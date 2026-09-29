import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, Type } from "@earendil-works/pi-ai";
import { Xean, openXeanStorage } from "../packages/core/src/index.ts";
import {
  chatGptWebProvider,
  reportedPiUsage,
} from "../packages/core/src/pi.ts";
import { piRuntime, readSettings } from "../packages/core/src/solve/config.ts";
import {
  campaignOptions,
  declarationVersion,
} from "../packages/core/src/solve/campaign.ts";
import { createSolver } from "../packages/core/src/solve/solver.ts";
import { project } from "../packages/core/src/solve/notes.ts";
import { ask } from "../packages/core/src/solve/pi.ts";

const selection = (name: string, args: unknown) =>
  JSON.stringify({ text: "", calls: [{ name, arguments: args }] });

function response(text: string) {
  const id = "chatcmpl-response-fixture";
  return new Response(
    [
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        model: "chatgpt-web",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: text },
            finish_reason: null,
          },
        ],
      })}`,
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        model: "chatgpt-web",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}`,
      "data: [DONE]",
    ].join("\n\n") + "\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("ChatGPT Web is explicit Explorer-only and one-shot", () => {
  expect(() =>
    readSettings({
      profiles: {
        default: {
          provider: "codex-chatgpt-web",
          model: "chatgpt-web/gpt-6-pro",
        },
      },
    }),
  ).toThrow("profiles.explorer");
  expect(() =>
    readSettings({
      profiles: {
        default: { provider: "openai", model: "gpt-6-astra" },
        correctness: {
          provider: "codex-chatgpt-web",
          model: "chatgpt-web/gpt-6-pro",
        },
      },
    }),
  ).toThrow("profiles.correctness");
  expect(() =>
    readSettings({
      profiles: {
        default: { provider: "openai", model: "gpt-6-astra" },
        explorer: {
          provider: "codex-chatgpt-web",
          model: "chatgpt-web/gpt-6-pro",
        },
      },
      maxExplorerResponses: 2,
    }),
  ).toThrow("maxExplorerResponses=1");
  const safe = readSettings({
    profiles: {
      default: { provider: "openai", model: "gpt-6-astra" },
      explorer: {
        provider: "codex-chatgpt-web",
        model: "chatgpt-web/gpt-6-pro",
      },
    },
  });
  expect(safe.maxExplorerResponses).toBe(1);
});

