import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { execa } from "execa";
import { campaignVersion, inspectCampaign } from "xean";
import { usageRecord } from "xean-cli/report";
import { readArtifacts } from "./artifacts.ts";
import { snapshot, type Snapshot } from "./snapshot.ts";

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
        if (
          artifacts.value?.schema !== "xean-observe/v2" ||
          typeof artifacts.value.observedAt !== "string" ||
          !artifacts.value.status?.calls ||
          !Array.isArray(artifacts.value.notes) ||
          !Array.isArray(artifacts.value.work)
        )
          throw new Error("Unsupported observation schema");
        run.snapshot = artifacts.value;
      } else if (artifacts.kind === "export") {
        if (artifacts.value.campaign?.version !== campaignVersion)
          throw new Error("Unsupported campaign export");
        run.snapshot = snapshot(artifacts.value, artifacts.at);
      } else run.heartbeat = artifacts.value;
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
        Object.assign(run.process, {
          rounds: latest?.rounds,
          calls: latest?.calls,
          active: latest?.active,
          log,
          errorLog,
        });
      }
    }
  } catch (error) {
    reportError(error);
  }
  return run;
}
