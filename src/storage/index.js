/**
 * Public surface of the ForgeLoop SQLite storage package.
 *
 * Consumers import from here so the internal file layout can change without
 * touching call sites. Domain services keep ownership of lifecycle transitions,
 * authority, and evidence validation; this package owns persistence only.
 */

export {
  BUSY_TIMEOUT_MS,
  checkStorageIntegrity,
  openStorageDatabase,
  readStorageMeta,
  STORAGE_ERROR_CODES,
  STORAGE_RELATIVE_PATH,
  assertStorageRuntime,
  translateStorageError,
} from "./connection.js";

export { SCHEMA_MIGRATIONS, SCHEMA_STATEMENTS, STORAGE_FORMAT, STORAGE_SCHEMA_VERSION } from "./schema.js";

export { isInTransaction, runInTransaction } from "./transaction.js";
export { backupStorageDatabase, restoreStorageDatabase } from "./backup.js";
export { backupProjectStorage, verifyProjectStorageBackup, restoreProjectStorageBackup } from "./project-backup.js";
export { restoreProjectStorageToFreshProject, resumeReadyProjectStorageRestore, resumeProjectStorageRestore } from "./project-restore.js";
export { verifyProjectRestoreJournal } from "./restore-journal.js";
export { verifyActiveProjectRestore } from "./restore-terminal.js";
export { registerAttachment, iterateAttachmentReferences } from "./attachment-references.js";
export { publishAttachmentFile, verifyAttachmentFile } from "./attachment-files.js";

export {
  CURRENT_ARTIFACT_ID,
  appendEvent,
  commitTaskMutation,
  countEvents,
  countTasks,
  findActionById,
  findActionByIdempotencyKey,
  findApprovalById,
  findArtifact,
  findExecutionById,
  findOverlappingClaims,
  findSession,
  findTaskById,
  findTaskByKey,
  iterateActions,
  iterateApprovals,
  iterateArtifacts,
  iterateClaims,
  iterateExecutions,
  listActions,
  listApprovals,
  listArtifacts,
  listClaims,
  listEvents,
  listEventsByType,
  listExecutions,
  listSessions,
  listTasks,
  mutateTaskState,
  putAction,
  putApproval,
  putArtifact,
  putExecution,
  putSession,
  readEventTail,
  readLedgerHead,
  releaseClaims,
  reserveClaims,
  upsertTask,
} from "./repository.js";

export { exportTask, exportDatabase } from "./exporter.js";
export { importProjectState } from "./importer.js";
