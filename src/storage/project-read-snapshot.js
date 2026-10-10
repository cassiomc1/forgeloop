import { getOperationalStore } from "./operational-context.js";
import { needsExistingProjectScope, withExistingProjectScope } from "./existing-project-scope.js";

/** Keep committed native projections consistent without holding live locks across I/O. */
export async function withProjectReadSnapshot(target, read) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => withProjectReadSnapshot(target, read), { readOnly: true });
  }
  const store = getOperationalStore(target);
  // Prepared operations must retain their staged records and transaction observations.
  if (!store || store.transaction || store.writes.size || store.events.size || store.attachments.size) return read();
  const { withStorageSnapshot, isOwnedStorageSnapshot } = await import("./snapshot.js");
  // Reuse only a pure reader on an owned immutable copy. Writable ancestors
  // still need detached observation scopes for later conflict checks.
  if (store.captureObservations === false && isOwnedStorageSnapshot(store.db)) return read();
  const { withOperationalReadSnapshot } = await import("./unit-of-work.js");
  return withStorageSnapshot(store.db, db => withOperationalReadSnapshot({ db, target }, read));
}
