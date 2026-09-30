import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Xean, openXeanStorage } from "xean";
import {
  createSolver,
  piRuntime,
  readSettings,
  type Plan,
  type Task,
} from "xean/solve";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { fixtureRuntime } from "./fixtures/pi.ts";

test("direct browser Explorer quota survives reopen with a replaced planner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-browser-quota-"));
  const path = join(directory, "campaign.sqlite");
  let calls = 0;
  const setup = () => {
    const runtime = fixtureRuntime(() => {
      calls++;
      return fauxAssistantMessage(
        [fauxToolCall("submit_result", { notes: [], candidate: false })],
        { stopReason: "toolUse" },
      );
    });
    runtime.profiles.explorer.model.provider = "codex-chatgpt-web";
    const solver = createSolver(
      { problem: "P", completionCriteria: "Prove P" },
      () => runtime,
    );
    solver.functions.coordinator = async () => ({
      work: [
        { kind: "explorer", guidance: "Explore" },
        { kind: "explorer", guidance: "Try another approach" },
      ],
    });
    return solver;
  };
  let engine: Xean | undefined;
  try {
    engine = await Xean.open(await openXeanStorage(path), setup());
    const first = await engine.run();
    expect(first.work).toHaveLength(1);
    await engine.close();
    engine = await Xean.open(await openXeanStorage(path), setup());
    await engine.input({ kind: "guide", id: "again", text: "Continue" });
    const second = await engine.run();
    expect(calls).toBe(1);
    expect(second.work).toEqual(first.work);
  } finally {
    await engine?.close();
    await rm(directory, { recursive: true });
  }
});

test("runtime construction validates profiles and never falls back from an explicit credential environment", () => {
  const browser = {
    provider: "codex-chatgpt-web" as const,
    model: "chatgpt-web/gpt-6-pro",
  };
  expect(() => piRuntime({ profiles: { default: browser } })).toThrow(
    "profiles.explorer",
  );
  expect(() =>
    piRuntime({
      profiles: {
        default: {
          provider: "openai",
          model: "gpt-6-astra",
          baseUrl: "https://example.invalid/v1?credential=fixture",
        },
      },
    }),
  ).toThrow("baseUrl");
  const apiKeyEnv = "XEAN_TEST_MISSING_PROFILE_CREDENTIAL";
  const previous = process.env[apiKeyEnv];
  try {
    const settings = readSettings({
      profiles: {
        default: { provider: "openai", model: "gpt-6-astra", apiKeyEnv },
      },
    });
    for (const value of [undefined, "", "   "]) {
      if (value === undefined) delete process.env[apiKeyEnv];
      else process.env[apiKeyEnv] = value;
      expect(() => piRuntime(settings, "unrelated-key")).toThrow(apiKeyEnv);
    }
    process.env[apiKeyEnv] = "selected-key";
    expect(
      piRuntime(settings, "unrelated-key").profiles.explorer.options?.apiKey,
    ).toBe("selected-key");
  } finally {
    if (previous === undefined) delete process.env[apiKeyEnv];
    else process.env[apiKeyEnv] = previous;
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
