import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";

import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { runPreflight } from "../src/commands/preflight.js";
import { prepareCompletion } from "../src/core/completion-artifacts.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { createWorkState, readWorkState, writeWorkState } from "../src/core/work-state.js";
import { currentRepositoryFingerprint } from "../src/core/repository.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();
const STALE_HEAD = "d6b8991dd0da318543a17d0d1c537687567992d1";
const CHECK_ID = "closure-evidence";
const REQUIREMENT = "the deterministic closure evidence command passes";
const COMMAND_ARGV = [process.execPath, "-e", "process.exit(0)"];

function snapshot(db) {
  return db.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map(({ name }) => ({
    name,
    rows: db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
      .map(row => JSON.stringify(row)).sort(),
  }));
}

function eventRows(db, taskId) {
  return db.prepare(
    "SELECT seq, event_type, event_json FROM events WHERE task_id = ? ORDER BY seq",
  ).all(taskId).map(row => ({ ...row, event: JSON.parse(row.event_json) }));
}

function installEventFault(db, name, eventType, message) {
  db.exec(`CREATE TRIGGER "${name}" AFTER INSERT ON events
    WHEN NEW.event_type = '${eventType}'
    BEGIN SELECT RAISE(ABORT, '${message}'); END`);
}

function operationCommitCount(rows) {
  return rows.filter(row => row.event_type === "TRANSACTION_COMMITTED"
    && row.event.details?.operation === "reconcile-closure").length;
}

