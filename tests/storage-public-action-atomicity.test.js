import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";

import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";

const packageRoot = getPackageRoot();
const trustedAuthority = Object.freeze({
  trustMode: "HOST_ATTESTED",
  hostSupplied: true,
  source: "host-boundary",
  grantRef: "grant-public-action-atomicity",
});

function snapshot(db) {
  return db.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map(({ name }) => ({
    name,
    rows: db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
      .map(row => JSON.stringify(row))
      .sort(),
  }));
}

function eventRows(db, taskId) {
  return db.prepare(
    "SELECT seq, event_type, event_json FROM events WHERE task_id = ? ORDER BY seq",
  ).all(taskId).map(row => ({ ...row, event: JSON.parse(row.event_json) }));
}

function installEventFault(db, triggerName, eventType, message) {
  db.exec(`CREATE TRIGGER "${triggerName}" AFTER INSERT ON events
    WHEN NEW.event_type = '${eventType}'
    BEGIN SELECT RAISE(ABORT, '${message}'); END`);
}

async function invoke(target, command, input, authorityContext) {
  return executeForgeLoopCommand({ command, projectPath: target, input, authorityContext });
}

async function createActionFixture(taskId, { authorize = true } = {}) {
  const target = await createGitRepository(`forgeloop-public-action-atomicity-${taskId}-`);
  try {
    await setupVerifyingTask(target, packageRoot, {
      taskId,
      capabilityPolicy: {
        schemaVersion: 1,
        defaultDecision: "DENY",
        rules: [{ capability: "external.publish", decision: "REQUIRE_AUTHORITY" }],
      },
      requirement: "external outcome remains durable",
    });
    const proposed = await invoke(target, "action-propose", {
      taskId,
      actionId: `action-${taskId}`,
      actionCapability: "external.publish",
      actionEffectClass: "EXTERNAL_PUBLICATION",
      actionTarget: "registry/fixture-release",
      actionOperation: "publish fixture release",
      actionIdempotencyKey: `${taskId}:publish:v1`,
      actionRequirement: "external outcome remains durable",
      actionRequiredForCompletion: true,
    });
    assert.equal(proposed.ok, true, JSON.stringify(proposed));
    assert.equal(proposed.result.action.state, "PROPOSED");

    if (authorize) {
      const authorized = await invoke(target, "action-authorize", {
        taskId,
        actionId: proposed.result.action.actionId,
      }, trustedAuthority);
      assert.equal(authorized.ok, true, JSON.stringify(authorized));
      assert.equal(authorized.result.action.state, "AUTHORIZED");
      assert.equal(authorized.result.authorization.authorityKind, "HOST_ATTESTED");
    }
    return { target, taskId, actionId: proposed.result.action.actionId };
  } catch (error) {
    await removeTempTree(target);
    throw error;
  }
}

