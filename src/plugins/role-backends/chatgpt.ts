import { createHash } from "node:crypto";
import type { Roles } from "../../workflow.ts";
import type { ExternalAnswer, ExternalCall } from "../../roles/backend.ts";
import { decode } from "../../math/contracts.ts";

export type ChatGPTOptions = { baseUrl: string; model: string };

export function chatgptCall(settings: ChatGPTOptions): ExternalCall {
  return async (_mode, schema, instructions, input, runtime, context) => {
    context.abortSignal?.throwIfAborted();
    const identity = createHash("sha256")
      .update(JSON.stringify([settings, schema, instructions, input]))
      .digest("hex");
    if (
      (await runtime.memo("external.worker.backend", identity, context)) !==
      identity
    )
      throw new Error(
        "External backend configuration changed during task recovery",
      );
    const cached = await runtime.memo<ExternalAnswer<typeof schema>>(
      "research.chatgpt.result",
      context,
    );
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
              schema,
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
        {
          value: decode(schema, JSON.parse(text)),
          workspace: "",
          searches: 0,
          operationId: id,
          reportedAt: new Date().toISOString(),
        },
        context,
      ),
    );
  };
}

/** A single browser-backed Explorer call; interrupted admissions are never resent. */
export function chatgpt(settings: ChatGPTOptions) {
  return (builtins: Roles): Partial<Roles> => ({
    external: {
      ...builtins.external,
      explorer: chatgptCall(settings),
      explorerOnce: true,
    },
  });
}
