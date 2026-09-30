import { expect, spyOn, test } from "bun:test";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import {
  createRegistry,
  defineTask,
  MemoryStorage,
  StorageRejected,
} from "@earendil-works/pi-durable";
import {
  Store,
  campaignAddress,
  initialAttempt,
} from "../packages/core/src/store.ts";
import { campaignVersion } from "../packages/core/src/types.ts";

test("Store snapshots entries and keeps rejected commits separate from uncertain commits", async () => {
  const storage = new MemoryStorage();
  const registry = createRegistry();
  registry.tasks.add(
    defineTask({
      name: "xean.worker",
      version: 1,
      initial: initialAttempt,
      phases: { run: async () => {} },
      abort: async () => {},
    }),
  );
  const store = await Store.open(
    storage,
    {
      version: campaignVersion,
      task: "prepared changes",
      coordinator: "fixture",
      status: "running",
      state: { count: 1 },
      limits: {
        concurrency: 1,
        attempts: 1,
        providerCalls: null,
      },
      providerCalls: 0,
      callAllowance: null,
      callLimitReached: false,
      result: null,
      error: null,
    },
    { models: createModels(), registry },
  );
  const address = await storage.findDocument(
    campaignAddress,
    "current",
    context,
  );
  const persisted = async () =>
    (await storage.document(address!.id, "current", context))!.value.state;
  try {
    const taskId = await store.mutate(async (tx) => {
      const taskId = await tx.newTask("xean.worker", {
        id: "committed",
        role: "fixture",
        input: null,
      });
      const data = { text: "original" };
      const entry = tx.entry("snapshot", data, taskId);
      data.text = "changed while minting ID";
      await entry;
      return taskId;
    });
    expect((await store.mutate((tx) => tx.entries()))[0]).toMatchObject({
      byTaskId: taskId,
      data: { text: "original" },
    });
    expect(await store.mutate((tx) => tx.tasks.map(({ id }) => id))).toEqual([
      taskId,
    ]);

    await expect(
      store.mutate((tx) => {
        tx.state.state = { count: 99 };
        throw new Error("callback failed");
      }),
    ).rejects.toThrow("callback failed");
    expect(store.failure).toBeUndefined();
    expect(await persisted()).toEqual({ count: 1 });
    for (const failure of [
      new StorageRejected("nothing committed"),
      new Error("commit outcome is unknown"),
    ]) {
      const rejected = spyOn(storage, "commit").mockImplementation(async () => {
        throw failure;
      });
      try {
        await expect(
          store.mutate(async (tx) => {
            tx.state.state = { count: 99 };
            await tx.newTask("xean.worker", {
              id: "rejected",
              role: "fixture",
              input: null,
            });
            await tx.entry("rejected", null);
          }),
        ).rejects.toThrow(failure.message);
      } finally {
        rejected.mockRestore();
      }
      expect(await persisted()).toEqual({ count: 1 });
      expect(
        (await storage.scanTasks({}, 10, undefined, context)).items.map(
          ({ id }) => id,
        ),
      ).toEqual([taskId]);
      if (failure instanceof StorageRejected) {
        expect(store.failure).toBeUndefined();
        expect(
          await store.mutate(
            (tx) => (tx.state.state as { count: number }).count,
          ),
        ).toBe(1);
        expect(await store.mutate((tx) => tx.entries())).toHaveLength(1);
      } else {
        expect(store.failure).toBe(failure);
        await expect(store.mutate(() => {})).rejects.toThrow();
      }
    }
  } finally {
    await store.close();
  }
});
