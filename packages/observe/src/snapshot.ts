import type { Campaign, Xean } from "xean";
import { isSolverCampaign, project, type Task } from "xean/solve";
import { statusReport } from "xean/report";

export function snapshot(
  value: { campaign: Campaign; records?: Awaited<ReturnType<Xean["records"]>> },
  observedAt = new Date().toISOString(),
) {
  const { campaign, records } = value;
  const declaration = campaign.task as { kind?: string; task?: Task } | null;
  const notes = isSolverCampaign(campaign) ? project(campaign) : [];
  return {
    schema: "xean-observe/v2" as const,
    observedAt,
    task: declaration?.task ?? null,
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
