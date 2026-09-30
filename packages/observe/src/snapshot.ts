import type { Campaign, Xean } from "xean";
import { isSolverCampaign, project, taskSchema, type Task } from "xean/solve";
import { statusReport } from "xean/report";
import { Type } from "typebox";
import { Value } from "typebox/value";

export function snapshot(
  value: { campaign: Campaign; records?: Awaited<ReturnType<Xean["records"]>> },
  observedAt = new Date().toISOString(),
) {
  const { campaign, records } = value;
  const declaration = campaign.task as { kind?: string; task?: Task } | null;
  const solver = isSolverCampaign(campaign);
  const notes = solver ? project(campaign) : [];
  return {
    schema: "xean-observe/v2" as const,
    observedAt,
    // A generic kernel task may contain an unrelated field named task.
    task:
      solver ||
      declaration?.kind === "xean.role" ||
      declaration?.kind === "xean.review"
        ? (declaration?.task ?? null)
        : null,
    status: statusReport({ campaign, records: records ?? [] }),
    usageAvailable: records !== undefined,
    notes,
    work: campaign.work.map(({ id, role, status, attempts, error }) => ({
      id,
      role,
      status,
      attempts,
      error,
    })),
    result: campaign.result,
  };
}
export type Snapshot = ReturnType<typeof snapshot>;

// Validate fields consumed by the renderer. Proof checks and results stay opaque.
const snapshotSchema = Type.Unsafe<Snapshot>(
  Type.Script(
    { Task: taskSchema },
    `{
    schema: "xean-observe/v2",
    observedAt: string,
    usageAvailable: boolean,
    task: Task | null,
    status: {
      status: string, error: string | null, usageNote: string,
      calls: {
        admitted: number, settled: number, unknownUsage: number, unsettled: number,
        byModel: {
          model: string, api: string, admitted: number, reportedUsage: unknown
        }[]
      }
    },
    notes: {
      id: string, summary: string, detailedSummary: string, text: string,
      support: string[],
      imported: boolean, candidate: boolean, verified: boolean,
      dead: boolean, accepted: boolean
    }[],
    work: { id: string, role: string, status: string, attempts: number, error: string | null }[]
  }` as string,
  ),
);

export function readSnapshot(value: unknown): Snapshot {
  if (!Value.Check(snapshotSchema, value))
    throw new Error("Unsupported observation schema or malformed snapshot");
  return value;
}
