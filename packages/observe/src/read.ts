import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { execa } from "execa";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { campaignVersion, inspectCampaign } from "xean";
import { decode, taskSchema } from "xean/solve";
import { usageRecord } from "xean/report";
import { readEvidence, readReview } from "./artifacts.ts";
import { readSnapshot, snapshot, type Snapshot } from "./snapshot.ts";

// Only disposable observation subprocesses have this refresh timeout.
export const observationInterval = 10_000;
const observationProcess = {
  timeout: observationInterval,
  forceKillAfterDelay: 1_000,
};

const reviewReceipt = Type.Script(
  {
    Text: Type.String({ pattern: "\\S" }),
    DateTime: Type.String({ format: "date-time" }),
  },
  "{ reviewer: Text, reviewedAt: DateTime, verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE', report: Text }",
);

export type Source = {
  id: string;
  directory: string;
  host?: string;
  runtime?: string;
  job?: string;
  task?: string;
  review?: string;
};
export type Run = {
  id: string;
  source: string;
  kind?: "database" | "snapshot" | "export" | "heartbeat";
  observedAt: string;
  /** Campaign evidence retained from a previous successful read. */
  stale?: boolean;
  snapshot?: Snapshot;
  heartbeat?: {
    task: { problem: string; completionCriteria: string };
    rounds: number;
    lastRound?: unknown;
  };
  process?: {
    /** A sampled pool allocation, not ownership of this campaign. */
    job: string;
    task: string;
    allocation: string;
    status: string;
    observedAt: string;
    log: string;
    errorLog: string;
  };
  review?: {
    state: "missing" | "reviewed" | "unavailable";
    receipt?: Static<typeof reviewReceipt>;
    error?: string;
  };
  error?: string;
};

function recordError(target: Pick<Run, "error">, error: unknown) {
  target.error = [target.error, String(error)].filter(Boolean).join("\n");
}

export async function readRun(
  source: Source,
  fleet: string,
  processObservation?: ReturnType<typeof readProcess>,
  signal?: AbortSignal,
): Promise<Run> {
  processObservation ??= source.job
    ? readProcess(source, fleet, signal)
    : undefined;
  const run: Run = {
    id: source.id,
    source: `${source.host ? `${source.host}:` : ""}${source.directory}`,
    observedAt: new Date().toISOString(),
  };
  let review: Awaited<ReturnType<typeof readReview>>;
  try {
    const db = source.host
      ? undefined
      : await realpath(resolve(source.directory, "campaign.sqlite")).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
            return undefined;
          },
        );
    if (db) {
      run.kind = "database";
      run.snapshot = snapshot(await inspectCampaign(db, usageRecord));
    } else {
      const evidence = source.host
        ? (JSON.parse(
            (
              await execa(
                "ssh",
                [
                  "-oBatchMode=yes",
                  "-oConnectTimeout=10",
                  source.host,
                  source.runtime!,
                  "--no-install",
                  "--no-env-file",
                  "run",
                  "-",
                ],
                {
                  ...observationProcess,
                  cancelSignal: signal,
                  input: `${await Bun.file(new URL("./artifacts.ts", import.meta.url)).text()}\nawait Bun.write(Bun.stdout, JSON.stringify(await readEvidence(${JSON.stringify(source.directory)}, ${JSON.stringify(source.review)})));`,
                },
              )
            ).stdout,
          ) as Awaited<ReturnType<typeof readEvidence>>)
        : await readEvidence(source.directory);
      review = evidence.review;
      if ("error" in evidence) throw new Error(evidence.error);
      const { artifacts } = evidence;
      run.kind = artifacts.kind;
      if (artifacts.kind === "snapshot") {
        run.snapshot = readSnapshot(artifacts.value);
      } else if (artifacts.kind === "export") {
        if (artifacts.value.campaign?.version !== campaignVersion)
          throw new Error("Unsupported campaign export");
        run.snapshot = readSnapshot(snapshot(artifacts.value, artifacts.at));
      } else
        run.heartbeat = {
          ...artifacts.value,
          task: decode(taskSchema, artifacts.value.task),
        };
      run.observedAt = artifacts.at;
    }
  } catch (error) {
    recordError(run, error);
  }
  if (!source.host) review = await readReview(source.directory, source.review);
  if (source.review !== undefined) {
    if (review?.state !== "reviewed") {
      run.review = review ?? { state: "unavailable", error: run.error };
    } else if (Value.Check(reviewReceipt, review.receipt)) {
      const { reviewer, reviewedAt, verdict, report } = review.receipt;
      run.review = {
        state: "reviewed",
        receipt: { reviewer, reviewedAt, verdict, report },
      };
    } else {
      run.review = {
        state: "unavailable",
        error: "Malformed external review receipt",
      };
    }
  }
  if (processObservation) {
    const observation = await processObservation;
    run.process = observation.process;
    if (observation.error) recordError(run, observation.error);
  }
  return run;
}

/** One allocation/log read, reusable by runs in the same worker pool. */
export async function readProcess(
  source: Pick<Source, "job" | "task">,
  fleet: string,
  signal?: AbortSignal,
): Promise<Pick<Run, "process" | "error">> {
  const observation: Pick<Run, "process" | "error"> = {};
  try {
    if (source.job) {
      const nomad = (args: string[]) =>
        execa(resolve(fleet, "bin/fleet-nomad"), args, {
          ...observationProcess,
          cancelSignal: signal,
          stdin: "ignore",
          stripFinalNewline: false,
        }).then(({ stdout }) => stdout);
      const allocations = JSON.parse(
        await nomad(["job", "allocs", "-json", source.job]),
      ) as { ID: string; CreateIndex: number; ClientStatus: string }[];
      const allocation = allocations.sort(
        (a, b) => b.CreateIndex - a.CreateIndex,
      )[0];
      if (allocation) {
        observation.process = {
          job: source.job,
          task: source.task ?? "solver",
          allocation: allocation.ID,
          status: allocation.ClientStatus,
          observedAt: new Date().toISOString(),
          log: "",
          errorLog: "",
        };
        const readLog = async (stderr: boolean) => {
          try {
            return await nomad([
              "alloc",
              "logs",
              ...(stderr ? ["-stderr"] : []),
              "-tail",
              "-n",
              stderr ? "10" : "20",
              allocation.ID,
              source.task ?? "solver",
            ]);
          } catch (error) {
            recordError(observation, error);
            return "";
          }
        };
        const [log, errorLog] = await Promise.all([
          readLog(false),
          readLog(true),
        ]);
        Object.assign(observation.process, { log, errorLog });
      }
    }
  } catch (error) {
    recordError(observation, error);
  }
  return observation;
}
