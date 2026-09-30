import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  Xean,
  openXeanStorage,
  type Execution,
} from "../packages/core/src/index.ts";
import {
  campaignOptions,
  createResearch,
  declarationVersion,
  readSettings,
  type Declaration,
  type Note,
} from "../packages/core/src/solve/index.ts";
import { fixtureRuntime } from "./fixtures/pi.ts";

const selection = {
  provider: "claude-code" as const,
  model: "claude-opus-5-5",
};
const task = { problem: "Offline research", completionCriteria: "Establish P" };
const usage = {
  input_tokens: 17,
  cache_read_input_tokens: 3,
  output_tokens: 7,
};

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "xean-claude-research-"));
  const command = join(directory, "claude");
  await writeFile(
    command,
    `#!${process.execPath}\nimport { runFixture } from ${JSON.stringify(join(import.meta.dir, "fixtures/claude-research.ts"))};\nawait runFixture(${JSON.stringify(directory)});\n`,
    { mode: 0o700 },
  );
  const previous = process.env.PI_CLAUDE_CODE_PROVIDER_PATH;
  process.env.PI_CLAUDE_CODE_PROVIDER_PATH = command;
  try {
    await run(directory);
  } finally {
    if (previous === undefined) delete process.env.PI_CLAUDE_CODE_PROVIDER_PATH;
    else process.env.PI_CLAUDE_CODE_PROVIDER_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

test("Claude research settings route source, literature, and review through durable native calls", async () => {
  await fixture(async (directory) => {
    const profiles = { default: { provider: "openai", model: "gpt-6-astra" } };
    const settings = readSettings({
      profiles,
      research: selection,
      literature: true,
    });
    expect(readSettings({ profiles }).research).toBeUndefined();
    for (const override of [
      { command: "claude" },
      { profile: "custom" },
      { reasoning: "minimal" },
    ])
      expect(() =>
        readSettings({ profiles, research: { ...selection, ...override } }),
      ).toThrow();
    const note: Note = {
      id: "given",
      summary: "Apply P",
      detailedSummary: "Apply P",
      text: "Apply P",
      support: [],
      revision: 0,
      imported: false,
      verified: false,
      dead: false,
      accepted: false,
      candidate: false,
      checks: [
        {
          noteId: "given",
          correctness: {
            verdict: "PASS",
            report: "Checked conditionally",
            premises: ["P holds"],
          },
        },
      ],
    };
    const common = { version: declarationVersion, task, settings } as const;
    const declarations: Declaration[] = [
      {
        ...common,
        kind: "xean.role",
        role: "verifier",
        input: {
          task,
          notes: [note],
          targets: [{ id: note.id, through: "source" }],
        },
      },
      {
        ...common,
        kind: "xean.role",
        role: "literature",
        input: { task, notes: [], query: "Find a primary source for P" },
      },
      {
        ...common,
        kind: "xean.review",
        argument: "P holds by the cited theorem.",
      },
    ];
    for (const [index, declaration] of declarations.entries()) {
      const options = campaignOptions(
        declaration,
        fixtureRuntime(() => {
          throw new Error("Research must use the configured native provider");
        }),
      );
      const path = join(directory, `${index}.sqlite`);
      let engine = await Xean.open(await openXeanStorage(path), options);
      try {
        const result = await engine.run();
        expect(result.status).toBe("completed");
        expect(result.providerCalls).toBe(1);
        expect(result.result).toMatchObject(
          index === 0
            ? {
                kind: "verification",
                checks: [
                  {
                    noteId: "given",
                    source: {
                      kind: "research-report",
                      verdict: "PASS",
                      premises: ["P holds"],
                    },
                  },
                ],
              }
            : index === 1
              ? { kind: "notes", candidate: false, notes: [{ id: "n1" }] }
              : {
                  kind: "research-report",
                  verdict: "PASS",
                  premises: ["P holds"],
                },
        );
        const records = await engine.records();
        expect(
          records.find((record) => record.kind === "xean.call.request")!.data,
        ).toMatchObject({
          payload: {
            kind: "claude-code-print",
            model: selection.model,
            reasoning: "max",
          },
        });
        expect(
          records.find((record) => record.kind === "xean.call.settled")!.data,
        ).toMatchObject({ usage, message: { failed: false } });
        await engine.close();
        engine = await Xean.open(
          await openXeanStorage(path),
          campaignOptions(declaration, () => {
            throw new Error("Completed research must not initialize providers");
          }),
        );
        expect(await engine.run()).toEqual(result);
        expect(await engine.records()).toEqual(records);
      } finally {
        await engine.close();
      }
    }
    const calls = (await readFile(join(directory, "calls.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls).toHaveLength(3);
    for (const { args } of calls) {
      expect(args[args.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch");
      expect(args[args.indexOf("--effort") + 1]).toBe("max");
    }
  });
}, 15_000);

test("Claude research retains failure usage and refuses evidence from failed or unrelated tool results", async () => {
  await fixture(async () => {
    const settlements: unknown[] = [];
    const execution: Execution = {
      attemptId: "research-fixture",
      attempt: 1,
      recorder: {
        begin() {
          return {
            recordRequest() {},
            settle(_message, counts) {
              settlements.push(counts);
            },
          };
        },
      },
    };
    const research = createResearch(selection);
    for (const mode of ["failed-tool", "unpaired-tool"]) {
      const input = {
        task: { ...task, problem: mode },
        notes: [{ id: "n", text: "Apply P", premises: ["P holds"] }],
      };
      expect(
        await research.source(input, execution, BACKGROUND_CONTEXT),
      ).toMatchObject([
        { noteId: "n", result: { verdict: "INCONCLUSIVE", passages: [] } },
      ]);
      await expect(
        research.literature(
          { task: input.task, notes: [], query: "Find P" },
          execution,
          BACKGROUND_CONTEXT,
        ),
      ).rejects.toThrow("without observed web activity");
    }
    for (const mode of ["invalid", "error"])
      await expect(
        research.review(
          { task: { ...task, problem: mode }, argument: "P holds." },
          execution,
          BACKGROUND_CONTEXT,
        ),
      ).rejects.toThrow(
        mode === "invalid" ? "Invalid value" : "Fixture research failed",
      );
    expect(settlements).toEqual(Array.from({ length: 6 }, () => usage));
  });
}, 15_000);
