import { expect, spyOn, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Xean, openXeanStorage } from "../packages/core/src/index.ts";
import { declarationVersion } from "xean/solve";
import { readSnapshot, snapshot } from "../packages/observe/src/snapshot.ts";
import { observe, publish } from "../packages/observe/src/publish.ts";
import { readRun, type Run } from "../packages/observe/src/read.ts";
import { api, readSources } from "../packages/observe/src/server.ts";

async function fakeNomad(
  directory: string,
  failLogs?: "stdout" | "stderr",
  active: unknown = [],
  task = "solver",
) {
  await mkdir(join(directory, "bin"), { recursive: true });
  await writeFile(
    join(directory, "bin/fleet-nomad"),
    `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === "job") console.log(JSON.stringify([{ ID: "allocation", CreateIndex: 1, ClientStatus: "failed" }]));
else if (args.at(-1) !== ${JSON.stringify(task)}) throw new Error("wrong Nomad task");
else if ((args.includes("-stderr") ? "stderr" : "stdout") === ${JSON.stringify(failLogs)}) throw new Error("logs unavailable");
else if (args.includes("-stderr")) console.log("worker stopped");
else console.log(JSON.stringify({ calls: 3, rounds: 2, active: ${JSON.stringify(active)} }) + "\\nnull");
`,
    { mode: 0o700 },
  );
}

