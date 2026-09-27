import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Xean, inspectCampaign, openXeanStorage } from "xean";
import { createSolver, project, type Plan, type Task } from "xean/solve";

test("direct library campaigns reject historical bare tasks without changing their records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-library-format-"));
  const path = join(directory, "campaign.sqlite");
  const task = { problem: "Prove P", completionCriteria: "Complete proof" };
  try {
    const historical = await Xean.open(await openXeanStorage(path), {
      task,
      roles: [],
      coordinator: {
        name: "xean.coordinator",
        run: () => ({ state: null }),
      },
    });
    try {
      await historical.input({
        kind: "submit",
        id: "legacy",
        candidate: false,
        notes: [{ id: "n1", summary: "P", text: "Proof of P", support: [] }],
      });
    } finally {
      await historical.close();
    }
    const before = await inspectCampaign(path);
    let runtimeLoads = 0;
    const solver = createSolver(task, () => {
      runtimeLoads++;
      throw new Error("Historical campaign must not initialize models");
    });
    const storage = await openXeanStorage(path);
    const checks = await Promise.allSettled([
      Promise.resolve().then(() => project(before.campaign)),
      Xean.open(storage, solver).then((engine) => engine.close()),
    ]);
    expect(await inspectCampaign(path)).toEqual(before);
    expect(runtimeLoads).toBe(0);
    expect(checks).toMatchObject([
      {
        status: "rejected",
        reason: { message: expect.stringContaining("Unsupported solver") },
      },
      {
        status: "rejected",
        reason: { message: expect.stringContaining("Task differs") },
      },
    ]);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("public solver functions replace planning, Explorer, and Verifier without constructing Pi", async () => {
  const task: Task = {
    problem: "Prove 2 + 2 = 4",
    completionCriteria: "Give a proof",
  };
  const solver = createSolver(task, () => {
    throw new Error(
      "Replaced functions must not initialize the default runtime",
    );
  });
  const called: string[] = [];
  solver.functions.coordinator = async ({
    task: exact,
    notes,
  }): Promise<Plan> => {
    expect(exact).toEqual(task);
    called.push("plan");
    return {
      work: notes.length
        ? [
            {
              kind: "verifier",
              notes: [notes[0]!.id],
              through: "reconstruction",
            },
          ]
        : [
            {
              kind: "explorer",
              guidance: "Prove the exact claim",
              support: [],
            },
          ],
    };
  };
  solver.functions.explorer = async () => {
    called.push("explore");
    return {
      kind: "notes",
      candidate: true,
      notes: [
        {
          id: "n1",
          summary: "Addition",
          detailedSummary: "Two plus two equals four by associativity.",
          text: "2 + 2 = (1 + 1) + (1 + 1) = 4.",
          support: [],
        },
      ],
    };
  };
  solver.functions.verifier = async ({ notes, targets }) => {
    called.push("verify");
    expect(targets).toEqual([{ id: notes[0]!.id, through: "reconstruction" }]);
    return {
      kind: "verification",
      checks: [
        {
          noteId: notes[0]!.id,
          correctness: {
            verdict: "PASS",
            report: "Addition is correct",
            premises: [],
          },
          source: { verdict: "PASS", report: "Self-contained" },
          requirements: { verdict: "PASS", report: "Exact task" },
          reconstruction: {
            verdict: "PASS",
            report: "Independent proof agrees",
            statement: task.problem,
            premises: [],
            proof: "Counting two pairs gives four units.",
          },
        },
      ],
    };
  };
  const engine = await Xean.open(await openXeanStorage(":memory:"), solver);
  try {
    const result = await engine.run();
    expect(result.status).toBe("completed");
    expect(result.providerCalls).toBe(0);
    expect(called).toEqual(["plan", "explore", "plan", "verify"]);
    expect(await engine.run()).toEqual(result);
    expect(called).toHaveLength(4);
  } finally {
    await engine.close();
  }
});
