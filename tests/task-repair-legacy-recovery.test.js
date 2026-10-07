import assert from "node:assert/strict";
import { readRawFixtureText, overwriteFixtureText, overwriteFixtureLease, readRawFixtureLease } from "./helpers/native-storage-fixture.js";
import { test } from "node:test";

import { runTaskCreate } from "../src/commands/task-create.js";
import { runTaskRepairLegacyRecovery } from "../src/commands/task-repair-legacy-recovery.js";
import { runTaskResume } from "../src/commands/task-resume.js";
import { appendProtocolEvent, eventHash, validateEventLedger } from "../src/core/events.js";
import { assertTaskMutationAllowed, resolveTaskClaimState } from "../src/core/task-claim-state.js";
import { acquireTaskLock, readLockInfo } from "../src/core/task-lock.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { ensureWithin } from "../src/core/filesystem.js";
import {
  legacyRecoveryMigrationId,
} from "../src/core/task-recovery-migration.js";
import { packageRoot, setupAbandonedTask, withRecoveryTarget } from "./helpers/task-recovery-fixture.js";

const LEGACY_DETAILS = Object.freeze({
  classification: "RECOVERABLE",
  reasonCodes: ["E_REPOSITORY_CHANGED", "OFFICIAL_RECOVERY_AVAILABLE"],
  authorization: "OPERATOR_AUTHORIZED",
  note: "recovery event recorded by early adapter without modern identity fields",
});

async function appendLegacyBoundaryEvent(target, taskId) {
  return appendProtocolEvent(target, {
    taskId,
    event: "OPERATOR_RECOVERY_RECORDED",
    details: { ...LEGACY_DETAILS },
  }, packageRoot, { taskId });
}

async function setupLegacyBoundaryTask(target, { taskId = "legacy-boundary-task", writeClaims = ["tests"] } = {}) {
  await setupAbandonedTask(target, { taskId, writeClaims });
  const legacyEvent = await appendLegacyBoundaryEvent(target, taskId);
  return { taskId, legacyEvent };
}

async function rewriteLedger(target, taskId, mutateLastEvents) {
  const eventsPath = ensureWithin(target, taskArtifactPath(taskId, "events"));
  const lines = (await readRawFixtureText(target, eventsPath)).trim().split("\n");
  const events = lines.map((line) => JSON.parse(line));
  mutateLastEvents(events);
  let previousHash = null;
  for (const event of events) {
    event.previousHash = previousHash;
    delete event.hash;
    event.hash = eventHash(event);
    previousHash = event.hash;
  }
  await overwriteFixtureText(target, eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

test("missing acknowledgement is refused before anything else", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupLegacyBoundaryTask(target, {});
    await assert.rejects(
      () => runTaskRepairLegacyRecovery({ target, packageRoot, taskId }),
      (error) => error.code === "E_TASK_RECOVERY_AUTHORIZATION_REQUIRED",
    );
  });
});

