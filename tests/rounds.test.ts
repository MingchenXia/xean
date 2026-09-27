import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Xean, openXeanStorage } from "../packages/core/src/index.ts";
import { createSolver } from "../packages/core/src/solve/index.ts";
import { limitRounds, resumeExperiment } from "../scripts/bounded-solve.ts";

test("an increased total resumes only additional rounds and preserves prior work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-rounds-"));
  const database = join(directory, "campaign.sqlite");
  const task = { problem: "Fixture", completionCriteria: "Complete proof" };
  const setup = (allowance: number) => {
    const solver = createSolver(task, () => {
      throw new Error("Round accounting needs no models");
    });
    solver.functions.coordinator = async (input) => {
      expect(input).not.toHaveProperty("rounds");
      expect(input).not.toHaveProperty("allowance");
      expect(JSON.stringify(input)).not.toContain("bounded-continue-");
      return {
        work: [{ kind: "explorer", guidance: "Continue", support: [] }],
      };
    };
    solver.functions.explorer = async () => ({
      kind: "notes",
      candidate: false,
      notes: [
        {
          id: "n1",
          text: "Partial work",
          summary: "Partial",
          detailedSummary: "Partial work remains incomplete.",
          support: [],
        },
      ],
    });
    return { solver, rounds: limitRounds(solver, directory, allowance) };
  };
  let engine: Xean | undefined;
  try {
    const first = setup(20);
    engine = await Xean.open(await openXeanStorage(database), first.solver);
    await engine.run();
    const paused = await engine.pause();
    expect(first.rounds()).toBe(20);
    expect(paused.work).toHaveLength(20);
    const lastMarker = await readFile(join(directory, "round-20.json"), "utf8");
    await engine.close();

    const continuation = setup(40);
    engine = await Xean.open(
      await openXeanStorage(database),
      continuation.solver,
    );
    expect(await engine.run()).toEqual(paused);
    const resumed = await resumeExperiment(engine, 40);
    expect(continuation.rounds()).toBe(40);
    expect(resumed.work).toHaveLength(40);
    expect(resumed.work.slice(0, 20)).toEqual(paused.work);
    expect(resumed.providerCalls).toBe(0);
    expect(await readFile(join(directory, "round-20.json"), "utf8")).toBe(
      lastMarker,
    );
    const finished = await engine.pause();
    await engine.close();

    const repeated = setup(40);
    engine = await Xean.open(await openXeanStorage(database), repeated.solver);
    expect(repeated.rounds()).toBe(40);
    expect(await engine.run()).toEqual(finished);
    const retried = await resumeExperiment(engine, 40);
    expect(retried.work).toHaveLength(40);
    expect(retried.inputs).toEqual(finished.inputs);
    expect(repeated.rounds()).toBe(40);
    expect(() => setup(20)).toThrow("exceeded its round allowance");
  } finally {
    await engine?.close();
    await rm(directory, { recursive: true });
  }
});
