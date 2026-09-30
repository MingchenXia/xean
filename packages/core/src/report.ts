import type {
  CallIdentity,
  Campaign,
  EntryId,
  JsonValue,
  RecordProjection,
  Xean,
} from "./index.ts";
import { isSolverCampaign, project } from "./solve/notes.ts";

/** Project mathematical notes once for reports built from the same snapshot. */
export function campaignReport(snapshot: {
  campaign: Campaign;
  records?: Awaited<ReturnType<Xean["records"]>>;
}) {
  return {
    ...snapshot,
    ...(isSolverCampaign(snapshot.campaign)
      ? { notes: project(snapshot.campaign) }
      : {}),
  };
}

/** Status needs call metadata, without retaining prompts or response bodies. */
export const usageRecord: RecordProjection = (
  entry,
): ReturnType<RecordProjection> => {
  const data = entry.data as Record<string, JsonValue>;
  if (entry.kind === "xean.call.started")
    return { ...entry, data: { model: data.model! } };
  if (entry.kind === "xean.call.settled")
    return {
      ...entry,
      data: { callId: data.callId!, usage: data.usage ?? null },
    };
  return undefined;
};

function usageGroup({ provider, id, api }: CallIdentity) {
  return {
    provider,
    model: id,
    api,
    admitted: 0,
    settled: 0,
    unknownUsage: 0,
    reportedUsage: Object.create(null) as Record<string, number>,
  };
}
type UsageGroup = ReturnType<typeof usageGroup>;

/** Summarize one coherent kernel snapshot without reconciling provider bills. */
export function statusReport({
  campaign,
  records = [],
  notes = isSolverCampaign(campaign) ? project(campaign) : undefined,
}: ReturnType<typeof campaignReport>) {
  const groups = new Map<string, UsageGroup>();
  const calls = new Map<EntryId, UsageGroup>();
  for (const entry of records) {
    if (entry.kind === "xean.call.started") {
      const { model } = entry.data as unknown as { model: CallIdentity };
      const key = JSON.stringify([model.provider, model.id, model.api]);
      const group = groups.get(key) ?? usageGroup(model);
      groups.set(key, group);
      group.admitted++;
      calls.set(entry.id, group);
    } else if (entry.kind === "xean.call.settled") {
      const { callId, usage } = entry.data as {
        callId: EntryId;
        usage: unknown;
      };
      const group = calls.get(callId);
      if (!group) throw new Error(`Call settlement lacks admission: ${callId}`);
      calls.delete(callId);
      group.settled++;
      const fields =
        usage && typeof usage === "object" && !Array.isArray(usage)
          ? Object.entries(usage).filter(
              (entry): entry is [string, number] =>
                typeof entry[1] === "number" && Number.isFinite(entry[1]),
            )
          : [];
      if (fields.length === 0) group.unknownUsage++;
      for (const [field, value] of fields)
        group.reportedUsage[field] = (group.reportedUsage[field] ?? 0) + value;
    }
  }
  const byModel = [...groups.values()].map((group) => ({
    ...group,
    unsettled: group.admitted - group.settled,
  }));
  const settled = byModel.reduce((total, group) => total + group.settled, 0);
  const work = { queued: 0, active: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const item of campaign.work) work[item.status]++;
  return {
    status: campaign.status,
    error: campaign.error,
    work,
    pendingSignals: campaign.pendingSignals,
    ...(notes
      ? {
          notes: {
            total: notes.length,
            verified: notes.filter((note) => note.verified).length,
            dead: notes.filter((note) => note.dead).length,
            accepted: notes.filter((note) => note.accepted).length,
            candidates: notes.filter((note) => note.candidate).length,
          },
        }
      : {}),
    calls: {
      admitted: campaign.providerCalls,
      allowance: campaign.callAllowance,
      limitReached: campaign.callLimitReached,
      settled,
      unknownUsage: byModel.reduce(
        (total, group) => total + group.unknownUsage,
        0,
      ),
      unsettled: campaign.providerCalls - settled,
      byModel,
    },
    usageNote:
      "Reported native counts may be partial and fields overlap. Codex internal requests and provider bills are not reconciled. Price estimates are omitted.",
  };
}