test("ACTIVE task with valid legacy boundary repairs to validated recovery and blocks mutation until resume", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId, legacyEvent } = await setupLegacyBoundaryTask(target, { writeClaims: ["docs", "tests"] });

    const expectedRecoveryId = legacyRecoveryMigrationId({
      taskId,
      seq: legacyEvent.seq,
      hash: legacyEvent.hash,
    });

    const before = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(before.claimState, "INCONSISTENT");
    assert.equal(before.mutationAllowed, false);
    assert.deepEqual(before.effectiveWriteClaims, ["docs", "tests"]);
    assert.equal(before.ownershipValid, false);

    // Overlapping acquisition must fail while ownership is inconsistent.
    await assert.rejects(
      () => runTaskCreate({ target, packageRoot, taskId: "blocked-task", claims: ["tests"] }),
      (error) => error.code === "E_TASK_SCOPE_CONFLICT" || error.code === "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT",
    );

    const result = await runTaskRepairLegacyRecovery({
      target,
      packageRoot,
      taskId,
      acknowledgeRecovery: true,
    });
    assert.equal(result.repaired, 1);
    assert.equal(result.alreadyRepaired, false);
    assert.equal(result.recoveryId, expectedRecoveryId);
    assert.equal(result.classificationAtRecovery, "LEGACY_BOUNDARY_MIGRATED");

    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);

    const after = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(after.claimState, "RELEASED_BY_RECOVERY");
    assert.deepEqual(after.effectiveWriteClaims, []);
    assert.deepEqual(after.historicalWriteClaims, ["docs", "tests"]);
    assert.equal(after.mutationAllowed, false);
    assert.equal(after.ownershipValid, true);

    await assert.rejects(
      () => assertTaskMutationAllowed(target, { taskId, packageRoot }),
      (error) => error.code === "E_TASK_RECOVERED",
    );

    // Another task may now safely acquire the released claims.
    const created = await runTaskCreate({ target, packageRoot, taskId: "second-task", claims: ["tests"] });
    assert.equal(created.taskId ?? created.descriptor?.taskId, "second-task");

    // Migration event binds the original legacy event by reference at the tail.
    const migration = ledger.events.find((event) => event.event === "LEGACY_RECOVERY_MIGRATION_RECORDED");
    assert.equal(migration.event, "LEGACY_RECOVERY_MIGRATION_RECORDED");
    assert.equal(migration.details.legacyEventSeq, legacyEvent.seq);
    assert.equal(migration.details.legacyEventHash, legacyEvent.hash);
    assert.equal(migration.details.legacyEventAt, legacyEvent.at);
    assert.equal(migration.details.legacyTaskId, taskId);
    assert.equal(migration.details.legacyClassification, "RECOVERABLE");
    assert.equal(migration.details.legacyAuthority, "OPERATOR_AUTHORIZED");
    assert.equal(migration.details.authorityKind, "CALLER_ACKNOWLEDGED");
    assert.ok(migration.seq > legacyEvent.seq);
  });
});

test("repair is idempotent and recognizes the already repaired relationship", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupLegacyBoundaryTask(target, {});
    await runTaskRepairLegacyRecovery({ target, packageRoot, taskId, acknowledgeRecovery: true });

    const second = await runTaskRepairLegacyRecovery({
      target,
      packageRoot,
      taskId,
      acknowledgeRecovery: true,
    });
    assert.equal(second.repaired, 0);
    assert.equal(second.alreadyRepaired, true);

    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);
    assert.equal(
      ledger.events.filter((event) => event.event === "LEGACY_RECOVERY_MIGRATION_RECORDED").length,
      1,
    );
  });
});

test("task-resume accepts a migrated LEGACY_BOUNDARY_MIGRATED recovery without any bypass", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupLegacyBoundaryTask(target, { writeClaims: ["tests"] });
    await runTaskRepairLegacyRecovery({ target, packageRoot, taskId, acknowledgeRecovery: true });

    const resumed = await runTaskResume({ target, packageRoot, taskId });
    assert.equal(resumed.resumed, true);
    assert.deepEqual(resumed.reacquiredClaims, ["tests"]);

    const active = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(active.claimState, "ACTIVE");
    assert.equal(active.mutationAllowed, true);
  });
});

test("meaningful activity after the legacy boundary refuses repair", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupLegacyBoundaryTask(target, {});
    await rewriteLedger(target, taskId, (events) => {
      events.push({
        seq: events.length + 1,
        schemaVersion: 1,
        protocolVersion: 1,
        taskId,
        event: "CHECK_RECORDED",
        at: new Date().toISOString(),
        details: { checkId: "late-check", status: "passed" },
      });
    });

    await assert.rejects(
      () => runTaskRepairLegacyRecovery({ target, packageRoot, taskId, acknowledgeRecovery: true }),
      (error) => error.code === "E_LEGACY_RECOVERY_MIGRATION_INVALID",
    );
  });
});

