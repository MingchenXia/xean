import { randomUUID } from "node:crypto";
import {
  createProvider,
  getDeclaredTools,
  resolveTranscript,
  Type,
  type AssistantMessageEvent,
  type Model,
  type SimpleStreamOptions,
  type ToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { lazyStream } from "@earendil-works/pi-ai/api/lazy";
import { Value } from "typebox/value";

export const chatGptWebProviderId = "codex-chatgpt-web";
const api = "chatgpt-web";

/**
 * Map the browser bridge's text-only Chat Completions reply to native Pi tool
 * calls. The bridge does not implement Responses or native tool calls, so the
 * schema and envelope are carried in the prompt and validated here.
 */
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
    if (
      normalized.messages.some(
        (m) =>
          Array.isArray(m.content) && m.content.some((p) => p.type === "image"),
      )
    )
      throw new Error("ChatGPT Web provider currently accepts text only");
    const output = tools.length
      ? Type.Object(
          {
            text: Type.String(),
            calls: Type.Array(
              Type.Union(
                tools.map((tool) =>
                  Type.Object(
                    {
                      name: Type.Literal(tool.name),
                      arguments: tool.parameters,
                    },
                    {
                      additionalProperties: false,
                      description: tool.description,
                    },
                  ),
                ),
              ),
            ),
          },
          { additionalProperties: false },
        )
      : undefined;
    const input: TranscriptContext = {
      ...normalized,
      messages: normalized.messages.map((m) => {
        if (m.role === "system")
          return { ...m, toolsAdded: [], toolsRemoved: [] };
        // The bridge reads only message.content and labels every non-user
        // turn Assistant. Carry calls and results in text before Pi conversion.
        if (m.role === "toolResult")
          return {
            role: "user" as const,
            timestamp: m.timestamp,
            content: `Tool result: ${JSON.stringify({
              id: m.toolCallId,
              name: m.toolName,
              isError: m.isError,
              content: m.content,
            })}`,
          };
        if (m.role === "assistant")
          return {
            ...m,
            content: m.content.map((part) =>
              part.type === "toolCall"
                ? {
                    type: "text" as const,
                    text: `Tool call: ${JSON.stringify({
                      id: part.id,
                      name: part.name,
                      arguments: part.arguments,
                    })}`,
                  }
                : part,
            ),
          };
        return m;
      }),
    };
    if (output)
      input.messages = [
        ...input.messages,
        {
          role: "system",
          timestamp: Date.now(),
          content: `Return exactly one JSON object matching this schema: ${JSON.stringify(output)}. Use calls for the caller-owned tools you need, with optional accompanying text. Use an empty calls array for a final text answer. The caller executes these tools and supplies their results before your next response. Do not substitute ChatGPT-native tools for these functions.`,
        },
      ];
    let servedModel: string | undefined;
    const { streamSimple } =
      await import("@earendil-works/pi-ai/api/openai-completions");
    const source = streamSimple(
      {
        ...model,
        api: "openai-completions",
        compat: {
          maxTokensField: "max_tokens",
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsStore: false,
          supportsUsageInStreaming: false,
          supportsMidConvoSystemMessages: true,
        },
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
          // The browser bridge only accepts ordinary Chat Completions fields.
          // Native tool declarations would be ignored by the bridge and can
          // mislead callers into believing the model produced a native call.
          delete body.tools;
          delete body.tool_choice;
          delete body.stream_options;
          const replacement = await options.onPayload?.(body, model);
          return replacement === undefined ? body : replacement;
        },
        onResponse: (response) => options.onResponse?.(response, model),
        onProviderStreamEvent: async (event) => {
          // Only the bridge's explicit served_model comes from native reply
          // metadata; model may instead be a generic or requested alias.
          const served = (event as { served_model?: unknown })?.served_model;
          if (typeof served === "string" && served && served !== "chatgpt-web")
            servedModel ??= served;
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
      const finalAnswer = completed.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      const message = {
        ...completed,
        api: model.api,
        content: [] as typeof completed.content,
        usageReported: false,
        // Preserve the original reply even when its envelope is malformed or
        // incomplete, without exposing it as executable agent-loop content.
        chatGptWeb: { text: finalAnswer, servedModel: servedModel ?? null },
      };
      try {
        options.signal?.throwIfAborted();
        if (completed.stopReason !== "stop")
          throw new Error(
            completed.errorMessage ??
              `ChatGPT Web stopped with ${completed.stopReason}`,
          );
        if (!finalAnswer)
          throw new Error("ChatGPT Web returned no text answer");
        const selection = output ? JSON.parse(finalAnswer) : undefined;
        if (output && !Value.Check(output, selection))
          throw new Error("ChatGPT Web returned an invalid tool selection");
        const calls: Pick<ToolCall, "name" | "arguments">[] =
          selection?.calls ?? [];
        const text: string = selection?.text ?? finalAnswer;
        if (
          calls.some(
            (call) =>
              call.arguments === null ||
              typeof call.arguments !== "object" ||
              Array.isArray(call.arguments),
          )
        )
          throw new Error("ChatGPT Web tool arguments must be an object");
        if (!calls.length && !text.trim())
          throw new Error("ChatGPT Web returned no text or tool calls");
        // A buffered provider emits one complete result. Pi owns tool execution.
        yield { type: "start", partial: message };
        message.content = [
          ...(text ? [{ type: "text" as const, text }] : []),
          ...calls.map((call) => ({
            type: "toolCall" as const,
            id: `call_${randomUUID()}`,
            name: call.name,
            arguments: call.arguments,
          })),
        ];
        message.stopReason = calls.length ? "toolUse" : "stop";
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
