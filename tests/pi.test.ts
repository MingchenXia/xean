import { temporaryDirectory } from "./directory.ts";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setImmediate } from "node:timers/promises";
import {
  cleanupSessionResources,
  createModels,
  fauxAssistantMessage,
  isRetryableAssistantError,
  normalizeContext,
  retryAssistantCall,
  type Model,
} from "@earendil-works/pi-ai";
import { streamSimple as responses } from "@earendil-works/pi-ai/api/openai-responses";
import {
  streamSimple as codex,
  getOpenAICodexWebSocketDebugStats,
} from "@earendil-works/pi-ai/api/openai-codex-responses";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  continuationContent,
  createSession,
  defineDoc,
  SessionFailed,
  type ConversationId,
  type Tx,
} from "@earendil-works/pi-durable";
import {
  NodeSqliteDatabase,
  openNodeSqliteStorage,
} from "@earendil-works/pi-durable/storage/sqlite/node";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";

test("native read-only storage rejects ID allocation and commits even on a writable connection", async () => {
  const directory = await temporaryDirectory("pi-readonly-");
  const path = join(directory, "campaign.sqlite");
  await (await openNodeSqliteStorage(path)).close(context);
  using database = new DatabaseSync(path);
  database.exec("BEGIN");
  const retained = database.prepare("SELECT * FROM durable_metadata");
  const metadata = () => retained.get();
  const before = metadata();
  const storage = await SqliteStorage.open(
    new NodeSqliteDatabase(database, { readOnly: true }),
    { readOnly: true },
  );
  try {
    await expect(storage.mintId()).rejects.toThrow("read-only");
    await expect(storage.commit([], context)).rejects.toThrow("read-only");
    expect(metadata()).toEqual(before);
    using writer = new DatabaseSync(path);
    writer.exec("UPDATE durable_metadata SET next_seq = next_seq + 1");
    await storage.close(context);
    expect(writer.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get()).toEqual({
      busy: 0,
      log: 0,
      checkpointed: 0,
    });
    expect(database.isOpen).toBe(false);
  } finally {
    await storage.close(context);
  }
  using ended = new DatabaseSync(path);
  ended.exec("BEGIN; ROLLBACK");
  await new NodeSqliteDatabase(ended, { readOnly: true }).close();
  expect(ended.isOpen).toBe(false);
});

test("zero retention collects idle values, pins watched values, and reloads committed state", async () => {
  const directory = await temporaryDirectory("pi-document-cache-");
  const session = createSession(
    await openNodeSqliteStorage(join(directory, "cache.sqlite")),
    { documentRetentionMs: 0 },
  );
  const Doc = defineDoc({
    kind: "fixture.payload",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ text: "" }),
  });
  const ids: ConversationId[] = [];
  const refs: WeakRef<object>[] = [];
  const changed = Promise.withResolvers<string | undefined>();
  try {
    for (const text of ["watched", "idle"]) {
      const id = await session.commit(async (tx) => {
        const conversation = await tx.createConversation({
          ownership: { kind: "ownerless" },
        });
        (await tx.doc(Doc, conversation.id)).text = text;
        return conversation.id;
      }, context);
      ids.push(id);
      if (text === "watched") {
        const watch = (await session.watchDoc(Doc, id, context))!;
        refs.push(new WeakRef(watch.value!));
        watch.start(async (value) => {
          changed.resolve(value?.text);
        });
      } else
        refs.push(new WeakRef((await session.snapshot(Doc, id, context))!));
    }
    await setImmediate();
    Bun.gc(true);
    expect(refs[0]!.deref()).toEqual({ text: "watched" });
    expect(refs[1]!.deref()).toBeUndefined();
    expect(await session.snapshot(Doc, ids[1]!, context)).toEqual({
      text: "idle",
    });
    await session.commit(async (tx) => {
      (await tx.doc(Doc, ids[0]!)).text = "Updated after eviction";
    }, context);
    expect((await session.snapshot(Doc, ids[0]!, context))?.text).toBe(
      "Updated after eviction",
    );
    expect(await changed.promise).toBe("Updated after eviction");
    await setImmediate();
    Bun.gc(true);
    expect(refs[0]!.deref()).toBeUndefined();
  } finally {
    await session.close(context);
  }
});

