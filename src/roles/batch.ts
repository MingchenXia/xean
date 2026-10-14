import { normalizeContext, type Api, type Model } from "@earendil-works/pi-ai";
import { clampMaxTokensToContext } from "@earendil-works/pi-ai/api/simple-options";

/** Select a prefix using the caller's input and complete-output estimates. */
export function selectBatch<T>(
  pending: readonly T[],
  model: Model<Api>,
  inputFor: (group: T[]) => unknown,
  writtenTokens: (item: T) => number,
): T[] {
  let count = 1;
  let output = 0;
  for (let size = 1; size <= pending.length; size++) {
    const group = pending.slice(0, size);
    // Reserve complete writing, JSON framing, and three times as much
    // reasoning. These estimates are scheduling hints, never output caps.
    output += Math.max(512, writtenTokens(group.at(-1)!)) + 128;
    if (output * (model.reasoning ? 4 : 1) > model.maxTokens * 0.8) break;
    const content = JSON.stringify(inputFor(group));
    const room = clampMaxTokensToContext(
      { ...model, contextWindow: model.contextWindow * 0.8 },
      normalizeContext({
        messages: [{ role: "user", content, timestamp: 0 }],
      }),
      model.maxTokens,
    );
    if (room < model.maxTokens) break;
    count = size;
  }
  // An oversized estimate gets one note, subject to Pi's input guard.
  return pending.slice(0, count);
}
