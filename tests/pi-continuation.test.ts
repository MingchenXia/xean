import { expect, test } from "bun:test";
import { join } from "node:path";
import { Type } from "typebox";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxToolCall,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import {
  fauxProvider,
  type FauxResponseStep,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
  type Conversation,
  type SubmissionId,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { temporaryDirectory } from "./directory.ts";

const limitResponse = (
  content: readonly AssistantMessage["content"][number][],
  reason = "max_output_tokens",
): AssistantMessage => ({
  ...fauxAssistantMessage([...content], { stopReason: "length" }),
  rawStopReason: `incomplete.${reason}`,
});

async function fixture(steps: FauxResponseStep[]) {
  const directory = await temporaryDirectory("pi-continuation-");
  const path = join(directory, "native.sqlite");
  const provider = fauxProvider({
    provider: "continuation",
    models: [{ id: "fixture", reasoning: true }],
  });
  provider.setResponses(steps);
  const models = createModels();
  models.setProvider(provider.provider);
  const registry = createRegistry();
  let toolCalls = 0;
  const tool = defineTool({
    name: "effect",
    description: "Must not execute from truncated output",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async () => {
      toolCalls++;
      return { output: [{ type: "text" as const, text: "executed" }] };
    },
  });
  registry.install(defineExtension({ name: "fixture.tools", tools: [tool] }));
  const open = async (authenticated = true) => {
    const harness = await Harness.open(
      await openNodeSqliteStorage(path),
      {
        registry,
        models: authenticated ? models : createModels(),
        settings: {
          retry: { enabled: false, maxRetries: 0, baseDelayMs: 60000 },
          compaction: { enabled: false },
        },
      },
      context,
    );
    const root = await harness.root(context, {
      agent: {
        model: { provider: "continuation", modelId: "fixture" },
        tools: [tool],
      },
    });
    return { harness, root };
  };
  return {
    open,
    provider,
    get toolCalls() {
      return toolCalls;
    },
  };
}

async function assistants(root: Conversation) {
  return (await root.context(context)).entries.flatMap((entry) =>
    (entry.model ?? []).filter((message) => message.role === "assistant"),
  );
}

test.each([
  { reason: "max_messages", chunks: 10 },
  { reason: "max_output_tokens", chunks: 1 },
])(
  "native Pi continues limit responses with retry disabled (%j)",
  async ({ reason, chunks }) => {
    const seen: string[] = [];
    const current = await fixture([
      ...Array.from({ length: chunks }, (_, i): FauxResponseStep => (input) => {
        const text = JSON.stringify(input.messages);
        for (const previous of seen) expect(text).toContain(previous);
        expect(text).not.toContain("truncated-effect");
        expect(input.messages.some((m) => m.role === "toolResult")).toBe(false);
        const token = `progress-${i}`;
        const thinking = `reasoning-${i}`;
        seen.push(token, thinking);
        return limitResponse(
          [
            { type: "text", text: token },
            { type: "thinking", thinking },
            fauxToolCall("effect", {}, { id: `truncated-effect-${i}` }),
          ],
          reason,
        );
      }),
      (input) => {
        for (const previous of seen)
          expect(JSON.stringify(input.messages)).toContain(previous);
        return fauxAssistantMessage("Complete answer");
      },
    ]);
    const input = {
      type: "input" as const,
      requestId: "assignment",
      content: "Finish the argument",
    };
    const { harness, root } = await current.open();
    let submissionId: SubmissionId;
    try {
      const submission = await root.submit(input, context);
      submissionId = submission.id;
      expect((await submission.wait(context)).status).toBe("done");
      await root.waitForIdle(context);
      expect(current.provider.state.callCount).toBe(chunks + 1);
      expect(current.toolCalls).toBe(0);
      const raw = await assistants(root);
      expect(raw.filter((m) => m.stopReason === "length")).toHaveLength(chunks);
      expect(
        raw.flatMap((m) => m.content).filter((p) => p.type === "toolCall"),
      ).toHaveLength(chunks);
      const tasks = await root.commit((tx) => tx.scanTasks({}, 100), context);
      expect(tasks.items.length).toBeGreaterThanOrEqual(chunks + 1);
      expect(
        tasks.items.every((task) => task.state.outcome?.status === "completed"),
      ).toBe(true);
    } finally {
      await harness.close(context);
    }
    const reopened = await current.open(false);
    try {
      expect((await reopened.root.submit(input, context)).id).toBe(
        submissionId,
      );
      await reopened.root.waitForIdle(context);
      expect((await assistants(reopened.root)).at(-1)?.content).toEqual([
        { type: "text", text: "Complete answer" },
      ]);
      expect(
        (await reopened.root.context(context)).messages.some(
          (m) => m.role === "toolResult",
        ),
      ).toBe(false);
      expect(current.provider.state.callCount).toBe(chunks + 1);
    } finally {
      await reopened.harness.close(context);
    }
  },
);

test("a completed encrypted reasoning item suffices for native continuation", async () => {
  const signature = JSON.stringify({
    type: "reasoning",
    id: "rs_complete",
    encrypted_content: "fixture-opaque",
    summary: [],
  });
  const current = await fixture([
    limitResponse(
      [{ type: "thinking", thinking: "", thinkingSignature: signature }],
      "max_messages",
    ),
    (input) => {
      expect(
        input.messages.some(
          (m) =>
            m.role === "assistant" &&
            m.content.some(
              (p) => p.type === "thinking" && p.thinkingSignature === signature,
            ),
        ),
      ).toBe(true);
      return fauxAssistantMessage("Finished");
    },
  ]);
  const { harness, root } = await current.open();
  try {
    const submission = await root.submit(
      { type: "input", content: "Continue" },
      context,
    );
    expect((await submission.wait(context)).status).toBe("done");
    expect(current.provider.state.callCount).toBe(2);
  } finally {
    await harness.close(context);
  }
});

test.each([
  { content: [] },
  { content: [{ type: "text" as const, text: " " }] },
  { content: [fauxToolCall("effect", {})] },
])(
  "an output limit with no resumable content fails without spinning (%j)",
  async ({ content }) => {
    const current = await fixture([limitResponse(content)]);
    const { harness, root } = await current.open();
    try {
      const submission = await root.submit(
        { type: "input", content: "Continue" },
        context,
      );
      expect(await submission.wait(context)).toMatchObject({
        status: "unanswered",
        reason: "model_error",
        detail:
          "Model response reached its output limit without resumable text or reasoning",
      });
      expect(current.provider.state.callCount).toBe(1);
      expect(current.toolCalls).toBe(0);
      expect((await assistants(root))[0]?.stopReason).toBe("length");
    } finally {
      await harness.close(context);
    }
  },
);

test("native continuation survives interruption at its atomic handoff", async () => {
  const current = await fixture([
    limitResponse([{ type: "text", text: "Durable partial proof" }]),
  ]);
  const { harness, root } = await current.open();
  const closed = Promise.withResolvers<void>();
  let closing = false;
  harness.subscribeCommits(({ changes }) => {
    if (
      !closing &&
      changes.some(
        (change) =>
          change.type === "entry" &&
          change.value.model?.some(
            (m) => m.role === "assistant" && m.stopReason === "length",
          ),
      )
    ) {
      closing = true;
      void harness.close(context).then(closed.resolve, closed.reject);
    }
  });
  await root.submit(
    { type: "input", requestId: "interrupted", content: "Finish" },
    context,
  );
  await closed.promise;
  current.provider.setResponses([
    (input) => {
      expect(JSON.stringify(input.messages)).toContain("Durable partial proof");
      return fauxAssistantMessage("Recovered answer");
    },
  ]);
  const reopened = await current.open();
  try {
    const submission = await reopened.root.submit(
      { type: "input", requestId: "interrupted", content: "Finish" },
      context,
    );
    expect((await submission.wait(context)).status).toBe("done");
    expect(
      (await assistants(reopened.root)).filter(
        (m) => m.stopReason === "length",
      ),
    ).toHaveLength(1);
    expect(current.provider.state.callCount).toBe(2);
  } finally {
    await reopened.harness.close(context);
  }
});

test("continuation retains steering and defers follow-up until the complete answer", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const current = await fixture([
    async () => {
      started.resolve();
      await release.promise;
      return limitResponse([{ type: "text", text: "Partial" }]);
    },
    (input) => {
      const text = JSON.stringify(input.messages);
      expect(text).toContain("Steering input");
      expect(text).not.toContain("Follow-up input");
      return fauxAssistantMessage("Original answer");
    },
    (input) => {
      expect(JSON.stringify(input.messages)).toContain("Follow-up input");
      return fauxAssistantMessage("Follow-up answer");
    },
  ]);
  const { harness, root } = await current.open();
  try {
    const first = await root.submit(
      { type: "input", content: "Original input" },
      context,
    );
    await started.promise;
    const steer = await root.submit(
      { type: "input", content: "Steering input", whenBusy: "steer" },
      context,
    );
    const follow = await root.submit(
      { type: "input", content: "Follow-up input", whenBusy: "followUp" },
      context,
    );
    release.resolve();
    const a = await first.wait(context),
      b = await steer.wait(context),
      c = await follow.wait(context);
    expect(a.status).toBe("done");
    expect(b.answer).toBe(a.answer);
    expect(c.status).toBe("done");
    expect(c.answer).not.toBe(a.answer);
  } finally {
    release.resolve();
    await harness.close(context);
  }
});

