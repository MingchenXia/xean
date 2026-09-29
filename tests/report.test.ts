import { expect, spyOn, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  MemoryStorage,
  ROOT_CONVERSATION_ID,
  type EntryId,
} from "@earendil-works/pi-durable";
import { Xean, type JsonValue } from "xean";
import { declarationVersion } from "xean/solve";
import { statusReport, usageRecord } from "xean/report";

test("status retains native usage, explicit zeros, unknown usage, and unsettled calls", async () => {
  const storage = new MemoryStorage();
  const engine = await Xean.open(storage, {
    task: { kind: "xean.solve", version: declarationVersion },
    roles: [],
    coordinator: { name: "fixture", run: () => ({ state: null }) },
  });
  try {
    await engine.input({
      kind: "submit",
      id: "example",
      notes: [
        {
          id: "n1",
          text: "A proof",
          summary: "A claim",
          detailedSummary: "A claim with a proof",
          support: [],
        },
      ],
      candidate: true,
    });
    const snapshot = await engine.inspectWithRecords();
    let id = 100;
    const entry = (kind: string, data: JsonValue) => {
      const record = {
        id: id++ as EntryId,
        conversationId: ROOT_CONVERSATION_ID,
        kind,
        data,
      };
      snapshot.records.push(record);
      return record.id;
    };
    const pi = { provider: "fixture", id: "model", api: "openai-responses" };
    const calls = (
      [
        [
          pi,
          {
            input: 100,
            output: 20,
            cacheRead: 30,
            reasoning: 10,
            totalTokens: 150,
            cost: { total: 99 },
          },
        ],
        [
          pi,
          { input: 0, output: 0, cacheRead: 0, reasoning: 0, totalTokens: 0 },
        ],
        [pi, null],
        [pi, undefined],
        [
          { provider: "codex-cli", id: "model", api: "codex-exec" },
          { input_tokens: 200, cached_input_tokens: 50, output_tokens: 40 },
        ],
      ] as const
    ).map(([model, usage]) => ({
      callId: entry("xean.call.started", { model }),
      usage,
    }));
    const body = "Large transcript body ".repeat(4096);
    entry("xean.call.request", { payload: body });
    for (const { callId, usage } of calls)
      if (usage !== undefined)
        entry("xean.call.settled", { callId, message: body, usage });
    snapshot.campaign.providerCalls = calls.length;
    const report = statusReport(snapshot);
    for (const kind of ["xean.solve.offline", "xean.solve.library"])
      expect(
        statusReport({
          ...snapshot,
          campaign: {
            ...snapshot.campaign,
            task: { kind, version: declarationVersion },
          },
        }),
      ).toEqual(report);
    expect(report).toMatchObject({
      status: "running",
      pendingSignals: 2,
      work: { queued: 0, active: 0, completed: 0, failed: 0, cancelled: 0 },
      notes: { total: 1, verified: 1, dead: 0, accepted: 0, candidates: 1 },
      calls: { admitted: 5, settled: 4, unknownUsage: 1, unsettled: 1 },
    });
    expect(report.calls.byModel).toEqual([
      {
        provider: "fixture",
        model: "model",
        api: "openai-responses",
        admitted: 4,
        settled: 3,
        unknownUsage: 1,
        unsettled: 1,
        reportedUsage: {
          input: 100,
          output: 20,
          cacheRead: 30,
          reasoning: 10,
          totalTokens: 150,
        },
      },
      {
        provider: "codex-cli",
        model: "model",
        api: "codex-exec",
        admitted: 1,
        settled: 1,
        unknownUsage: 0,
        unsettled: 0,
        reportedUsage: {
          input_tokens: 200,
          cached_input_tokens: 50,
          output_tokens: 40,
        },
      },
    ]);
    await storage.commit(
      snapshot.records.map((value) => ({ type: "entry", value })),
      BACKGROUND_CONTEXT,
    );
    const scanEntries = storage.scanEntries.bind(storage);
    let projected = 0;
    const scanning = spyOn(storage, "scanEntries").mockImplementation(
      (query, _limit, cursor, context) => {
        // Project each page before requesting another.
        if (cursor) expect(projected).toBeGreaterThan(0);
        return scanEntries(query, 2, cursor, context);
      },
    );
    try {
      const selected = await engine.inspectWithRecords((entry) => {
        projected++;
        return usageRecord(entry);
      });
      selected.campaign.providerCalls = calls.length;
      expect(statusReport(selected)).toEqual(report);
      expect(selected.records).toHaveLength(calls.length + 4);
      expect(JSON.stringify(selected.records)).not.toContain(body);
    } finally {
      scanning.mockRestore();
    }
    expect(await engine.records()).toEqual(snapshot.records);
  } finally {
    await engine.close();
  }
});
