import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  link,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  ROOT_CONVERSATION_ID,
  type DocumentId,
  type TaskId,
  type TaskRecord,
} from "@earendil-works/pi-durable";
import { openXeanStorage } from "../packages/core/src/storage.ts";
import { NodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node";

test("Pi adapter normalizes Bun rows, rejects asynchronous transactions, and finalizes statements", () => {
  const native = new Database(":memory:", { strict: true });
  const database = new NodeSqliteDatabase({
    exec: (sql) => native.exec(sql),
    prepare: (sql) => native.prepare(sql),
    close: () => native.close(true),
  });
  database.exec("CREATE TABLE test(value INTEGER)");
  const rows = database.prepare("SELECT value FROM test");
  try {
    expect(rows.get()).toBeUndefined();
    expect(() =>
      database.transaction(() => {
        database.prepare("INSERT INTO test VALUES (?)").run(1);
        return Promise.resolve();
      }),
    ).toThrow("must be synchronous");
    expect(rows.all()).toEqual([]);
    database.transaction(() =>
      database.prepare("INSERT INTO test VALUES (?)").run(2),
    );
    expect(rows.get()).toEqual({ value: 2 });
  } finally {
    database.close();
  }
  expect(() => rows.get()).toThrow("closed");
});

test("SQLite ownership and reader snapshots survive aliases and native cleanup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-readers-"));
  const path = join(directory, "campaign.sqlite");
  const storage = await openXeanStorage(path);
  let snapshot = await openXeanStorage(path, { readOnly: true });
  const readers: Database[] = [];
  const read = () => {
    const database = new Database(path, { readonly: true, strict: true });
    readers.push(database);
    return database;
  };
  const count = (database: Database) =>
    database
      .query<{ count: number }, []>(
        "SELECT count(*) AS count FROM conversations",
      )
      .get()!.count;
  try {
    const first = read();
    first.exec("BEGIN");
    expect(count(first)).toBe(0);
    await storage.commit(
      [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
      context,
    );
    expect(
      await snapshot.conversation(ROOT_CONVERSATION_ID, context),
    ).toBeUndefined();
    await expect(snapshot.commit([], context)).rejects.toThrow("read-only");
    await expect(snapshot.mintId()).rejects.toThrow("read-only");
    expect(count(first)).toBe(0);
    const second = read();
    expect(count(second)).toBe(1);
    first.exec("COMMIT");
    expect(count(first)).toBe(1);
    expect(() => second.exec("DELETE FROM conversations")).toThrow("readonly");
    await expect(openXeanStorage(path)).rejects.toThrow("locked");
    const alias = join(directory, "alias.sqlite");
    await symlink(path, alias);
    await expect(openXeanStorage(alias)).rejects.toThrow("locked");
    const dangling = join(directory, "dangling.sqlite");
    await symlink(join(directory, "missing.sqlite"), dangling);
    await expect(
      openXeanStorage(dangling).then((unexpected) => unexpected.close(context)),
    ).rejects.toThrow("symlink");
    expect(count(second)).toBe(1);
    await storage.close(context);
    expect(count(second)).toBe(1);
    const reopened = await openXeanStorage(path);
    await reopened.close(context);
    expect(count(second)).toBe(1);
    // Creating and removing hard links to an open database invalidates its
    // vnode on macOS. Test rejection on a separate file.
    const hardlink = join(directory, "hardlink.sqlite");
    await writeFile(hardlink, "");
    await link(hardlink, join(directory, "hardlink-alias.sqlite"));
    await expect(openXeanStorage(hardlink)).rejects.toThrow("hard links");
    await snapshot.close(context);
    for (const reader of readers.splice(0)) reader.close(true);
    Bun.gc(true);
    const bytes = await readFile(path);
    snapshot = await openXeanStorage(path, { readOnly: true });
    expect(await snapshot.conversation(ROOT_CONVERSATION_ID, context)).toEqual({
      id: ROOT_CONVERSATION_ID,
    });
    expect(await snapshot.task(999999 as TaskId, context)).toBeUndefined();
    await snapshot.close(context);
    expect(await readFile(path)).toEqual(bytes);
  } finally {
    await snapshot.close(context);
    for (const reader of readers) reader.close(true);
    await storage.close(context);
    await rm(directory, { recursive: true, force: true });
  }
});

test("Pi rolls back a task and document batch when its final SQLite write fails", async () => {
  const storage = await openXeanStorage(":memory:");
  const task = {
    id: await storage.mintId<TaskId<JsonValue>>(),
    conversationId: ROOT_CONVERSATION_ID,
    kind: "xean.worker",
    version: 1,
    input: null,
    after: [],
    background: false,
    abortRequested: false,
    state: { status: "pending", checkpoint: null },
  } satisfies TaskRecord<JsonValue, JsonValue, JsonValue>;
  const documentId = await storage.mintId<DocumentId>();
  try {
    await storage.commit(
      [
        { type: "conversation", value: { id: ROOT_CONVERSATION_ID } },
        { type: "task", value: task },
        {
          type: "document.create",
          record: {
            id: documentId,
            kind: "xean.note",
            scope: { kind: "session" },
          },
          content: { kind: "base", version: 1, value: { text: "original" } },
        },
      ],
      context,
    );
    await expect(
      storage.commit(
        [
          {
            type: "task",
            value: {
              ...task,
              state: {
                status: "terminal",
                outcome: { status: "completed", result: "new result" },
              },
            },
          },
          {
            type: "document.change",
            id: documentId,
            // SQLite rejects NaN as a NOT NULL revision version after the
            // task update and replacement document deletion have executed.
            content: {
              kind: "base",
              version: Number.NaN,
              value: { text: "uncommitted" },
            },
          },
        ],
        context,
      ),
    ).rejects.toThrow("NOT NULL");
    expect((await storage.task(task.id, context))?.state).toEqual(task.state);
    expect(
      (await storage.document(documentId, "current", context))?.value,
    ).toEqual({
      text: "original",
    });
  } finally {
    await storage.close(context);
  }
});
