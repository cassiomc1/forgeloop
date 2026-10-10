import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { removeTempTree } from "./helpers/rm-safe.js";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { importProjectState } from "../src/storage/importer.js";
import { exportTask } from "../src/storage/exporter.js";
import { putAction, putApproval, putExecution, findActionById, findApprovalById, findExecutionById } from "../src/storage/repository.js";

const cases = [
  { kind: "action", put: putAction, find: findActionById, id: "export-action", payload: { actionId: "export-action", state: "PROPOSED", revision: 0 }, sql: "UPDATE actions SET status = 'CORRUPT_INDEX' WHERE task_id = ?" },
  { kind: "approval", put: putApproval, find: findApprovalById, id: "export-approval", payload: { approvalId: "export-approval", decision: "APPROVED" }, sql: "UPDATE approvals SET decision = 'CORRUPT_INDEX' WHERE task_id = ?" },
  { kind: "execution", put: putExecution, find: findExecutionById, id: "export-execution", payload: { executionId: "export-execution", checkId: "export-check", verificationCycle: 1 }, sql: "UPDATE executions SET check_id = 'CORRUPT_INDEX' WHERE task_id = ?" },
];

for (const { kind, put, find, id, payload, sql } of cases) {
  test(`portable ${kind} export rejects an index that disagrees with canonical payload`, async () => {
    const root = await buildDiagnosisProject({ legacy: true });
    const { db } = await importProjectState(root, path.join(root, "test.sqlite"));
    try {
      put(db, { taskId: TEST_TASK_ID, [kind]: { ...payload, taskId: TEST_TASK_ID } });
      assert.deepEqual(find(db, TEST_TASK_ID, id), { ...payload, taskId: TEST_TASK_ID });
      await exportTask(db, TEST_TASK_ID, path.join(root, "valid-export"));
      db.prepare(sql).run(TEST_TASK_ID);
      assert.throws(() => find(db, TEST_TASK_ID, id), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
      await assert.rejects(exportTask(db, TEST_TASK_ID, path.join(root, "invalid-export")), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
    } finally { db.close(); await removeTempTree(root); }
  });
}
