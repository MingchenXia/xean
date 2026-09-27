import type { CampaignView, Work } from "./types.ts";

/** Mutable fields are frozen here; immutable input/results stay in Pi tasks. */
export type ViewReference = Omit<CampaignView, "task" | "work" | "inputs"> & {
  work: Pick<Work, "taskId" | "status" | "attempts" | "attemptId" | "error">[];
  /** Last visible receipt ID, or zero; input receipts are append-only. */
  inputs: CampaignView["inputs"][number]["id"] | 0;
};

export function reference(view: CampaignView): ViewReference {
  const { task: _task, work, inputs, ...frozen } = view;
  return {
    ...frozen,
    inputs: inputs.at(-1)?.id ?? 0,
    work: work.map(({ taskId, status, attempts, attemptId, error }) => ({
      taskId,
      status,
      attempts,
      attemptId,
      error,
    })),
  };
}

export function materialize(
  snapshot: ViewReference,
  current: Pick<CampaignView, "task" | "work" | "inputs">,
): CampaignView {
  const workers = new Map(current.work.map((work) => [work.taskId, work]));
  return {
    ...snapshot,
    task: current.task,
    inputs: current.inputs.filter(({ id }) => id <= snapshot.inputs),
    work: snapshot.work.map((saved) => {
      const work = workers.get(saved.taskId);
      if (!work) throw new Error(`Snapshot task is missing: ${saved.taskId}`);
      return {
        ...work,
        ...saved,
        result: saved.status === "completed" ? work.result : null,
        publicationId: saved.status === "completed" ? work.publicationId : null,
      };
    }),
  };
}
