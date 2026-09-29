import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createSession,
  defineDoc,
  ROOT_CONVERSATION_ID,
  type Cursor,
  type DocumentId,
  type EntryId,
  type EntryRecord,
  type Seq,
  type Session,
  type Storage,
  type TaskId,
  type TaskRecord,
  type Tx,
} from "@earendil-works/pi-durable";
import { json } from "./json.ts";
import { campaignVersion } from "./types.ts";
import type {
  CampaignState,
  JsonValue,
  RecordProjection,
  Signal,
  WorkRequest,
} from "./types.ts";

export type AttemptState = {
  phase: "run";
  attempts: number;
  attemptId: string | null;
  error: string | null;
  /** A grant must not turn an earlier admission denial into a blocking failure. */
  callDenied?: boolean;
};
export type Input = WorkRequest | Omit<Signal, "id">;
export type PiTask = TaskRecord<Input, AttemptState, JsonValue>;
export const WORKER = "xean.worker";
export const COORDINATOR = "xean.coordinator";
export const campaignAddress = {
  kind: "xean.campaign",
  scope: { kind: "session" as const },
};
const context = BACKGROUND_CONTEXT;
const campaign = defineDoc({
  kind: campaignAddress.kind,
  scope: "session",
  version: campaignVersion,
  initial(): CampaignState {
    throw new Error("Xean campaign document is missing");
  },
  checkpointWhen: () => true,
});

/** Consumed decisions remain in Pi; scheduling only needs their terminal state. */
function resident(task: PiTask): PiTask {
  if (
    task.kind === COORDINATOR &&
    task.state.status === "terminal" &&
    task.state.outcome.status === "completed"
  )
    return {
      ...task,
      memos: undefined,
      state: {
        ...task.state,
        outcome: { ...task.state.outcome, result: null },
      },
    };
  return task;
}

export interface Transaction {
  state: CampaignState;
  readonly tasks: readonly PiTask[];
  /** Replaces a task using Pi's immutable record copy. */
  writeTask(task: PiTask): void;
  newTask(kind: string, input: Input): Promise<TaskId<JsonValue>>;
  entry(kind: string, data: unknown, taskId?: TaskId): Promise<EntryId>;
  entries(project?: RecordProjection): Promise<EntryRecord[]>;
}

/** Pi publishes adopted commits; Xean retains the scheduling projection. */
export class Store {
  private readonly session: Session;
  failure: Error | undefined;
  revision: Seq | 0 = 0;

  private constructor(
    readonly storage: Storage,
    private readonly tasks: Map<TaskId, PiTask>,
  ) {
    this.session = createSession(storage);
    this.session.subscribeCommits(({ seq, changes }) => {
      for (const change of changes)
        if (change.type === "task")
          this.tasks.set(change.value.id, resident(change.value as PiTask));
      this.revision = seq;
    });
  }

  static async open(storage: Storage, initial?: CampaignState): Promise<Store> {
    if (!(await storage.findDocument(campaignAddress, "current", context))) {
      if (!initial) throw new Error("A new Xean campaign requires a task");
      if (await storage.conversation(ROOT_CONVERSATION_ID, context)) {
        throw new Error("Storage already contains a non-Xean session");
      }
      const documentId = await storage.mintId<DocumentId>();
      await storage.commit(
        [
          { type: "conversation", value: { id: ROOT_CONVERSATION_ID } },
          {
            type: "document.create",
            record: { ...campaignAddress, id: documentId },
            content: {
              kind: "base",
              version: campaignVersion,
              value: initial,
            },
          },
        ],
        context,
      );
    }
    const tasks = new Map<TaskId, PiTask>();
    const store = new Store(storage, tasks);
    const state = await store.session.snapshot(campaign, context);
    if (state?.version !== campaignVersion) {
      throw new Error("Unsupported Xean campaign version");
    }
    let cursor: Cursor | undefined;
    do {
      const page = await storage.scanTasks({}, 256, cursor, context);
      for (const task of page.items) {
        if (task.version !== 1 || ![WORKER, COORDINATOR].includes(task.kind)) {
          throw new Error(`Unsupported Xean task ${task.kind}@${task.version}`);
        }
        tasks.set(task.id, resident(task as PiTask));
      }
      cursor = page.next;
    } while (cursor);
    return store;
  }

  /** Kernel supplies normalized JSON; results must detach draft references. */
  mutate<T>(action: (tx: Transaction) => T | Promise<T>): Promise<T> {
    return this.session
      .commit(async (tx) => {
        return action({
          state: await tx.doc(campaign),
          tasks: [...this.tasks.values()],
          writeTask: (task) => tx.setTask(task),
          newTask: (kind, input) =>
            tx.createTask<Input, AttemptState, JsonValue, object>(
              {
                definition: {
                  name: kind,
                  version: 1,
                  initial: (): AttemptState => ({
                    phase: "run",
                    attempts: 0,
                    attemptId: null,
                    error: null,
                  }),
                },
              },
              json(input),
              { conversationId: ROOT_CONVERSATION_ID },
            ),
          entry: async (kind, data, taskId) => {
            // Pi copies after ID minting; snapshot at Xean's call boundary.
            const entry = await tx.appendEntry(ROOT_CONVERSATION_ID, {
              kind,
              data: json(data) as JsonValue,
              ...(taskId === undefined ? {} : { byTaskId: taskId }),
            });
            return entry.id;
          },
          entries: (project) => this.scanEntries(tx, project),
        });
      }, context)
      .catch(async (error) => {
        // Pi distinguishes rejected callbacks/batches from poisoned sessions.
        // A read-only commit checks that state without touching Storage.
        try {
          await this.session.commit(() => {}, context);
        } catch (failure) {
          const cause =
            failure instanceof Error ? (failure.cause ?? failure) : failure;
          this.failure ??=
            cause instanceof Error ? cause : new Error(String(cause));
        }
        throw error;
      });
  }

  entries(): Promise<EntryRecord[]> {
    return this.mutate((tx) => tx.entries());
  }

  private async scanEntries(
    tx: Tx,
    project: RecordProjection = (entry) => entry,
  ): Promise<EntryRecord[]> {
    const entries: EntryRecord[] = [];
    let cursor: Cursor | undefined;
    do {
      const page = await tx.scanEntries(
        { conversationId: ROOT_CONVERSATION_ID },
        64,
        cursor,
      );
      for (const entry of page.items) {
        const selected = project(entry);
        if (selected !== undefined) entries.push(selected);
      }
      cursor = page.next;
    } while (cursor);
    return entries.reverse();
  }

  async close(): Promise<void> {
    await this.session.close(context);
    this.tasks.clear();
  }
}
