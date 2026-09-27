import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ROOT_CONVERSATION_ID, type Cursor } from "@earendil-works/pi-durable";
import { Xean, openXeanStorage, type XeanOptions } from "xean";
import { observe } from "xean-observe";
import { serveControl } from "xean-cli/control";
import {
  createSolver,
  codexResearch,
  declarationVersion,
  piRuntime,
  project,
  readSettings,
  decode,
  taskSchema,
  submitCommand,
  type Research,
} from "xean/solve";

/** Correctness checks task-permitted background; unresolved premises stay blocked. */
export const offlineResearch: Research = {
  retrieval: false,
  async source({ notes }) {
    return notes.map(({ id, premises }) => ({
      noteId: id,
      result: premises.length
        ? {
            verdict: "INCONCLUSIVE" as const,
            report:
              "Source retrieval is disabled. These premises remain unresolved under the task's proof rules. Prove them in notes before relying on them.",
          }
        : {
            verdict: "PASS" as const,
            report:
              "Correctness left no unresolved external premise under the task's proof rules.",
          },
    }));
  },
  async literature() {
    throw new Error(
      "Literature retrieval is disabled for this closed-book run",
    );
  },
  async review() {
    throw new Error("Online review is disabled for this closed-book run");
  },
};

/** This experiment counts planning invocations, including interrupted ones. */
export function limitRounds(
  solver: ReturnType<typeof createSolver>,
  directory: string,
  allowance = 20,
) {
  assert.ok(
    Number.isSafeInteger(allowance) && allowance >= 0,
    "Invalid round allowance",
  );
  const plan = solver.functions.coordinator;
  let rounds = 0;
  while (existsSync(resolve(directory, `round-${rounds + 1}.json`))) rounds++;
  assert.ok(rounds <= allowance, "Experiment exceeded its round allowance");
  solver.functions.coordinator = async (...args) => {
    if (rounds === allowance) return { work: [] };
    const marker = {
      round: rounds + 1,
      attemptId: args[1].attemptId,
      startedAt: new Date().toISOString(),
    };
    await writeFile(
      resolve(directory, `round-${rounds + 1}.json`),
      JSON.stringify(marker) + "\n",
      { flag: "wx", flush: true },
    );
    rounds++;
    console.log(JSON.stringify(marker));
    return plan(...args);
  };
  return () => rounds;
}

