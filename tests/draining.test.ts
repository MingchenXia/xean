import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as yieldToEvents } from "node:timers/promises";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import {
  Xean,
  openXeanStorage,
  TransientError,
  type JsonValue,
  type XeanOptions,
} from "../packages/core/src/index.ts";

const model = {
  provider: "fixture",
  id: "fixture",
  api: "openai-responses" as const,
};

test("Coordinator call-cap failure lets an admitted worker publish and signal", async () => {
  const admitted = Promise.withResolvers<void>();
  const denied = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const signals: string[] = [];
  let workerAborted = false;
  const engine = await Xean.open(new MemoryStorage(), {
    task: "drain after Coordinator admission denial",
    limits: { concurrency: 1, providerCalls: 1 },
    roles: [
      {
        name: "worker",
        async run(_input, execution, context) {
          const call = await execution.recorder.begin(model);
          await call.recordRequest({ input: "worker request" });
          admitted.resolve();
          await release.promise;
          workerAborted = context.abortSignal!.aborted;
          await call.settle(fauxAssistantMessage("worker result"), null);
          return "worker result";
        },
      },
    ],
    coordinator: {
      name: "coordinate",
      async run(signal, view, execution) {
        signals.push(signal.kind);
        if (signal.kind === "start")
          return {
            state: null,
            dispatch: ["worker", "queued"].map((id) => ({
              id,
              role: "worker",
              input: null,
            })),
          };
        if (signal.kind === "input") {
          try {
            await execution.recorder.begin(model);
          } finally {
            denied.resolve();
          }
          throw new Error("Coordinator call should have been denied");
        }
        return { state: view.work[0]!.result };
      },
    },
  });
  try {
    const running = engine.run();
    await admitted.promise;
    await engine.input("steer while worker is running");
    await denied.promise;
    expect(await engine.inspect()).toMatchObject({
      status: "running",
      callLimitReached: true,
    });
    const pausing = engine.pause();
    release.resolve();
    expect((await pausing).status).toBe("paused");
    await running;
    expect(signals).toEqual(["start", "input"]);
    const result = await engine.resume();
    expect(workerAborted).toBe(false);
    expect(result.status).toBe("limited");
    expect(result.providerCalls).toBe(1);
    expect(result.work[0]).toMatchObject({
      status: "completed",
      attempts: 1,
      result: "worker result",
    });
    expect(signals).toEqual(["start", "input", "completed"]);
    expect(result.state).toBe("worker result");
    expect(result.pendingSignals).toBe(0);
    expect(result.work[1]).toMatchObject({
      status: "queued",
      attempts: 0,
      publicationId: null,
    });
    const cancelled = await engine.cancel();
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.work[1]!.status).toBe("cancelled");
    await expect(engine.extendCalls(1, "after-cancel")).rejects.toThrow(
      "does not accept",
    );
  } finally {
    release.resolve();
    await engine.close();
  }
});

