import type { TaskId } from "@earendil-works/pi-durable";
import type { Exploration } from "./contracts.ts";

export type ExplorerLimit = "context_capacity" | "response_limit";

/** Read a worker's forced handoff without inspecting its private conversations. */
export function explorerLimit(value: unknown) {
  const result = value as PublishedResult | undefined;
  return result?.kind === "published" ? result.limit : undefined;
}

export type PublishedResult = {
  kind: "published";
  notes: string[];
  edits: string[];
  limit?: ExplorerLimit;
};

/** Published submissions retain references rather than publishing their bodies twice. */
export function publicationResult(
  submissions: readonly Exploration[],
  workerId: TaskId,
  limit?: ExplorerLimit,
): PublishedResult {
  const notes = new Set(
    submissions.flatMap(({ notes }) =>
      notes.map(({ id }) => `${workerId}/${id}`),
    ),
  );
  const edits = new Set(
    submissions.flatMap(({ edits }) =>
      (edits ?? []).map(({ id }) =>
        notes.has(`${workerId}/${id}`) ? `${workerId}/${id}` : id,
      ),
    ),
  );
  return {
    kind: "published",
    notes: [...notes],
    edits: [...edits],
    ...(limit ? { limit } : {}),
  };
}
