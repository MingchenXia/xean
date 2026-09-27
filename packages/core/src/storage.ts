import { realpathSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Storage } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import {
  NodeSqliteDatabase,
  openNodeSqliteDatabase,
} from "@earendil-works/pi-durable/storage/sqlite/node";

/** Pi supplies WAL, statements, transactions, and records; Xean owns the campaign. */
export async function openXeanStorage(
  path: string,
  options: Parameters<typeof SqliteStorage.open>[1] = {},
): Promise<Storage> {
  const { readOnly = false } = options;
  if (!path) throw new Error("Xean storage requires a database path.");
  const cleanup = new DisposableStack();
  try {
    if (!readOnly && path !== ":memory:") {
      await mkdir(dirname(path), { recursive: true });
      const file = statSync(path, { throwIfNoEntry: false });
      if (file && file.nlink !== 1)
        throw new Error("Campaign databases must not have hard links");
      path = file
        ? realpathSync(path)
        : join(realpathSync(dirname(path)), basename(path));
      // Never unlink the lock file: ownership follows this inode across opens.
      const owner = cleanup.use(
        new DatabaseSync(`${path}.lock`, { timeout: 0 }),
      );
      owner.exec("BEGIN EXCLUSIVE");
    }
    let database: NodeSqliteDatabase;
    if (readOnly) {
      const native = cleanup.use(new DatabaseSync(path, { readOnly: true }));
      database = new NodeSqliteDatabase(native);
      database.exec("BEGIN");
    } else {
      database = await openNodeSqliteDatabase(path, { busyTimeoutMs: 0 });
      cleanup.defer(database.close.bind(database));
      database.exec("PRAGMA synchronous = FULL");
    }
    // Readers close without a writer checkpoint; owners release their lock last.
    database.close = () => cleanup.dispose();
    return await SqliteStorage.open(database, { readOnly });
  } catch (error) {
    cleanup.dispose();
    throw error;
  }
}
