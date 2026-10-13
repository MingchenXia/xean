import type { Context } from "@earendil-works/chord";
import { createHash } from "node:crypto";
import type { Roles } from "../../workflow.ts";
import type { ExternalCall } from "../../roles/backend.ts";
export type ChatGPTOptions = { baseUrl: string; model: string };
import { decode, explorationSchema } from "../../math/contracts.ts";
import type { RoleRuntime } from "../../roles/types.ts";

export async function chatgptCall(
  settings: ChatGPTOptions,
  instructions: string,
  input: unknown,
  runtime: RoleRuntime,
  context: Context,
) {
  context.abortSignal?.throwIfAborted();
  const identity = createHash("sha256")
    .update(JSON.stringify([settings, instructions, input]))
    .digest("hex");
  if (
    (await runtime.memo("research.chatgpt.backend", identity, context)) !==
    identity
  )
    throw new Error(
      "External backend configuration changed during task recovery",
    );
  const cached = await runtime.memo<
    ReturnType<typeof decode<typeof explorationSchema>>
  >("research.chatgpt.result", context);
  if (cached !== undefined) return structuredClone(cached);
  const id = crypto.randomUUID();
  if ((await runtime.memo("research.chatgpt", id, context)) !== id)
    throw new Error(
      "ChatGPT request already admitted; refusing an ambiguous replay",
    );
  const response = await fetch(
    `${settings.baseUrl.replace(/\/$/, "")}/responses`,
    {
      method: "POST",
      signal: context.abortSignal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.model,
        stream: false,
        reasoning: { effort: "max" },
        instructions,
        input: [
          {
            type: "message",
            role: "user",
            content: JSON.stringify(input),
            internal_chat_message_metadata_passthrough: { turn_id: id },
          },
        ],
        client_metadata: {
          "x-codex-turn-metadata": { thread_id: id, turn_id: id },
        },
        text: {
          format: {
            type: "json_schema",
            name: "exploration",
            strict: true,
            schema: explorationSchema,
          },
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`ChatGPT HTTP ${response.status}`);
  const result = await response.json();
  context.abortSignal?.throwIfAborted();
  if (result.status !== "completed") {
    const detail = [result.error?.code, result.error?.message]
      .filter((part) => typeof part === "string" && part)
      .join(": ");
    throw new Error(`ChatGPT ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  const answers = result.output.filter(
    (item: any) =>
      item.type === "message" &&
      item.role === "assistant" &&
      item.phase === "final_answer",
  );
  if (answers.length !== 1)
    throw new Error("ChatGPT returned no unique final answer");
  const text = answers[0].content
    .filter((part: any) => part.type === "output_text")
    .map((part: any) => part.text)
    .join("");
  return structuredClone(
    await runtime.memo(
      "research.chatgpt.result",
      decode(explorationSchema, JSON.parse(text)),
      context,
    ),
  );
}

/** A single browser-backed Explorer call; interrupted admissions are never resent. */
export function chatgpt(settings: ChatGPTOptions) {
  const call: ExternalCall = async (
    _mode,
    schema,
    instructions,
    input,
    runtime,
    context,
  ) => {
    const value = await chatgptCall(
      settings,
      instructions,
      input,
      runtime,
      context,
    );
    return {
      value: decode(schema, value),
      workspace: "",
      searches: 0,
      operationId: (await runtime.memo<string>("research.chatgpt", context))!,
      reportedAt: await runtime.memo(
        "research.chatgpt.reportedAt",
        new Date().toISOString(),
        context,
      ),
    };
  };
  return (builtins: Roles): Partial<Roles> => ({
    external: { ...builtins.external, explorer: call, explorerOnce: true },
  });
}