test("live, unknown, and corrupt task locks refuse repair", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupLegacyBoundaryTask(target, {});
    const lock = await acquireTaskLock(target, taskId, "mutation");
    try {
      await assert.rejects(
        () => runTaskRepairLegacyRecovery({ target, packageRoot, taskId, acknowledgeRecovery: true }),
        (error) => error.code === "E_TASK_LOCKED",
      );
    } finally {
      await lock.release();
    }
  });
});

test("modern recovery event without recoveryId refuses repair", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupLegacyBoundaryTask(target, {});
    await rewriteLedger(target, taskId, (events) => {
      events.push({
        seq: events.length + 1,
        schemaVersion: 1,
        protocolVersion: 1,
        taskId,
        event: "TASK_RECOVERY_RECORDED",
        at: new Date().toISOString(),
        details: { ...LEGACY_DETAILS, classification: "STALE", note2: "near miss" },
      });
    });

    await assert.rejects(
      () => runTaskRepairLegacyRecovery({ target, packageRoot, taskId, acknowledgeRecovery: true }),
      (error) => error.code === "E_LEGACY_RECOVERY_MIGRATION_INVALID",
    );
  });
});

test("tampered ledger refuses repair fail-closed", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupLegacyBoundaryTask(target, {});
    const eventsPath = ensureWithin(target, taskArtifactPath(taskId, "events"));
    const original = await readRawFixtureText(target, eventsPath);
    const lines = original.trim().split("\n");
    const first = JSON.parse(lines[0]);
    first.taskId = `${first.taskId}-x`;
    lines[0] = JSON.stringify(first);
    await overwriteFixtureText(target, eventsPath, `${lines.join("\n")}\n`);

    await assert.rejects(
      () => runTaskRepairLegacyRecovery({ target, packageRoot, taskId, acknowledgeRecovery: true }),
      (error) => error.code === "E_LEGACY_RECOVERY_MIGRATION_INVALID",
    );
  });
});

async function writeTaskLockFile(target, taskId, lockData) {
  await overwriteFixtureLease(target, taskId, lockData);
}

function staleLockFixture(taskId) {
  return {
    taskId,
    lockId: "stale-repair-lock",
    operation: "crashed-cmd",
    ownerInstanceId: "stale-owner",
    acquiredAt: "2020-01-01T00:00:00.000Z",
    heartbeatAt: "2020-01-01T00:00:00.000Z",
    leaseMs: 1,
  };
}

test("STALE task lock is CAS-settled by the official repair and repair succeeds", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupLegacyBoundaryTask(target, {});
    await writeTaskLockFile(target, taskId, staleLockFixture(taskId));

    const result = await runTaskRepairLegacyRecovery({ target, packageRoot, taskId, acknowledgeRecovery: true });
    assert.equal(result.repaired, 1);
    assert.equal(await readLockInfo(target, taskId), null);
  });
});

test("STALE lock replaced by a live owner refuses repair and preserves the replacement", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupLegacyBoundaryTask(target, {});
    await writeTaskLockFile(target, taskId, staleLockFixture(taskId));
    const replacement = {
      ...staleLockFixture(taskId),
      lockId: "replacement-owner-lock",
      ownerInstanceId: "replacement-owner",
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      leaseMs: 300000,
    };
    await writeTaskLockFile(target, taskId, replacement);

    await assert.rejects(
      () => runTaskRepairLegacyRecovery({ target, packageRoot, taskId, acknowledgeRecovery: true }),
      (error) => error.code === "E_TASK_LOCKED",
    );
    const preserved = JSON.parse(await readRawFixtureLease(target, taskId));
    assert.equal(preserved.lockId, "replacement-owner-lock");
  });
});

test("UNKNOWN task lock refuses repair and preserves the lock", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupLegacyBoundaryTask(target, {});
    await writeTaskLockFile(target, taskId, {
      taskId,
      acquiredAt: "2020-01-01T00:00:00.000Z",
      heartbeatAt: "2020-01-01T00:00:00.000Z",
      leaseMs: 1,
    });

    await assert.rejects(
      () => runTaskRepairLegacyRecovery({ target, packageRoot, taskId, acknowledgeRecovery: true }),
      (error) => error.code === "E_LEGACY_RECOVERY_MIGRATION_INVALID",
    );
    assert.ok(await readRawFixtureLease(target, taskId));
  });
});

