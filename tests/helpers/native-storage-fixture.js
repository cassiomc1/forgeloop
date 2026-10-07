import { createHash } from "node:crypto";
import { canonicalFingerprint } from "../../src/core/artifacts.js";
import { createTaskDescriptor, readTaskDescriptor, writeTaskDescriptor } from "../../src/core/task-descriptor.js";
import path from "node:path";
import { TASK_ARTIFACT_FILES } from "../../src/core/task-paths.js";
import { withProjectStorage } from "../../src/storage/project-boundary.js";
import { getOperationalStore } from "../../src/storage/operational-context.js";
import { appendEvent, findTaskById, putArtifact, runInTransaction, upsertTask } from "../../src/storage/index.js";

async function withFixtureStore(target, callback, options) {
  const selected = getOperationalStore(target);
  return selected ? callback(selected) : withProjectStorage(target, callback, options);
}

export async function readFixtureText(target, filename) {
  const relative = (path.isAbsolute(filename) ? path.relative(target, filename) : filename).replaceAll("\\", "/");
  return withFixtureStore(target, store => store.readText(relative), { readOnly: true });
}

// Independent inspection of deliberately corrupt fixture bytes. This bypasses
// production payload guards only in tests so unchanged-state checks remain valid.
export async function readRawFixtureText(target, filename) {
  const relative = (path.isAbsolute(filename) ? path.relative(target, filename) : filename).replaceAll("\\", "/");
  const parts = relative.replaceAll("\\", "/").split("/");
  const gate = parts.length === 5 && parts[3] === "gates" && parts[4].endsWith(".json");
  if ((parts.length !== 4 && !gate) || parts[0] !== ".forgeloop" || parts[1] !== "task-state") throw new Error("Not a canonical fixture artifact");
  const kind = gate ? "gate" : Object.keys(TASK_ARTIFACT_FILES).find(key => TASK_ARTIFACT_FILES[key] === parts[3]);
  if (!kind) throw new Error("Unknown fixture artifact");
  return withFixtureStore(target, store => {
    const row = store.db.prepare("SELECT task_id, state_json, descriptor_json FROM tasks WHERE task_key = ?").get(parts[2]);
    if (!row) throw new Error("Fixture task does not exist");
    if (kind === "state") return row.state_json;
    if (kind === "descriptor") return row.descriptor_json;
    if (kind === "events") return store.db.prepare("SELECT event_json FROM events WHERE task_id = ? ORDER BY seq").all(row.task_id).map(event => `${event.event_json}\n`).join("");
    return store.db.prepare("SELECT payload_json FROM task_artifacts WHERE task_id = ? AND kind = ? AND artifact_id = ?").get(row.task_id, kind, gate ? parts[4].slice(0, -5) : "current")?.payload_json ?? null;
  }, { readOnly: true });
}

export async function overwriteFixtureDescriptorBytes(target, taskId, text) {
  await withFixtureStore(target, store => {
    const result = store.db.prepare("UPDATE tasks SET descriptor_json = ? WHERE task_id = ?").run(text, taskId);
    if (result.changes !== 1) throw new Error("Fixture task does not exist");
  });
}

export async function overwriteFixtureStateBytes(target, taskId, text) {
  await withFixtureStore(target, store => {
    const result = store.db.prepare("UPDATE tasks SET state_json = ? WHERE task_id = ?").run(text, taskId);
    if (result.changes !== 1) throw new Error("Fixture task does not exist");
  });
}

export async function overwriteFixtureArtifactBytes(target, filename, text) {
  const relative = (path.isAbsolute(filename) ? path.relative(target, filename) : filename).replaceAll("\\", "/");
  const parts = relative.replaceAll("\\", "/").split("/");
  const kind = Object.keys(TASK_ARTIFACT_FILES).find(key => TASK_ARTIFACT_FILES[key] === parts[3]);
  if (parts.length !== 4 || parts[0] !== ".forgeloop" || parts[1] !== "task-state" || !kind || ["state", "descriptor", "events"].includes(kind)) throw new Error("Not a flat fixture artifact");
  await withFixtureStore(target, store => {
    const row = store.db.prepare("SELECT task_id FROM tasks WHERE task_key = ?").get(parts[2]);
    if (!row) throw new Error("Fixture task does not exist");
    const result = store.db.prepare("UPDATE task_artifacts SET payload_json = ? WHERE task_id = ? AND kind = ?").run(text, row.task_id, kind);
    if (result.changes !== 1) throw new Error("Fixture artifact does not exist or is ambiguous");
  });
}