test("the external observer reads coherent live snapshots without changing a locked campaign", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-observe-"));
  const database = join(directory, "campaign.sqlite");
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const engine = await Xean.open(await openXeanStorage(database), {
    task: {
      kind: "xean.solve",
      version: declarationVersion,
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
                detailedSummary:
                  "For every integer $n$, $4n$ is even because it is twice $2n$.",
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
    // The publisher gets only a path, in another process while ownership is held.
    const publisher = Bun.spawnSync([
      process.execPath,
      "--no-install",
      "--no-env-file",
      new URL("../packages/observe/src/publish.ts", import.meta.url).pathname,
      directory,
    ]);
    expect(publisher.exitCode).toBe(0);
    expect(publisher.stderr.toString()).toBe("");
    const before = await readRun({ id: "fixture", directory }, directory);
    expect(before.error).toBeUndefined();
    expect(before.snapshot?.notes).toHaveLength(0);
    expect(before.snapshot?.status.calls.unsettled).toBe(1);
    release.resolve();
    await running;
    const committed = await engine.inspectWithRecords();
    const stop = observe(directory, (error) => {
      failures.push(error);
    });
    await stop();
    await stop();
    await Promise.all(Array.from({ length: 8 }, () => publish(directory)));
    expect(
      (await readdir(directory)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
    expect(await engine.inspectWithRecords()).toEqual(committed);
    const after = await readRun({ id: "fixture", directory }, directory);
    const published = await Bun.file(
      join(directory, "observation.json"),
    ).json();
    expect(published).toEqual({
      ...after.snapshot,
      observedAt: published.observedAt,
    });
    expect(published.schema).toBe("xean-observe/v2");
    expect(after.snapshot?.notes[0]?.id).toBe("work/n1");
    expect(after.snapshot?.notes[0]?.detailedSummary).toContain("twice $2n$");
    const history = await engine.inspect();
    const library = snapshot({
      campaign: {
        ...history,
        task: { kind: "xean.solve.library", version: declarationVersion },
      },
    });
    expect(library.notes).toEqual(after.snapshot!.notes);
    expect(library.status.notes).toEqual(after.snapshot?.status.notes);
    for (const kind of ["xean.role", "xean.review"])
      expect(
        readSnapshot(
          snapshot({
            campaign: { ...history, task: { kind, task: published.task } },
          }),
        ).task,
      ).toEqual(published.task);
    for (const kind of [
      "xean.solve",
      "xean.solve.offline",
      "xean.solve.library",
    ])
      expect(() =>
        snapshot({
          campaign: {
            ...history,
            task: { kind, version: declarationVersion - 1 },
          },
        }),
      ).toThrow("Unsupported solver declaration");
    const exported = join(directory, "exported");
    await mkdir(exported);
    const observationFile = join(exported, "observation.json");
    const exportedRun = () =>
      readRun({ id: "exported", directory: exported }, directory);
    await writeFile(observationFile, JSON.stringify(published));
    const readback = await exportedRun();
    expect(readback.error).toBeUndefined();
    expect(readback.kind).toBe("snapshot");
    expect(readback.snapshot).toEqual(published);
    for (const invalid of [
      { ...published, task: { label: "Invalid snapshot" } },
      { ...published, notes: [{ ...published.notes[0], support: undefined }] },
      { ...published, notes: [{ ...published.notes[0], text: undefined }] },
      {
        ...published,
        status: {
          ...published.status,
          calls: { ...published.status.calls, byModel: [null] },
        },
      },
    ]) {
      await writeFile(observationFile, JSON.stringify(invalid));
      const unavailable = await exportedRun();
      expect(unavailable.error).toBeString();
      expect(unavailable.snapshot).toBeUndefined();
    }
    await writeFile(observationFile, JSON.stringify(published));
    const resultFile = join(exported, "result.json");
    await writeFile(
      resultFile,
      JSON.stringify({
        ...committed,
        campaign: { ...committed.campaign, status: "completed" },
      }),
    );
    await utimes(observationFile, 1, 1);
    await utimes(resultFile, 2, 2);
    expect(await exportedRun()).toMatchObject({
      kind: "export",
      snapshot: { status: { status: "completed" } },
    });
    // Only the selected artifact is parsed; errors never fall back to old evidence.
    await writeFile(observationFile, "{invalid JSON");
    await utimes(observationFile, 1, 1);
    expect((await exportedRun()).error).toBeUndefined();
    await utimes(observationFile, 3, 3);
    expect((await exportedRun()).error).toBeString();
    await writeFile(observationFile, JSON.stringify(published));
    for (const modified of [2, 3]) {
      await utimes(observationFile, modified, modified);
      expect(await exportedRun()).toMatchObject({
        kind: "snapshot",
        snapshot: published,
      });
    }
    expect(after.snapshot?.status.calls.byModel[0]?.reportedUsage).toEqual({
      input_tokens: 0,
      output_tokens: 9,
    });
    expect(JSON.stringify(after)).not.toContain("request body");
    expect(JSON.stringify(after)).not.toContain("response body");
    await fakeNomad(directory, undefined, [], "worker");
    const supervised = await readRun(
      { id: "fixture", directory, job: "fixture-job", task: "worker" },
      directory,
    );
    expect(supervised.error).toBeUndefined();
    expect(supervised.kind).toBe("database");
    expect(supervised.snapshot?.notes).toEqual(after.snapshot?.notes);
    expect(supervised.process).toMatchObject({
      status: "failed",
      calls: 3,
      rounds: 2,
      active: [],
      errorLog: "worker stopped\n",
    });
    await fakeNomad(directory);
    const handle = api(
      [
        { id: "fixture", directory },
        { id: "missing", directory: join(directory, "missing") },
        { id: "exported", directory: exported, job: "fixture-job" },
      ],
      directory,
    );
    const response = await handle(new Request("http://127.0.0.1/api/runs"));
    const rows = (await response.json()) as Run[];
    expect(rows[0]?.snapshot?.notes).toHaveLength(1);
    expect(rows[1]?.error).toBeString();
    const clock = spyOn(Date, "now").mockReturnValue(Date.now());
    const refresh = async () => {
      clock.mockReturnValue(Date.now() + 10_001);
      return (await (
        await handle(new Request("http://127.0.0.1/api/runs"))
      ).json()) as Run[];
    };
    try {
      await writeFile(observationFile, "{invalid JSON");
      await fakeNomad(directory, undefined, [
        { id: "new-work", role: "verifier" },
      ]);
      for (let i = 0; i < 2; i++) {
        const failed = await refresh();
        expect(failed[2]).toMatchObject({
          stale: true,
          kind: rows[2]!.kind,
          observedAt: rows[2]!.observedAt,
          snapshot: rows[2]!.snapshot,
          process: { active: [{ id: "new-work", role: "verifier" }] },
        });
        expect(failed[2]?.error).toBeString();
        expect(failed[0]).not.toHaveProperty("stale");
        expect(failed[1]?.snapshot).toBeUndefined();
        expect(failed[1]).not.toHaveProperty("stale");
      }
      const recovered = { ...published, notes: [] };
      await writeFile(observationFile, JSON.stringify(recovered));
      await fakeNomad(directory, "stderr");
      const refreshed = await refresh();
      expect(refreshed[2]?.snapshot).toEqual(recovered);
      expect(refreshed[2]).not.toHaveProperty("stale");
      expect(refreshed[2]?.error).toContain("logs unavailable");
    } finally {
      clock.mockRestore();
    }
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

test("observer accepts generic campaign databases and exports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-observe-generic-"));
  const engine = await Xean.open(
    await openXeanStorage(join(directory, "campaign.sqlite")),
    {
      task: { task: { label: "Opaque kernel payload" } },
      roles: [],
      coordinator: { name: "fixture", run: () => ({ state: null }) },
    },
  );
  try {
    const value = await engine.inspectWithRecords();
    const exported = join(directory, "exported");
    await mkdir(exported);
    await writeFile(join(exported, "result.json"), JSON.stringify(value));
    for (const path of [directory, exported]) {
      const observed = await readRun(
        { id: "generic", directory: path },
        directory,
      );
      expect(observed.error).toBeUndefined();
      expect(observed.snapshot?.task).toBeNull();
      expect(observed.snapshot?.status.status).toBe(value.campaign.status);
    }
  } finally {
    await engine.close();
    await rm(directory, { recursive: true });
  }
});

test("observer sources preserve unavailable evidence and reject unsupported snapshots and unsafe remote commands", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-observe-artifacts-"));
  try {
    await writeFile(join(directory, "task.json"), "null");
    const malformed = await readRun({ id: "bad-task", directory }, directory);
    expect(malformed.error).toBeString();
    expect(malformed.heartbeat).toBeUndefined();
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
      JSON.stringify({
        schema: "xean-observe/v1",
        observedAt: new Date().toISOString(),
        status: { calls: {} },
        notes: [],
        work: [],
      }),
    );
    for (const failed of ["stdout", "stderr"] as const) {
      await fakeNomad(directory, failed);
      const unavailable = await readRun(
        { id: "old", directory, job: "fixture-job" },
        directory,
      );
      expect(unavailable.error).toContain("Unsupported observation");
      expect(unavailable.error).toContain("logs unavailable");
      expect(unavailable.process).toMatchObject({
        status: "failed",
        ...(failed === "stdout"
          ? { log: "", errorLog: "worker stopped\n" }
          : {
              calls: 3,
              rounds: 2,
              log: expect.stringContaining('"calls":3'),
              errorLog: "",
            }),
      });
    }
    await fakeNomad(directory, undefined, [null]);
    const badProcess = await readRun(
      { id: "old", directory, job: "fixture-job" },
      directory,
    );
    expect(badProcess.error).toContain("Malformed process heartbeat");
    expect(badProcess.process?.active).toBeUndefined();
    expect(badProcess.process?.log).toContain('"active":[null]');
    expect(badProcess.process?.status).toBe("failed");
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
    expect(() =>
      readSources([{ id: "run", directory, task: "" }], directory),
    ).toThrow("Nomad task");
    let reads = 0;
    const handle = api(
      [
        {
          id: "known",
          get directory() {
            reads++;
            return directory;
          },
        },
      ],
      directory,
    );
    for (const [path, status] of [
      ["/api/unknown", 404],
      ["/api/runs/unknown", 404],
      ["/api/runs/", 404],
      ["/api/runs/%", 400],
    ] as const)
      expect(
        (await handle(new Request(`http://127.0.0.1${path}`))).status,
      ).toBe(status);
    expect(reads).toBe(0);
  } finally {
    await rm(directory, { recursive: true });
  }
});
