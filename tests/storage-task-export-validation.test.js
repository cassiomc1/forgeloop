import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import { importProjectState } from "../src/storage/importer.js";
import { exportTask } from "../src/storage/exporter.js";
import { findTaskById } from "../src/storage/repository.js";

function replacePayloadField(db, column, field, value) {
  const row = db.prepare(`SELECT ${column} AS payload FROM tasks WHERE task_id = ?`).get(TEST_TASK_ID);
  const payload = JSON.parse(row.payload);
  assert.ok(payload);
  payload[field] = value;
  db.prepare(`UPDATE tasks SET ${column} = ? WHERE task_id = ?`).run(JSON.stringify(payload), TEST_TASK_ID);
}

const cases = [
  ["descriptor owner", db => replacePayloadField(db, "descriptor_json", "taskId", "foreign-task")],
  ["descriptor task key", db => replacePayloadField(db, "descriptor_json", "taskKey", "f".repeat(64))],
  ["state owner", db => replacePayloadField(db, "state_json", "taskId", "foreign-task")],
  ["indexed phase", db => db.prepare("UPDATE tasks SET phase = 'COMPLETE' WHERE task_id = ?").run(TEST_TASK_ID)],
  ["indexed revision", db => db.prepare("UPDATE tasks SET revision = revision + 1 WHERE task_id = ?").run(TEST_TASK_ID)],
  ["indexed creation time", db => db.prepare("UPDATE tasks SET created_at = 'corrupt' WHERE task_id = ?").run(TEST_TASK_ID)],
];

for (const [name, tamper] of cases) {
  test(`portable task export rejects corrupted ${name}`, async () => {
    const root = await buildDiagnosisProject({ legacy: true });
    const { db } = await importProjectState(root, path.join(root, "test.sqlite"));
    try {
      assert.equal(findTaskById(db, TEST_TASK_ID).taskId, TEST_TASK_ID);
      await exportTask(db, TEST_TASK_ID, path.join(root, "valid"));
      tamper(db);
      assert.throws(() => findTaskById(db, TEST_TASK_ID), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
      await assert.rejects(exportTask(db, TEST_TASK_ID, path.join(root, "invalid")), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
    } finally {
      db.close();
      await removeTempTree(root);
    }
  });
}
