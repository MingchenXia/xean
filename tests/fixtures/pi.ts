import {
  lazyStream,
  type AssistantMessage,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";
import {
  profileNames,
  type PiRuntime,
} from "../../packages/core/src/solve/pi.ts";

export const model: Model<"openai-codex-responses"> = {
  id: "xean-fixture",
  name: "Xean fixture",
  api: "openai-codex-responses",
  provider: "xean-fixture",
  baseUrl: "https://xean.invalid/backend-api",
  reasoning: true,
  input: ["text"],
  contextWindow: 20_000,
  maxTokens: 1000,
  cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
  compat: { codexProxyAuth: true },
};

/** Script role replies while Pi owns the stream and its error handling. */
export function fixtureRuntime(
  respond: (
    input: Parameters<Models["streamSimple"]>[1],
    options: Parameters<Models["streamSimple"]>[2],
    selected: Parameters<Models["streamSimple"]>[0],
  ) => AssistantMessage,
): PiRuntime {
  return {
    profiles: Object.fromEntries(
      profileNames.map((name) => [name, { model: { ...model, id: name } }]),
    ) as PiRuntime["profiles"],
    models: {
      streamSimple(selected, input, options) {
        async function* events() {
          await options!.onPayload!(input, selected);
          const message = respond(input, options, selected);
          yield { type: "start" as const, partial: message };
          for (const [contentIndex, block] of message.content.entries())
            if (block.type === "thinking" && block.thinkingSignature)
              yield {
                type: "thinking_end" as const,
                contentIndex,
                content: block.thinking,
                partial: message,
              };
          yield {
            type: "done" as const,
            reason: message.stopReason as "toolUse",
            message,
          };
        }
        return lazyStream(selected, async () => events());
      },
    } as Models,
  };
}