async function recordAction(target, taskId, actionId, state, evidenceRef = undefined) {
  const result = await invoke(target, "action-record", {
    taskId,
    actionId,
    actionState: state,
    actionProvenance: "EXTERNAL_OBSERVED",
    ...(evidenceRef ? { actionEvidenceRef: evidenceRef } : {}),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.state, state);
  return result.result;
}

async function assertFaultRollbackAndRetry({
  target,
  db,
  taskId,
  invokeOperation,
  eventTypes,
  faultEvent = eventTypes[0],
  operation,
  triggerName,
  faultMessage,
}) {
  const before = snapshot(db);
  const beforeEvents = eventRows(db, taskId);
  const beforeCommitCount = beforeEvents.filter(row => row.event_type === "TRANSACTION_COMMITTED"
    && row.event?.details?.operation === operation).length;
  installEventFault(db, triggerName, faultEvent, faultMessage);
  try {
    const failed = await invokeOperation();
    assert.equal(failed.ok, false, JSON.stringify(failed));
    assert.match(JSON.stringify(failed.error), new RegExp(faultMessage));
    assert.deepEqual(snapshot(db), before, "faulted action operation changed canonical rows");
    assert.equal(db.isTransaction, false, "faulted action operation left a transaction open");
  } finally {
    db.exec(`DROP TRIGGER "${triggerName}"`);
  }

  const retried = await invokeOperation();
  assert.equal(retried.ok, true, JSON.stringify(retried));
  const afterEvents = eventRows(db, taskId);
  const newEvents = afterEvents.filter(row => row.seq > (beforeEvents.at(-1)?.seq ?? 0));
  for (const eventType of eventTypes) {
    assert.equal(
      afterEvents.filter(row => row.event_type === eventType).length,
      beforeEvents.filter(row => row.event_type === eventType).length + 1,
      `${eventType} must be published exactly once by the retry`,
    );
  }
  const transitions = newEvents.filter(row => eventTypes.includes(row.event_type));
  assert.equal(transitions.length, eventTypes.length, "retry must publish one transition per expected event");
  const commits = afterEvents.filter(row => row.event_type === "TRANSACTION_COMMITTED"
    && row.event?.details?.operation === operation);
  assert.equal(commits.length, beforeCommitCount + 1, `${operation} must have one new commit witness`);
  const commit = commits.at(-1);
  assert.equal(commit.seq, transitions.at(-1).seq + 1, `${operation} witness must follow its transition`);
  assert.equal(commit.event.details.operation, operation);
  assert.equal(db.isTransaction, false, "successful action operation left a transaction open");
  return retried;
}

for (const scenario of [
  { state: "STARTED", event: "ACTION_STARTED", seedStarted: false },
  { state: "COMMITTED", event: "ACTION_COMMIT_RECORDED", seedStarted: true, evidence: "external:commit-captured" },
  { state: "FAILED", event: "ACTION_FAILED", seedStarted: true, evidence: "external:failure-captured" },
  { state: "COMMIT_UNKNOWN", event: "ACTION_COMMIT_UNKNOWN", seedStarted: true, evidence: "external:unknown-captured" },
]) {
  test(`public action-record ${scenario.state} rolls back all tables and retries atomically`, async () => {
    const fixture = await createActionFixture(`record-${scenario.state.toLowerCase()}`);
    const db = new DatabaseSync(path.join(fixture.target, ".forgeloop", "state.sqlite"));
    try {
      if (scenario.seedStarted) await recordAction(fixture.target, fixture.taskId, fixture.actionId, "STARTED");
      const invokeOperation = () => invoke(fixture.target, "action-record", {
        taskId: fixture.taskId,
        actionId: fixture.actionId,
        actionState: scenario.state,
        actionProvenance: "EXTERNAL_OBSERVED",
        ...(scenario.evidence ? { actionEvidenceRef: scenario.evidence } : {}),
      });
      await assertFaultRollbackAndRetry({
        target: fixture.target,
        db,
        taskId: fixture.taskId,
        invokeOperation,
        eventTypes: [scenario.event],
        operation: "action-record",
        triggerName: `public_action_record_${scenario.state.toLowerCase()}_fault`,
        faultMessage: `PUBLIC_ACTION_RECORD_${scenario.state}_FAULT`,
      });
    } finally {
      db.close();
      await removeTempTree(fixture.target);
    }
  });
}

test("public action-authorize rolls back the trusted authorization transition and retries atomically", async () => {
  const fixture = await createActionFixture("authorize", { authorize: false });
  const db = new DatabaseSync(path.join(fixture.target, ".forgeloop", "state.sqlite"));
  try {
    const authorizer = () => invoke(fixture.target, "action-authorize", {
      taskId: fixture.taskId,
      actionId: fixture.actionId,
    }, trustedAuthority);
    await assertFaultRollbackAndRetry({
      target: fixture.target,
      db,
      taskId: fixture.taskId,
      invokeOperation: authorizer,
      eventTypes: ["ACTION_AUTHORIZED"],
      operation: "action-authorize",
      triggerName: "public_action_authorize_fault",
      faultMessage: "PUBLIC_ACTION_AUTHORIZE_FAULT",
    });
  } finally {
    db.close();
    await removeTempTree(fixture.target);
  }
});

test("public action-verify rolls back verification and retries without rerunning the external check", async () => {
  const fixture = await createActionFixture("verify");
  const db = new DatabaseSync(path.join(fixture.target, ".forgeloop", "state.sqlite"));
  try {
    await recordAction(fixture.target, fixture.taskId, fixture.actionId, "STARTED");
    await recordAction(fixture.target, fixture.taskId, fixture.actionId, "COMMITTED", "external:commit-captured");
    const checked = await invoke(fixture.target, "run-check", {
      taskId: fixture.taskId,
      checkId: "independent-action-check",
      checkRequirement: "external outcome remains durable",
      commandArgv: [process.execPath, "-e", "process.exit(0)"],
    });
    assert.equal(checked.ok, true, JSON.stringify(checked));
    const evidenceRef = checked.result.execution.executionId;
    assert.match(evidenceRef, /^exec-/);
    const executionCount = db.prepare("SELECT COUNT(*) AS count FROM executions WHERE task_id = ?")
      .get(fixture.taskId).count;
    const invokeOperation = () => invoke(fixture.target, "action-verify", {
      taskId: fixture.taskId,
      actionId: fixture.actionId,
      actionEvidenceRef: evidenceRef,
    });
    const result = await assertFaultRollbackAndRetry({
      target: fixture.target,
      db,
      taskId: fixture.taskId,
      invokeOperation,
      eventTypes: ["ACTION_VERIFIED"],
      operation: "action-verify",
      triggerName: "public_action_verify_fault",
      faultMessage: "PUBLIC_ACTION_VERIFY_FAULT",
    });
    assert.equal(result.result.state, "VERIFIED");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM executions WHERE task_id = ?")
      .get(fixture.taskId).count, executionCount, "verification retry must not rerun the external check");
  } finally {
    db.close();
    await removeTempTree(fixture.target);
  }
});

for (const faultEvent of ["ACTION_RECONCILED", "ACTION_COMMIT_RECORDED"]) test(`public action-reconcile rolls back on ${faultEvent} and retries its reserved external outcome atomically`, async () => {
  const fixture = await createActionFixture("reconcile");
  const db = new DatabaseSync(path.join(fixture.target, ".forgeloop", "state.sqlite"));
  try {
    await recordAction(fixture.target, fixture.taskId, fixture.actionId, "STARTED");
    await recordAction(fixture.target, fixture.taskId, fixture.actionId, "COMMIT_UNKNOWN", "external:unknown-captured");
    const invokeOperation = () => invoke(fixture.target, "action-reconcile", {
      taskId: fixture.taskId,
      actionId: fixture.actionId,
      reconciliationOutcome: "COMMITTED",
      evidenceRefs: ["external:commit-observed"],
    }, trustedAuthority);
    const result = await assertFaultRollbackAndRetry({
      target: fixture.target,
      db,
      taskId: fixture.taskId,
      invokeOperation,
      eventTypes: ["ACTION_RECONCILED", "ACTION_COMMIT_RECORDED"],
      faultEvent,
      operation: "action-reconcile",
      triggerName: "public_action_reconcile_fault",
      faultMessage: "PUBLIC_ACTION_RECONCILE_FAULT",
    });
    assert.equal(result.result.action.state, "COMMITTED");
  } finally {
    db.close();
    await removeTempTree(fixture.target);
  }
});
