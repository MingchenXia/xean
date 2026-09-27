import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as yieldToEvents } from "node:timers/promises";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import {
  Xean,
  openXeanStorage,
  type Coordinator,
  type XeanOptions,
} from "../packages/core/src/index.ts";
import { auditedStream } from "../packages/core/src/pi.ts";

const coordinator: Coordinator = {
  name: "fixture",
  run(signal) {
    return signal.kind === "start"
      ? { state: null, dispatch: [{ id: "work", role: "worker", input: null }] }
      : { state: signal.kind };
  },
};
const model: Model<"openai-responses"> = {
  id: "fixture",
  name: "Fixture",
  api: "openai-responses",
  provider: "fixture",
  baseUrl: "https://xean.invalid",
  reasoning: false,
  input: ["text"],
  contextWindow: 100,
  maxTokens: 10,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

test.each(["pending admission", "failed settlement"] as const)(
  "%s cannot publish a worker result",
  async (boundary) => {
    let pending: Promise<void> | undefined;
    const engine = await Xean.open(new MemoryStorage(), {
      task: boundary,
      coordinator,
      roles: [
        {
          name: "worker",
          async run(_input, execution) {
            if (boundary === "failed settlement") {
              const call = await execution.recorder.begin(model);
              const message = Object.assign(fauxAssistantMessage(""), {
                toJSON() {
                  throw new Error("Invalid response");
                },
              });
              await expect(
                Promise.resolve(call.settle(message, null)),
              ).rejects.toThrow("Invalid response");
            } else {
              pending = Promise.resolve(execution.recorder.begin(model)).then(
                (call) =>
                  call.settle(
                    fauxAssistantMessage("", { stopReason: "aborted" }),
                    null,
                  ),
                () => {},
              );
            }
            return "must not publish";
          },
        },
      ],
    });
    try {
      const result = await engine.run();
      await pending;
      expect(result.work[0]).toMatchObject({
        status: "failed",
        result: null,
        error:
          boundary === "failed settlement"
            ? "Invalid response"
            : "Role returned with unsettled provider calls",
      });
      expect(result.state).toBe("failed");
    } finally {
      await pending;
      await engine.close();
    }
  },
);

test("failed parallel calls keep run and close open until cancellation usage settles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-call-cleanup-"));
  const path = join(directory, "campaign.sqlite");
  const ready = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let runFinished = false;
  let closeFinished = false;
  const models: Pick<Models, "streamSimple"> = {
    streamSimple(requestModel, request, options) {
      const output = createAssistantMessageEventStream();
      void (async () => {
        await options!.onPayload!({ input: request.messages }, requestModel);
        const slow = request.messages[0]!.content === "slow";
        const message = fauxAssistantMessage("", {
          stopReason: slow ? "aborted" : "error",
          errorMessage: slow ? "cancelled sibling" : "first call failed",
        });
        if (slow) {
          options!.signal!.addEventListener("abort", () => aborted.resolve(), {
            once: true,
          });
          ready.resolve();
          await aborted.promise;
          await release.promise;
          message.usageReported = true;
          message.usage = { ...message.usage, input: 7, totalTokens: 7 };
        } else await ready.promise;
        output.push({
          type: "error",
          reason: slow ? "aborted" : "error",
          error: message,
        });
        output.end();
      })();
      return output;
    },
  };
  const options: XeanOptions = {
    task: "parallel call cleanup",
    coordinator,
    roles: [
      {
        name: "worker",
        async run(_input, execution, context) {
          const stream = auditedStream(models, execution.recorder);
          await Promise.all(
            ["fast", "slow"].map(async (content) => {
              const message = await stream(
                model,
                {
                  messages: [{ role: "user", content, timestamp: 0 }],
                },
                { signal: context.abortSignal },
              ).result();
              if (message.stopReason === "error")
                throw new Error(message.errorMessage);
            }),
          );
          return "must not publish";
        },
      },
    ],
  };
  let engine: Xean | undefined;
  try {
    engine = await Xean.open(await openXeanStorage(path), options);
    const running = engine.run().then((result) => {
      runFinished = true;
      return result;
    });
    await aborted.promise;
    const closing = engine.close().then(() => {
      closeFinished = true;
    });
    await yieldToEvents();
    await yieldToEvents();
    expect(runFinished).toBe(false);
    expect(closeFinished).toBe(false);
    release.resolve();
    await Promise.all([running, closing]);

    engine = await Xean.open(await openXeanStorage(path), options);
    const records = await engine.records();
    const settlements = records.filter(
      (record) => record.kind === "xean.call.settled",
    );
    expect(settlements).toHaveLength(2);
    expect(settlements.map((record) => record.data)).toContainEqual(
      expect.objectContaining({
        message: expect.objectContaining({ stopReason: "aborted" }),
        usage: expect.objectContaining({ input: 7, totalTokens: 7 }),
      }),
    );
    expect((await engine.inspect()).work[0]!.result).toBeNull();
  } finally {
    release.resolve();
    await engine?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
