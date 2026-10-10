import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { runTaskRepairContractBootstrap } from "../src/commands/task-repair-contract-bootstrap.js";
import {
  appendProtocolEvent,
  eventHash,
  readEvents,
} from "../src/core/events.js";
import {
  legacyContractBootstrapRepairId,
} from "../src/core/contract-bootstrap-recovery.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { evaluateRoute } from "../src/core/router.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { writeJsonArtifact } from "../src/core/artifacts.js";
import { withTaskTransaction } from "../src/core/transaction.js";
import { createWorkState, readWorkState, writeWorkState } from "../src/core/work-state.js";
import { openStorageDatabase } from "../src/storage/index.js";
import { readTaskRecovery } from "../src/core/task-recovery.js";
import {
  packageRoot,
  setupAbandonedTask,
  withRecoveryTarget,
} from "./helpers/task-recovery-fixture.js";
import { overwriteFixtureText } from "./helpers/native-storage-fixture.js";

function database(target) {
  return openStorageDatabase(path.join(target, ".forgeloop", "state.sqlite"));
}

function snapshot(db) {
  return db.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map(({ name }) => ({
    name,
    rows: db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
      .map((row) => JSON.stringify(row))
      .sort(),
  }));
}

function eventRows(db, taskId) {
  return db.prepare(
    "SELECT seq, event_type, event_json FROM events WHERE task_id = ? ORDER BY seq",
  ).all(taskId).map((row) => ({
    ...row,
    event: JSON.parse(row.event_json),
  }));
}

function installEventFault(db, triggerName, eventType, message) {
  db.exec(`CREATE TRIGGER "${triggerName}" AFTER INSERT ON events
    WHEN NEW.event_type = '${eventType}'
    BEGIN SELECT RAISE(ABORT, '${message}'); END`);
}

async function invoke(target, command, input) {
  return executeForgeLoopCommand({ command, projectPath: target, input });
}

async function assertPublicFaultRollbackAndRetry({
  target,
  db,
  taskId,
  command,
  input,
  eventType,
  operation,
  triggerName,
  faultMessage,
  assertRetry,
}) {
  const before = snapshot(db);
  const beforeEvents = eventRows(db, taskId);
  installEventFault(db, triggerName, eventType, faultMessage);
  try {
    const failed = await invoke(target, command, input);
    assert.equal(failed.ok, false, `${command} unexpectedly succeeded: ${JSON.stringify(failed)}`);
    assert.match(JSON.stringify(failed.error), new RegExp(faultMessage));
    assert.deepEqual(snapshot(db), before, `${command} changed canonical rows after publication failure`);
    assert.equal(db.isTransaction, false, `${command} left the native transaction open`);
  } finally {
    db.exec(`DROP TRIGGER "${triggerName}"`);
  }

  const retried = await invoke(target, command, input);
  assert.equal(retried.ok, true, `${command} retry failed: ${JSON.stringify(retried)}`);
  const after = snapshot(db);
  assert.notDeepEqual(after, before, `${command} retry must publish a new canonical outcome`);
  const afterEvents = eventRows(db, taskId);
  const domainsBefore = beforeEvents.filter((row) => row.event_type === eventType).length;
  const domainsAfter = afterEvents.filter((row) => row.event_type === eventType);
  assert.equal(domainsAfter.length, domainsBefore + 1, `${eventType} must be published once by the retry`);
  const domain = domainsAfter.at(-1);
  const commitsBefore = beforeEvents.filter((row) => row.event_type === "TRANSACTION_COMMITTED"
    && row.event?.details?.operation === operation).length;
  const commitsAfter = afterEvents.filter((row) => row.event_type === "TRANSACTION_COMMITTED"
    && row.event?.details?.operation === operation);
  assert.equal(commitsAfter.length, commitsBefore + 1, `${operation} must have one new commit witness`);
  const commit = commitsAfter.at(-1);
  assert.equal(commit.seq, domain.seq + 1, `${operation} commit must immediately follow its domain event`);
  assert.equal(commit.event?.details?.operation, operation);
  assert.equal(db.isTransaction, false, `${command} retry left the native transaction open`);
  await assertRetry?.({ retried, before, after, beforeEvents, afterEvents, domain, commit });
  return { retried, before, after, beforeEvents, afterEvents, domain, commit };
}

async function prepareActiveReviewingTask(target, taskId) {
  const fixture = await setupAbandonedTask(target, { taskId });
  const state = await readWorkState(target, { packageRoot, taskId });
  await writeWorkState(target, createWorkState({
    ...state,
    contractFingerprint: fixture.contractHash,
    phase: "REVIEWING",
    previousPhase: "VERIFYING",
    verificationCycle: 1,
    repositoryFingerprint: { branch: null, head: null },
    verificationEvidence: [{ kind: "OBSERVED", source: "fixture", result: "focused checks passed" }],
    lastUpdated: new Date().toISOString(),
  }), { packageRoot, taskId });
  await appendProtocolEvent(target, {
    taskId,
    event: "REVIEW_STARTED",
    details: { verificationCycle: 1 },
  }, packageRoot, { taskId });
  return fixture;
}

