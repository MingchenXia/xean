import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { execa } from "execa";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { campaignVersion, inspectCampaign } from "xean";
import { decode, taskSchema } from "xean/solve";
import { usageRecord } from "xean/report";
import { readArtifacts } from "./artifacts.ts";
import { readSnapshot, snapshot, type Snapshot } from "./snapshot.ts";

const processHeartbeat = Type.Script(
  { Count: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) },
  "{ calls: Count, rounds?: Count, active?: { id: string, role: string }[] }",
);

export type Source = {
  id: string;
  directory: string;
  host?: string;
  runtime?: string;
  job?: string;
};
export type Run = {
  id: string;
  source: string;
  kind?: "database" | "snapshot" | "export" | "heartbeat";
  observedAt: string;
  snapshot?: Snapshot;
  heartbeat?: {
    task: { problem: string; completionCriteria: string };
    rounds: number;
    lastRound?: unknown;
  };
  process?: {
    status: string;
    observedAt: string;
    rounds?: number;
    calls?: number;
    active?: { id: string; role: string }[];
    log: string;
    errorLog: string;
  };
  error?: string;
};

export async function readRun(source: Source, fleet: string): Promise<Run> {
  const run: Run = {
    id: source.id,
    source: `${source.host ? `${source.host}:` : ""}${source.directory}`,
    observedAt: new Date().toISOString(),
  };
  const reportError = (error: unknown) => {
    run.error = [run.error, String(error)].filter(Boolean).join("\n");
  };
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
      const artifacts = source.host
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
                  input: `${await Bun.file(new URL("./artifacts.ts", import.meta.url)).text()}\nawait Bun.write(Bun.stdout, JSON.stringify(await readArtifacts(${JSON.stringify(source.directory)})));`,
                },
              )
            ).stdout,
          ) as Awaited<ReturnType<typeof readArtifacts>>)
        : await readArtifacts(source.directory);
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
    reportError(error);
  }
  try {
    if (source.job) {
      const nomad = (args: string[]) =>
        execa(resolve(fleet, "bin/fleet-nomad"), args, {
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
        run.process = {
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
              "solver",
            ]);
          } catch (error) {
            reportError(error);
            return "";
          }
        };
        const [log, errorLog] = await Promise.all([
          readLog(false),
          readLog(true),
        ]);
        const heartbeats = log.split("\n").flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });
        const latest = heartbeats.findLast(
          (row) => typeof row?.calls === "number",
        );
        Object.assign(run.process, { log, errorLog });
        if (latest) {
          if (!Value.Check(processHeartbeat, latest))
            throw new Error("Malformed process heartbeat");
          Object.assign(run.process, {
            rounds: latest.rounds,
            calls: latest.calls,
            active: latest.active,
          });
        }
      }
    }
  } catch (error) {
    reportError(error);
  }
  return run;
}
