import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { getPackageRoot } from "../src/core/templates.js";
import { canonicalFingerprint } from "../src/core/artifacts.js";
import { resolveStructuralQualityContext } from "../src/core/structural-quality/service.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { getOperationalStore } from "../src/storage/operational-context.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { putArtifact, upsertTask } from "../src/storage/repository.js";
import { runInTransaction } from "../src/storage/transaction.js";

test("structural-quality context observes one committed state/contract pair during independent replacement", async () => {
  const packageRoot = getPackageRoot();
  const target = await buildDiagnosisProject({ packageRoot });
  let changed = false;
  try {
    await withProjectStorage(target, async () => {
      const prototype = Object.getPrototypeOf(getOperationalStore(target));
      const originalRead = prototype.readText;
      const writer = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
      const initial = await resolveStructuralQualityContext({ target, packageRoot, taskId: TEST_TASK_ID, resolveProvider: false });
      assert.equal(initial.state.contractFingerprint, canonicalFingerprint(initial.contract.value));
      prototype.readText = function(relativePath) {
        if (!changed && relativePath.endsWith("/contract.json")) {
          changed = true;
          const row = writer.prepare("SELECT * FROM tasks WHERE task_id=?").get(TEST_TASK_ID);
          const stored = writer.prepare("SELECT payload_json FROM task_artifacts WHERE task_id=? AND kind='contract'").get(TEST_TASK_ID);
          const contract = { ...JSON.parse(stored.payload_json), objective: "new independently committed contract" };
          const previousState = JSON.parse(row.state_json);
          const state = { ...previousState, revision: previousState.revision + 1, contractFingerprint: canonicalFingerprint(contract) };
          runInTransaction(writer, () => {
            putArtifact(writer, { taskId: TEST_TASK_ID, kind: "contract", payload: contract });
            upsertTask(writer, { taskId: TEST_TASK_ID, descriptor: JSON.parse(row.descriptor_json), state });
          });
        }
        return originalRead.call(this, relativePath);
      };
      try {
        const observed = await resolveStructuralQualityContext({ target, packageRoot, taskId: TEST_TASK_ID, resolveProvider: false });
        assert.equal(changed, true);
        assert.equal(observed.state.contractFingerprint, canonicalFingerprint(observed.contract.value));
        assert.equal(observed.contract.value.objective, initial.contract.value.objective);
        assert.equal(observed.state.revision, initial.state.revision);
      } finally { prototype.readText = originalRead; writer.close(); }
    }, { readOnly: true });
    const current = await resolveStructuralQualityContext({ target, packageRoot, taskId: TEST_TASK_ID, resolveProvider: false });
    assert.equal(current.contract.value.objective, "new independently committed contract");
    assert.equal(current.state.contractFingerprint, canonicalFingerprint(current.contract.value));
  } finally { await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
