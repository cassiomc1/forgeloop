import { canonicalFingerprint } from "../core/artifacts.js";
import { readStorageVersionMarker } from "./storage-marker.js";
import { verifyProjectRestoreJournal } from "./restore-journal.js";
import { withVerifiedProjectStorageBackup } from "./project-backup.js";
import { operationalContext } from "./operational-context.js";

/** Historical roots remain valid only for exact records in the bound snapshot. */
export async function isRetainedRestoreExecution(target, execution, { taskId } = {}) {
  // Replacement journals also audit incoming archives. Those read-only audits
  // must not select their snapshot as the caller's live operational project.
  return operationalContext.run(null, () => verifyRetainedExecution(target, execution, taskId));
}

async function verifyRetainedExecution(target, execution, taskId) {
  const marker = await readStorageVersionMarker(target);
  if (!marker?.operationId) return false;
  let retained;
  try { retained = await verifyProjectRestoreJournal(target, marker.operationId); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  if (!retained.snapshotVerified || !["PUBLISHING", "ACTIVE"].includes(retained.journal.phase)) return false;
  return withVerifiedProjectStorageBackup(retained.snapshot, ({ db }) => {
    const row = db.prepare("SELECT payload_json FROM executions WHERE task_id = ? AND execution_id = ?")
      .get(taskId ?? execution.taskId, execution.executionId);
    return Boolean(row && canonicalFingerprint(JSON.parse(row.payload_json)) === canonicalFingerprint(execution));
  });
}
