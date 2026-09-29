import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Campaign, Xean } from "xean";
import { isSolverCampaign, project, type Task } from "xean/solve";
import { statusReport, usageRecord } from "xean-cli/report";

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

/** Publish disposable snapshots for observers that read exported artifacts. */
export function observe(
  engine: Xean,
  directory: string,
  onError: (error: unknown) => void = console.error,
) {
  let pending: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  const publish = async () => {
    const value = snapshot(await engine.inspectWithRecords(usageRecord));
    const file = join(directory, "observation.json");
    await writeFile(`${file}.tmp`, JSON.stringify(value) + "\n", {
      mode: 0o600,
    });
    await rename(`${file}.tmp`, file);
  };
  const tick = () => {
    if (pending) return;
    pending = publish()
      .catch(onError)
      .finally(() => {
        pending = undefined;
      });
  };
  tick();
  const timer = setInterval(tick, 10_000);
  return () =>
    (stopping ??= (async () => {
      clearInterval(timer);
      await pending;
      await publish().catch(onError);
    })());
}
