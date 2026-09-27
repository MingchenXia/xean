import { expect, test } from "bun:test";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import {
  Xean,
  TransientError,
  type JsonValue,
} from "../packages/core/src/index.ts";

for (const transient of [false, true])
  test(`${transient ? "transient failures retry privately" : "ordinary failures report to Coordinator"}`, async () => {
    const invoked: JsonValue[] = [];
    const attempts: string[] = [];
    const signals: string[] = [];
    const engine = await Xean.open(new MemoryStorage(), {
      task: "logical retry",
      limits: { attempts: 2 },
      roles: [
        {
          name: "worker",
          run(input, execution) {
            invoked.push(input);
            attempts.push(execution.attemptId);
            if (attempts.length === 1)
              throw new (transient ? TransientError : Error)(
                "execution failure",
              );
            return { verdict: "inconclusive" };
          },
        },
      ],
      coordinator: {
        name: "coordinate",
        run(signal, view) {
          signals.push(signal.kind);
          if (signal.kind === "start")
            return {
              state: null,
              dispatch: [{ id: "first", role: "worker", input: "bad" }],
            };
          if (signal.kind === "failed") {
            expect(view.work[0]).toMatchObject({
              status: "failed",
              attempts: 1,
              result: null,
              error: "execution failure",
            });
            return {
              state: "trying another request",
              dispatch: [{ id: "second", role: "worker", input: "good" }],
            };
          }
          return { state: "inconclusive received" };
        },
      },
    });
    try {
      const result = await engine.run();
      expect(invoked).toEqual(["bad", transient ? "bad" : "good"]);
      expect(new Set(attempts).size).toBe(2);
      expect(signals).toEqual(
        transient ? ["start", "completed"] : ["start", "failed", "completed"],
      );
      expect(result.work).toHaveLength(transient ? 1 : 2);
      expect(result.work.at(-1)).toMatchObject({
        attempts: transient ? 2 : 1,
        status: "completed",
        result: { verdict: "inconclusive" },
      });
      expect(result.status).toBe("running");
      expect(result.pendingSignals).toBe(0);
    } finally {
      await engine.close();
    }
  });

test("call cap drains admitted work and delivers both outcomes before stopping", async () => {
  const admitted = Promise.withResolvers<void>();
  const failed = Promise.withResolvers<void>();
  const outcomes: string[] = [];
  const invoked: JsonValue[] = [];
  const engine = await Xean.open(new MemoryStorage(), {
    task: "drain",
    limits: { concurrency: 2, providerCalls: 1 },
    roles: [
      {
        name: "worker",
        async run(input, execution, context) {
          invoked.push(input);
          if (input === "second") await admitted.promise;
          const call = await execution.recorder.begin({
            provider: "fixture",
            id: "fixture",
            api: "openai-responses",
          });
          await call.recordRequest({ input });
          admitted.resolve();
          await failed.promise;
          expect(context.abortSignal!.aborted).toBe(false);
          const message = fauxAssistantMessage("authorized result");
          await call.settle(message, null);
          return "authorized result";
        },
      },
    ],
    coordinator: {
      name: "coordinate",
      run(signal) {
        if (signal.kind === "start")
          return {
            state: null,
            dispatch: ["first", "second", "queued"].map((id) => ({
              id,
              role: "worker",
              input: id,
            })),
          };
        outcomes.push(signal.kind);
        if (signal.kind === "failed") failed.resolve();
        return { state: outcomes.slice() };
      },
    },
  });
  try {
    const result = await engine.run();
    expect(result.status).toBe("limited");
    expect(result.providerCalls).toBe(1);
    expect(invoked).toEqual(["first", "second"]);
    expect(outcomes).toEqual(["failed", "completed"]);
    expect(
      result.work.map((work) => [work.id, work.status, work.result]),
    ).toEqual([
      ["first", "completed", "authorized result"],
      ["second", "failed", null],
      ["queued", "queued", null],
    ]);
    expect(result.pendingSignals).toBe(0);
  } finally {
    failed.resolve();
    await engine.close();
  }
});

test("synchronous work yields to external cancellation", async () => {
  let invoked = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelled = Promise.withResolvers<void>();
  const engine = await Xean.open(new MemoryStorage(), {
    task: "fair scheduling",
    roles: [
      {
        name: "worker",
        run() {
          if (++invoked === 1)
            timer = setTimeout(() => {
              void engine
                .cancel()
                .then(() => cancelled.resolve(), cancelled.reject);
            }, 0);
          return null;
        },
      },
    ],
    coordinator: {
      name: "coordinate",
      run() {
        return {
          state: null,
          ...(invoked < 100
            ? {
                dispatch: [
                  { id: String(invoked), role: "worker", input: null },
                ],
              }
            : {}),
        };
      },
    },
  });
  try {
    expect((await engine.run()).status).toBe("cancelled");
    await cancelled.promise;
    expect(invoked).toBeLessThan(100);
  } finally {
    clearTimeout(timer);
    await engine.close();
  }
});