/** A drained campaign needs a new signal as well as a higher outer allowance. */
export async function resumeExperiment(engine: Xean, allowance: number) {
  if ((await engine.inspect()).status === "blocked") return engine.resume();
  await submitCommand(engine, {
    kind: "guide",
    id: `bounded-continue-${allowance}`,
    text: "Continue the exact task using the recorded mathematical notes and verification feedback.",
  });
  return engine.resume();
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      offline: { type: "boolean", default: false },
      resume: { type: "boolean", default: false },
      "round-limit": { type: "string", default: "20" },
    },
  });
  const offline = values.offline;
  const allowance = Number(values["round-limit"]);
  assert.ok(
    positionals.length === 1,
    "Usage: scripts/bounded-solve.ts RUN_DIRECTORY [--offline] [--round-limit TOTAL] [--resume]",
  );
  const directory = resolve(positionals[0]!);
  const task = decode(
    taskSchema,
    await Bun.file(resolve(directory, "task.json")).json(),
  );
  const settings = readSettings(
    await Bun.file(resolve(directory, "settings.json")).json(),
  );
  if (offline) assert.equal(settings.literature, false);
  const solver = createSolver(
    task,
    () => piRuntime(settings),
    settings,
    offline
      ? offlineResearch
      : (ready) => codexResearch(settings.research, ready.usagePrefix),
  );
  const rounds = limitRounds(solver, directory, allowance);
  const options: XeanOptions = {
    // A separate kind prevents the online CLI from resuming this experiment.
    task: {
      kind: offline ? "xean.solve.offline" : "xean.solve",
      version: declarationVersion,
      task,
      settings,
    },
    roles: solver.roles,
    coordinator: solver.coordinator,
    accept: solver.accept,
    validateInput: solver.validateInput,
    limits: settings.limits,
  };
  const database = resolve(directory, "campaign.sqlite");
  let storage = await openXeanStorage(database);
  let engine = await Xean.open(storage, options);
  const stopObserving = observe(engine, directory);
  let control: Awaited<ReturnType<typeof serveControl>> | undefined;
  let interrupted = false;
  let shutdown: Promise<unknown> | undefined;
  const interrupt = () => {
    interrupted = true;
    shutdown ??= Promise.all([control?.close(true), engine.close()]);
    void shutdown.catch(() => {});
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const heartbeat = setInterval(() => {
    void engine
      .inspect()
      .then((view) =>
        console.log(
          JSON.stringify({
            status: view.status,
            rounds: rounds(),
            calls: view.providerCalls,
            active: view.work
              .filter((work) => work.status === "active")
              .map((work) => ({ id: work.id, role: work.role })),
          }),
        ),
      )
      .catch(() => {});
  }, 30_000);
  const write = (name: string, value: unknown) =>
    Bun.write(resolve(directory, name), JSON.stringify(value, null, 2) + "\n");
  const recordDigest = async (exportRecords = false) => {
    // The campaign is quiescent here. Pi pages newest first; retain only page
    // cursors so export can revisit them in chronological order.
    const page = (cursor?: Cursor) =>
      storage.scanEntries(
        { conversationId: ROOT_CONVERSATION_ID },
        64,
        cursor,
        BACKGROUND_CONTEXT,
      );
    const cursors: (Cursor | undefined)[] = [];
    const hash = createHash("sha256");
    let cursor: Cursor | undefined;
    do {
      if (exportRecords) cursors.push(cursor);
      const records = await page(cursor);
      for (const record of records.items)
        hash.update(JSON.stringify(record) + "\n");
      cursor = records.next;
    } while (cursor);
    if (exportRecords) {
      const output = Bun.file(resolve(directory, "records.json")).writer();
      try {
        output.write("[");
        let separator = "\n";
        for (const cursor of cursors.reverse()) {
          for (const record of (await page(cursor)).items.toReversed()) {
            output.write(
              separator + JSON.stringify(record, null, 2).replace(/^/gm, "  "),
            );
            separator = ",\n";
          }
          await output.flush();
        }
        output.write(separator === "\n" ? "]\n" : "\n]\n");
      } finally {
        await output.end();
      }
    }
    return hash.digest("hex");
  };
  try {
    control = await serveControl(await realpath(database), engine);
    if (values.resume) await resumeExperiment(engine, allowance);
    else await engine.run();
    await control.close();
    if (interrupted) process.exitCode = 130;
    else {
      let campaign = await engine.inspect();
      const roundLimit =
        rounds() === allowance && campaign.status === "running";
      if (roundLimit) {
        await engine.pause();
        campaign = await engine.inspect();
      }
      clearInterval(heartbeat);
      await write("result.json", {
        outcome:
          campaign.status === "completed"
            ? "accepted"
            : roundLimit
              ? "round_limit"
              : campaign.status,
        rounds: rounds(),
        campaign,
        notes: project(campaign),
      });
      const recordsHash = await recordDigest(true);
      await stopObserving();
      await engine.close();
      storage = await openXeanStorage(database);
      engine = await Xean.open(storage, {
        ...options,
        roles: options.roles.map((role) => ({
          ...role,
          run() {
            throw new Error("Unexpected work on reopen");
          },
        })),
        coordinator: {
          ...options.coordinator,
          run() {
            throw new Error("Unexpected planning on reopen");
          },
        },
      });
      assert.deepEqual(await engine.run(), campaign);
      assert.equal(await recordDigest(), recordsHash);
      await write("verified.json", {
        rounds: rounds(),
        calls: campaign.providerCalls,
        unchangedOnReopen: true,
        runtime: Bun.version,
        offline,
      });
      console.log(
        JSON.stringify({
          status: campaign.status,
          roundLimit,
          rounds: rounds(),
          calls: campaign.providerCalls,
        }),
      );
    }
  } finally {
    clearInterval(heartbeat);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    await control?.close(true);
    await shutdown;
    await stopObserving();
    await engine.close();
  }
}
