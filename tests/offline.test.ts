import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { offlineResearch } from "../scripts/bounded-solve.ts";
import {
  declarationVersion,
  readDeclaration,
} from "../packages/core/src/solve/campaign.ts";

test("closed-book research cannot retrieve or clear unresolved premises", async () => {
  const results = await offlineResearch.source(
    {
      task: { problem: "Prove a statement", completionCriteria: "A proof" },
      notes: [
        { id: "proved", text: "Self-contained proof", premises: [] },
        {
          id: "external",
          text: "Uses a theorem",
          premises: ["External claim"],
        },
      ],
    },
    null!,
    null!,
  );
  expect(results.map(({ result }) => result.verdict)).toEqual([
    "PASS",
    "INCONCLUSIVE",
  ]);
  await expect(offlineResearch.literature(null!, null!, null!)).rejects.toThrow(
    "disabled",
  );
  await expect(offlineResearch.review(null!, null!, null!)).rejects.toThrow(
    "disabled",
  );
  const declaration = {
    kind: "xean.solve",
    version: declarationVersion,
    task: { problem: "Prove a statement", completionCriteria: "A proof" },
    settings: {
      profiles: { default: { provider: "openai", model: "fixture" } },
    },
  };
  expect(() => readDeclaration(declaration)).not.toThrow();
  expect(() =>
    readDeclaration({ ...declaration, kind: "xean.solve.offline" }),
  ).toThrow();
});

test("closed-book runner honors omitted literature defaults and reopens without calls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-offline-"));
  try {
    await writeFile(
      join(directory, "task.json"),
      JSON.stringify({
        problem: "Fixture",
        completionCriteria: "Exact result",
      }),
    );
    await writeFile(
      join(directory, "settings.json"),
      JSON.stringify({
        profiles: { default: { provider: "openai", model: "unavailable" } },
      }),
    );
    const run = async () => {
      const result = Bun.spawnSync(
        [
          process.execPath,
          "--no-install",
          "--no-env-file",
          resolve(import.meta.dir, "../scripts/bounded-solve.ts"),
          directory,
          "--offline",
          "--round-limit",
          "0",
        ],
        { timeout: 5000, env: { ...process.env, OPENAI_API_KEY: "" } },
      );
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
      return {
        result: await Bun.file(join(directory, "result.json")).json(),
        records: await Bun.file(join(directory, "records.json")).json(),
      };
    };
    const first = await run();
    expect(first.result).toMatchObject({
      outcome: "round_limit",
      rounds: 0,
      campaign: { status: "paused", providerCalls: 0 },
    });
    expect(first.records.length).toBeGreaterThan(0);
    const reopened = await run();
    expect(reopened.result.outcome).toBe("paused");
    expect(reopened.result.campaign).toEqual(first.result.campaign);
    expect(reopened.result.notes).toEqual(first.result.notes);
    expect(reopened.records).toEqual(first.records);
    expect(await Bun.file(join(directory, "observation.json")).exists()).toBe(
      false,
    );
  } finally {
    await rm(directory, { recursive: true });
  }
});
