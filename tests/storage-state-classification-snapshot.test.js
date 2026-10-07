import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { getPackageRoot } from "../src/core/templates.js";
import { canonicalFingerprint } from "../src/core/artifacts.js";
import { createContinuity } from "../src/core/continuity.js";
import { runStatus } from "../src/commands/status.js";
import { readAndClassifyWorkState } from "../src/core/work-state.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { getOperationalStore } from "../src/storage/operational-context.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { putArtifact, upsertTask } from "../src/storage/repository.js";
import { runInTransaction } from "../src/storage/transaction.js";

for (const [name, observe] of [["direct state classification", readAndClassifyWorkState], ["public status", runStatus]]) {
  test(`${name} retains its original committed pair and the next call sees replacement`, async () => {
    const packageRoot = getPackageRoot();
    const target = await buildDiagnosisProject({ packageRoot });
    let changed = false;
    try {
      await withProjectStorage(target, async () => {
        const prototype = Object.getPrototypeOf(getOperationalStore(target));
        const originalRead = prototype.readText;
        const writer = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
        const initial = await observe({ target, packageRoot, taskId: TEST_TASK_ID, contractFile: taskArtifactPath(TEST_TASK_ID, "contract") });
        assert.equal(initial.contractComparison, "MATCH");
        prototype.readText = function(relativePath) {
          if (!changed && relativePath.endsWith("/contract.json")) {
            changed = true;
            const row = writer.prepare("SELECT * FROM tasks WHERE task_id=?").get(TEST_TASK_ID);
            const stored = writer.prepare("SELECT payload_json FROM task_artifacts WHERE task_id=? AND kind='contract'").get(TEST_TASK_ID);
            const contract = { ...JSON.parse(stored.payload_json), objective: "new independently committed contract" };
            const previousState = JSON.parse(row.state_json);
            const state = { ...previousState, revision: previousState.revision + 1, contractFingerprint: canonicalFingerprint(contract), pendingSteps: [...previousState.pendingSteps, "independent-replacement-marker"] };
            const continuity = createContinuity({ taskId: TEST_TASK_ID, workStateFingerprint: canonicalFingerprint(state), contractFingerprint: state.contractFingerprint, phase: state.phase, repositoryFingerprint: state.repositoryFingerprint, updatedAt: new Date().toISOString(), remainingWork: [], knownIssues: [], changedAreas: [], inspectFirst: [], resumeNote: "independent-continuity-marker" });
            runInTransaction(writer, () => {
              putArtifact(writer, { taskId: TEST_TASK_ID, kind: "contract", payload: contract });
              putArtifact(writer, { taskId: TEST_TASK_ID, kind: "continuity", payload: continuity });
              upsertTask(writer, { taskId: TEST_TASK_ID, descriptor: JSON.parse(row.descriptor_json), state });
            });
          }
          return originalRead.call(this, relativePath);
        };
        try {
          const observed = await observe({ target, packageRoot, taskId: TEST_TASK_ID, contractFile: taskArtifactPath(TEST_TASK_ID, "contract") });
          assert.equal(changed, true);
          assert.equal(observed.contractComparison, "MATCH", observed.error);
          assert.deepEqual(observed.pending, initial.pending);
          if (name === "public status") {
            assert.equal(initial.continuity.present, false);
            assert.equal(observed.continuity.present, false);
          }
        } finally { prototype.readText = originalRead; writer.close(); }
      }, { readOnly: true });
      const current = await observe({ target, packageRoot, taskId: TEST_TASK_ID, contractFile: taskArtifactPath(TEST_TASK_ID, "contract") });
      assert.equal(current.contractComparison, "MATCH");
      assert.equal(current.pending.at(-1), "independent-replacement-marker");
      if (name === "public status") {
        assert.equal(current.continuity.present, true);
        assert.equal(current.continuity.continuity.resumeNote, "independent-continuity-marker");
      }
    } finally { await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  });

}
