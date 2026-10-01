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
  task = "solver",
  stdout = "worker output",
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
else console.log(${JSON.stringify(stdout)});
`,
    { mode: 0o700 },
  );
}

test("pooled runs share process reads and failures only within each refresh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-observe-pool-"));
  const clock = spyOn(Date, "now").mockReturnValue(Date.now());
  try {
    const mode = join(directory, "mode");
    const calls = join(directory, "calls.jsonl");
    await mkdir(join(directory, "bin"));
    await writeFile(
      join(directory, "task.json"),
      JSON.stringify({
        problem: "Task",
        completionCriteria: "Proof",
      }),
    );
    await writeFile(mode, "stderr");
    await writeFile(
      join(directory, "bin/fleet-nomad"),
      `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
const mode = readFileSync(${JSON.stringify(mode)}, "utf8");
if (args[0] === "job") {
  if (mode === "allocs") throw new Error("allocations unavailable");
  console.log(JSON.stringify([{ ID: "allocation", CreateIndex: 1, ClientStatus: "running" }]));
} else {
  const task = args.at(-1);
  const stream = args.includes("-stderr") ? "stderr" : "stdout";
  if (mode === "stderr" && task === "solver" && stream === "stderr") throw new Error("solver stderr unavailable");
  console.log(task + " " + stream);
}
`,
      { mode: 0o700 },
    );
    const handle = api(
      [
        { id: "first", directory, job: "pool" },
        { id: "second", directory, job: "pool", task: "solver" },
        { id: "worker", directory, job: "pool", task: "worker" },
        { id: "missing", directory: join(directory, "missing"), job: "pool" },
      ],
      directory,
    );
    const read = async () =>
      (await (
        await handle(new Request("http://127.0.0.1/api/runs"))
      ).json()) as Run[];
    const commands = async () =>
      (await Bun.file(calls).text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
    const [first, concurrent] = await Promise.all([read(), read()]);
    expect(concurrent).toEqual(first);
    expect((await commands()).filter((args) => args[0] === "job")).toHaveLength(
      2,
    );
    expect(await commands()).toHaveLength(6);
    expect(first[0]?.error).toContain("solver stderr unavailable");
    expect(first[1]?.error).toBe(first[0]?.error);
    expect(first[0]?.process).toMatchObject({
      job: "pool",
      task: "solver",
      allocation: "allocation",
      log: "solver stdout\n",
      errorLog: "",
    });
    expect(first[2]?.process).toMatchObject({
      job: "pool",
      task: "worker",
      allocation: "allocation",
      log: "worker stdout\n",
      errorLog: "worker stderr\n",
    });
    expect(first[2]?.error).toBeUndefined();
    expect(first[3]?.error).toContain("No observation, result, or task file");
    expect(first[0]?.error).not.toContain(
      "No observation, result, or task file",
    );
    await writeFile(mode, "allocs");
    clock.mockReturnValue(Date.now() + 10_001);
    const failed = await read();
    expect(await commands()).toHaveLength(8);
    expect(failed[0]?.error).toContain("allocations unavailable");
    expect(failed[1]?.error).toBe(failed[0]?.error);
    expect(failed[0]?.process).toBeUndefined();
    await writeFile(mode, "ok");
    clock.mockReturnValue(Date.now() + 10_001);
    const recovered = await read();
    expect(await commands()).toHaveLength(14);
    expect(recovered.slice(0, 3).every((run) => run.error === undefined)).toBe(
      true,
    );
    expect(recovered[0]?.process?.errorLog).toBe("solver stderr\n");
  } finally {
    clock.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});

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
    expect(published.schema).toBe("xean-observe/v3");
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
    await fakeNomad(directory, undefined, "worker");
    const supervised = await readRun(
      { id: "fixture", directory, job: "fixture-job", task: "worker" },
      directory,
    );
    expect(supervised.error).toBeUndefined();
    expect(supervised.kind).toBe("database");
    expect(supervised.snapshot?.notes).toEqual(after.snapshot?.notes);
    expect(supervised.process).toMatchObject({
      job: "fixture-job",
      task: "worker",
      allocation: "allocation",
      status: "failed",
      log: "worker output\n",
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
      await fakeNomad(directory, undefined, "solver", "new-work");
      for (let i = 0; i < 2; i++) {
        const failed = await refresh();
        expect(failed[2]).toMatchObject({
          stale: true,
          kind: rows[2]!.kind,
          observedAt: rows[2]!.observedAt,
          snapshot: rows[2]!.snapshot,
          process: { log: "new-work\n" },
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
              log: "worker output\n",
              errorLog: "",
            }),
      });
    }
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

test("source refresh reloads membership and retains stale evidence only for the same ID and location", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-observe-reload-"));
  const clock = spyOn(Date, "now").mockReturnValue(Date.now());
  try {
    for (const id of ["first", "second"]) {
      await mkdir(join(directory, id));
      await writeFile(
        join(directory, id, "task.json"),
        JSON.stringify({ problem: id, completionCriteria: "Proof" }),
      );
    }
    const config = join(directory, "sources.json");
    const first = { id: "first", directory: "first" };
    const second = { id: "second", directory: "second" };
    await writeFile(config, JSON.stringify([first, second]));
    let reloads = 0;
    const handle = api(async () => {
      reloads++;
      return readSources(await Bun.file(config).json(), directory);
    }, directory);
    const request = (suffix = "") =>
      handle(new Request(`http://127.0.0.1/api/runs${suffix}`));
    const refresh = async (sources: unknown) => {
      await writeFile(config, JSON.stringify(sources));
      clock.mockReturnValue(Date.now() + 10_001);
      return (await (await request()).json()) as Run[];
    };
    const [initial, concurrent] = await Promise.all([request(), request()]);
    const original = (await initial.json()) as Run[];
    expect(await concurrent.json()).toEqual(original);
    expect(reloads).toBe(1);
    await writeFile(join(directory, "first/task.json"), "invalid");
    const reordered = await refresh([second, first]);
    expect(reordered.map((run) => run.id)).toEqual(["second", "first"]);
    expect(reordered[1]).toMatchObject({
      stale: true,
      heartbeat: original[0]!.heartbeat,
      observedAt: original[0]!.observedAt,
    });
    expect(reordered[0]?.heartbeat?.task.problem).toBe("second");
    expect(reordered[0]?.stale).toBeUndefined();
    const relocated = await refresh([{ ...first, directory: "missing" }]);
    expect(relocated[0]?.heartbeat).toBeUndefined();
    expect(relocated[0]?.stale).toBeUndefined();
    expect((await request("/second")).status).toBe(404);
    const added = await refresh([second, { id: "third", directory: "second" }]);
    expect(added.map((run) => run.id)).toEqual(["second", "third"]);
    await writeFile(config, "not JSON");
    clock.mockReturnValue(Date.now() + 10_001);
    expect((await request()).status).toBe(500);
    expect((await refresh([second]))[0]?.heartbeat).toEqual(
      added[0]?.heartbeat,
    );
    expect(await refresh([])).toEqual([]);
    expect((await request("/second")).status).toBe(404);
  } finally {
    clock.mockRestore();
    await rm(directory, { recursive: true });
  }
});