async function setupStaleVerifyingTask(target, taskId) {
  await writeTaskDescriptor(target, createTaskDescriptor({
    taskId,
    writeClaims: ["src"],
  }), packageRoot);
  const contract = createContract({
    taskId,
    objective: "Exercise public reconcile-closure atomicity",
    deliverables: ["src"],
    constraints: [],
    risks: [],
    verification: [{ id: CHECK_ID, text: REQUIREMENT, type: "VERIFICATION" }],
    successCriteria: ["the closure remains bound to the current repository"],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  await writeContract(target, contract, packageRoot, { taskId });
  const route = evaluateRoute({ workType: "documentation", surfaces: ["documentation"], platforms: [] });
  const persistedRoute = await persistRoute(target, route, packageRoot, {
    contractFingerprint: contractHash,
    taskId,
  });
  await writeWorkState(target, createWorkState({
    taskId,
    contractFingerprint: contractHash,
    routeFingerprint: persistedRoute.fingerprint,
    repositoryFingerprint: await currentRepositoryFingerprint(target),
    phase: "VERIFYING",
    previousPhase: "EXECUTING",
    selectedGuides: route.guides,
    requiredGates: [],
    satisfiedGates: [],
    requiredArtifacts: [],
    completedSteps: ["implementation"],
    pendingSteps: ["verification"],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
  }), { packageRoot, taskId });
  await appendProtocolEvent(target, { taskId, event: "TASK_RECEIVED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId });
  const preflight = await runPreflight({ target, packageRoot, taskId });
  assert.equal(preflight.status, "READY");
  await appendProtocolEvent(target, { taskId, event: "PLAN_RECORDED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "EXECUTION_STARTED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, {
    taskId,
    event: "VERIFICATION_STARTED",
    details: { verificationCycle: 1 },
  }, packageRoot, { taskId });
  await prepareCompletion({ target, packageRoot, taskId });
  const currentState = await readWorkState(target, { packageRoot, taskId });
  await writeWorkState(target, {
    ...currentState,
    repositoryFingerprint: { branch: "main", head: STALE_HEAD },
  }, { packageRoot, taskId });
}

async function makeFixture(taskId) {
  const target = await createGitRepository(`forgeloop-public-closure-${taskId}-`);
  try {
    await setupStaleVerifyingTask(target, taskId);
    const db = new DatabaseSync(path.join(target, ".forgeloop", "state.sqlite"));
    return { target, db, taskId };
  } catch (error) {
    await removeTempTree(target);
    throw error;
  }
}

function invoke(target, taskId) {
  return executeForgeLoopCommand({
    command: "reconcile-closure",
    projectPath: target,
    input: {
      taskId,
      checkId: CHECK_ID,
      checkRequirement: REQUIREMENT,
      commandArgv: COMMAND_ARGV,
    },
  });
}

async function closeFixture(fixture) {
  fixture.db.close();
  await removeTempTree(fixture.target);
}

test("public reconcile-closure rolls back the full native snapshot on RECONCILE_CLOSURE fault", async () => {
  const fixture = await makeFixture("reconcile-event-fault");
  try {
    const before = snapshot(fixture.db);
    const beforeEvents = eventRows(fixture.db, fixture.taskId);
    const beforeExecutions = fixture.db.prepare("SELECT COUNT(*) AS count FROM executions WHERE task_id = ?")
      .get(fixture.taskId).count;
    const beforeCommits = operationCommitCount(beforeEvents);
    installEventFault(fixture.db, "reconcile_closure_fault", "CHECKPOINT_RECONCILED", "RECONCILE_CLOSURE_FAULT");
    try {
      const failed = await invoke(fixture.target, fixture.taskId);
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.match(JSON.stringify(failed.error), /RECONCILE_CLOSURE_FAULT/);
      assert.deepEqual(snapshot(fixture.db), before, "RECONCILE_CLOSURE fault changed native rows");
      assert.equal(fixture.db.isTransaction, false);
    } finally {
      fixture.db.exec("DROP TRIGGER reconcile_closure_fault");
    }

    const retried = await invoke(fixture.target, fixture.taskId);
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.result.reconciled, true);
    const afterEvents = eventRows(fixture.db, fixture.taskId);
    assert.equal(afterEvents.filter(row => row.event_type === "CHECKPOINT_RECONCILED").length,
      beforeEvents.filter(row => row.event_type === "CHECKPOINT_RECONCILED").length + 1);
    assert.equal(operationCommitCount(afterEvents), beforeCommits + 1);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM executions WHERE task_id = ?")
      .get(fixture.taskId).count, beforeExecutions + 1);
    const reconciliation = afterEvents.find(row => row.event_type === "CHECKPOINT_RECONCILED");
    assert.equal(reconciliation.event.details.executionId, retried.result.executionId);
    const state = await readWorkState(fixture.target, { packageRoot, taskId: fixture.taskId });
    assert.deepEqual(state.repositoryFingerprint, retried.result.repositoryFingerprint);
    assert.equal(fixture.db.isTransaction, false);
  } finally {
    await closeFixture(fixture);
  }
});

test("public reconcile-closure rolls back the full native snapshot on receipt staging fault", async () => {
  const fixture = await makeFixture("reconcile-receipt-fault");
  const { withOperationalStore } = await import("../src/storage/unit-of-work.js");
  try {
    const before = snapshot(fixture.db);
    const beforeEvents = eventRows(fixture.db, fixture.taskId);
    const beforeExecutions = fixture.db.prepare("SELECT COUNT(*) AS count FROM executions WHERE task_id = ?")
      .get(fixture.taskId).count;
    const beforeCommits = operationCommitCount(beforeEvents);
    await withOperationalStore({ db: fixture.db, target: fixture.target }, async source => {
      const prototype = Object.getPrototypeOf(source);
      const originalStageText = prototype.stageText;
      let reached = false;
      prototype.stageText = function stageTextWithReceiptFault(relativePath, text) {
        if (relativePath === taskArtifactPath(fixture.taskId, "receipt")) {
          reached = true;
          throw new Error("RECEIPT_STAGE_FAULT");
        }
        return originalStageText.call(this, relativePath, text);
      };
      try {
        const failed = await invoke(fixture.target, fixture.taskId);
        assert.equal(failed.ok, false, JSON.stringify(failed));
        assert.match(JSON.stringify(failed.error), /RECEIPT_STAGE_FAULT/);
        assert.equal(reached, true, "receipt staging fault was not reached");
        assert.deepEqual(snapshot(fixture.db), before, "receipt staging fault changed native rows");
        assert.equal(fixture.db.isTransaction, false);
      } finally {
        prototype.stageText = originalStageText;
      }
    });

    const retried = await invoke(fixture.target, fixture.taskId);
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.result.reconciled, true);
    const afterEvents = eventRows(fixture.db, fixture.taskId);
    assert.equal(afterEvents.filter(row => row.event_type === "CHECKPOINT_RECONCILED").length,
      beforeEvents.filter(row => row.event_type === "CHECKPOINT_RECONCILED").length + 1);
    assert.equal(operationCommitCount(afterEvents), beforeCommits + 1);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM executions WHERE task_id = ?")
      .get(fixture.taskId).count, beforeExecutions + 1);
    const reconciliation = afterEvents.find(row => row.event_type === "CHECKPOINT_RECONCILED");
    assert.equal(reconciliation.event.details.executionId, retried.result.executionId);
    const state = await readWorkState(fixture.target, { packageRoot, taskId: fixture.taskId });
    assert.deepEqual(state.repositoryFingerprint, retried.result.repositoryFingerprint);
    assert.equal(fixture.db.isTransaction, false);
  } finally {
    await closeFixture(fixture);
  }
});
