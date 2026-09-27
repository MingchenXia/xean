import { createHash, randomUUID } from "node:crypto";
import {
  createProvider,
  getDeclaredTools,
  normalizeContext,
  resolveTranscript,
  type AssistantMessageEvent,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { lazyStream } from "@earendil-works/pi-ai/api/lazy";
import { Value } from "typebox/value";

export const chatGptWebProviderId = "codex-chatgpt-web";
const api = "chatgpt-web";

/** Plain text or one typed output function, using a browser-only Responses bridge. */
export function chatGptWebProvider(baseUrl = "http://127.0.0.1:17841/v1") {
  const model: Model<typeof api> = {
    id: "chatgpt-web/gpt-6-pro",
    name: "ChatGPT Web GPT-6 Astra Pro",
    api,
    provider: chatGptWebProviderId,
    baseUrl,
    reasoning: true,
    thinkingLevelMap: { max: "max" },
    input: ["text"],
    // Conservative input window below the bridge's 104k browser-message ceiling.
    contextWindow: 100_000,
    maxTokens: 8_192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  return createProvider({
    id: chatGptWebProviderId,
    name: "ChatGPT Web",
    auth: {
      apiKey: { name: "Browser session", resolve: async () => ({ auth: {} }) },
    },
    models: [model],
    api: { stream, streamSimple: stream },
  });
}

function stream(
  model: Model<string>,
  context: TranscriptContext,
  options: SimpleStreamOptions = {},
) {
  return lazyStream(model, async () => {
    options.signal?.throwIfAborted();
    if (options.reasoning !== undefined && options.reasoning !== "max")
      throw new Error("ChatGPT Web Pro requires max reasoning");
    if (options.deferred || (options.transport && options.transport !== "sse"))
      throw new Error("ChatGPT Web supports synchronous SSE requests");
    const normalized = resolveTranscript(context, false);
    const tools =
      options.toolChoice === "none"
        ? []
        : getDeclaredTools(normalized.messages);
    if (tools.length > 1)
      throw new Error(
        "ChatGPT Web supports one object-shaped output function per request",
      );
    if (
      normalized.messages.some(
        (m) =>
          Array.isArray(m.content) && m.content.some((p) => p.type === "image"),
      )
    )
      throw new Error("ChatGPT Web provider currently accepts text only");
    const tool = tools[0];
    const input = normalizeContext({
      messages: normalized.messages.map((m) =>
        m.role === "system" ? { ...m, toolsAdded: [], toolsRemoved: [] } : m,
      ),
    });
    if (tool)
      input.messages = [
        ...input.messages,
        {
          role: "system",
          timestamp: Date.now(),
          content: `Express the result for the caller's output function ${JSON.stringify(tool.name)} as one JSON object containing its arguments. The supplied output schema defines those arguments. The caller processes the result after this response. Do not attempt to call a ChatGPT-native tool for this function.\n${tool.description}`,
        },
      ];
    const threadId = createHash("sha256")
      .update(options.sessionId ?? randomUUID())
      .digest("hex");
    const turnId = randomUUID();
    let finalAnswers: string[] | undefined;
    const { streamSimple } =
      await import("@earendil-works/pi-ai/api/openai-responses");
    const source = streamSimple(
      {
        ...model,
        api: "openai-responses",
        compat: { supportsMaxOutputTokens: false },
      },
      input,
      {
        ...options,
        apiKey: options.apiKey ?? "local-browser-bridge",
        reasoning: "max",
        transport: "sse",
        cacheRetention: "none",
        // An interrupted browser request may already have been submitted. Never replay it here.
        maxRetries: 0,
        onPayload: async (payload) => {
          const body = payload as Record<string, any>;
          body.client_metadata = {
            "x-codex-turn-metadata": JSON.stringify({
              thread_id: threadId,
              turn_id: turnId,
            }),
          };
          const user = body.input.findLast((item: any) => item.role === "user");
          if (!user) throw new Error("ChatGPT Web requires a user message");
          Object.assign(user, {
            type: "message",
            id: `msg_${randomUUID()}`,
            internal_chat_message_metadata_passthrough: { turn_id: turnId },
          });
          if (tool)
            body.text = {
              format: {
                type: "json_schema",
                name: tool.name,
                strict: true,
                schema: tool.parameters,
              },
            };
          const replacement = await options.onPayload?.(body, model);
          return replacement === undefined ? body : replacement;
        },
        onResponse: (response) => options.onResponse?.(response, model),
        onProviderStreamEvent: async (event) => {
          const raw = event as Record<string, any>;
          if (raw.type === "response.completed")
            finalAnswers = raw.response.output
              .filter(
                (item: any) =>
                  item.type === "message" &&
                  item.role === "assistant" &&
                  item.phase === "final_answer",
              )
              .map((item: any) =>
                item.content
                  .filter((p: any) => p.type === "output_text")
                  .map((p: any) => p.text)
                  .join(""),
              );
          await options.onProviderStreamEvent?.(event, model);
        },
      },
    );
    return (async function* (): AsyncGenerator<AssistantMessageEvent> {
      // Drain Pi's stream as it arrives without retaining its redundant commentary/deltas.
      for await (const _event of source) {
        /* Final native content is authoritative. */
      }
      const completed = await source.result();
      const message = {
        ...completed,
        api: model.api,
        content: [] as typeof completed.content,
        usageReported: false,
      };
      try {
        options.signal?.throwIfAborted();
        if (completed.stopReason !== "stop")
          throw new Error(
            completed.errorMessage ??
              `ChatGPT Web stopped with ${completed.stopReason}`,
          );
        if (finalAnswers?.length !== 1 || !finalAnswers[0])
          throw new Error("ChatGPT Web returned no unique final answer");
        const text = finalAnswers[0];
        const args = tool ? JSON.parse(text) : undefined;
        if (
          tool &&
          (args === null ||
            typeof args !== "object" ||
            Array.isArray(args) ||
            !Value.Check(tool.parameters, args))
        )
          throw new Error(
            `ChatGPT Web returned invalid arguments for ${tool.name}`,
          );
        // A buffered provider emits one complete result. Pi owns tool execution.
        yield { type: "start", partial: message };
        message.content = [
          tool
            ? {
                type: "toolCall",
                id: `call_${randomUUID()}`,
                name: tool.name,
                arguments: args,
              }
            : { type: "text", text },
        ];
        message.stopReason = tool ? "toolUse" : "stop";
        yield { type: "done", reason: message.stopReason, message };
      } catch (error) {
        message.stopReason = options.signal?.aborted ? "aborted" : "error";
        message.errorMessage =
          error instanceof Error ? error.message : String(error);
        yield {
          type: "error",
          reason: message.stopReason,
          error: message,
        };
      }
    })();
  });
}
