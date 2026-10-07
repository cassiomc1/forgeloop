import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { assertSafePath, fileExists } from "../core/filesystem.js";
import { LEGACY_TASK_ARTIFACT_PATHS as paths, taskArtifactPath } from "../core/task-paths.js";
import { assertTaskId, taskStorageKey } from "../core/task-identity.js";
import { createTaskDescriptor } from "../core/task-descriptor.js";
import { readPortableJsonArtifact, canonicalFingerprint } from "../core/artifacts.js";
import { validateMigrationSnapshot } from "../core/task-migration-validation.js";
import { readPortableEvents } from "../core/events.js";
import { getPackageRoot } from "../core/templates.js";
import { upsertTask, appendEvent, putArtifact, putExecution } from "./repository.js";

const artifacts = Object.freeze([
  ["contract", "current-contract"], ["route", "routing-result"],
  ["preflight", "preflight"], ["state", "work-state"],
  ["continuity", "continuity"], ["receipt", "execution-receipt"],
]);

/** Read-only singleton conversion input. No temporary writable namespace. */
export async function readSingletonImportSource(target, packageRoot = getPackageRoot()) {
  const payloads = new Map();
  let taskId = null;
  for (const [kind, schema] of artifacts) {
    if (!(await fileExists(await assertSafePath(target, paths[kind])))) continue;
    const { value } = await readPortableJsonArtifact(target, paths[kind], schema, packageRoot);
    if (value.taskId) {
      if (taskId !== null && taskId !== value.taskId) throw Object.assign(new Error("Singleton artifact identities disagree"), { code: "E_TASK_MIGRATION_IDENTITY_MISMATCH" });
      taskId = value.taskId;
    }
    payloads.set(kind, { payload: value, sourceText: await readFile(await assertSafePath(target, paths[kind]), "utf8") });
  }
  assertTaskId(taskId);
  const snapshot = await validateMigrationSnapshot(target, { taskId, packageRoot, paths });
  for (const [kind, value] of payloads) {
    if (createHash("sha256").update(value.sourceText).digest("hex") !== snapshot.artifactFingerprints[kind]
      || canonicalFingerprint(JSON.parse(value.sourceText)) !== canonicalFingerprint(value.payload)) {
      throw Object.assign(new Error("Singleton artifact changed during conversion read"), { code: "E_STORAGE_MIGRATION_SOURCE_CHANGED" });
    }
  }
  const events = await readPortableEvents(target, packageRoot, { eventsPath: paths.events });
  const directories = {};
  for (const [kind, schema] of [["gates", "gate"], ["executions", "execution"]]) {
    directories[kind] = [];
    const directory = await assertSafePath(target, paths[kind]);
    if (!(await fileExists(directory))) continue;
    for (const filename of (await readdir(directory)).sort()) {
      const relative = `${paths[kind]}/${filename}`;
      const { value } = await readPortableJsonArtifact(target, relative, schema, packageRoot);
      const id = filename.slice(0, -5);
      if ((kind === "gates" ? value.gate : value.executionId) !== id) throw Object.assign(new Error(`Singleton directory artifact identity disagrees with filename: ${relative}`), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
      directories[kind].push({ id, payload: value, sourceText: await readFile(await assertSafePath(target, relative), "utf8") });
    }
  }
  const after = await validateMigrationSnapshot(target, { taskId, packageRoot, paths });
  if (canonicalFingerprint(snapshot) !== canonicalFingerprint(after)) throw Object.assign(new Error("Singleton source changed during conversion read"), { code: "E_STORAGE_MIGRATION_SOURCE_CHANGED" });
  return { taskId, taskKey: taskStorageKey(taskId), payloads, events, directories, snapshot };
}

/** Caller must own an unpublished SQLite import transaction. */
export function importSingletonSource(db, source) {
  if (!db.isTransaction) throw Object.assign(new Error("Singleton import requires an enclosing transaction"), { code: "E_STORAGE_TRANSACTION_INVALID" });
  const { taskId, taskKey, payloads, events, directories } = source;
  if (db.prepare("SELECT task_id FROM tasks WHERE task_id = ? OR task_key = ?").get(taskId, taskKey)) throw Object.assign(new Error("Singleton conversion collides with an existing task namespace"), { code: "E_STORAGE_IMPORT_IDENTITY_COLLISION" });
  const createdAt = payloads.get("state")?.payload.createdAt ?? payloads.get("contract")?.payload.createdAt ?? events[0]?.at ?? "1970-01-01T00:00:00.000Z";
  const descriptor = createTaskDescriptor({ taskId, writeClaims: [], createdAt, updatedAt: createdAt });
  upsertTask(db, { taskId, taskKey, descriptor, state: payloads.get("state")?.payload ?? null });
  for (const event of events) appendEvent(db, { taskId, event });
  for (const [kind, value] of payloads) {
    if (kind !== "state") putArtifact(db, { taskId, kind, ...value });
  }
  for (const gate of directories.gates) putArtifact(db, { taskId, kind: "gate", artifactId: gate.id, payload: gate.payload, sourceText: gate.sourceText });
  for (const execution of directories.executions) putExecution(db, { taskId, execution: execution.payload });
  return { taskId, taskKey, events: events.length, stateFingerprint: payloads.has("state") ? canonicalFingerprint(payloads.get("state").payload) : null };
}

/** Exact source-to-portable-export mapping; unrelated roots keep their paths. */
export function singletonExportPath(taskId, relativePath) {
  for (const [kind, sourcePath] of Object.entries(paths)) {
    if (kind === "session") continue;
    if (relativePath === sourcePath) return taskArtifactPath(taskId, kind);
    if (["gates", "executions"].includes(kind) && relativePath.startsWith(`${sourcePath}/`)) return `${taskArtifactPath(taskId, kind)}/${relativePath.slice(sourcePath.length + 1)}`;
  }
  return relativePath;
}