export async function overwriteFixtureLease(target, taskId, value) {
  await withFixtureStore(target, store => {
    if (typeof value !== "string") putArtifact(store.db, { taskId, kind: "operationLease", payload: value });
    else {
      putArtifact(store.db, { taskId, kind: "operationLease", payload: { taskId } });
      store.db.prepare("UPDATE task_artifacts SET payload_json = ? WHERE task_id = ? AND kind = 'operationLease' AND artifact_id = 'current'").run(value, taskId);
    }
  });
}

export async function readRawFixtureLease(target, taskId) {
  return withFixtureStore(target, store => store.db.prepare("SELECT payload_json FROM task_artifacts WHERE task_id = ? AND kind = 'operationLease' AND artifact_id = 'current'").get(taskId)?.payload_json ?? null, { readOnly: true });
}

// Deliberately rewrite disposable test authority, keeping indexed projections
// consistent so domain tampering rules remain the reason for rejection.
export async function overwriteFixtureText(target, filename, text) {
  const relative = (path.isAbsolute(filename) ? path.relative(target, filename) : filename).replaceAll("\\", "/");
  const parts = relative.replaceAll("\\", "/").split("/");
  if (parts.length === 5 && ["actions", "approvals"].includes(parts[3])) return overwriteFixtureRecordBytes(target, filename, text);
  if (parts.length === 5 && parts[3] === "handoffs" && parts[4].endsWith(".json")) {
    return withFixtureStore(target, store => runInTransaction(store.db, () => {
      const row = store.db.prepare("SELECT task_id FROM tasks WHERE task_key = ?").get(parts[2]);
      if (!row) throw new Error("Fixture task does not exist");
      putArtifact(store.db, { taskId: row.task_id, kind: "handoff", artifactId: parts[4].slice(0, -5), payload: JSON.parse(text), sourceText: text });
    }));
  }
  if (parts.length !== 4 || parts[0] !== ".forgeloop" || parts[1] !== "task-state") throw new Error(`Not a canonical fixture artifact: ${relative}`);
  const kind = Object.keys(TASK_ARTIFACT_FILES).find(key => TASK_ARTIFACT_FILES[key] === parts[3]);
  if (!kind) throw new Error(`Unknown fixture artifact: ${relative}`);
  await withFixtureStore(target, store => runInTransaction(store.db, () => {
    const row = store.db.prepare("SELECT task_id FROM tasks WHERE task_key = ?").get(parts[2]);
    if (!row) throw new Error("Fixture task does not exist");
    if (kind === "events") {
      const events = text.split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
      store.db.prepare("DELETE FROM events WHERE task_id = ?").run(row.task_id);
      for (const event of events) appendEvent(store.db, { taskId: row.task_id, event });
    } else {
      const payload = JSON.parse(text);
      if (kind === "state" || kind === "descriptor") {
        upsertTask(store.db, { ...findTaskById(store.db, row.task_id), [kind]: payload });
      } else putArtifact(store.db, { taskId: row.task_id, kind, payload, sourceText: text });
    }
  }));
}


export async function ensureFixtureTask(target, taskId, packageRoot) {
  try { await readTaskDescriptor(target, taskId, packageRoot); }
  catch (error) {
    if (error.code !== "E_TASK_NOT_FOUND") throw error;
    await writeTaskDescriptor(target, createTaskDescriptor({ taskId, writeClaims: [] }), packageRoot);
  }
}