test("browser provider runs a quota-safe one-shot Explorer", async () => {
  const settings = readSettings({
    profiles: {
      default: { provider: "openai", model: "gpt-6-astra" },
      explorer: {
        provider: "codex-chatgpt-web",
        model: "chatgpt-web/gpt-6-pro",
        baseUrl: "https://bridge.invalid/v1",
      },
    },
    maxExplorerReads: 1,
    limits: { concurrency: 1, attempts: 1, providerCalls: 1 },
  });
  const runtime = piRuntime(settings, "unrelated-gateway-key");
  expect(runtime.profiles.explorer.options?.apiKey).toBeUndefined();
  const requests: any[] = [];
  const draft = {
    notes: [
      {
        id: "n1",
        summary: "First",
        detailedSummary: "Preserve the mathematical notation.",
        text: "Preserve a_b and \\sum_i exactly.",
        support: [],
      },
    ],
    candidate: true,
  };
  runtime.profiles.explorer.options!.fetch = Object.assign(
    async (_url: unknown, init?: RequestInit) => {
      expect(String(_url)).toBe("https://bridge.invalid/v1/chat/completions");
      expect(new Headers(init?.headers).get("authorization")).not.toContain(
        "unrelated-gateway-key",
      );
      const body = await new Response(init?.body).json();
      requests.push(body);
      expect(body.tools).toBeUndefined();
      expect(body.tool_choice).toBeUndefined();
      expect(body.max_output_tokens).toBeUndefined();
      expect(body.reasoning_effort).toBeUndefined();
      expect(
        body.messages.findLast((message: any) => message.role === "system")
          ?.content,
      ).toContain("Return exactly one JSON object matching this schema");
      expect(JSON.stringify(body.messages)).toContain(
        "Return exactly one JSON object matching this schema",
      );
      expect(JSON.stringify(body.messages)).not.toContain("read_notes");
      return response(selection("submit_result", draft));
    },
    { preconnect: fetch.preconnect },
  );
  const task = {
    problem: "Fixture task",
    completionCriteria: "Fixture result",
  };
  const engine = await Xean.open(
    new MemoryStorage(),
    campaignOptions(
      {
        version: declarationVersion,
        kind: "xean.role",
        role: "explorer",
        task,
        settings,
        input: {
          task,
          notes: [
            {
              id: "given",
              summary: "Read me",
              detailedSummary: "A fixture",
              text: "FROZEN-NOTE",
              support: [],
              revision: 0,
              imported: true,
              checks: [],
              verified: true,
              dead: false,
              accepted: false,
              candidate: false,
            },
          ],
          guidance: "Explore",
        },
      },
      runtime,
    ),
  );
  try {
    await engine.run();
    const snapshot = await engine.inspectWithRecords();
    expect(snapshot.campaign.status).toBe("completed");
    expect(snapshot.campaign.providerCalls).toBe(1);
    const notes = project(snapshot.campaign);
    expect(notes.map((n) => n.text)).toEqual([draft.notes[0]!.text]);
    expect(
      notes.every((n) => !n.imported && !n.verified && !n.accepted),
    ).toBeTrue();
    for (const kind of [
      "xean.call.started",
      "xean.call.request",
      "xean.call.settled",
    ])
      expect(snapshot.records.filter((r) => r.kind === kind)).toHaveLength(1);
    const settled = snapshot.records
      .filter((r) => r.kind === "xean.call.settled")
      .map((r) => r.data as any);
    expect(
      settled.every(
        (r) => r.usage === null && r.message.usageReported === false,
      ),
    ).toBeTrue();
    const identities = requests.map((r) =>
      JSON.parse(r.client_metadata["x-codex-turn-metadata"]),
    );
    expect(new Set(identities.map((i) => i.thread_id)).size).toBe(1);
    expect(new Set(identities.map((i) => i.turn_id)).size).toBe(1);
  } finally {
    await engine.close();
  }
});

test("ChatGPT Explorer is not dispatched again after an existing attempt", async () => {
  const task = {
    problem: "Quota fixture task",
    completionCriteria: "Quota fixture result",
  };
  const settings = readSettings({
    profiles: {
      default: { provider: "openai", model: "gpt-6-astra" },
      explorer: {
        provider: "codex-chatgpt-web",
        model: "chatgpt-web/gpt-6-pro",
      },
    },
  });
  const solver = createSolver(task, piRuntime(settings), {
    ...settings,
    chatGptSingleShot: true,
  });
  solver.functions.coordinator = async () => ({
    work: [{ kind: "explorer", guidance: "Continue" }],
  });
  const view = {
    task: { version: declarationVersion, kind: "xean.solve" },
    status: "running",
    callLimitReached: false,
    state: null,
    work: [],
    inputs: [],
  } as any;
  const execution = {
    attemptId: "quota-dispatch",
    attempt: 1,
    recorder: {
      begin: () => ({ recordRequest() {}, settle() {} }),
    },
  } as any;
  const first = await solver.coordinator.run(
    { id: 1 as any, kind: "start", value: null },
    view,
    execution,
    BACKGROUND_CONTEXT,
  );
  expect(
    first.dispatch?.filter(({ role }) => role === "xean.explorer"),
  ).toHaveLength(1);
  const second = await solver.coordinator.run(
    { id: 2 as any, kind: "completed", value: null },
    {
      ...view,
      work: [
        {
          id: "w1",
          role: "xean.explorer",
          status: "failed",
        },
      ],
    },
    execution,
    BACKGROUND_CONTEXT,
  );
  expect(
    second.dispatch?.filter(({ role }) => role === "xean.explorer"),
  ).toHaveLength(0);
});

