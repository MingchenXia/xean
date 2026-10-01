import { expect, test } from "bun:test";
import { getEventListeners } from "node:events";
import {
  fauxAssistantMessage,
  isRetryableAssistantError,
  normalizeContext,
  retryAssistantCall,
  type Model,
} from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses";

const model: Model<"openai-codex-responses"> = {
  id: "xean-retry-fixture",
  name: "Xean retry fixture",
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

async function retryTransport(signal: AbortSignal, delay: number) {
  let calls = 0;
  const stubFetch: typeof fetch = Object.assign(
    async () => {
      if (calls++ === 0)
        return new Response("Service unavailable", {
          status: 503,
          headers: { "retry-after-ms": String(delay) },
        });
      return new Response(
        `data: ${JSON.stringify({
          type: "response.completed",
          response: {
            id: "resp_retry",
            status: "completed",
            output: [],
            usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
          },
        })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
    { preconnect: fetch.preconnect },
  );
  const result = await streamSimple(model, normalizeContext({ messages: [] }), {
    apiKey: "xean-offline-retry-key",
    transport: "sse",
    fetch: stubFetch,
    maxRetries: 1,
    signal,
  }).result();
  return { result, calls };
}

async function retryTurn(signal: AbortSignal, delay: number) {
  let calls = 0;
  const result = await retryAssistantCall(
    async () =>
      fauxAssistantMessage(
        [],
        calls++ === 0
          ? { stopReason: "error", errorMessage: "Service unavailable" }
          : { stopReason: "stop" },
      ),
    { enabled: true, maxRetries: 1, baseDelayMs: delay },
    signal,
  );
  return { result, calls };
}

test("recorded transport failures retry without retrying request or JSON errors", async () => {
  for (const [errorMessage, expectedCalls] of [
    ["Upstream closed stream without completion", 2],
    [
      "Codex error: Previous response owner account is unavailable; retry later.",
      2,
    ],
    ["invalid_request_error: Upstream closed stream without completion", 1],
    ["subscription_sharing_usage_limit_exceeded: HTTP 429", 1],
    ["subscription_sharing_usage_unavailable", 2],
    ["subscription_sharing_user_unavailable", 2],
    ["terminated", 2],
    ["Connection terminated unexpectedly", 2],
    ["JSON Parse error: Unterminated string", 1],
    ["JSON Parse error: Invalid escape character F", 1],
    ["JSON Parse error: Invalid escape character {", 1],
  ] as const) {
    let calls = 0;
    await retryAssistantCall(
      async () =>
        fauxAssistantMessage(
          [],
          calls++ === 0
            ? { stopReason: "error", errorMessage }
            : { stopReason: "stop" },
        ),
      { enabled: true, maxRetries: 1, baseDelayMs: 1 },
      undefined,
    );
    expect(calls).toBe(expectedCalls);
  }
});

test("new provider error codes use status and type before message wording", async () => {
  for (const [providerError, expected] of [
    [{ code: "future_error", type: "server_error" }, true],
    [{ code: "future_error", type: "service_unavailable_error" }, true],
    [{ code: "future_error", status: 529 }, true],
    [{ code: "future_error", status: 400 }, false],
    [{ code: "future_error", type: "invalid_request_error" }, false],
    [
      { code: "future_error", type: "authentication_error", status: 500 },
      false,
    ],
    [{ code: "future_error", type: "permission_error" }, false],
    [{ code: "insufficient_quota", status: 429 }, false],
    [{ code: "project_spend_limit_exceeded", status: 429 }, false],
    [{ code: "future_error" }, false],
  ] as const)
    expect(
      isRetryableAssistantError({
        ...fauxAssistantMessage([], {
          stopReason: "error",
          errorMessage: "Unfamiliar detail",
        }),
        providerError,
      }),
    ).toBe(expected);
  expect(
    isRetryableAssistantError({
      ...fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "Billing quota exceeded",
      }),
      providerError: { status: 429 },
    }),
  ).toBe(false);
  let calls = 0;
  const result = await retryAssistantCall(
    () =>
      streamSimple(model, normalizeContext({ messages: [] }), {
        apiKey: "xean-offline-retry-key",
        transport: "sse",
        maxRetries: 0,
        fetch: Object.assign(
          async () =>
            calls++ === 0
              ? Response.json(
                  {
                    error: {
                      type: "server_error",
                      code: "future_error",
                      message: "Unfamiliar detail",
                    },
                  },
                  { status: 529 },
                )
              : new Response(
                  `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_new_error", status: "completed", output: [] } })}\n\n`,
                  { headers: { "content-type": "text/event-stream" } },
                ),
          { preconnect: fetch.preconnect },
        ),
      }).result(),
    { enabled: true, maxRetries: 1, baseDelayMs: 1 },
    undefined,
  );
  expect(result.stopReason).toBe("stop");
  expect(calls).toBe(2);
  for (const body of [
    "Billing quota exceeded",
    JSON.stringify({ error: { message: "Billing quota exceeded" } }),
    JSON.stringify({
      error: {
        type: "insufficient_quota",
        code: "future_quota_code",
        message: "Unfamiliar detail",
      },
    }),
  ]) {
    calls = 0;
    const failure = await retryAssistantCall(
      () =>
        streamSimple(model, normalizeContext({ messages: [] }), {
          apiKey: "xean-offline-retry-key",
          transport: "sse",
          maxRetries: 1,
          fetch: Object.assign(
            async () => {
              calls++;
              return new Response(body, {
                status: 429,
                headers: { "retry-after-ms": "1" },
              });
            },
            { preconnect: fetch.preconnect },
          ),
        }).result(),
      { enabled: true, maxRetries: 1, baseDelayMs: 1 },
      undefined,
    );
    expect(failure.stopReason).toBe("error");
    expect(calls).toBe(1);
  }
});

test.each([retryTransport, retryTurn])(
  "%p releases listeners after completed backoffs",
  async (retry) => {
    const controller = new AbortController();
    const { result, calls } = await retry(controller.signal, 1);
    expect(result.stopReason).toBe("stop");
    expect(calls).toBe(2);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  },
);

test.each([retryTransport, retryTurn])(
  "%p cancellation interrupts backoff without another request or listener leak",
  async (retry) => {
    const controller = new AbortController();
    let listenersAtAbort = 0;
    const timer = setTimeout(() => {
      listenersAtAbort = getEventListeners(controller.signal, "abort").length;
      controller.abort();
    }, 10);
    try {
      const { result, calls } = await retry(controller.signal, 1000);
      expect(listenersAtAbort).toBe(1);
      expect(result.stopReason).toBe("aborted");
      expect(calls).toBe(1);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    } finally {
      clearTimeout(timer);
    }
  },
);