test("a retained retired watch releases its obsolete document tracker", async () => {
  const directory = await temporaryDirectory("pi-retired-watch-");
  const session = createSession(
    await openNodeSqliteStorage(join(directory, "cache.sqlite")),
    { documentRetentionMs: 0 },
  );
  const Doc = defineDoc({
    kind: "fixture.retired-payload",
    version: 1,
    scope: "session",
    initial: () => ({ text: "retired" }),
  });
  try {
    await session.commit(async (tx) => {
      await tx.doc(Doc);
    }, context);
    const watch = (await session.watchDoc(Doc, context))!;
    const ref = new WeakRef(watch.value!);
    watch.start(async () => {});
    await session.commit((tx) => tx.retireDoc(Doc), context);
    await expect(watch.closed).resolves.toEqual({ reason: "retired" });
    await session.commit(async (tx) => {
      await tx.doc(Doc);
    }, context);
    await setImmediate();
    Bun.gc(true);
    expect(ref.deref()).toBeUndefined();
    expect(watch.value).toBeNull();
  } finally {
    await session.close(context);
  }
});

test("native cache eviction preserves multi-document commits and rollback after reopening", async () => {
  const directory = await temporaryDirectory("pi-cache-transactions-");
  const path = join(directory, "cache.sqlite");
  const storage = await openNodeSqliteStorage(path);
  const session = createSession(storage, { documentRetentionMs: 0 });
  const Doc = defineDoc({
    kind: "fixture.transaction",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ value: 0 }),
  });
  const ids: ConversationId[] = [];
  try {
    await session.commit(async (tx) => {
      for (let i = 0; i < 2; i++) {
        const conversation = await tx.createConversation({
          ownership: { kind: "ownerless" },
        });
        ids.push(conversation.id);
        (await tx.doc(Doc, conversation.id)).value = i;
      }
    }, context);
    const edit = async (tx: Tx) => {
      const first = await tx.doc(Doc, ids[0]!);
      for (let i = 1; i < ids.length; i++)
        (await tx.doc(Doc, ids[i]!)).value += 1000;
      // Zero retention must keep every draft valid until this commit settles.
      first.value += 1000;
    };
    await session.commit(edit, context);
    await expect(
      session.commit(async (tx) => {
        await edit(tx);
        throw new Error("Fixture callback rollback");
      }, context),
    ).rejects.toThrow("Fixture callback rollback");
    for (let i = 0; i < ids.length; i++)
      expect((await session.snapshot(Doc, ids[i]!, context))?.value).toBe(
        i + 1000,
      );
    const failure = new Error("Fixture storage rollback");
    storage.commit = async () => {
      throw failure;
    };
    await expect(session.commit(edit, context)).rejects.toBe(failure);
    await expect(session.closed).resolves.toEqual({
      reason: "failed",
      error: failure,
    });
    expect(() => session.snapshot(Doc, ids[0]!, context)).toThrow(
      SessionFailed,
    );
  } finally {
    await session.close(context);
  }
  const reopened = createSession(await openNodeSqliteStorage(path), {
    documentRetentionMs: 0,
  });
  try {
    for (let i = 0; i < ids.length; i++)
      expect((await reopened.snapshot(Doc, ids[i]!, context))?.value).toBe(
        i + 1000,
      );
    await reopened.commit(async (tx) => {
      (await tx.doc(Doc, ids[0]!)).value++;
    }, context);
    expect((await reopened.snapshot(Doc, ids[0]!, context))?.value).toBe(1001);
  } finally {
    await reopened.close(context);
  }
});