test("explicit external receipts refresh independently of campaign evidence locally and through one SSH read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-observe-review-"));
  const path = process.env.PATH;
  try {
    await writeFile(
      join(directory, "task.json"),
      JSON.stringify({ problem: "Task", completionCriteria: "Proof" }),
    );
    const source = { id: "review", directory, review: "selected-review.json" };
    expect(
      (await readRun({ id: "unsupplied", directory }, directory)).review,
    ).toBeUndefined();
    expect(await readRun(source, directory)).toMatchObject({
      review: { state: "missing" },
      heartbeat: { task: { problem: "Task" } },
    });
    const receipt = {
      reviewer: "Independent reviewer",
      reviewedAt: "2026-10-01T00:00:00Z",
      verdict: "PASS" as const,
      report: "The proof checks.",
    };
    for (const value of ["not JSON", JSON.stringify({ verdict: "PASS" })]) {
      await writeFile(join(directory, source.review), value);
      const observed = await readRun(source, directory);
      expect(observed.review?.state).toBe("unavailable");
      expect(observed.review?.error).toBeString();
      expect(observed.error).toBeUndefined();
      expect(observed.heartbeat?.task.problem).toBe("Task");
    }
    await writeFile(join(directory, source.review), JSON.stringify(receipt));
    expect((await readRun(source, directory)).review).toEqual({
      state: "reviewed",
      receipt,
    });
    await mkdir(join(directory, "bin"));
    const calls = join(directory, "ssh-calls.jsonl");
    await writeFile(
      join(directory, "bin/ssh"),
      `#!${process.execPath}
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))+"\\n");
const child=Bun.spawn([process.execPath,"--no-install","--no-env-file","run","-"],{stdin:new TextEncoder().encode(await Bun.stdin.text()),stdout:"inherit",stderr:"inherit"});
process.exit(await child.exited);
`,
      { mode: 0o700 },
    );
    process.env.PATH = `${join(directory, "bin")}:${path ?? ""}`;
    const remote = { ...source, host: "jupiter", runtime: process.execPath };
    const changed = {
      ...receipt,
      verdict: "FAIL" as const,
      report: "A later review identifies a gap.",
    };
    await writeFile(join(directory, source.review), JSON.stringify(changed));
    const observed = await readRun(remote, directory);
    expect(observed.review).toEqual({ state: "reviewed", receipt: changed });
    expect(observed.heartbeat?.task.problem).toBe("Task");
    expect(observed.error).toBeUndefined();
    expect((await Bun.file(calls).text()).trim().split("\n")).toHaveLength(1);
    const engine = await Xean.open(
      await openXeanStorage(join(directory, "fixture.sqlite")),
      {
        task: null,
        roles: [],
        coordinator: { name: "fixture", run: () => ({ state: null }) },
      },
    );
    let exported;
    try {
      exported = await engine.inspectWithRecords();
    } finally {
      await engine.close();
    }
    for (const [file, kind, value] of [
      ["result.json", "export", exported],
      ["observation.json", "snapshot", snapshot(exported)],
    ] as const) {
      await writeFile(join(directory, file), JSON.stringify(value));
      expect(await readRun(remote, directory)).toMatchObject({
        kind,
        review: { state: "reviewed", receipt: changed },
      });
    }
    await writeFile(join(directory, "observation.json"), "invalid snapshot");
    const unavailable = await readRun(remote, directory);
    expect(unavailable.error).toBeString();
    expect(unavailable.snapshot).toBeUndefined();
    expect(unavailable.review).toEqual({ state: "reviewed", receipt: changed });
    expect((await Bun.file(calls).text()).trim().split("\n")).toHaveLength(4);
    expect(() =>
      readSources([{ ...source, review: "/arbitrary/file" }], directory),
    ).toThrow("relative path");
  } finally {
    if (path === undefined) delete process.env.PATH;
    else process.env.PATH = path;
    await rm(directory, { recursive: true });
  }
});
