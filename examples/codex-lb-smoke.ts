import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  cleanupSessionResources,
  createModels,
  envApiKeyAuth,
} from "@earendil-works/pi-ai";
import { convertToLlm, runAgentLoop } from "@earendil-works/pi-agent-core";
import { getTelemetryContext } from "@earendil-works/pi-agent-core/harness/context";
import { getOpenAICodexWebSocketDebugStats } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import {
  Xean,
  openXeanStorage,
  type XeanOptions,
} from "../packages/core/src/index.ts";
import { auditedStream } from "../packages/core/src/pi.ts";
import { sumOfSquares } from "./sum-of-squares.ts";

// Run under Fleet's locked Bun. Supply the API key on stdin for live mode;
// configure the lab CA when starting Bun. Resume mode needs no credential.
const [mode, directory, runId] = process.argv.slice(2);
if (
  (mode !== "live" && mode !== "resume") ||
  !directory ||
  !runId ||
  !/^[a-zA-Z0-9_-]{1,60}$/.test(runId)
) {
  throw new Error("Usage: codex-lb-smoke.ts <live|resume> DIRECTORY RUN_ID");
}
const root = resolve(directory);
const path = resolve(root, "campaign.sqlite");
await mkdir(root, { recursive: true });
if (mode === "live" && (await Bun.file(path).exists())) {
  throw new Error("Live smoke requires a fresh database");
}
if (mode === "resume" && !(await Bun.file(path).exists())) {
  throw new Error("Resume smoke requires an existing database");
}
const apiKey = mode === "live" ? (await Bun.stdin.text()).trim() : "";
if (mode === "live" && !apiKey) throw new Error("API key is required on stdin");

const models = createModels();
models.setProvider({
  ...openaiCodexProvider(),
  // The gateway uses an API key; Pi's built-in Codex provider uses OAuth.
  auth: { apiKey: envApiKeyAuth("Codex LB", []) },
});
const base = models.getModel("openai-codex", "gpt-5.6-luna");
if (!base) throw new Error("Pi's pinned catalog is missing the smoke model");
const model = {
  ...base,
  baseUrl: "https://codex-lb.lab/backend-api/codex",
  compat: { ...base.compat, codexProxyAuth: true },
};
const workers: {
  worker: number;
  attemptId: string;
  usageTag: string;
  startedAt: string;
  finishedAt?: string;
  websocket?: ReturnType<typeof getOpenAICodexWebSocketDebugStats>;
}[] = [];
let active = 0;
let peakActive = 0;
const options: XeanOptions = {
  ...sumOfSquares,
  task: { operation: "live sum of squares", values: [3, 4], runId },
  limits:
    mode === "live"
      ? {
          concurrency: 2,
          attempts: 1,
          providerCalls: 4,
          deadline: Date.now() + 45_000,
        }
      : undefined,
  roles: [
    {
      name: "xean.square",
      async run(input, execution, context) {
        assert.equal(mode, "live", "Completed work must not run on reopen");
        assert.equal(typeof input, "number");
        const value = input as number;
        const usageTag = `xean-smoke/${runId}/square-${value}/attempt-1`;
        const worker: (typeof workers)[number] = {
          worker: value,
          attemptId: execution.attemptId,
          usageTag,
          startedAt: new Date().toISOString(),
        };
        workers.push(worker);
        peakActive = Math.max(peakActive, ++active);
        try {
          let turns = 0;
          await runAgentLoop(
            [
              {
                role: "user",
                content: `What is ${value} squared?`,
                timestamp: Date.now(),
              },
            ],
            {
              messages: [
                {
                  role: "system",
                  content:
                    "Return only the requested integer, without explanation.",
                  timestamp: Date.now(),
                },
              ],
              tools: [],
            },
            {
              model,
              convertToLlm,
              apiKey,
              sessionId: execution.attemptId,
              telemetryContext: getTelemetryContext(context),
              reasoning: "max",
              transport: "websocket-cached",
              maxRetries: 0,
              headers: {
                "X-Codex-LB-Usage-Tag": usageTag,
                "X-Codex-LB-Required-Capability": "usage_tag_v1",
              },
              finishTurn({ message }) {
                assert.equal(
                  message.stopReason,
                  "stop",
                  message.errorMessage ?? "Pi call failed",
                );
                assert.equal(message.usageReported, true);
                assert.ok(message.usage.totalTokens > 0);
                const answer = message.content
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("")
                  .trim();
                assert.equal(answer, String(value * value));
                return { action: ++turns === 2 ? "end" : "continue" };
              },
              prepareNextTurn: () => ({
                messages: [
                  {
                    role: "user",
                    content: "Repeat that same integer.",
                    timestamp: Date.now(),
                  },
                ],
              }),
            },
            () => {},
            context.abortSignal,
            auditedStream(models, execution.recorder),
          );
          assert.equal(turns, 2);
          worker.websocket = getOpenAICodexWebSocketDebugStats(
            execution.attemptId,
          );
          assert.equal(worker.websocket?.requests, 2);
          assert.equal(worker.websocket?.connectionsCreated, 1);
          assert.equal(worker.websocket?.connectionsReused, 1);
          assert.equal(worker.websocket?.deltaRequests, 1);
          assert.equal(worker.websocket?.fullContextRequests, 1);
          return value * value;
        } finally {
          worker.finishedAt = new Date().toISOString();
          active--;
          cleanupSessionResources(execution.attemptId);
          assert.equal(
            getOpenAICodexWebSocketDebugStats(execution.attemptId),
            undefined,
          );
        }
      },
    },
  ],
};

const xean = await Xean.open(await openXeanStorage(path), options);
try {
  const before = await xean.inspect();
  const recordsBefore = await xean.records();
  const campaign = await xean.run();
  const records = await xean.records();
  const report = {
    mode,
    runId,
    checkedAt: new Date().toISOString(),
    runtime: Bun.version,
    model: `${model.provider}/${model.id}`,
    workers,
    peakActive,
    campaign,
    records,
  };
  const encoded = JSON.stringify(report, null, 2) + "\n";
  assert.ok(
    !apiKey || !encoded.includes(apiKey),
    "Credential must not be saved",
  );
  await writeFile(resolve(root, `${mode}.json`), encoded);
  assert.equal(
    campaign.status,
    "completed",
    campaign.error ?? "Campaign did not complete",
  );
  assert.equal(campaign.result, 25);
  assert.equal(campaign.providerCalls, 4);
  assert.deepEqual(
    campaign.work.map((work) => work.result).sort(),
    [9, 16].sort(),
  );
  for (const kind of ["started", "request", "settled"]) {
    assert.equal(
      records.filter((record) => record.kind === `xean.call.${kind}`).length,
      4,
    );
  }
  if (mode === "live") {
    assert.equal(workers.length, 2);
    assert.equal(peakActive, 2);
  } else {
    assert.equal(workers.length, 0);
    assert.deepEqual(campaign, before);
    assert.deepEqual(records, recordsBefore);
    const live = await Bun.file(resolve(root, "live.json")).json();
    assert.deepEqual(campaign, live.campaign);
    assert.deepEqual(records, live.records);
  }
  console.log(
    JSON.stringify({
      mode,
      runId,
      status: campaign.status,
      result: campaign.result,
      newCalls: campaign.providerCalls - before.providerCalls,
      peakActive,
    }),
  );
} finally {
  await xean.close();
}
