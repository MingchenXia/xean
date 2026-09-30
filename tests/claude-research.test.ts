import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
    `#!${process.execPath}\nimport { runFixture } from ${JSON.stringify(join(import.meta.dir, "fixtures/claude-research.ts"))};\nawait runFixture();\n`,
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

test("Claude research settings route review through a durable native call", async () => {
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
    const declaration: Declaration = {
      version: declarationVersion,
      task,
      settings,
      kind: "xean.review",
      argument: "P holds by the cited theorem.",
    };
    const options = campaignOptions(
      declaration,
      fixtureRuntime(() => {
        throw new Error("Research must use the configured native provider");
      }),
    );
    const path = join(directory, "review.sqlite");
    let engine = await Xean.open(await openXeanStorage(path), options);
    try {
      const result = await engine.run();
      expect(result.status).toBe("completed");
      expect(result.providerCalls).toBe(1);
      expect(result.result).toMatchObject({
        kind: "research-report",
        verdict: "PASS",
        premises: ["P holds"],
      });
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
  });
}, 15_000);

test("Claude research requires successful retrieval and retains failure usage", async () => {
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
    for (const mode of ["success", "failed-tool", "unpaired-tool"]) {
      const input = {
        task: { ...task, problem: mode },
        notes: [{ id: "n", text: "Apply P", premises: ["P holds"] }],
      };
      const successful = mode === "success";
      expect(
        await research.source(input, execution, BACKGROUND_CONTEXT),
      ).toMatchObject([
        {
          noteId: "n",
          result: {
            verdict: successful ? "PASS" : "INCONCLUSIVE",
            passages: successful
              ? [expect.objectContaining({ quote: "P holds." })]
              : [],
          },
        },
      ]);
      const literature = research.literature(
        { task: input.task, notes: [], query: "Find P" },
        execution,
        BACKGROUND_CONTEXT,
      );
      if (successful)
        expect(await literature).toMatchObject({
          candidate: false,
          notes: [{ id: "n1" }],
        });
      else
        await expect(literature).rejects.toThrow(
          "without observed web activity",
        );
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
    expect(settlements).toEqual(Array.from({ length: 8 }, () => usage));
  });
}, 15_000);
