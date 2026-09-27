import { expect, spyOn, test } from "bun:test";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { MemoryStorage, StorageRejected } from "@earendil-works/pi-durable";
import { Store, campaignAddress } from "../packages/core/src/store.ts";
import { campaignVersion } from "../packages/core/src/types.ts";

test("Store snapshots entries and keeps rejected commits separate from uncertain commits", async () => {
  const storage = new MemoryStorage();
  const store = await Store.open(storage, {
    version: campaignVersion,
    task: "prepared changes",
    coordinator: "fixture",
    status: "running",
    state: { count: 1 },
    limits: {
      concurrency: 1,
      attempts: 1,
      providerCalls: null,
      deadline: null,
    },
    providerCalls: 0,
    callAllowance: null,
    callLimitReached: false,
    result: null,
    error: null,
  });
  const address = await storage.findDocument(
    campaignAddress,
    "current",
    context,
  );
  const persisted = async () =>
    (await storage.document(address!.id, "current", context))!.value.state;
  try {
    await store.mutate(async (tx) => {
      const data = { text: "original" };
      const entry = tx.entry("snapshot", data);
      data.text = "changed while minting ID";
      await entry;
    });
    expect((await store.entries())[0]?.data).toEqual({ text: "original" });

    const revision = store.revision;
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
      expect(store.revision).toBe(revision);
      expect(await persisted()).toEqual({ count: 1 });
      expect(
        (await storage.scanTasks({}, 10, undefined, context)).items,
      ).toEqual([]);
      if (failure instanceof StorageRejected) {
        expect(store.failure).toBeUndefined();
        expect(
          await store.mutate(
            (tx) => (tx.state.state as { count: number }).count,
          ),
        ).toBe(1);
        expect(await store.entries()).toHaveLength(1);
      } else {
        expect(store.failure).toBe(failure);
        await expect(store.mutate(() => {})).rejects.toThrow();
      }
    }
  } finally {
    await store.close();
  }
});