const transcript = normalizeContext({
  messages: [{ role: "user", content: "Fixture", timestamp: 0 }],
});
const jwt = `fixture.${btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture" } }))}.signature`;
const model: Model<"openai-responses"> = {
  id: "fixture",
  name: "Fixture",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://fixture.invalid",
  reasoning: false,
  input: ["text"],
  contextWindow: 20000,
  maxTokens: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const codexModel = {
  ...model,
  api: "openai-codex-responses" as const,
  provider: "openai-codex",
};
const mockFetch = (
  run: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
): typeof fetch => Object.assign(run, { preconnect: fetch.preconnect });
const terminal = (status = "completed", extra = {}) => ({
  type: `response.${status}`,
  response: { id: "fixture", status, output: [], ...extra },
});
function sse(events: object[], newline = "\n", fragmented = false) {
  const bytes = new TextEncoder().encode(
    events
      .map(
        (event) =>
          `event: ${(event as { type: string }).type}${newline}data: ${JSON.stringify(event)}${newline}${newline}`,
      )
      .join(""),
  );
  return new Response(
    fragmented
      ? new ReadableStream({
          start(controller) {
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
            controller.close();
          },
        })
      : bytes,
    { headers: { "content-type": "text/event-stream" } },
  );
}
const options = { apiKey: jwt, transport: "sse" as const, maxRetries: 0 };
function call(
  useCodex: boolean,
  events: object[],
  newline = "\n",
  fragmented = false,
) {
  const request = {
    ...options,
    fetch: mockFetch(async () => sse(events, newline, fragmented)),
  };
  return (
    useCodex
      ? codex(codexModel, transcript, request)
      : responses(model, transcript, request)
  ).result();
}

test.each([false, true])(
  "Responses continuation limits preserve completed output without provider retries (Codex=%s)",
  async (useCodex) => {
    const thinking = {
      type: "reasoning",
      id: "reasoning",
      summary: [{ type: "summary_text", text: "Completed reasoning summary" }],
    };
    const message = {
      type: "message",
      id: "progress",
      role: "assistant",
      phase: "commentary",
      content: [{ type: "output_text", text: "Progress to continue." }],
    };
    for (const reason of [
      "max_messages",
      "max_output_tokens",
      "max_messages_extra",
      "content_filter",
      "authentication_error",
      "insufficient_quota",
      "context_length_exceeded",
    ]) {
      let requests = 0;
      const result = await retryAssistantCall(
        () => {
          requests++;
          return call(useCodex, [
            {
              type: "response.output_item.done",
              output_index: 0,
              item: thinking,
            },
            {
              type: "response.output_item.done",
              output_index: 1,
              item: message,
            },
            terminal("incomplete", {
              incomplete_details: { reason },
              output: [
                { ...thinking, encrypted_content: "terminal-only" },
                message,
              ],
              usage: {
                input_tokens: 100,
                output_tokens: 25,
                total_tokens: 125,
                input_tokens_details: { cached_tokens: 40 },
                output_tokens_details: { reasoning_tokens: 20 },
              },
            }),
          ]);
        },
        { enabled: true, maxRetries: 1, baseDelayMs: 1 },
        undefined,
      );
      const continuation = ["max_messages", "max_output_tokens"].includes(
        reason,
      );
      expect(requests).toBe(1);
      expect(result.rawStopReason).toBe(`incomplete.${reason}`);
      expect(result.stopReason).toBe(continuation ? "length" : "error");
      if (continuation) expect(result.errorMessage).toBeUndefined();
      else expect(result.errorMessage).toContain(reason);
      expect(result.responseId).toBe("fixture");
      expect(result.usageReported).toBe(true);
      expect(result.usage).toMatchObject({
        input: 60,
        output: 25,
        reasoning: 20,
        cacheRead: 40,
        totalTokens: 125,
      });
      const retained = result.content.find(
        (block) => block.type === "thinking",
      )!;
      expect(retained.thinking).toBe("Completed reasoning summary");
      expect(JSON.parse(retained.thinkingSignature!)).toEqual({
        ...thinking,
        encrypted_content: "terminal-only",
      });
      const text = result.content.find((block) => block.type === "text")!;
      expect(text.text).toBe("Progress to continue.");
      expect(JSON.parse(text.textSignature!)).toEqual({
        v: 1,
        id: "progress",
        phase: "commentary",
      });
    }
  },
);

test.each([false, true])(
  "Responses continuation replays unsigned summaries as text and keeps signed reasoning (Codex=%s)",
  async (useCodex) => {
    const signed = {
      type: "reasoning",
      id: "rs_complete",
      encrypted_content: "fixture-opaque",
      summary: [],
    };
    const summary = "Unfinished but reusable reasoning summary";
    const partial = await call(useCodex, [
      { type: "response.output_item.done", output_index: 0, item: signed },
      {
        type: "response.output_item.added",
        output_index: 1,
        item: { type: "reasoning", id: "rs_partial", summary: [] },
      },
      {
        type: "response.reasoning_summary_text.delta",
        output_index: 1,
        summary_index: 0,
        delta: summary,
      },
      terminal("incomplete", {
        incomplete_details: { reason: "max_messages" },
      }),
    ]);
    expect(partial.stopReason).toBe("length");
    expect(partial.content[1]).toMatchObject({
      type: "thinking",
      thinking: summary,
    });
    expect(partial.content[1]).not.toHaveProperty("thinkingSignature");
    for (const limited of [true, false]) {
      let input: unknown;
      const request = {
        ...options,
        onPayload: (payload: unknown) => {
          input = (payload as { input: unknown }).input;
        },
        fetch: mockFetch(async () => sse([terminal()])),
      };
      const replay = normalizeContext({
        messages: [
          ...transcript.messages,
          limited
            ? partial
            : { ...partial, stopReason: "stop", rawStopReason: "completed" },
          { role: "user", content: "Continue", timestamp: 1 },
        ],
      });
      const result = await (
        useCodex
          ? codex(codexModel, replay, request)
          : responses(model, replay, request)
      ).result();
      expect(result.stopReason).toBe("stop");
      expect(input).toEqual(expect.arrayContaining([signed]));
      const replayedSummary = expect.arrayContaining([
        expect.objectContaining({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: summary, annotations: [] }],
        }),
      ]);
      if (limited) expect(input).toEqual(replayedSummary);
      else expect(input).not.toEqual(replayedSummary);
    }
  },
);

