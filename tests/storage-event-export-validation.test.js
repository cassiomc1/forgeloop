import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";

import path from "node:path";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { importProjectState } from "../src/storage/importer.js";
import { exportTask } from "../src/storage/exporter.js";
import { iterateCanonicalEvents } from "../src/storage/repository.js";

test("streamed event export validates indexed authority before emitting corrupted evidence", async () => {
  const root = await buildDiagnosisProject({ legacy: true });
  const { db } = await importProjectState(root, path.join(root, "test.sqlite"));
  try {
    const expected = db.prepare("SELECT event_json FROM events WHERE task_id = ? ORDER BY seq").all(TEST_TASK_ID).map(row => JSON.parse(row.event_json));
    assert.ok(expected.length > 0);
    assert.deepEqual([...iterateCanonicalEvents(db, TEST_TASK_ID)], expected);
    await exportTask(db, TEST_TASK_ID, path.join(root, "valid-export"));
    db.prepare("UPDATE events SET event_type = 'CORRUPT_INDEX' WHERE task_id = ? AND seq = ?").run(TEST_TASK_ID, expected[0].seq);
    assert.throws(() => [...iterateCanonicalEvents(db, TEST_TASK_ID)], { code: "E_STORAGE_PAYLOAD_MISMATCH" });
    await assert.rejects(exportTask(db, TEST_TASK_ID, path.join(root, "invalid-export")), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
  } finally { db.close(); await removeTempTree(root); }
});