test("browser provider returns final text and validates a generic typed output without coercion", async () => {
  const models = createModels();
  models.setProvider(chatGptWebProvider("https://bridge.invalid/v1"));
  const model = models.getModel("codex-chatgpt-web", "chatgpt-web/gpt-6-pro")!;
  const tool = {
    name: "answer",
    description: "Return an answer",
    parameters: Type.Object(
      { count: Type.Integer() },
      { additionalProperties: false },
    ),
  };
  const input = {
    messages: [{ role: "user" as const, content: "Answer", timestamp: 0 }],
  };
  for (const [text, valid] of [
    [selection("answer", { count: 2 }), true],
    [selection("answer", { count: "2" }), false],
    [selection("answer", { count: 2, extra: 1 }), false],
    [selection("missing", { count: 2 }), false],
    [
      JSON.stringify({
        text: "",
        calls: [
          { name: "answer", arguments: { count: 2 } },
          { name: "missing", arguments: {} },
        ],
      }),
      false,
    ],
    ['{"count":\\[\\]}', false],
  ] as const) {
    const options = {
      fetch: Object.assign(async () => response(text), {
        preconnect: fetch.preconnect,
      }),
    };
    const events = models.streamSimple(
      model,
      { ...input, tools: [tool] },
      options,
    );
    const types = [];
    for await (const event of events) types.push(event.type);
    const result = await events.result();
    expect(result.stopReason).toBe(valid ? "toolUse" : "error");
    expect(reportedPiUsage(result)).toBeNull();
    if (valid)
      expect(result.content).toMatchObject([
        { type: "toolCall", name: "answer", arguments: { count: 2 } },
      ]);
    else {
      expect(result.content).toEqual([]);
      expect(types).not.toContain("done");
    }
    const plain = await models.completeSimple(
      model,
      { ...input, tools: [tool] },
      { ...options, toolChoice: "none" },
    );
    expect(plain.content).toEqual([{ type: "text", text }]);
  }
  const lookup = {
    name: "lookup",
    description: "Look up a key",
    parameters: Type.Object(
      { key: Type.String() },
      { additionalProperties: false },
    ),
  };
  for (const envelope of [
    {
      text: "Checking",
      calls: [
        { name: "lookup", arguments: { key: "x" } },
        { name: "answer", arguments: { count: 2 } },
      ],
    },
    { text: "Finished", calls: [] },
  ]) {
    const result = await models.completeSimple(
      model,
      { ...input, tools: [tool, lookup] },
      {
        fetch: Object.assign(async () => response(JSON.stringify(envelope)), {
          preconnect: fetch.preconnect,
        }),
      },
    );
    expect(result.stopReason).toBe(envelope.calls.length ? "toolUse" : "stop");
    expect(result.content).toMatchObject([
      { type: "text", text: envelope.text },
      ...envelope.calls.map((call) => ({ type: "toolCall", ...call })),
    ]);
  }
  const mismatched = await models.completeSimple(
    model,
    { ...input, tools: [tool, lookup] },
    {
      fetch: Object.assign(
        async () => response(selection("answer", { key: "x" })),
        { preconnect: fetch.preconnect },
      ),
    },
  );
  expect(mismatched.stopReason).toBe("error");
  expect(mismatched.content).toEqual([]);
  let dispatched = false;
  const invalidPayload = await models.completeSimple(model, input, {
    onPayload: () => null,
    fetch: Object.assign(
      async () => {
        dispatched = true;
        return response("unexpected");
      },
      { preconnect: fetch.preconnect },
    ),
  });
  // Preserve a hook's replacement exactly, including an invalid null request.
  expect(invalidPayload.stopReason).toBe("error");
  expect(dispatched).toBeFalse();
});

test("browser provider rejects images and settles cancellation without replay", async () => {
  const models = createModels();
  models.setProvider(chatGptWebProvider());
  const model = models.getModel("codex-chatgpt-web", "chatgpt-web/gpt-6-pro")!;
  const input = {
    messages: [{ role: "user" as const, content: "Answer", timestamp: 0 }],
  };
  let calls = 0;
  const controller = new AbortController();
  const options = {
    signal: controller.signal,
    fetch: Object.assign(
      async (_url: unknown, init?: RequestInit) => {
        calls++;
        controller.abort();
        init?.signal?.throwIfAborted();
        throw new Error("Cancellation did not reach fetch");
      },
      { preconnect: fetch.preconnect },
    ),
  };
  const tool = {
    name: "one",
    description: "Output",
    parameters: Type.Object({}),
  };
  expect(
    (
      await models.completeSimple(
        model,
        {
          messages: [
            {
              role: "user",
              content: [
                { type: "image", data: "fixture", mimeType: "image/png" },
              ],
              timestamp: 0,
            },
          ],
          tools: [tool],
        },
        options,
      )
    ).stopReason,
  ).toBe("error");
  expect(calls).toBe(0);
  expect((await models.completeSimple(model, input, options)).stopReason).toBe(
    "aborted",
  );
  expect(calls).toBe(1);
  // Pi may reject an already-aborted request during auth, before invoking the provider.
  expect(["error", "aborted"]).toContain(
    (await models.completeSimple(model, input, options)).stopReason,
  );
  expect(calls).toBe(1);
});