test("CORRUPT task lock refuses repair and preserves the lock", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupLegacyBoundaryTask(target, {});
    await overwriteFixtureLease(target, taskId, "{\"taskId\":");

    await assert.rejects(
      () => runTaskRepairLegacyRecovery({ target, packageRoot, taskId, acknowledgeRecovery: true }),
      (error) => error.code === "E_LEGACY_RECOVERY_MIGRATION_INVALID",
    );
    assert.ok(await readRawFixtureLease(target, taskId));
  });
});

async function repairOnce(target, taskId) {
  const first = await runTaskRepairLegacyRecovery({ target, packageRoot, taskId, acknowledgeRecovery: true });
  assert.equal(first.repaired, 1);
  return first;
}

async function assertTamperRefused(target, taskId, mutate) {
  const recoveryPath = ensureWithin(target, taskArtifactPath(taskId, "recovery"));
  const artifact = JSON.parse(await readRawFixtureText(target, recoveryPath));
  await overwriteFixtureText(target, recoveryPath, `${JSON.stringify(mutate(artifact), null, 2)}\n`);
  await assert.rejects(
    () => runTaskRepairLegacyRecovery({ target, packageRoot, taskId, acknowledgeRecovery: true }),
    (error) => error.code === "E_TASK_RECOVERY_INCONSISTENT",
  );
}

test("alreadyRepaired fails closed on any tampered recovery relationship field", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupLegacyBoundaryTask(target, { writeClaims: ["tests"] });
    await repairOnce(target, taskId);
    await assertTamperRefused(target, taskId, (a) => ({ ...a, releasedClaims: ["docs"] }));
  });

  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupLegacyBoundaryTask(target, {});
    await repairOnce(target, taskId);
    await assertTamperRefused(target, taskId, (a) => ({ ...a, classificationAtRecovery: "STALE" }));
  });

  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupLegacyBoundaryTask(target, {});
    await repairOnce(target, taskId);
    await assertTamperRefused(target, taskId, (a) => ({ ...a, previousRevision: 99 }));
  });

  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupLegacyBoundaryTask(target, {});
    await repairOnce(target, taskId);
    await assertTamperRefused(target, taskId, (a) => ({
      ...a,
      repositoryFingerprint: { ...a.repositoryFingerprint, head: "0".repeat(40) },
    }));
  });

  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupLegacyBoundaryTask(target, {});
    await repairOnce(target, taskId);
    await assertTamperRefused(target, taskId, (a) => ({
      ...a,
      authority: { kind: "HOST_ATTESTED", grantRef: "grant://forged" },
    }));
  });
});

test("migration event authority HOST_ATTESTED is invalid for v1", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupLegacyBoundaryTask(target, {});
    await repairOnce(target, taskId);
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    const migration = ledger.events.find((event) => event.event === "LEGACY_RECOVERY_MIGRATION_RECORDED");
    const forged = { ...migration, details: { ...migration.details, authorityKind: "HOST_ATTESTED" } };
    delete forged.hash;
    forged.hash = eventHash(forged);
    const eventsPath = ensureWithin(target, taskArtifactPath(taskId, "events"));
    const lines = (await readRawFixtureText(target, eventsPath)).trim().split("\n").map((line) => JSON.parse(line));
    lines[lines.findIndex((line) => line.event === "LEGACY_RECOVERY_MIGRATION_RECORDED")] = forged;
    await overwriteFixtureText(target, eventsPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

    await assert.rejects(
      () => runTaskRepairLegacyRecovery({ target, packageRoot, taskId, acknowledgeRecovery: true }),
      (error) => error.code === "E_LEGACY_RECOVERY_MIGRATION_INVALID",
    );
  });
});
