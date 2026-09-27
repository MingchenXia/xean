import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  Xean,
  openXeanStorage,
  type XeanOptions,
} from "../packages/core/src/index.ts";
import {
  bindCodex,
  codexResearch,
} from "../packages/core/src/solve/research.ts";
import {
  askCodex,
  type CodexOptions,
} from "../packages/core/src/solve/codex.ts";
import {
  sourceSchema,
  reviewSchema,
  decode,
  type ResearchReport,
} from "../packages/core/src/solve/contracts.ts";

async function fixture(directory: string): Promise<CodexOptions> {
  const command = join(directory, "codex");
  await writeFile(
    command,
    `#!${process.execPath}\nimport ${JSON.stringify(join(import.meta.dir, "fixtures/codex.ts"))};\n`,
    { mode: 0o700 },
  );
  return {
    model: "xean-fixture",
    profile: "fixture-profile",
    command,
    environment: {
      HOME: directory,
      CODEX_HOME: join(directory, "native-codex-home"),
      PATH: process.env.PATH,
      XEAN_FIXTURE: "unchanged",
      XEAN_CODEX_USAGE_TAG: "caller-tag",
    },
  };
}

const schema = Type.Object(
  { answer: Type.Number() },
  { additionalProperties: false },
);
test("Codex native results and invalid-answer usage survive completed SQLite reopen", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".xean-codex-test-"));
  const path = join(directory, "campaign.sqlite");
  const codex = await fixture(directory);
  codex.command = relative(process.cwd(), codex.command!);
  const options: XeanOptions = {
    task: "offline Codex lifecycle",
    limits: { concurrency: 1 },
    roles: [
      {
        name: "worker",
        async run(input, execution, context) {
          if (input === "success") {
            const research = codexResearch(codex);
            expect(
              await research.source(
                {
                  task: {
                    problem: "Self-contained task",
                    completionCriteria: "Prove it",
                  },
                  notes: [{ id: "self", text: "Self-contained", premises: [] }],
                },
                execution,
                context,
              ),
            ).toMatchObject([{ noteId: "self", result: { verdict: "PASS" } }]);
          }
          return (
            await askCodex(
              codex,
              schema,
              "Return the answer",
              { mode: input },
              execution,
              context,
              "xean-tests",
            )
          ).value;
        },
      },
    ],
    coordinator: {
      name: "fixture",
      run(signal, view) {
        return {
          state: null,
          ...(signal.kind === "start"
            ? {
                dispatch: ["success", "invalid", "nonzero"].map((id) => ({
                  id,
                  role: "worker",
                  input: id,
                })),
              }
            : view.work.every((work) =>
                  ["completed", "failed"].includes(work.status),
                )
              ? { completion: "done" }
              : {}),
        };
      },
    },
    accept: (candidate) => candidate === "done",
  };
  let engine = await Xean.open(await openXeanStorage(path), options);
  try {
    for (const wireSchema of [sourceSchema, reviewSchema])
      expect(new Set(Object.keys(wireSchema.properties))).toEqual(
        new Set(wireSchema.required),
      );
    const source = {
      value: {
        verdict: "PASS" as const,
        report: "Reported passage",
        correction: null,
        passages: [
          { premise: 0, url: "https://example.com/paper", quote: "P holds" },
        ],
      },
      operationId: "fixture",
      searches: 0,
    };
    expect(bindCodex(source, ["P"]).verdict).toBe("INCONCLUSIVE");
    const task = { problem: "Assume P holds.", completionCriteria: "Prove Q" };
    const taskSource = {
      ...source,
      value: {
        ...source.value,
        passages: [{ premise: 0, url: "urn:xean:task", quote: task.problem }],
      },
    };
    const taskReport = bindCodex(taskSource, ["P"], [], "fixture", task);
    expect(taskReport.verdict).toBe("PASS");
    expect(bindCodex(taskSource, ["P"]).verdict).toBe("INCONCLUSIVE");
    expect(
      bindCodex(taskSource, ["P"], [], "fixture", {
        ...task,
        problem: "Prove P.",
      }).verdict,
    ).toBe("INCONCLUSIVE");
    const taskReuse = {
      ...source,
      value: {
        ...source.value,
        passages: [{ premise: 0, passageId: taskReport.passages[0]!.id }],
      },
    };
    expect(
      bindCodex(taskReuse, ["P"], taskReport.passages, "reuse", task).verdict,
    ).toBe("PASS");
    expect(bindCodex(taskReuse, ["P"], taskReport.passages).verdict).toBe(
      "INCONCLUSIVE",
    );
    source.searches = 1;
    expect(bindCodex(source, ["P", "Q"]).verdict).toBe("INCONCLUSIVE");
    const verified = bindCodex(source, ["P"]);
    expect(verified.verdict).toBe("PASS");
    expect(verified).not.toHaveProperty("correction");
    expect(
      bindCodex(
        {
          ...source,
          value: {
            ...source.value,
            correction: {
              summary: "Edited",
              detailedSummary: "Harmless edit",
              text: "Harmless edit",
            },
          },
        },
        ["P"],
      ).correction,
    ).toEqual({
      summary: "Edited",
      detailedSummary: "Harmless edit",
      text: "Harmless edit",
    });
    expect(verified).toMatchObject({
      kind: "codex-report",
      operationId: "fixture",
    });
    expect(verified.passages).toEqual([
      { ...source.value.passages[0]!, id: "fixture/0", statement: "P" },
    ]);
    const partial = bindCodex(
      {
        ...source,
        value: {
          ...source.value,
          passages: [
            { premise: 0, passageId: "missing" },
            ...source.value.passages,
          ],
        },
      },
      ["P"],
    );
    expect(partial.verdict).toBe("INCONCLUSIVE");
    expect(partial.passages).toEqual([
      { ...verified.passages[0]!, id: "fixture/1" },
    ]);
    const reused = {
      ...source,
      operationId: "reuse",
      searches: 0,
      value: {
        ...source.value,
        passages: [{ premise: 0, passageId: "fixture/0" }],
      },
    };
    const reuse = bindCodex(
      reused,
      ["P applied to this note"],
      verified.passages,
    );
    expect(reuse).toMatchObject({
      verdict: "PASS",
      operationId: "reuse",
      premises: ["P applied to this note"],
      passages: verified.passages,
    });
    expect(bindCodex(reused, ["P"]).verdict).toBe("INCONCLUSIVE");
    expect(bindCodex(reused, ["P", "Q"], verified.passages).verdict).toBe(
      "INCONCLUSIVE",
    );
    expect(
      bindCodex(
        { ...reused, value: { ...reused.value, verdict: "FAIL" } },
        ["Q"],
        verified.passages,
      ).verdict,
    ).toBe("FAIL");
    expect(
      bindCodex(
        {
          ...source,
          searches: 0,
          value: {
            ...source.value,
            passages: [
              ...reused.value.passages,
              { premise: 1, url: "https://example.com/q", quote: "Q" },
            ],
          },
        },
        ["P", "Q"],
        verified.passages,
      ).verdict,
    ).toBe("INCONCLUSIVE");
    // Independent review's wire contract permits only newly inspected passages.
    expect(() =>
      decode(reviewSchema, { ...reused.value, premises: ["P"] }),
    ).toThrow();
    const result = await engine.run();
    expect(result.status).toBe("completed");
    expect(result.work.map((work) => [work.status, work.result])).toEqual([
      ["completed", { answer: 25 }],
      ["failed", null],
      ["failed", null],
    ]);
    expect(result.work[2]!.error).toBe("Fixture failed after reporting usage");
    const records = await engine.records();
    const requests = records.filter(
      (entry) => entry.kind === "xean.call.request",
    );
    const settlements = records.filter(
      (entry) => entry.kind === "xean.call.settled",
    );
    expect(requests).toHaveLength(3);
    expect(settlements).toHaveLength(3);
    for (let index = 0; index < 3; index++) {
      expect(requests[index]!.id).toBeLessThan(settlements[index]!.id);
      expect(settlements[index]!.data).toMatchObject({
        message: {
          failed: index === 2,
          isCanceled: false,
          exitCode: index === 2 ? 7 : 0,
          stdout: expect.stringContaining('"turn.completed"'),
          stderr:
            index === 2
              ? expect.stringContaining("Fixture failed after reporting usage")
              : "",
        },
        usage: { input_tokens: 11, cached_input_tokens: 3, output_tokens: 5 },
      });
    }
    expect(requests[0]!.data).toMatchObject({
      payload: {
        kind: "codex-exec",
        model: "xean-fixture",
        reasoning: "max",
        prompt: JSON.stringify({ mode: "success" }),
      },
    });
    const calls = await readFile(join(directory, "invocations.jsonl"), "utf8");
    const invocations = calls.trim().split("\n");
    expect(invocations.map((line) => JSON.parse(line))).toEqual(
      result.work.map((work) => ({
        mode: work.id,
        profile: "fixture-profile",
        reasoning: 'model_reasoning_effort="max"',
        shell: "features.shell_tool=false",
        codexHome: codex.environment!.CODEX_HOME,
        marker: "unchanged",
        usageTag: `xean-tests/${work.attemptId}`,
      })),
    );
    await engine.close();
    engine = await Xean.open(await openXeanStorage(path), options);
    expect(await engine.run()).toEqual(result);
    expect(await engine.records()).toEqual(records);
    expect(await readFile(join(directory, "invocations.jsonl"), "utf8")).toBe(
      calls,
    );
  } finally {
    await engine.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

test("source batches preserve note identity and distinct evidence in one Codex call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-source-batch-"));
  try {
    const codex = await fixture(directory);
    const task = {
      problem: "Assume P holds.",
      completionCriteria: "Apply P and Q",
    };
    const notes = [
      { id: "a", text: "Apply P", premises: ["P holds"] },
      { id: "self", text: "Self-contained", premises: [] },
      { id: "b", text: "Apply Q", premises: ["Q holds"] },
    ];
    await expect(
      codexResearch(codex).source(
        { task, notes: [notes[0]!, { ...notes[1]!, id: "a" }] },
        {
          attemptId: "duplicates",
          recorder: {
            begin() {
              throw new Error("Must not call");
            },
          },
        },
        BACKGROUND_CONTEXT,
      ),
    ).rejects.toThrow("Duplicate source note IDs");
    let admitted = 0;
    let request: { operationId: string; prompt: string } | undefined;
    const results = await codexResearch(codex).source(
      { task, notes },
      {
        attemptId: "batch",
        recorder: {
          begin() {
            admitted++;
            return {
              recordRequest(payload) {
                request = payload as typeof request;
              },
              settle() {},
            };
          },
        },
      },
      BACKGROUND_CONTEXT,
    );
    expect(admitted).toBe(1);
    expect(JSON.parse(request!.prompt).task).toEqual(task);
    expect(JSON.parse(request!.prompt).notes).toEqual([notes[0], notes[2]]);
    expect(results.map(({ noteId }) => noteId)).toEqual(["a", "self", "b"]);
    expect(results[1]!.result).toMatchObject({ verdict: "PASS" });
    const reports = [
      results[0]!.result,
      results[2]!.result,
    ] as ResearchReport[];
    expect(
      reports.map(({ verdict, operationId }) => ({ verdict, operationId })),
    ).toEqual([
      { verdict: "PASS", operationId: request!.operationId },
      { verdict: "PASS", operationId: request!.operationId },
    ]);
    expect(reports.flatMap(({ passages }) => passages)).toEqual([
      {
        id: `${request!.operationId}/0/0`,
        premise: 0,
        statement: "P holds",
        url: "urn:xean:task",
        quote: task.problem,
      },
      {
        id: `${request!.operationId}/1/0`,
        premise: 0,
        statement: "Q holds",
        url: "https://example.com/paper",
        quote: "Q holds",
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("close kills a Codex launcher and its resistant descendant and preserves cancellation usage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-codex-cancel-"));
  const path = join(directory, "campaign.sqlite");
  const codex = await fixture(directory);
  const options: XeanOptions = {
    task: "cancel Codex",
    roles: [
      {
        name: "worker",
        async run(_input, execution, context) {
          return (
            await askCodex(
              codex,
              schema,
              "Wait",
              { mode: "wait" },
              execution,
              context,
            )
          ).value;
        },
      },
    ],
    coordinator: {
      name: "fixture",
      run(signal) {
        return {
          state: null,
          ...(signal.kind === "start"
            ? { dispatch: [{ id: "wait", role: "worker", input: null }] }
            : {}),
        };
      },
    },
  };
  let engine = await Xean.open(await openXeanStorage(path), options);
  let processes: number[] = [];
  const running = engine.run();
  try {
    const ready = join(directory, "processes.json");
    for (
      const deadline = Date.now() + 5000;
      !(await Bun.file(ready).exists());
    ) {
      if (Date.now() > deadline)
        throw new Error("Codex fixture did not become ready");
      await Bun.sleep(10);
    }
    const recorded: unknown = JSON.parse(await readFile(ready, "utf8"));
    if (
      !Array.isArray(recorded) ||
      recorded.length !== 2 ||
      !recorded.every((pid) => Number.isSafeInteger(pid) && pid > 1)
    )
      throw new Error("Invalid fixture process IDs");
    processes = recorded as number[];
    const invocation = JSON.parse(
      await readFile(join(directory, "invocations.jsonl"), "utf8"),
    );
    expect(invocation.usageTag).toBe("caller-tag");
    await engine.close();
    await running;
    for (const pid of processes) {
      for (const deadline = Date.now() + 3000; alive(pid);) {
        if (Date.now() > deadline)
          throw new Error(`Codex fixture process ${pid} survived close`);
        await Bun.sleep(10);
      }
    }
    engine = await Xean.open(await openXeanStorage(path), options);
    const records = await engine.records();
    expect(
      records.find((entry) => entry.kind === "xean.call.request")!.data,
    ).toMatchObject({ payload: { usageTag: "caller-tag" } });
    const settlements = records.filter(
      (entry) => entry.kind === "xean.call.settled",
    );
    expect(settlements).toHaveLength(1);
    expect(settlements[0]!.data).toMatchObject({
      message: { failed: true, isCanceled: true },
      usage: { input_tokens: 7, output_tokens: 0 },
    });
    expect((await engine.inspect()).work[0]!.result).toBeNull();
  } finally {
    for (const pid of processes) if (alive(pid)) process.kill(pid, "SIGKILL");
    await engine.close();
    await running;
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}
