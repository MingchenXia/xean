import { getTelemetryContext } from "@earendil-works/pi-agent-core/harness/context";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as yieldToEvents } from "node:timers/promises";
import {
  cleanupSessionResources,
  createModels,
  Type,
  type Model,
} from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import {
  convertToLlm,
  runAgentLoop,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import { InMemoryTelemetryContext } from "@earendil-works/pi-telemetry";
import {
  Xean,
  openXeanStorage,
  type XeanOptions,
} from "../packages/core/src/index.ts";
import { auditedStream } from "../packages/core/src/pi.ts";

function response(item: object): Response {
  const events = [
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: {
        id: "response-fixture",
        status: "completed",
        output: [item],
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      },
    },
  ];
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("native Pi tools wait for settlement and survive close as one retried worker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-agent-"));
  const path = join(directory, "campaign.sqlite");
  const telemetry = new InMemoryTelemetryContext();
  const pending = Promise.withResolvers<void>();
  const settled = Promise.withResolvers<void>();
  const releaseSettlement = Promise.withResolvers<void>();
  const requests: { input: { type: string; output?: string }[] }[] = [];
  const toolAttempts: string[] = [];
  const models = createModels();
  models.setProvider(openaiProvider());
  const model: Model<"openai-responses"> = {
    id: "xean-agent-fixture",
    name: "Offline agent fixture",
    provider: "openai",
    api: "openai-responses",
    baseUrl: "https://xean.invalid/v1",
    reasoning: false,
    input: ["text"],
    contextWindow: 20_000,
    maxTokens: 1000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const fixtureFetch: typeof fetch = Object.assign(
    async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as (typeof requests)[number];
      requests.push(body);
      const output = body.input.find(
        (item) => item.type === "function_call_output",
      );
      if (!output) {
        return response({
          type: "function_call",
          id: "fc_add",
          call_id: "call_add",
          name: "add",
          arguments: '{"left":1,"right":2}',
        });
      }
      expect(output.output).toBe("3");
      if (requests.length === 2) {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal)
            throw new Error("Provider request lost its abort signal");
          signal.throwIfAborted();
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
          pending.resolve();
        });
      }
      return response({
        type: "message",
        id: "msg_answer",
        role: "assistant",
        content: [{ type: "output_text", text: "3", annotations: [] }],
      });
    },
    { preconnect: fetch.preconnect },
  );
  const parameters = Type.Object({
    left: Type.Integer(),
    right: Type.Integer(),
  });
  const options: XeanOptions = {
    task: "Add 1 and 2 with a tool",
    limits: { attempts: 2, providerCalls: 4 },
    telemetry,
    roles: [
      {
        name: "agent",
        async run(input, execution, context) {
          const add: AgentTool<typeof parameters> = {
            name: "add",
            label: "Add",
            description: "Add two integers",
            parameters,
            execute: async (_id, values) =>
              getTelemetryContext(context).startSpan(
                { name: "fixture.add" },
                () => {
                  toolAttempts.push(execution.attemptId);
                  return {
                    content: [
                      {
                        type: "text" as const,
                        text: String(values.left + values.right),
                      },
                    ],
                    details: null,
                  };
                },
              ),
          };
          try {
            const messages = await runAgentLoop(
              [{ role: "user", content: String(input), timestamp: 0 }],
              { messages: [], tools: [add] },
              {
                model,
                convertToLlm,
                apiKey: "offline-fixture-key",
                fetch: fixtureFetch,
                maxRetries: 0,
                sessionId: execution.attemptId,
                telemetryContext: getTelemetryContext(context),
              },
              () => {},
              context.abortSignal,
              auditedStream(models, {
                async begin(identity) {
                  const call = await execution.recorder.begin(identity);
                  return {
                    recordRequest: call.recordRequest,
                    async settle(message, usage) {
                      await call.settle(message, usage);
                      if (requests.length === 1) {
                        settled.resolve();
                        await releaseSettlement.promise;
                      }
                    },
                  };
                },
              }),
            );
            context.abortSignal!.throwIfAborted();
            const last = messages.at(-1);
            if (last?.role !== "assistant" || last.stopReason !== "stop")
              throw new Error("Agent did not finish successfully");
            return last.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("");
          } finally {
            cleanupSessionResources(execution.attemptId);
          }
        },
      },
    ],
    coordinator: {
      name: "tool-fixture",
      run(signal, view) {
        return signal.kind === "start"
          ? {
              state: null,
              dispatch: [{ id: "add", role: "agent", input: "Add 1 and 2" }],
            }
          : { state: null, completion: view.work[0]!.result };
      },
    },
    accept: (candidate) => candidate === "3",
  };
  let engine: Xean | undefined;
  try {
    engine = await Xean.open(await openXeanStorage(path), options);
    const running = engine.run();
    await settled.promise;
    await yieldToEvents();
    expect(toolAttempts).toHaveLength(0);
    releaseSettlement.resolve();
    await Promise.race([
      pending.promise,
      running.then(() => {
        throw new Error("Worker stopped before the pending provider call");
      }),
    ]);
    await engine.close();
    await running;

    engine = await Xean.open(await openXeanStorage(path), options);
    const interrupted = await engine.inspect();
    expect(interrupted).toMatchObject({
      status: "running",
      providerCalls: 2,
      pendingSignals: 0,
    });
    expect(interrupted.work[0]).toMatchObject({
      status: "queued",
      attempts: 1,
      result: null,
    });
    const before = await engine.records();
    expect(
      before.filter((record) => record.kind === "xean.call.request"),
    ).toHaveLength(2);
    expect(
      before
        .filter((record) => record.kind === "xean.call.settled")
        .map((record) => record.data),
    ).toMatchObject([
      { message: { stopReason: "toolUse" }, usage: { totalTokens: 5 } },
      { message: { stopReason: "aborted" }, usage: null },
    ]);

    const completed = await engine.run();
    expect(completed).toMatchObject({
      status: "completed",
      result: "3",
      providerCalls: 4,
      pendingSignals: 0,
    });
    expect(completed.work[0]).toMatchObject({
      status: "completed",
      attempts: 2,
      result: "3",
    });
    expect(
      requests.map((body) =>
        body.input.some((item) => item.type === "function_call_output"),
      ),
    ).toEqual([false, true, false, true]);
    // Whole-worker recovery repeats the deterministic tool, not just the last call.
    expect(new Set(toolAttempts).size).toBe(2);
    expect(toolAttempts).toHaveLength(2);
    const records = await engine.records();
    expect(
      records.filter((record) => record.kind === "xean.call.settled"),
    ).toHaveLength(4);
    expect(
      records.filter(
        (record) =>
          record.kind === "xean.attempt.completed" &&
          record.byTaskId === completed.work[0]!.taskId,
      ),
    ).toHaveLength(1);

    const spans = telemetry.getSpans();
    const workers = spans.filter((span) => span.name === "xean.worker");
    expect(workers.map((span) => span.attributes["xean.attempt"])).toEqual(
      toolAttempts,
    );
    expect(
      spans
        .filter((span) => span.name === "fixture.add")
        .map((span) => span.parentId),
    ).toEqual(workers.map((span) => span.id));
    expect(spans.every((span) => span.settled)).toBe(true);

    await engine.close();
    engine = await Xean.open(await openXeanStorage(path), options);
    expect(await engine.run()).toEqual(completed);
    expect(await engine.records()).toEqual(records);
    expect(requests).toHaveLength(4);
    expect(toolAttempts).toHaveLength(2);
  } finally {
    releaseSettlement.resolve();
    await engine?.close();
    await rm(directory, { recursive: true });
  }
});
