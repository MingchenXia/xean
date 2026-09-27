import { isJsonValue } from "@earendil-works/chord";

/** Use Chord's strict JSON contract at Xean's durable boundary. */
export function json<T>(input: T): T {
  if (!isJsonValue(input))
    throw new TypeError("Xean state must be finite, plain JSON");
  // Match the representation Pi persists, including normalization of -0.
  return JSON.parse(JSON.stringify(input)) as T;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