test("reopening an interrupted browser worker never submits a second request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-browser-recovery-"));
  const path = join(directory, "campaign.sqlite");
  const started = Promise.withResolvers<void>();
  let calls = 0;
  const task = {
    problem: "Fixture task",
    completionCriteria: "Fixture result",
  };
  const settings = readSettings({
    profiles: {
      default: { provider: "openai", model: "gpt-6-astra" },
      explorer: {
        provider: "codex-chatgpt-web",
        model: "chatgpt-web/gpt-6-pro",
        baseUrl: "https://bridge.invalid/v1",
      },
    },
    limits: { concurrency: 1, attempts: 3, providerCalls: 3 },
  });
  const options = () =>
    campaignOptions(
      {
        version: declarationVersion,
        kind: "xean.role",
        role: "explorer",
        task,
        settings,
        input: { task, notes: [], guidance: "Explore" },
      },
      () => {
        const runtime = piRuntime(settings);
        runtime.profiles.explorer.options!.fetch = Object.assign(
          async (_url: unknown, init?: RequestInit) => {
            calls++;
            if (calls > 1)
              return response(
                selection("submit_result", { notes: [], candidate: false }),
              );
            const signal = init!.signal!;
            signal.throwIfAborted();
            return new Promise<Response>((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              });
              started.resolve();
            });
          },
          { preconnect: fetch.preconnect },
        );
        return runtime;
      },
    );
  let engine = await Xean.open(await openXeanStorage(path), options());
  try {
    const running = engine.run();
    await started.promise;
    await engine.close();
    await running;
    expect(calls).toBe(1);
    engine = await Xean.open(await openXeanStorage(path), options());
    const campaign = await engine.run();
    expect(campaign.status).toBe("blocked");
    expect(campaign.work[0]).toMatchObject({ status: "failed", attempts: 2 });
    expect(campaign.work[0]!.error).toContain(
      "ChatGPT Web cannot repeat an interrupted worker",
    );
    expect(calls).toBe(1);
    expect(campaign.providerCalls).toBe(1);
    const records = await engine.records();
    for (const kind of ["xean.call.started", "xean.call.settled"])
      expect(records.filter((record) => record.kind === kind)).toHaveLength(1);
    expect(
      records.filter((record) => record.kind === "xean.attempt.interrupted"),
    ).toHaveLength(1);
  } finally {
    await engine.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("solver recovery never resubmits a disconnected browser request", async () => {
  const runtime = piRuntime(
    readSettings({
      profiles: {
        default: {
          provider: "openai",
          model: "gpt-6-astra",
        },
        explorer: {
          provider: "codex-chatgpt-web",
          model: "chatgpt-web/gpt-6-pro",
        },
      },
    }),
  );
  let calls = 0;
  let settled = 0;
  runtime.profiles.explorer.options!.fetch = Object.assign(
    async () => {
      calls++;
      // A second request would hide the disconnect behind a successful result.
      return calls === 1
        ? new Response("upstream connection lost", { status: 502 })
        : response(selection("submit_result", { answer: true }));
    },
    { preconnect: fetch.preconnect },
  );
  await expect(
    ask(
      runtime,
      "explorer",
      "Return the answer",
      {},
      Type.Object({ answer: Type.Boolean() }),
      {
        attemptId: "browser-disconnect",
        attempt: 1,
        recorder: {
          begin: () => ({
            recordRequest() {},
            settle(_message, usage) {
              expect(usage).toBeNull();
              settled++;
            },
          }),
        },
      },
      BACKGROUND_CONTEXT,
    ),
  ).rejects.toThrow();
  expect(calls).toBe(1);
  expect(settled).toBe(1);
});
