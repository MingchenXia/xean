import { expect, spyOn, test } from "bun:test";
import {
  cleanupSessionResources,
  normalizeContext,
  retryAssistantCall,
  type Model,
} from "@earendil-works/pi-ai";
import {
  getOpenAICodexWebSocketDebugStats,
  streamSimple,
} from "@earendil-works/pi-ai/api/openai-codex-responses";

const apiKey = "xean-offline-websocket-key";
const model: Model<"openai-codex-responses"> = {
  id: "xean-websocket-fixture",
  name: "Xean WebSocket fixture",
  api: "openai-codex-responses",
  provider: "openai-codex",
  baseUrl: "https://xean.invalid/backend-api",
  reasoning: false,
  input: ["text"],
  contextWindow: 20_000,
  maxTokens: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: { codexProxyAuth: true },
};

function reply(index: number) {
  const item = {
    type: "message",
    id: `msg_${index}`,
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: `reply ${index}`, annotations: [] }],
  };
  return [
    { type: "response.output_item.added", output_index: 0, item },
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: {
        id: `resp_${index}`,
        status: "completed",
        output: [item],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    },
  ];
}

function fixture(
  lostContextAt?: number,
  failureCode = "previous_response_not_found",
  failureType?: string,
) {
  type Connection = {
    id: number;
    path: string;
    authorization: string | null;
    session: string | null;
    account: string | null;
  };
  const connections: Connection[] = [];
  const requests: { connection: Connection; body: Record<string, unknown> }[] =
    [];
  const active = new Set<OfflineWebSocket>();
  const original = globalThis.WebSocket;
  // Exercise Pi's native parser and continuation state without OS sockets.
  class OfflineWebSocket extends EventTarget {
    readyState = 0;
    readonly connection: Connection;

    constructor(url: string, options: { headers: Record<string, string> }) {
      super();
      const headers = new Headers(options.headers);
      this.connection = {
        id: connections.length + 1,
        path: new URL(url).pathname,
        authorization: headers.get("authorization"),
        session: headers.get("session-id"),
        account: headers.get("chatgpt-account-id"),
      };
      connections.push(this.connection);
      active.add(this);
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      });
    }

    send(message: string) {
      requests.push({ connection: this.connection, body: JSON.parse(message) });
      const events =
        requests.length === lostContextAt
          ? [
              {
                type: "response.failed",
                response: {
                  id: "resp_lost",
                  status: "failed",
                  output: [],
                  error: {
                    code: failureCode,
                    type: failureType,
                    message:
                      failureCode === "stream_incomplete"
                        ? "Upstream websocket closed before response.completed (close_code=1011)"
                        : "fixture context expired",
                  },
                },
              },
            ]
          : reply(requests.length);
      setTimeout(() => {
        for (const event of events)
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify(event),
            }),
          );
      }, 0);
    }

    close() {
      this.readyState = 3;
      active.delete(this);
      this.dispatchEvent(new Event("close"));
    }
  }
  globalThis.WebSocket = OfflineWebSocket as unknown as typeof WebSocket;
  return {
    requests,
    connections,
    endpoint: (name = "a") => `https://xean.invalid/${name}`,
    cleanup(sessionId: string) {
      cleanupSessionResources(sessionId);
      expect(active.size).toBe(0);
      expect(getOpenAICodexWebSocketDebugStats(sessionId)).toBeUndefined();
    },
    stop() {
      for (const socket of active) socket.close();
      globalThis.WebSocket = original;
    },
  };
}