test("a queued reset ends the incomplete submission and starts fresh context", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const current = await fixture([
    async () => {
      started.resolve();
      await release.promise;
      return limitResponse([
        { type: "text", text: "Discarded partial context" },
      ]);
    },
    (input) => {
      const text = JSON.stringify(input.messages);
      expect(text).toContain("Reset instructions");
      expect(text).toContain("New input");
      expect(text).not.toContain("Discarded partial context");
      expect(text).not.toContain("Old input");
      return fauxAssistantMessage("New answer");
    },
  ]);
  const { harness, root } = await current.open();
  try {
    const original = await root.submit(
      { type: "input", content: "Old input" },
      context,
    );
    await started.promise;
    await root.reset("Reset instructions", context);
    const next = await root.submit(
      { type: "input", content: "New input", whenBusy: "followUp" },
      context,
    );
    release.resolve();
    expect(await original.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "reset",
    });
    expect((await next.wait(context)).status).toBe("done");
    expect(current.provider.state.callCount).toBe(2);
  } finally {
    release.resolve();
    await harness.close(context);
  }
});

test.each(["cancel", "terminal_error"])(
  "a native continuation respects %s",
  async (mode) => {
    const started = Promise.withResolvers<void>();
    const current = await fixture([
      limitResponse([{ type: "text", text: "Retained progress" }]),
      async (_input, options) => {
        started.resolve();
        if (mode === "cancel")
          await new Promise<void>((resolve) => {
            if (options?.signal?.aborted) resolve();
            else
              options?.signal?.addEventListener("abort", () => resolve(), {
                once: true,
              });
          });
        return fauxAssistantMessage([], {
          stopReason: mode === "cancel" ? "aborted" : "error",
          errorMessage: "authentication_error: fixture",
        });
      },
    ]);
    const { harness, root } = await current.open();
    try {
      const submission = await root.submit(
        { type: "input", content: "Continue" },
        context,
      );
      await started.promise;
      if (mode === "cancel") await root.abort(context);
      expect(await submission.wait(context)).toMatchObject({
        status: "unanswered",
        reason: mode === "cancel" ? "aborted" : "model_error",
      });
      expect(current.provider.state.callCount).toBe(2);
      expect(
        (await assistants(root)).some((m) =>
          m.content.some(
            (p) => p.type === "text" && p.text === "Retained progress",
          ),
        ),
      ).toBe(true);
    } finally {
      await harness.close(context);
    }
  },
);
