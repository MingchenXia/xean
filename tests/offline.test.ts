import { expect, test } from "bun:test";
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
