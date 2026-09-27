import {
  createProvider,
  type AssistantMessageEvent,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { lazyStream } from "@earendil-works/pi-ai/api/lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";

export const claudeCodeProviderId = "claude-code";
const api = "claude-code";

/** Claude Code owns subscription auth; the maintained provider returns Pi tool calls. */
export function claudeCodeProvider() {
  const base = anthropicProvider()
    .getModels()
    .find((model) => model.id === "claude-opus-5-5");
  if (!base) throw new Error("Pinned Pi catalog lacks Claude Opus 5.5");
  const model: Model<typeof api> = {
    ...base,
    provider: claudeCodeProviderId,
    api,
    baseUrl: "claude-code://local",
    compat: undefined,
    // Subscription tokens are measured, but API dollar rates do not describe the bill.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  return createProvider({
    id: claudeCodeProviderId,
    name: "Claude Code subscription",
    models: [model],
    auth: {
      apiKey: {
        name: "Claude Code login",
        resolve: async () => ({ auth: {} }),
      },
    },
    api: { stream, streamSimple: stream },
  });
}

function stream(
  model: Model<string>,
  context: TranscriptContext,
  options: SimpleStreamOptions = {},
) {
  const cwd = process.cwd();
  return lazyStream(model, async () => {
    options.signal?.throwIfAborted();
    if (options.apiKey || options.transport || options.deferred)
      throw new Error(
        "Claude Code uses local subscription auth and print mode",
      );
    const { inspectClaudeInstallation } =
      await import("pi-claude-code-provider/src/auth.ts");
    const { createClaudeStream } =
      await import("pi-claude-code-provider/src/provider.ts");
    const { SessionImageStore } =
      await import("pi-claude-code-provider/src/session-image-store.ts");
    const installation = await inspectClaudeInstallation();
    options.signal?.throwIfAborted();
    const imageStore = new SessionImageStore();
    imageStore.open();
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const source = createClaudeStream(installation, {
      onSettled: settle,
      resolveSession: () => ({
        cwd,
        imageStore,
        onRateLimitNotice: () => {},
        resolution: "registered",
      }),
    })(model, context, { ...options, timeoutMs: 0 });
    return (async function* () {
      let terminal:
        Extract<AssistantMessageEvent, { type: "done" | "error" }> | undefined;
      try {
        for await (const event of source) {
          if (event.type === "done" || event.type === "error") terminal = event;
          else yield event;
        }
      } finally {
        // Upstream may announce cancellation before its process tree has exited.
        await settled;
        try {
          await imageStore.close();
        } catch (error) {
          if (!terminal) throw error;
          const message =
            terminal.type === "done" ? terminal.message : terminal.error;
          message.stopReason = "error";
          message.errorMessage = `Claude image cleanup failed: ${String(error)}`;
          terminal = { type: "error", reason: "error", error: message };
        }
      }
      if (terminal) yield terminal;
    })();
  });
}