// Test-only removal of disposable audit artifacts; production deletion remains
// restricted to the domain transaction overlay.
export async function deleteFixtureArtifact(target, filename) {
  const relative = (path.isAbsolute(filename) ? path.relative(target, filename) : filename).replaceAll("\\", "/");
  const parts = relative.replaceAll("\\", "/").split("/");
  if (parts.length !== 4 || parts[0] !== ".forgeloop" || parts[1] !== "task-state") throw new Error("Not a canonical fixture artifact");
  const kind = Object.keys(TASK_ARTIFACT_FILES).find(key => TASK_ARTIFACT_FILES[key] === parts[3]);
  if (!kind) throw new Error("Unknown fixture artifact");
  await withFixtureStore(target, store => runInTransaction(store.db, () => {
    const row = store.db.prepare("SELECT task_id FROM tasks WHERE task_key = ?").get(parts[2]);
    if (!row) throw new Error("Fixture task does not exist");
    if (kind === "events") store.db.prepare("DELETE FROM events WHERE task_id = ?").run(row.task_id);
    else if (kind === "state") store.db.prepare("UPDATE tasks SET state_json = NULL, phase = NULL, revision = NULL WHERE task_id = ?").run(row.task_id);
    else if (kind === "descriptor") throw new Error("Fixture descriptor removal is unsupported");
    else store.db.prepare("DELETE FROM task_artifacts WHERE task_id = ? AND kind = ?").run(row.task_id, kind);
  }));
}


// Explicit test corruption supports malformed JSON and preserves path identity.
export async function overwriteFixtureRecordBytes(target, filename, text) {
  const relative = (path.isAbsolute(filename) ? path.relative(target, filename) : filename).replaceAll("\\", "/");
  const parts = relative.replaceAll("\\", "/").split("/");
  if (parts.length !== 5 || parts[0] !== ".forgeloop" || parts[1] !== "task-state" || !["actions", "approvals"].includes(parts[3]) || !parts[4].endsWith(".json")) throw new Error("Not a fixture action/approval record");
  let payload;
  try { payload = JSON.parse(text); } catch { payload = null; }
  const id = parts[4].slice(0, -5);
  await withFixtureStore(target, store => runInTransaction(store.db, () => {
    const row = store.db.prepare("SELECT task_id FROM tasks WHERE task_key = ?").get(parts[2]);
    if (!row) throw new Error("Fixture task does not exist");
    if (parts[3] === "actions") {
      store.db.prepare("INSERT INTO actions(task_id, action_id, idempotency_key, status, revision, payload_json) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(task_id, action_id) DO UPDATE SET idempotency_key=excluded.idempotency_key, status=excluded.status, revision=excluded.revision, payload_json=excluded.payload_json")
        .run(row.task_id, id, payload?.idempotencyKey ?? null, payload?.state ?? payload?.status ?? null, payload?.revision ?? null, text);
    } else {
      store.db.prepare("INSERT INTO approvals(task_id, approval_id, action_id, decision, payload_json) VALUES(?, ?, ?, ?, ?) ON CONFLICT(task_id, approval_id) DO UPDATE SET action_id=excluded.action_id, decision=excluded.decision, payload_json=excluded.payload_json")
        .run(row.task_id, id, payload?.actionId ?? null, payload?.decision ?? null, text);
    }
  }));
}

// Deliberately inject an inconsistent owner binding while retaining byte/fingerprint
// consistency. Production writers must refuse this; downstream rejection tests
// use direct SQL so they still exercise corruption admission, not fixture setup.
export async function overwriteFixtureArtifactPayload(target, { taskId, kind, artifactId = "current" }, payload) {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  await withFixtureStore(target, store => {
    const result = store.db.prepare("UPDATE task_artifacts SET payload_json = ?, fingerprint = ?, source_json = ?, byte_digest = ? WHERE task_id = ? AND kind = ? AND artifact_id = ?")
      .run(JSON.stringify(payload), canonicalFingerprint(payload), text, createHash("sha256").update(text).digest("hex"), taskId, kind, artifactId);
    if (result.changes !== 1) throw new Error("Fixture artifact does not exist");
  });
}