function conversation(
  sessionId: string,
  onPayload?: (payload: unknown) => void,
) {
  const context = normalizeContext({
    messages: [
      { role: "system", content: "Offline fixture", timestamp: 0 },
      { role: "user", content: "Begin", timestamp: 1 },
    ],
  });
  return async (baseUrl: string, key = apiKey) => {
    const stream = streamSimple({ ...model, baseUrl }, context, {
      apiKey: key,
      sessionId,
      transport: "websocket-cached",
      websocketConnectTimeoutMs: 1000,
      timeoutMs: 1000,
      maxRetries: 0,
      onPayload,
      fetch: Object.assign(
        async () => {
          throw new Error("Unexpected HTTP fallback in WebSocket fixture");
        },
        { preconnect: fetch.preconnect },
      ),
      env: { HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", NO_PROXY: "*" },
    });
    for await (const _event of stream) {
      /* Drain native stream events. */
    }
    const result = await stream.result();
    expect(result.stopReason).toBe("stop");
    context.messages.push(result, {
      role: "user",
      content: "Continue",
      timestamp: result.timestamp + 1,
    });
    return result;
  };
}

test("native WebSocket continuation avoids redundant body encoding and recovers lost context", async () => {
  const sessionId = `xean-ws-continuation-${crypto.randomUUID()}`;
  const server = fixture(3);
  let fullBodySerializations = 0;
  const requestBodies = new WeakSet<object>();
  const stringify = JSON.stringify;
  const stringifySpy = spyOn(JSON, "stringify").mockImplementation(
    (value, replacer, space) => {
      if (requestBodies.has(value)) fullBodySerializations++;
      return stringify(value, replacer as never, space);
    },
  );
  const run = conversation(sessionId, (payload) => {
    if (typeof payload !== "object" || payload === null)
      throw new Error("Expected a request body");
    requestBodies.add(payload);
  });
  try {
    await run(server.endpoint());
    await run(server.endpoint());
    await run(server.endpoint());
    const bodies = server.requests.map((request) => request.body);
    expect(bodies).toHaveLength(4);
    expect(bodies[0]).not.toHaveProperty("previous_response_id");
    expect(bodies[1]).toMatchObject({
      previous_response_id: "resp_1",
      input: [{ role: "user" }],
    });
    expect(bodies[2]).toHaveProperty("previous_response_id", "resp_2");
    expect(bodies[3]).not.toHaveProperty("previous_response_id");
    expect((bodies[3]!.input as unknown[]).length).toBeGreaterThan(
      (bodies[2]!.input as unknown[]).length,
    );
    expect(server.requests[0]?.connection.id).toBe(
      server.requests[1]?.connection.id,
    );
    expect(server.requests[2]?.connection.id).not.toBe(
      server.requests[3]?.connection.id,
    );
    expect(
      server.connections.every(
        (connection) =>
          connection.authorization === `Bearer ${apiKey}` &&
          connection.session === sessionId &&
          connection.account === null,
      ),
    ).toBe(true);
    expect(getOpenAICodexWebSocketDebugStats(sessionId)).toBeDefined();
    expect(fullBodySerializations).toBe(0);
    server.cleanup(sessionId);
  } finally {
    stringifySpy.mockRestore();
    cleanupSessionResources(sessionId);
    server.stop();
  }
});

test("native WebSocket sessions isolate credentials and endpoints", async () => {
  const sessionId = `xean-ws-isolation-${crypto.randomUUID()}`;
  const server = fixture();
  const run = conversation(sessionId);
  const secondKey = "xean-different-offline-key";
  try {
    await run(server.endpoint("a"));
    await run(server.endpoint("a"), secondKey);
    await run(server.endpoint("b"));
    expect(server.requests).toHaveLength(3);
    expect(
      server.requests.map((request) => request.connection.authorization),
    ).toEqual([`Bearer ${apiKey}`, `Bearer ${secondKey}`, `Bearer ${apiKey}`]);
    expect(server.requests.map((request) => request.connection.path)).toEqual([
      "/a/codex/responses",
      "/a/codex/responses",
      "/b/codex/responses",
    ]);
    for (const request of server.requests)
      expect(request.body).not.toHaveProperty("previous_response_id");
    server.cleanup(sessionId);
  } finally {
    cleanupSessionResources(sessionId);
    server.stop();
  }
});

test.each([
  ["stream_incomplete", undefined],
  ["future_provider_failure", "server_error"],
])(
  "%s switches bounded retries to HTTP with full history",
  async (code, type) => {
    const sessionId = `xean-ws-failure-${crypto.randomUUID()}`;
    const server = fixture(1, code, type);
    const context = normalizeContext({
      messages: [
        { role: "user", content: "Preserve this full request", timestamp: 1 },
      ],
    });
    const httpRequests: unknown[] = [];
    let attempts = 0;
    try {
      const result = await retryAssistantCall(
        async () => {
          attempts++;
          return streamSimple(model, context, {
            apiKey,
            sessionId,
            transport: "websocket-cached",
            maxRetries: 0,
            fetch: Object.assign(
              async (_url: unknown, init: RequestInit | undefined) => {
                const bytes = new Uint8Array(
                  await new Response(init!.body).arrayBuffer(),
                );
                const payload =
                  new Headers(init?.headers).get("content-encoding") === "zstd"
                    ? Bun.zstdDecompressSync(bytes)
                    : bytes;
                httpRequests.push(
                  JSON.parse(new TextDecoder().decode(payload)),
                );
                return new Response(
                  reply(2)
                    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                    .join(""),
                  {
                    headers: { "content-type": "text/event-stream" },
                  },
                );
              },
              { preconnect: fetch.preconnect },
            ),
            env: {
              HTTP_PROXY: "",
              HTTPS_PROXY: "",
              ALL_PROXY: "",
              NO_PROXY: "*",
            },
          }).result();
        },
        { enabled: true, maxRetries: 1, baseDelayMs: 1 },
        undefined,
      );
      expect(result.stopReason).toBe("stop");
      expect(attempts).toBe(2);
      expect(server.requests).toHaveLength(1);
      expect(httpRequests).toHaveLength(1);
      expect(httpRequests[0]).not.toHaveProperty("previous_response_id");
      expect(httpRequests[0]).toMatchObject({
        input: server.requests[0]!.body.input,
      });
      server.cleanup(sessionId);
    } finally {
      cleanupSessionResources(sessionId);
      server.stop();
    }
  },
);

test("opaque proxy authentication rejects the direct ChatGPT endpoint before dispatch", async () => {
  let sent = false;
  const stubFetch: typeof fetch = Object.assign(
    async () => {
      sent = true;
      throw new Error("must not dispatch");
    },
    { preconnect: fetch.preconnect },
  );
  const result = await streamSimple(
    { ...model, baseUrl: "https://chatgpt.com/backend-api" },
    normalizeContext({ messages: [] }),
    { apiKey, transport: "sse", fetch: stubFetch },
  ).result();
  expect(sent).toBe(false);
  expect(result.stopReason).toBe("error");
  expect(result.errorMessage).toContain("custom base URL");
});
