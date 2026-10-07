import { loadStorageDriver } from "./runtime.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ownedSnapshots = new WeakSet();
// Copy a committed snapshot in one native backup step. Smaller batches restart
// after writes from other connections and can starve readers under sustained work.
// This is a page-step limit, not an allocation or a JavaScript buffer size.
const SNAPSHOT_BACKUP_BATCH_PAGES = 0x7fffffff;

/** Isolate portable reads from live writers without holding a reader during I/O. */
export async function withStorageSnapshot(db, readSnapshot) {
  const { backup, DatabaseSync } = loadStorageDriver();
  if (db.isTransaction) {
    const error = new Error("Export requires a committed storage snapshot");
    error.code = "E_STORAGE_SNAPSHOT_TRANSACTION";
    throw error;
  }
  // Only live read-only copies created here can be reused; callers cannot opt in.
  if (ownedSnapshots.has(db)) return readSnapshot(db);
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-snapshot-"));
  let snapshot;
  try {
    const filename = path.join(directory, "state.sqlite");
    await backup(db, filename, { rate: SNAPSHOT_BACKUP_BATCH_PAGES });
    snapshot = new DatabaseSync(filename, { readOnly: true, enableForeignKeyConstraints: true });
    ownedSnapshots.add(snapshot);
    return await readSnapshot(snapshot);
  } finally {
    if (snapshot) ownedSnapshots.delete(snapshot);
    try { snapshot?.close(); } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