test("Anthropic disconnects retain signatures only after a completed thinking block", async () => {
  const original = globalThis.fetch;
  const provider = anthropicProvider();
  const selected = provider.getModels().find((model) => model.reasoning)!;
  const thinking = { type: "thinking" as const, thinking: "Partial reasoning" };
  const signature = "TRUNCATED_SIGNATURE_PREFIX";
  try {
    for (const completed of [false, true]) {
      globalThis.fetch = mockFetch(async () =>
        sse([
          {
            type: "message_start",
            message: {
              id: "fixture",
              model: selected.id,
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          },
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "thinking", thinking: "", signature: "" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "thinking_delta", thinking: thinking.thinking },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "signature_delta", signature },
          },
          ...(completed ? [{ type: "content_block_stop", index: 0 }] : []),
          {
            type: "error",
            error: {
              type: "api_error",
              message: "stream disconnected before completion",
            },
          },
        ]),
      );
      const result = await provider
        .streamSimple(selected, transcript, {
          apiKey: "fixture",
          maxRetries: 0,
        })
        .result();
      expect(result.stopReason).toBe("error");
      expect(isRetryableAssistantError(result)).toBe(true);
      expect(result.content).toEqual([
        completed ? { ...thinking, thinkingSignature: signature } : thinking,
      ]);
      expect(continuationContent(result)).toEqual([
        completed
          ? { ...thinking, thinkingSignature: signature }
          : { type: "text", text: thinking.thinking },
      ]);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("HTTP status survives adapter catches for native retry classification", async () => {
  const original = globalThis.fetch;
  try {
    for (const provider of [
      openaiProvider(),
      anthropicProvider(),
      googleProvider(),
    ]) {
      const models = createModels();
      models.setProvider(provider);
      const selected = provider.getModels().find((model) => model.reasoning)!;
      for (const status of [401, 404, 529]) {
        globalThis.fetch = mockFetch(async () =>
          Response.json(
            {
              error: {
                message:
                  status === 529
                    ? "Opaque detail 401 403"
                    : "Invalid timeout configuration",
              },
            },
            { status },
          ),
        );
        const result = await models.completeSimple(selected, transcript, {
          apiKey: "fixture",
          maxRetries: 0,
        });
        expect(result.providerError).toEqual({ status });
        expect(isRetryableAssistantError(result)).toBe(status === 529);
      }
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("terminal usage distinguishes zero from absence without backfilling failed reasoning", async () => {
  const item = {
    type: "reasoning",
    id: "reasoning",
    summary: [{ type: "summary_text", text: "Partial reasoning" }],
  };
  for (const useCodex of [false, true]) {
    for (const status of ["completed", "failed"]) {
      const result = await call(useCodex, [
        { type: "response.output_item.done", output_index: 0, item },
        terminal(status, {
          output: [{ ...item, encrypted_content: "terminal-only" }],
          error: { code: "invalid_request_error", message: "Fixture failure" },
          usage: {
            input_tokens: 100,
            output_tokens: 5,
            total_tokens: 105,
            input_tokens_details: { cached_tokens: 40 },
          },
        }),
      ]);
      expect(result.stopReason).toBe(status === "failed" ? "error" : "stop");
      expect(result.usageReported).toBe(true);
      expect(result.usage).toMatchObject({
        input: 60,
        cacheRead: 40,
        output: 5,
        totalTokens: 105,
      });
      const thinking = result.content.find(
        (block) => block.type === "thinking",
      )!;
      expect(JSON.parse(thinking.thinkingSignature!).encrypted_content).toBe(
        status === "failed" ? undefined : "terminal-only",
      );
    }
    for (const usage of [
      undefined,
      {},
      { input_tokens: "5" },
      { input_tokens: 0 },
    ]) {
      const result = await call(useCodex, [terminal("completed", { usage })]);
      expect(result.usageReported === true).toBe(usage?.input_tokens === 0);
    }
  }
  const original = globalThis.fetch;
  const provider = anthropicProvider();
  const selected = provider.getModels().find((model) => model.reasoning)!;
  try {
    for (const usage of [{}, { input_tokens: 0 }]) {
      globalThis.fetch = mockFetch(async () =>
        sse([
          {
            type: "message_start",
            message: { id: "fixture", model: selected.id, usage },
          },
          { type: "message_delta", delta: {}, usage: {} },
          {
            type: "error",
            error: { type: "api_error", message: "Fixture failure" },
          },
        ]),
      );
      const result = await provider
        .streamSimple(selected, transcript, {
          apiKey: "fixture",
          maxRetries: 0,
        })
        .result();
      expect(result.usageReported === true).toBe(usage.input_tokens === 0);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("Codex preserves account limits and classifies transient failures", async () => {
  const disconnected =
    "stream error: stream disconnected before completion: stream closed before response.completed";
  for (const [status, code, retry] of [
    [429, "usage_limit_reached", false],
    [429, "usage_not_included", false],
    [429, "rate_limit_exceeded", true],
    [401, "future_error", false],
    [403, "future_error", false],
    [529, "future_error", true],
  ] as const) {
    let requests = 0;
    const result = await codex(codexModel, transcript, {
      ...options,
      maxRetries: 1,
      fetch: mockFetch(async () => {
        requests++;
        return Response.json(
          {
            error: {
              code,
              type: "rate_limit_error",
              message: "Timeout detail",
            },
          },
          { status, headers: { "retry-after-ms": "0" } },
        );
      }),
    }).result();
    expect(result.providerError).toEqual({
      status,
      type: "rate_limit_error",
      code,
    });
    expect(isRetryableAssistantError(result)).toBe(retry);
    expect(requests).toBe(retry ? 2 : 1);
    expect(result.errorMessage?.includes("ChatGPT usage limit")).toBe(
      code.startsWith("usage_"),
    );
  }
  for (const [errorMessage, retry] of [
    ["JSON Parse error: Unterminated string", false],
    ["Connection terminated unexpectedly", true],
    ["The pending stream has been canceled", true],
    ["invalid_request_error: timeout", false],
    ["project_spend_limit_exceeded: 429", false],
    ["credit_balance_exhausted: 429", false],
    ["Upstream closed stream without completion", true],
    ["stream_incomplete", true],
    ["Previous response owner account is unavailable", true],
    [disconnected, true],
    [
      "OpenAI Responses stream completed with an unfinished tool call: submit_explorer (call_fixture)",
      true,
    ],
    ["No response body", true],
    ...[
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EPIPE",
      "UND_ERR_SOCKET",
    ].map((code) => [code, true] as const),
    [
      "invalid_request_error: OpenAI Responses stream completed with an unfinished tool call: submit_explorer (call_fixture)",
      false,
    ],
    ["context_length_exceeded: No response body", false],
    [`authentication_error: ${disconnected}`, false],
    [`permission_denied: ${disconnected}`, false],
    [`insufficient_quota: ${disconnected}`, false],
  ] as const)
    expect(
      isRetryableAssistantError({
        ...fauxAssistantMessage([], { stopReason: "error", errorMessage }),
        providerError: {},
      }),
    ).toBe(retry);
});

test("Xean registers native cleanup for Codex session diagnostics and fallback state", async () => {
  await import("../src/roles/conversation.ts");
  const original = globalThis.WebSocket;
  let sockets = 0,
    requests = 0;
  class OfflineWebSocket extends EventTarget {
    readyState = 0;
    constructor() {
      super();
      sockets++;
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      });
    }
    send() {
      setTimeout(
        () =>
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify(
                terminal("failed", {
                  error: {
                    code: "future_error",
                    type: "server_error",
                    message: "Opaque detail",
                  },
                }),
              ),
            }),
          ),
        0,
      );
    }
    close() {
      this.readyState = 3;
      this.dispatchEvent(new Event("close"));
    }
  }
  globalThis.WebSocket = OfflineWebSocket as unknown as typeof WebSocket;
  const sessionId = crypto.randomUUID();
  try {
    const request = () =>
      retryAssistantCall(
        () =>
          codex(codexModel, transcript, {
            ...options,
            sessionId,
            transport: "websocket-cached",
            env: {
              HTTP_PROXY: "",
              HTTPS_PROXY: "",
              ALL_PROXY: "",
              NO_PROXY: "*",
            },
            fetch: mockFetch(async () => {
              requests++;
              return sse([terminal()]);
            }),
          }).result(),
        { enabled: true, maxRetries: 1, baseDelayMs: 1 },
        undefined,
      );
    const result = await request();
    expect([result.stopReason, sockets, requests]).toEqual(["stop", 1, 1]);
    expect(
      getOpenAICodexWebSocketDebugStats(sessionId)?.websocketFallbackActive,
    ).toBe(true);
    cleanupSessionResources(sessionId);
    expect(getOpenAICodexWebSocketDebugStats(sessionId)).toBeUndefined();
    const repeated = await request();
    expect([repeated.stopReason, sockets, requests]).toEqual(["stop", 2, 2]);
  } finally {
    cleanupSessionResources(sessionId);
    globalThis.WebSocket = original;
  }
});

test("Codex SSE accepts CRLF frames even when every byte arrives separately", async () => {
  for (const newline of ["\n", "\r\n"])
    for (const fragmented of [false, true]) {
      const result = await call(
        true,
        [{ type: "response.created", response: { id: "fixture" } }, terminal()],
        newline,
        fragmented,
      );
      expect(result.stopReason).toBe("stop");
    }
});
