import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Xean, openXeanStorage } from "../packages/core/src/index.ts";
import { observe } from "../packages/observe/src/snapshot.ts";
import { readRun, type Run } from "../packages/observe/src/read.ts";
import { api, readSources } from "../packages/observe/src/server.ts";

test("the external observer reads coherent live snapshots without changing a locked campaign", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-observe-"));
  const database = join(directory, "campaign.sqlite");
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const engine = await Xean.open(await openXeanStorage(database), {
    task: {
      kind: "xean.solve",
      task: {
        problem: "Observer fixture",
        completionCriteria: "Retain exact text",
      },
    },
    coordinator: {
      name: "fixture",
      run: (signal) => ({
        state: null,
        ...(signal.kind === "start"
          ? { dispatch: [{ id: "work", role: "explorer", input: null }] }
          : {}),
      }),
    },
    roles: [
      {
        name: "explorer",
        async run(_, execution) {
          const call = await execution.recorder.begin({
            provider: "fixture",
            api: "fixture",
            id: "fixture",
          });
          await call.recordRequest({ private: "request body" });
          entered.resolve();
          await release.promise;
          await call.settle(
            { private: "response body" },
            { input_tokens: 0, output_tokens: 9 },
          );
          return {
            kind: "notes",
            candidate: false,
            notes: [
              {
                id: "n1",
                summary: "Fixture note",
                text: "<script>unsafe()</script> For every $n$, $4n$ is even.",
                support: [],
              },
            ],
          };
        },
      },
    ],
  });
  const running = engine.run();
  try {
    await entered.promise;
    const failures: unknown[] = [];
    await observe(engine, directory, (error) => {
      failures.push(error);
    })();
    const before = await readRun({ id: "fixture", directory }, directory);
    expect(before.error).toBeUndefined();
    expect(before.snapshot?.notes).toHaveLength(0);
    expect(before.snapshot?.status.calls.unsettled).toBe(1);
    release.resolve();
    await running;
    const stop = observe(engine, directory, (error) => {
      failures.push(error);
    });
    await stop();
    await stop();
    const after = await readRun({ id: "fixture", directory }, directory);
    const published = await Bun.file(
      join(directory, "observation.json"),
    ).json();
    expect(published).toEqual({
      ...after.snapshot,
      observedAt: published.observedAt,
    });
    expect(after.snapshot?.notes[0]?.id).toBe("work/n1");
    expect(after.snapshot?.status.calls.byModel[0]?.reportedUsage).toEqual({
      input_tokens: 0,
      output_tokens: 9,
    });
    expect(JSON.stringify(after)).not.toContain("request body");
    expect(JSON.stringify(after)).not.toContain("response body");
    const handle = api(
      [
        { id: "fixture", directory },
        { id: "missing", directory: join(directory, "missing") },
      ],
      directory,
    );
    const response = await handle(new Request("http://127.0.0.1/api/runs"));
    const rows = (await response.json()) as Run[];
    expect(rows[0]?.snapshot?.notes).toHaveLength(1);
    expect(rows[1]?.error).toBeString();
    expect(
      (await handle(new Request("http://127.0.0.1/api/runs/unknown"))).status,
    ).toBe(404);
    expect(
      (
        await handle(
          new Request("http://127.0.0.1/api/runs", { method: "POST" }),
        )
      ).status,
    ).toBe(405);
    expect(
      (
        await handle(
          new Request("http://127.0.0.1/api/runs", {
            headers: { origin: "https://example.com" },
          }),
        )
      ).status,
    ).toBe(403);
    expect(failures).toEqual([]);
  } finally {
    release.resolve();
    await running;
    await engine.close();
    await rm(directory, { recursive: true });
  }
});

test("observer sources preserve unavailable evidence and reject unsupported snapshots and unsafe remote commands", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-observe-artifacts-"));
  try {
    await writeFile(
      join(directory, "task.json"),
      JSON.stringify({
        problem: "An older running campaign",
        completionCriteria: "Exact task",
      }),
    );
    await writeFile(
      join(directory, "round-1.json"),
      JSON.stringify({ round: 1 }),
    );
    const run = await readRun({ id: "old", directory }, directory);
    expect(run.kind).toBe("heartbeat");
    expect(run.snapshot).toBeUndefined();
    expect(run.heartbeat?.rounds).toBe(1);
    await writeFile(
      join(directory, "observation.json"),
      JSON.stringify({ schema: "unsupported" }),
    );
    expect(
      (await readRun({ id: "old", directory }, directory)).error,
    ).toContain("Unsupported observation");
    expect(() =>
      readSources(
        [
          { id: "run", directory },
          { id: "run", directory },
        ],
        directory,
      ),
    ).toThrow();
    expect(() =>
      readSources(
        [{ id: "run", directory, host: "jupiter", runtime: "/tmp/bun;exit" }],
        directory,
      ),
    ).toThrow();
  } finally {
    await rm(directory, { recursive: true });
  }
});
