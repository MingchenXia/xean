import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createSession,
  defineDoc,
  ROOT_CONVERSATION_ID,
  StorageRejected,
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

/** Pi owns transactions; Xean keeps its scheduling cache and wakeup metadata. */
export class Store {
  private readonly session: Session;
  failure: Error | undefined;
  revision: Seq | 0 = 0;

  private constructor(
    readonly storage: Storage,
    private readonly tasks: Map<TaskId, PiTask>,
  ) {
    const commit: Storage["commit"] = async (writes, context) => {
      try {
        const revision = await storage.commit(writes, context);
        // The Session still holds its mutation line until document adoption.
        for (const write of writes)
          if (write.type === "task")
            this.tasks.set(write.value.id, resident(write.value as PiTask));
        return (this.revision = revision);
      } catch (error) {
        if (!(error instanceof StorageRejected))
          this.failure =
            error instanceof Error ? error : new Error(String(error));
        throw error;
      }
    };
    this.session = createSession(
      new Proxy(storage, {
        get(target, key) {
          if (key === "commit") return commit;
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    );
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
    let revision: Seq | 0 | undefined;
    return this.session
      .commit(async (tx) => {
        revision = this.revision;
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
      .catch((error) => {
        // A failed native adoption is as uncertain as a failed Storage reply.
        if (revision !== undefined && this.revision !== revision)
          this.failure =
            error instanceof Error ? error : new Error(String(error));
        throw error;
      });
  }

  entries(): Promise<EntryRecord[]> {
    return this.session.commit((tx) => this.scanEntries(tx), context);
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