test("call grants preserve failed work, recover queued work, and retain keyed receipts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-grants-"));
  const path = join(directory, "campaign.sqlite");
  const admitted = Promise.withResolvers<void>();
  const draining = Promise.withResolvers<void>();
  const signals: string[] = [];
  const seen: JsonValue[] = [];
  let workerRuns = 0;
  const options: XeanOptions = {
    task: "failure during draining",
    limits: { concurrency: 1, providerCalls: 1, attempts: 3 },
    roles: [
      {
        name: "worker",
        async run(input, execution) {
          workerRuns++;
          const call = await execution.recorder.begin(model);
          await call.recordRequest({ input: "worker request" });
          if (input === "queued") {
            await call.settle(fauxAssistantMessage("queued result"), null);
            return "queued result";
          }
          admitted.resolve();
          await draining.promise;
          await call.settle(fauxAssistantMessage("partial response"), null);
          throw new TransientError("temporary execution failure");
        },
      },
    ],
    coordinator: {
      name: "coordinate",
      async run(signal, view, execution) {
        signals.push(signal.kind);
        seen.push({ signal, view });
        if (signal.kind === "start")
          return {
            state: null,
            dispatch: ["worker", "queued"].map((id) => ({
              id,
              role: "worker",
              input: id,
            })),
          };
        if (signal.kind === "input") {
          try {
            await execution.recorder.begin(model);
          } finally {
            draining.resolve();
          }
          throw new Error("Coordinator call should have been denied");
        }
        if (signal.kind === "completed")
          return { state: null, completion: view.work[1]!.result };
        return { state: view.work[0]!.error };
      },
    },
    accept: (candidate) => candidate === "queued result",
  };
  let engine = await Xean.open(await openXeanStorage(path), options);
  try {
    const running = engine.run();
    await admitted.promise;
    const input = await engine.input("consume remaining admission", "more");
    const result = await running;
    expect(workerRuns).toBe(1);
    expect(result.status).toBe("limited");
    expect(result.providerCalls).toBe(1);
    expect(result.work[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      result: null,
      publicationId: null,
      error: "temporary execution failure",
    });
    expect(signals).toEqual(["start", "input", "failed"]);
    expect(result.state).toBe("temporary execution failure");
    expect(result.pendingSignals).toBe(0);
    expect(result.work[1]).toMatchObject({ status: "queued", attempts: 0 });
    await engine.close();
    engine = await Xean.open(await openXeanStorage(path), options);
    const grant = await engine.extendCalls(1, "more");
    expect(grant).toEqual({ id: grant.id, key: "more", value: 1 });
    expect(await engine.extendCalls(1, "more")).toEqual(grant);
    await expect(engine.extendCalls(2, "more")).rejects.toThrow("key reused");
    await expect(engine.extendCalls(0, "invalid")).rejects.toThrow(
      "positive safe integer",
    );
    await expect(
      engine.extendCalls(Number.MAX_SAFE_INTEGER, "overflow"),
    ).rejects.toThrow("safe integer range");
    expect(await engine.inspect()).toMatchObject({
      status: "running",
      callAllowance: 2,
      providerCalls: 1,
      limits: { providerCalls: 1 },
      inputs: [input],
    });
    expect(workerRuns).toBe(1);
    await engine.pause();
    await engine.extendCalls(1, "while-paused");
    expect((await engine.inspect()).status).toBe("paused");
    const completed = await engine.resume();
    expect(completed).toMatchObject({
      status: "completed",
      providerCalls: 2,
      callAllowance: 3,
    });
    expect(workerRuns).toBe(2);
    expect(completed.work.map((work) => work.status)).toEqual([
      "failed",
      "completed",
    ]);
    const publication = completed.work[1]!.publicationId;
    expect(publication).not.toBeNull();
    expect(seen).toContainEqual(
      expect.objectContaining({
        signal: expect.objectContaining({ id: publication, kind: "completed" }),
      }),
    );
    const starts = (await engine.records()).filter(
      (entry) =>
        entry.kind === "xean.attempt.started" &&
        (entry.data as { snapshot?: unknown }).snapshot,
    );
    expect(
      await Promise.all(starts.map((entry) => engine.attemptInput(entry.id))),
    ).toEqual(seen);
    expect(await engine.extendCalls(1, "more")).toEqual(grant);
    await expect(engine.extendCalls(1, "after-completion")).rejects.toThrow(
      "does not accept",
    );
    await engine.close();
    engine = await Xean.open(await openXeanStorage(path), options);
    expect(await engine.extendCalls(1, "more")).toEqual(grant);
    expect(await engine.run()).toEqual(completed);
    expect(workerRuns).toBe(2);
  } finally {
    draining.resolve();
    await engine.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a grant racing admission denial preserves the fresh Coordinator opportunity", async () => {
  const denied = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const signals: string[] = [];
  const engine = await Xean.open(new MemoryStorage(), {
    task: "grant after denied admission",
    limits: { providerCalls: 0, attempts: 1 },
    roles: [],
    coordinator: {
      name: "coordinate",
      async run(signal, _view, execution) {
        signals.push(signal.kind);
        if (signal.kind === "start") {
          try {
            await execution.recorder.begin(model);
          } catch (error) {
            denied.resolve();
            await release.promise;
            throw error;
          }
        }
        return { state: null, completion: "reconsidered" };
      },
    },
    accept: (value) => value === "reconsidered",
  });
  const running = engine.run();
  try {
    await denied.promise;
    await engine.extendCalls(1, "racing");
    release.resolve();
    expect(await running).toMatchObject({
      status: "completed",
      providerCalls: 0,
      callAllowance: 1,
    });
    expect(signals).toEqual(["start", "allowance"]);
  } finally {
    release.resolve();
    await running;
    await engine.close();
  }
});

