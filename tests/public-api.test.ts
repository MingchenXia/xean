import { expect, test } from "bun:test";
import { Xean, openXeanStorage } from "xean";
import { createSolver, type Plan, type Task } from "xean/solve";

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