async function appendTransaction(target, taskId, operation, event, details = undefined, fingerprint = undefined) {
  await withTaskTransaction({
    target,
    taskId,
    operation,
    packageRoot,
    recordCommitEvent: true,
  }, async () => {
    await appendProtocolEvent(target, {
      taskId,
      event,
      ...(details ? { details } : {}),
      ...(fingerprint ? { fingerprint } : {}),
    }, packageRoot, { taskId });
  });
}

async function prepareContractBootstrapCandidate(target, taskId) {
  const contract = createContract({
    taskId,
    objective: "Exercise public contract bootstrap repair atomicity",
    deliverables: ["src/example.js"],
    constraints: ["append-only"],
    risks: [],
    verification: ["focused tests"],
    successCriteria: ["repair is atomic"],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  const descriptor = createTaskDescriptor({ taskId, writeClaims: [] });
  await writeTaskDescriptor(target, descriptor, packageRoot);
  await writeContract(target, contract, packageRoot, { taskId });
  await appendTransaction(target, taskId, "task-create", "TASK_RECEIVED", {
    createdAt: descriptor.createdAt,
  });
  await appendTransaction(target, taskId, "discover", "DISCOVERY_STARTED", { source: "test" });
  await appendTransaction(target, taskId, "contract-create", "CONTRACT_VALIDATED", {
    contractFingerprint: contractHash,
  });

  const route = evaluateRoute({
    workType: "code",
    surfaces: ["documentation"],
    executableChange: true,
  });
  await writeJsonArtifact(
    target,
    taskArtifactPath(taskId, "route"),
    { ...route, contractFingerprint: contractHash },
    "routing-result",
    packageRoot,
    { taskId },
  );
  await appendTransaction(target, taskId, "route", "ROUTE_VALIDATED", undefined, route.fingerprint);
  await appendTransaction(target, taskId, "contract-create", "CONTRACT_VALIDATED", {
    contractFingerprint: contractHash,
  });
  await writeWorkState(target, createWorkState({
    taskId,
    contractFingerprint: contractHash,
    repositoryFingerprint: { branch: null, head: null },
    phase: "CONTRACT_READY",
    selectedGuides: [],
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: ["contract"],
    pendingSteps: ["route"],
    requiredArtifacts: [],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
  }), { packageRoot, taskId });
  return { taskId, contractHash };
}

function rewriteEventChain(events) {
  let previousHash = null;
  for (const [index, event] of events.entries()) {
    event.seq = index + 1;
    event.previousHash = previousHash;
    event.hash = eventHash(event);
    previousHash = event.hash;
  }
}

async function prepareLegacyContractBootstrapMigration(target, taskId) {
  await prepareContractBootstrapCandidate(target, taskId);
  await runTaskRepairContractBootstrap({
    target,
    packageRoot,
    taskId,
    acknowledgeRepair: true,
  });
  const events = await readEvents(target, packageRoot, { taskId });
  const marker = events.find((event) => event.event === "CONTRACT_BOOTSTRAP_REPAIR_RECORDED");
  assert.ok(marker, "fixture repair must create a contract bootstrap marker");
  delete marker.details.reconstructedStateRevision;
  marker.details.repairId = legacyContractBootstrapRepairId(marker.details);
  rewriteEventChain(events);
  await overwriteFixtureText(
    target,
    path.join(target, taskArtifactPath(taskId, "events")),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
}

async function prepareLegacyRecoveryMigration(target, taskId) {
  await setupAbandonedTask(target, { taskId });
  await appendProtocolEvent(target, {
    taskId,
    event: "OPERATOR_RECOVERY_RECORDED",
    details: {
      classification: "RECOVERABLE",
      reasonCodes: ["E_REPOSITORY_CHANGED", "OFFICIAL_RECOVERY_AVAILABLE"],
      authorization: "OPERATOR_AUTHORIZED",
      note: "recovery event recorded by early adapter without modern identity fields",
    },
  }, packageRoot, { taskId });
}

test("public task-abandon rolls back claims and recovery publication, then retries once", async () => {
  await withRecoveryTarget(async (target) => {
    const taskId = "public-task-abandon-atomicity";
    await prepareActiveReviewingTask(target, taskId);
    const db = database(target);
    try {
      const input = { taskId, acknowledgeAbandonment: true };
      const result = await assertPublicFaultRollbackAndRetry({
        target,
        db,
        taskId,
        command: "task-abandon",
        input,
        eventType: "TASK_ABANDONED",
        operation: "task-abandon",
        triggerName: "public_task_abandon_event_fault",
        faultMessage: "PUBLIC_TASK_ABANDON_EVENT_FAULT",
        assertRetry: async ({ retried, domain }) => {
          assert.equal(retried.result.abandoned, true);
          const recovery = await readTaskRecovery(target, { packageRoot, taskId });
          assert.equal(recovery.value.recoveryId, retried.result.recoveryId);
          assert.equal(recovery.value.recoveryEventSeq, domain.seq);
        },
      });
      const second = await invoke(target, "task-abandon", input);
      assert.equal(second.ok, false, JSON.stringify(second));
      assert.equal(second.error.code, "E_TASK_ALREADY_ABANDONED");
      assert.deepEqual(snapshot(db), result.after, "repeated abandonment must not add canonical rows");
    } finally {
      db.close();
    }
  });
});

test("public contract bootstrap repair rolls back reconstructed state and marker publication, then retries once", async () => {
  await withRecoveryTarget(async (target) => {
    const taskId = "public-contract-bootstrap-repair-atomicity";
    await prepareContractBootstrapCandidate(target, taskId);
    const db = database(target);
    try {
      const input = { taskId, acknowledgeRepair: true };
      const result = await assertPublicFaultRollbackAndRetry({
        target,
        db,
        taskId,
        command: "task-repair-contract-bootstrap",
        input,
        eventType: "CONTRACT_BOOTSTRAP_REPAIR_RECORDED",
        operation: "task-repair-contract-bootstrap",
        triggerName: "public_contract_bootstrap_repair_event_fault",
        faultMessage: "PUBLIC_CONTRACT_BOOTSTRAP_REPAIR_EVENT_FAULT",
        assertRetry: async ({ retried }) => {
          assert.equal(retried.result.repaired, true);
          assert.equal(retried.result.alreadyRepaired, false);
        },
      });
      const second = await invoke(target, "task-repair-contract-bootstrap", input);
      assert.equal(second.ok, true, JSON.stringify(second));
      assert.equal(second.result.alreadyRepaired, true);
      assert.deepEqual(snapshot(db), result.after, "idempotent repair must not add canonical rows");
    } finally {
      db.close();
    }
  });
});

test("public contract bootstrap migration rolls back its marker and witness, then retries once", async () => {
  await withRecoveryTarget(async (target) => {
    const taskId = "public-contract-bootstrap-migration-atomicity";
    await prepareLegacyContractBootstrapMigration(target, taskId);
    const db = database(target);
    try {
      const input = { taskId, acknowledgeMigration: true };
      const result = await assertPublicFaultRollbackAndRetry({
        target,
        db,
        taskId,
        command: "task-migrate-contract-bootstrap-repair",
        input,
        eventType: "CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_RECORDED",
        operation: "task-migrate-contract-bootstrap-repair",
        triggerName: "public_contract_bootstrap_migration_event_fault",
        faultMessage: "PUBLIC_CONTRACT_BOOTSTRAP_MIGRATION_EVENT_FAULT",
        assertRetry: async ({ retried }) => {
          assert.equal(retried.result.migrated, true);
          assert.equal(retried.result.alreadyMigrated, false);
        },
      });
      const second = await invoke(target, "task-migrate-contract-bootstrap-repair", input);
      assert.equal(second.ok, true, JSON.stringify(second));
      assert.equal(second.result.alreadyMigrated, true);
      assert.deepEqual(snapshot(db), result.after, "idempotent migration must not add canonical rows");
    } finally {
      db.close();
    }
  });
});

test("public legacy recovery repair rolls back its recovery artifact and migration marker, then retries once", async () => {
  await withRecoveryTarget(async (target) => {
    const taskId = "public-legacy-recovery-atomicity";
    await prepareLegacyRecoveryMigration(target, taskId);
    const db = database(target);
    try {
      const input = { taskId, acknowledgeRecovery: true };
      const result = await assertPublicFaultRollbackAndRetry({
        target,
        db,
        taskId,
        command: "task-repair-legacy-recovery",
        input,
        eventType: "LEGACY_RECOVERY_MIGRATION_RECORDED",
        operation: "task-repair-legacy-recovery",
        triggerName: "public_legacy_recovery_event_fault",
        faultMessage: "PUBLIC_LEGACY_RECOVERY_EVENT_FAULT",
        assertRetry: async ({ retried }) => {
          assert.equal(retried.result.repaired, 1);
          assert.equal(retried.result.alreadyRepaired, false);
          const recovery = await readTaskRecovery(target, { packageRoot, taskId });
          assert.equal(recovery.value.recoveryId, retried.result.recoveryId);
        },
      });
      const second = await invoke(target, "task-repair-legacy-recovery", input);
      assert.equal(second.ok, true, JSON.stringify(second));
      assert.equal(second.result.alreadyRepaired, true);
      assert.deepEqual(snapshot(db), result.after, "idempotent legacy repair must not add canonical rows");
    } finally {
      db.close();
    }
  });
});
