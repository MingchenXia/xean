import { expect, test } from "bun:test";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai";
import { awaitWithContext } from "@earendil-works/chord/context";
import { createRuntime } from "../src/config.ts";
import { open } from "../src/host.ts";
import { type Note } from "../src/math/contracts.ts";
import { createRoles } from "../src/roles/index.ts";
import type { ExternalCall } from "../src/roles/backend.ts";
import type { RoleRuntime } from "../src/roles/types.ts";
import { closedBookResearch } from "../src/roles/research.ts";
import { context, noteResult, settings, task } from "./fixture.ts";
import { temporaryDirectory } from "./directory.ts";

const roles = () =>
  createRoles({
    ...settings,
    ...createRuntime(settings, { models: createModels() }),
  });
const runtime = {} as RoleRuntime;
const answer = (value: unknown): ExternalCall =>
  (async () => ({
    value,
    workspace: "/fixture",
    operationId: "op",
    searches: 0,
    reportedAt: "2026-10-13T00:00:00Z",
  })) as ExternalCall;
const note: Note = {
  ...noteResult.notes[0]!,
  id: "seed",
  revision: 0,
  checks: {},
  verified: false,
  dead: false,
  accepted: false,
  retired: false,
};
const input = { task, notes: [note], assignment: "Check reflexivity." };

test("default core has no external backend and registration changes capabilities", async () => {
  const builtins = roles();
  const input = {
    task,
    notes: [],
    failures: [],
    guidance: [],
    explorerUsed: false,
    literatureUsed: false,
  };
  expect(builtins.capabilities(input)).toMatchObject({
    implementation: false,
    externalVerifier: false,
    sourceRetrieval: false,
  });
  await expect(
    builtins.implementation(
      { ...input, assignment: "Compute." },
      runtime,
      context,
    ),
  ).rejects.toThrow("Implementation backend is disabled");
  builtins.external = {
    implementation: answer({ notes: [] }),
    verifier: answer({ results: [] }),
    explorer: answer({ notes: [] }),
    explorerOnce: true,
  };
  expect(builtins.capabilities({ ...input, explorerUsed: true })).toMatchObject(
    {
      implementation: true,
      externalVerifier: true,
      explorer: false,
    },
  );
});

test("core rejects malformed external implementation and unsupported dependency results", async () => {
  const builtins = roles();
  builtins.external.implementation = answer({ notes: "not an array" });
  await expect(
    builtins.implementation(input, runtime, context),
  ).rejects.toThrow();
  builtins.external.implementation = answer({
    notes: [{ ...noteResult.notes[0], support: ["missing"] }],
  });
  await expect(
    builtins.implementation(input, runtime, context),
  ).rejects.toThrow("missing");
});

test("external Explorer gets only the index and cannot edit unseen full text", async () => {
  const builtins = roles();
  builtins.external.explorer = async (...args) => {
    expect(JSON.stringify(args[3])).not.toContain(note.text);
    return answer({
      notes: [],
      edits: [{ id: note.id, revision: 0, text: "Replacement." }],
    })(...args);
  };
  await expect(builtins.explorer(input, runtime, context)).rejects.toThrow(
    "without their full text",
  );
});

test("external verification must return exactly the requested IDs", async () => {
  const builtins = roles();
  builtins.external.verifier = answer({
    results: [
      {
        noteId: "wrong",
        verdict: "PASS",
        report: "Reflexive.",
        statement: "1 = 1.",
        premises: [],
      },
    ],
  });
  await expect(
    builtins.verifier(
      {
        ...input,
        targets: [note.id],
        through: "correctness",
        backend: "external",
      },
      runtime,
      context,
    ),
  ).rejects.toThrow("exactly one result per requested note");
});

test("standalone replacement results receive the same notebook validation", async () => {
  const directory = await temporaryDirectory("external-standalone-");
  const owner = await open(join(directory, "campaign.sqlite"), {
    create: {
      task,
      settings,
      mode: {
        role: "implementation",
        input: { notes: [], assignment: "Compute." },
      },
    },
    models: createModels(),
    roles: () => ({
      implementation: async () => ({
        kind: "notes",
        notes: [{ ...noteResult.notes[0], support: ["missing"] }],
      }),
    }),
  });
  try {
    await owner.root.waitForIdle(context);
    const page = await owner.root.commit(
      (tx) => tx.scanTasks({ kind: "research.worker" }, 10),
      context,
    );
    expect(page.items[0]!.state.outcome?.status).toBe("faulted");
    expect(page.items[0]!.state.outcome?.error?.message).toContain("missing");
  } finally {
    await owner.close();
  }
});

test.each(["explorer", "verifier"] as const)(
  "removing an interrupted %s backend cannot silently resume with the native default",
  async (role) => {
    const directory = await temporaryDirectory("external-mode-recovery-");
    const database = join(directory, "campaign.sqlite");
    let started!: () => void;
    const start = new Promise<void>((resolve) => {
      started = resolve;
    });
    const wait = async (callContext: typeof context): Promise<never> => {
      started();
      return awaitWithContext(new Promise<never>(() => {}), callContext);
    };
    const input =
      role === "explorer"
        ? { notes: [], assignment: "Explore." }
        : {
            notes: [
              {
                ...note,
                checks: {
                  correctness: {
                    verdict: "PASS",
                    report: "Conditional on the premise.",
                    statement: "1 = 1.",
                    premises: ["External theorem."],
                  },
                },
              },
            ],
            targets: [note.id],
            through: "source",
          };
    const owner = await open(database, {
      create: {
        task,
        settings,
        mode: { role, input: JSON.parse(JSON.stringify(input)) },
      },
      models: createModels(),
      roles: () => ({
        external:
          role === "explorer"
            ? {
                explorer: async (...args) => wait(args[5]),
              }
            : {
                research: {
                  ...closedBookResearch,
                  retrieval: true,
                  source: async (_input, _runtime, context) => wait(context),
                },
              },
      }),
    });
    const idle = owner.root.waitForIdle(context).catch(() => {});
    await start;
    await owner.close();
    await idle;
    const reopened = await open(database, { models: createModels() });
    try {
      await reopened.root.waitForIdle(context);
      const tasks = await reopened.root.commit(
        (tx) => tx.scanTasks({ kind: "research.worker" }, 10),
        context,
      );
      expect(tasks.items[0]!.state.outcome?.status).toBe("faulted");
      expect(tasks.items[0]!.state.outcome?.error?.message).toContain(
        "backend registration changed",
      );
    } finally {
      await reopened.close();
    }
  },
);