test("a grant does not turn an exhausted interrupted draining signal into a blocker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-draining-"));
  const path = join(directory, "campaign.sqlite");
  const admitted = Promise.withResolvers<void>();
  const releaseWorker = Promise.withResolvers<void>();
  const denyCall = Promise.withResolvers<void>();
  const coordinatorBusy = Promise.withResolvers<void>();
  const signals: string[] = [];
  let workerRuns = 0;
  const options: XeanOptions = {
    task: "recover exhausted Coordinator while draining",
    limits: { concurrency: 2, providerCalls: 1, attempts: 1 },
    roles: [
      {
        name: "worker",
        async run(input, execution) {
          workerRuns++;
          if (input === "denied") {
            await admitted.promise;
            await denyCall.promise;
          }
          const call = await execution.recorder.begin(model);
          await call.recordRequest({ input });
          admitted.resolve();
          await releaseWorker.promise;
          await call.settle(fauxAssistantMessage("persisted result"), null);
          return "persisted result";
        },
      },
    ],
    coordinator: {
      name: "coordinate",
      async run(signal, view, _execution, context) {
        signals.push(signal.kind);
        if (signal.kind === "start")
          return {
            state: null,
            dispatch: ["admitted", "denied"].map((id) => ({
              id,
              role: "worker",
              input: id,
            })),
          };
        if (signal.kind === "failed") {
          const aborted = new Promise<void>((resolve) => {
            context.abortSignal!.addEventListener("abort", () => resolve(), {
              once: true,
            });
          });
          coordinatorBusy.resolve();
          await aborted;
          throw new TransientError("Coordinator interrupted");
        }
        return { state: view.work[0]!.result };
      },
    },
  };
  let engine: Xean | undefined;
  let recovered: Xean | undefined;
  try {
    engine = await Xean.open(await openXeanStorage(path), options);
    const running = engine.run();
    await admitted.promise;
    const pausing = engine.pause();
    denyCall.resolve();
    for (let turn = 0; turn < 100; turn++) {
      if ((await engine.inspect()).work[1]!.status === "failed") break;
      await yieldToEvents();
    }
    expect((await engine.inspect()).work[1]!.status).toBe("failed");
    releaseWorker.resolve();
    const beforeClose = await pausing;
    expect(beforeClose.work[0]).toMatchObject({
      status: "completed",
      result: "persisted result",
    });
    expect(beforeClose.status).toBe("paused");
    expect(beforeClose.callLimitReached).toBe(true);
    expect(beforeClose.pendingSignals).toBe(2);
    expect(signals).toEqual(["start"]);
    await engine.close();
    await running;

    recovered = await Xean.open(await openXeanStorage(path), options);
    expect((await recovered.inspect()).status).toBe("paused");
    const resuming = recovered.resume();
    await coordinatorBusy.promise;
    await recovered.close();
    await resuming;
    recovered = await Xean.open(await openXeanStorage(path), options);
    expect(await recovered.inspect()).toMatchObject({
      status: "running",
      callLimitReached: true,
    });
    await recovered.extendCalls(1, "recover-draining");
    const result = await recovered.run();
    expect(result.status).toBe("running");
    expect(result.callLimitReached).toBe(false);
    expect(result.pendingSignals).toBe(0);
    expect(result.state).toBe("persisted result");
    expect(result.work[0]).toMatchObject({
      status: "completed",
      attempts: 1,
      result: "persisted result",
    });
    expect(workerRuns).toBe(2);
    expect(signals).toEqual(["start", "failed", "completed", "allowance"]);
  } finally {
    denyCall.resolve();
    releaseWorker.resolve();
    await engine?.close();
    await recovered?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
