import { removeTempTree } from "./helpers/rm-safe.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { ensureFixtureTask, overwriteFixtureRecordBytes } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { proposeAction, readAction, validateActionLedgerConsistency } from "../src/core/actions.js";
import { runActionRecord } from "../src/commands/action-record.js";
import { taskActionPath, taskApprovalPath, taskEvaluationPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

test("action, approval, and evaluation IDs reject traversal", () => {
  assert.throws(() => taskActionPath("task", "../x"));
  assert.throws(() => taskApprovalPath("task", "approval-../x"));
  assert.throws(() => taskEvaluationPath("task", "eval-../../x"));
});

test("forged action identity is rejected by native indexed authority", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-action-security-"));
  try {
    const taskId = "security-task";
    await ensureFixtureTask(target, taskId, packageRoot);
    const { action } = await proposeAction(target, { packageRoot, taskId, input: {
      actionId: "action-safe", effectClass: "REVERSIBLE_WRITE", capability: "filesystem.write",
      target: "file", operation: "write", idempotencyKey: "security:file:v1", requiredForCompletion: false,
      requirement: null, provenance: "HOST_REPORTED",
    } });
    const actionPath = taskActionPath(taskId, action.actionId);
    await overwriteFixtureRecordBytes(target, actionPath, JSON.stringify({ ...action, actionId: "action-forged" }));
    const authority = () => withProjectStorage(target, store => ({
      actions: store.db.prepare("SELECT * FROM actions WHERE task_id = ? ORDER BY action_id").all(taskId),
      events: store.db.prepare("SELECT * FROM events WHERE task_id = ? ORDER BY seq").all(taskId),
    }), { readOnly: true });
    const before = await authority();
    await assert.rejects(validateActionLedgerConsistency(target, { packageRoot, taskId }), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
    assert.deepEqual(await authority(), before);
  } finally { await removeTempTree(target); }
});

test("CALLER_REPORTED cannot manufacture authorization", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-action-security-authz-"));
  try {
    const taskId = "security-task-2";
    await ensureFixtureTask(target, taskId, packageRoot);
    const { action } = await proposeAction(target, { packageRoot, taskId, input: {
      actionId: "action-caller-authz", effectClass: "REVERSIBLE_WRITE", capability: "filesystem.write",
      target: "file", operation: "write", idempotencyKey: "security:authz:v1",
      requiredForCompletion: false, requirement: null, provenance: "CALLER_REPORTED",
    } });
    await assert.rejects(
      runActionRecord({ target, packageRoot, taskId,
        actionId: action.actionId, state: "AUTHORIZED", provenance: "CALLER_REPORTED" }),
      (error) => error.code === "E_ACTION_AUTHORIZATION_INVALID",
    );
    const current = await readAction(target, { packageRoot, taskId, actionId: action.actionId });
    assert.equal(current.state, "PROPOSED");
  } finally { await removeTempTree(target); }
});

test("CALLER_REPORTED cannot manufacture verification", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-action-security-ver-"));
  try {
    const taskId = "security-task-3";
    await ensureFixtureTask(target, taskId, packageRoot);
    const { action } = await proposeAction(target, { packageRoot, taskId, input: {
      actionId: "action-caller-ver", effectClass: "REVERSIBLE_WRITE", capability: "filesystem.write",
      target: "file", operation: "write", idempotencyKey: "security:ver:v1",
      requiredForCompletion: false, requirement: null, provenance: "CALLER_REPORTED",
    } });
    await assert.rejects(
      runActionRecord({ target, packageRoot, taskId,
        actionId: action.actionId, state: "VERIFIED", provenance: "EXTERNAL_OBSERVED",
        evidenceRef: "arbitrary:text" }),
      (error) => error.code === "E_ACTION_VERIFICATION_REQUIRED",
    );
    const current = await readAction(target, { packageRoot, taskId, actionId: action.actionId });
    assert.equal(current.state, "PROPOSED");
  } finally { await removeTempTree(target); }
});
