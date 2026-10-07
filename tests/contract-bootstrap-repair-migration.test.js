import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runTaskMigrateContractBootstrapRepair } from "../src/commands/task-migrate-contract-bootstrap-repair.js";
import { runTaskRepairContractBootstrap } from "../src/commands/task-repair-contract-bootstrap.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import {
  eventHash,
  appendProtocolEvent,
  readEvents,
  validateEventLedger,
  withEventLedgerAudit,
} from "../src/core/events.js";
import {
  legacyContractBootstrapRepairId,
  isLegacyContractBootstrapRepairMigrationCandidate,
  resolveEffectiveContractBootstrapRepairAnchor,
} from "../src/core/contract-bootstrap-recovery.js";
import { getNextAction, NEXT_ACTIONS } from "../src/core/next-action.js";
import { runAdvance } from "../src/commands/advance.js";
import { runPreflight } from "../src/commands/preflight.js";
import { evaluateRoute } from "../src/core/router.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";
import { withTaskTransaction } from "../src/core/transaction.js";
import { acquireTaskLock } from "../src/core/task-lock.js";
import { createWorkState, readWorkState, writeWorkState } from "../src/core/work-state.js";
import { writeJsonArtifact } from "../src/core/artifacts.js";
import { resolveTaskClaimState } from "../src/core/task-claim-state.js";
import { COMMAND_EXECUTORS } from "../src/core/command-executors.js";
import { parseArgs } from "../src/cli.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import { readRawFixtureText, overwriteFixtureText, deleteFixtureArtifact, overwriteFixtureLease } from "./helpers/native-storage-fixture.js";

const packageRoot = getPackageRoot();
const taskId = "contract-bootstrap-migration-fixture";

async function appendTransaction(target, operation, event, details = undefined, fingerprint = undefined) {
  await withTaskTransaction({ target, taskId, operation, packageRoot, recordCommitEvent: true }, async () => {
    await appendProtocolEvent(target, {
      taskId,
      event,
      ...(details ? { details } : {}),
      ...(fingerprint ? { fingerprint } : {}),
    }, packageRoot, { taskId });
  });
}

function rewriteEventChain(events, { preserveHashAt = new Set() } = {}) {
  let previousHash = null;
  for (const [index, event] of events.entries()) {
    event.seq = index + 1;
    event.previousHash = previousHash;
    if (!preserveHashAt.has(index)) event.hash = eventHash(event);
    previousHash = event.hash;
  }
}

async function fixture({ target = null, phase = "CONTRACT_READY", mutateEvents = null, preserveHashAt = new Set() } = {}) {
  target ??= await mkdtemp(path.join(os.tmpdir(), "forgeloop-contract-bootstrap-migration-"));
  const contract = createContract({
    taskId,
    objective: "Migrate a legacy contract bootstrap repair marker",
    deliverables: ["src/example.js"],
    constraints: ["append-only"],
    risks: [],
    verification: ["focused tests"],
    successCriteria: ["migration is idempotent"],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  const descriptor = createTaskDescriptor({ taskId, writeClaims: [] });
  await writeTaskDescriptor(target, descriptor, packageRoot);
  await writeContract(target, contract, packageRoot, { taskId });
  await appendTransaction(target, "task-create", "TASK_RECEIVED", { createdAt: descriptor.createdAt });
  await appendTransaction(target, "discover", "DISCOVERY_STARTED", { source: "test" });
  await appendTransaction(target, "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractHash });
  const route = evaluateRoute({ workType: "code", surfaces: ["documentation"], executableChange: true });
  const routeValue = { ...route, contractFingerprint: contractHash };
  await writeJsonArtifact(target, taskArtifactPath(taskId, "route"), routeValue, "routing-result", packageRoot, { taskId });
  await appendTransaction(target, "route", "ROUTE_VALIDATED", undefined, route.fingerprint);
  await appendTransaction(target, "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractHash });
  await writeWorkState(target, createWorkState({
    taskId,
    contractFingerprint: contractHash,
    repositoryFingerprint: { branch: null, head: null },
    phase,
    ...(phase === "ROUTED" ? { routeFingerprint: route.fingerprint } : {}),
    selectedGuides: [],
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: phase === "ROUTED" ? ["contract", "route"] : ["contract"],
    pendingSteps: phase === "ROUTED" ? ["execute"] : ["route"],
    requiredArtifacts: [],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
  }), { packageRoot, taskId });
  await runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true });

  const eventsPath = path.join(target, taskArtifactPath(taskId, "events"));
  const events = await readEvents(target, packageRoot, { taskId });
  const markerIndex = events.findIndex((event) => event.event === "CONTRACT_BOOTSTRAP_REPAIR_RECORDED");
  const marker = events[markerIndex];
  delete marker.details.reconstructedStateRevision;
  marker.details.repairId = legacyContractBootstrapRepairId(marker.details);
  mutateEvents?.(events, markerIndex);
  rewriteEventChain(events, {
    preserveHashAt,
  });
  await overwriteFixtureText(target, eventsPath, `${events.map(event => JSON.stringify(event)).join("\n")}\n`);
  return { target, eventsPath, markerLine: JSON.stringify(marker) };
}

test("strict validation fails closed, then official migration preserves history and is idempotent", async () => {
  const { target, eventsPath, markerLine } = await fixture();
  try {
    const strictBefore = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(strictBefore.valid, false);
    assert.match(strictBefore.errors.map((error) => error.message).join("\n"), /not officially migrated/);
    const tolerantBefore = await validateEventLedger(target, packageRoot, {
      taskId,
      allowUnmigratedLegacyContractBootstrapRepairMarkers: true,
    });
    assert.equal(tolerantBefore.valid, true);
    assert.ok(isLegacyContractBootstrapRepairMigrationCandidate(tolerantBefore.events, taskId));

    await withEventLedgerAudit(target, packageRoot, { taskId }, async strict => {
      assert.equal(strict.valid, false);
      await withEventLedgerAudit(target, packageRoot, {
        taskId, allowUnmigratedLegacyContractBootstrapRepairMarkers: true,
      }, async tolerant => {
        assert.equal(tolerant.valid, true, JSON.stringify(tolerant.errors));
        assert.equal(tolerant.events, strict.events);
        await withEventLedgerAudit(target, packageRoot, {
          taskId, allowUnmigratedLegacyRecoveryEvents: true,
        }, unrelatedTolerance => {
          assert.equal(unrelatedTolerance.valid, false);
          assert.match(unrelatedTolerance.errors.map(error => error.message).join("\n"), /not officially migrated/);
        });
      });
      await withEventLedgerAudit(target, packageRoot, {
        taskId, allowUnmigratedLegacyContractBootstrapRepairMarkers: true,
      }, repeated => assert.equal(repeated.valid, true, JSON.stringify(repeated.errors)));
    });

    const statePath = path.join(target, taskArtifactPath(taskId, "state"));
    const contractPath = path.join(target, taskArtifactPath(taskId, "contract"));
    const routePath = path.join(target, taskArtifactPath(taskId, "route"));
    const beforeState = await readRawFixtureText(target, statePath);
    const beforeContract = await readRawFixtureText(target, contractPath);
    const beforeRoute = await readRawFixtureText(target, routePath);

    const next = await getNextAction({ target, packageRoot, taskId });
    assert.equal(next.nextAction, NEXT_ACTIONS.MIGRATE_CONTRACT_BOOTSTRAP_REPAIR);
    assert.match(next.commands[0], /--acknowledge-migration/);

    const migrated = await runTaskMigrateContractBootstrapRepair({ target, packageRoot, taskId, acknowledgeMigration: true });
    assert.equal(migrated.migrated, true);
    assert.equal(migrated.alreadyMigrated, false);
    assert.equal(await readRawFixtureText(target, statePath), beforeState);
    assert.equal(await readRawFixtureText(target, contractPath), beforeContract);
    assert.equal(await readRawFixtureText(target, routePath), beforeRoute);
    const afterText = await readRawFixtureText(target, eventsPath);
    assert.equal(afterText.split("\n").find((line) => line === markerLine), markerLine);
    const strictAfter = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(strictAfter.valid, true);
    assert.equal(strictAfter.events.filter((event) => event.event === "CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_RECORDED").length, 1);

    const eventText = await readRawFixtureText(target, eventsPath);
    const second = await runTaskMigrateContractBootstrapRepair({ target, packageRoot, taskId, acknowledgeMigration: true });
    assert.equal(second.migrated, false);
    assert.equal(second.alreadyMigrated, true);
    assert.equal(await readRawFixtureText(target, eventsPath), eventText);

    const repairRerun = await runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true });
    assert.equal(repairRerun.alreadyRepaired, true);
  } finally {
    await removeTempTree(target);
  }
});

test("near-miss or progressed legacy boundaries are refused", async () => {
  const { target } = await fixture();
  try {
    const eventsPath = path.join(target, taskArtifactPath(taskId, "events"));
    const events = await readEvents(target, packageRoot, { taskId });
    const markerIndex = events.findIndex((event) => event.event === "CONTRACT_BOOTSTRAP_REPAIR_RECORDED");
    delete events[markerIndex].details.routeFingerprint;
    events[markerIndex].hash = eventHash(events[markerIndex]);
    events[markerIndex + 1].previousHash = events[markerIndex].hash;
    events[markerIndex + 1].hash = eventHash(events[markerIndex + 1]);
    await overwriteFixtureText(target, eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    await assert.rejects(
      runTaskMigrateContractBootstrapRepair({ target, packageRoot, taskId, acknowledgeMigration: true }),
      (error) => error.code === "E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID",
    );
  } finally {
    await removeTempTree(target);
  }
});

test("malformed markers and repair boundaries are never migration candidates", async () => {
  const cases = [
    {
      name: "missing reconstructedStateFingerprint",
      mutateEvents: (events, markerIndex) => delete events[markerIndex].details.reconstructedStateFingerprint,
    },
    {
      name: "unknown marker field",
      mutateEvents: (events, markerIndex) => { events[markerIndex].details.unexpected = true; },
    },
    {
      name: "marker hash mismatch",
      preserveHashAt: new Set(),
      mutateEvents: (events, markerIndex) => {
        events[markerIndex].hash = "0".repeat(64);
      },
    },
    {
      name: "missing repair transaction commit",
      mutateEvents: (events, markerIndex) => { events.splice(markerIndex + 1, 1); },
    },
    {
      name: "repair transaction operation mismatch",
      mutateEvents: (events, markerIndex) => { events[markerIndex + 1].details.operation = "other-operation"; },
    },
    {
      name: "post-repair lifecycle progression",
      mutateEvents: (events) => {
        const previous = events.at(-1);
        events.push({
          seq: previous.seq + 1,
          taskId,
          event: "PREFLIGHT_READY",
          at: new Date().toISOString(),
          previousHash: previous.hash,
          hash: "0".repeat(64),
        });
      },
    },
  ];

  for (const testCase of cases) {
    const preserveHashAt = testCase.preserveHashAt ?? new Set();
    const fixtureResult = await fixture({
      mutateEvents: testCase.mutateEvents,
      preserveHashAt,
    });
    try {
      if (testCase.name === "marker hash mismatch") {
        const events = await readEvents(fixtureResult.target, packageRoot, { taskId });
        const markerIndex = events.findIndex((event) => event.event === "CONTRACT_BOOTSTRAP_REPAIR_RECORDED");
        preserveHashAt.add(markerIndex);
        events[markerIndex].hash = "0".repeat(64);
        await overwriteFixtureText(fixtureResult.target, fixtureResult.eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
      }
      await assert.rejects(
        runTaskMigrateContractBootstrapRepair({
          target: fixtureResult.target,
          packageRoot,
          taskId,
          acknowledgeMigration: true,
        }),
        (error) => error.code === "E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID",
        testCase.name,
      );
    } finally {
      await removeTempTree(fixtureResult.target);
    }
  }
});

test("migration proves unchanged state, contract, and routed artifacts", async () => {
  const cases = [
    {
      name: "current state missing",
      mutate: async ({ target }) => deleteFixtureArtifact(target, path.join(target, taskArtifactPath(taskId, "state"))),
    },
    {
      name: "current state fingerprint mismatch",
      mutate: async ({ target }) => {
        const state = await readWorkState(target, { packageRoot, taskId });
        state.revision += 1;
        await writeWorkState(target, state, { packageRoot, taskId });
      },
    },
    {
      name: "current phase mismatch",
      phase: "ROUTED",
      mutate: async ({ target }) => {
        const state = await readWorkState(target, { packageRoot, taskId });
        delete state.routeFingerprint;
        state.phase = "CONTRACT_READY";
        await writeWorkState(target, state, { packageRoot, taskId });
      },
    },
    {
      name: "current contract fingerprint mismatch",
      mutate: async ({ target }) => {
        const contractPath = path.join(target, taskArtifactPath(taskId, "contract"));
        const contract = JSON.parse(await readRawFixtureText(target, contractPath));
        contract.objective = "different current contract";
        await overwriteFixtureText(target, contractPath, `${JSON.stringify(contract, null, 2)}\n`);
      },
    },
    {
      name: "routed route missing",
      phase: "ROUTED",
      mutate: async ({ target }) => deleteFixtureArtifact(target, path.join(target, taskArtifactPath(taskId, "route"))),
    },
    {
      name: "routed route fingerprint mismatch",
      phase: "ROUTED",
      mutate: async ({ target }) => {
        const routePath = path.join(target, taskArtifactPath(taskId, "route"));
        const route = JSON.parse(await readRawFixtureText(target, routePath));
        route.fingerprint = "0".repeat(64);
        await overwriteFixtureText(target, routePath, `${JSON.stringify(route, null, 2)}\n`);
      },
    },
    {
      name: "routed route bound to another contract",
      phase: "ROUTED",
      mutate: async ({ target }) => {
        const routePath = path.join(target, taskArtifactPath(taskId, "route"));
        const route = JSON.parse(await readRawFixtureText(target, routePath));
        route.contractFingerprint = "f".repeat(64);
        await overwriteFixtureText(target, routePath, `${JSON.stringify(route, null, 2)}\n`);
      },
    },
  ];

  for (const testCase of cases) {
    const fixtureResult = await fixture({ phase: testCase.phase });
    try {
      await testCase.mutate(fixtureResult);
      await assert.rejects(
        runTaskMigrateContractBootstrapRepair({
          target: fixtureResult.target,
          packageRoot,
          taskId,
          acknowledgeMigration: true,
        }),
        (error) => error.code === "E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID",
        testCase.name,
      );
    } finally {
      await removeTempTree(fixtureResult.target);
    }
  }
});

test("strict migration pairing rejects duplicate and misbound migration events", async () => {
  const fixtureResult = await fixture();
  try {
    await runTaskMigrateContractBootstrapRepair({ target: fixtureResult.target, packageRoot, taskId, acknowledgeMigration: true });
    const events = await readEvents(fixtureResult.target, packageRoot, { taskId });
    const migration = events.find((event) => event.event === "CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_RECORDED");
    await appendTransaction(fixtureResult.target, "test-duplicate-migration", migration.event, migration.details);
    const duplicateLedger = await validateEventLedger(fixtureResult.target, packageRoot, { taskId });
    assert.equal(duplicateLedger.valid, false);
    assert.match(duplicateLedger.errors.map((error) => error.message).join("\n"), /duplicate migration/);

    const second = await fixture();
    try {
      await runTaskMigrateContractBootstrapRepair({ target: second.target, packageRoot, taskId, acknowledgeMigration: true });
      const secondEvents = await readEvents(second.target, packageRoot, { taskId });
      const secondMigration = secondEvents.find((event) => event.event === "CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_RECORDED");
      secondMigration.details.legacyMarkerSeq += 1;
      rewriteEventChain(secondEvents);
      await overwriteFixtureText(second.target, second.eventsPath, `${secondEvents.map((event) => JSON.stringify(event)).join("\n")}\n`);
      const misboundLedger = await validateEventLedger(second.target, packageRoot, { taskId });
      assert.equal(misboundLedger.valid, false);
    } finally {
      await removeTempTree(second.target);
    }
  } finally {
    await removeTempTree(fixtureResult.target);
  }
});

test("migration semantic fields remain bound even when the tampered chain is rehashed", async () => {
  const cases = [
    ["legacyRepairTransactionId", "different-repair-transaction"],
    ["contractFingerprint", "f".repeat(64)],
    ["reconstructedPhase", "CONTRACT_READY"],
    ["routeFingerprint", "e".repeat(64)],
    ["reconstructedStateFingerprint", "d".repeat(64)],
  ];
  for (const [field, value] of cases) {
    const fixtureResult = await fixture({ phase: "ROUTED" });
    try {
      await runTaskMigrateContractBootstrapRepair({ target: fixtureResult.target, packageRoot, taskId, acknowledgeMigration: true });
      const events = await readEvents(fixtureResult.target, packageRoot, { taskId });
      const migration = events.find((event) => event.event === "CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_RECORDED");
      migration.details[field] = value;
      rewriteEventChain(events);
      await overwriteFixtureText(fixtureResult.target, fixtureResult.eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);

      const ledger = await validateEventLedger(fixtureResult.target, packageRoot, { taskId });
      assert.equal(ledger.valid, false, field);
      assert.match(ledger.errors.map((error) => error.code).join("\n"), /E_LEDGER_HASH_INVALID|E_EVENT_INVALID/, field);
      assert.equal(resolveEffectiveContractBootstrapRepairAnchor(ledger.events), null, field);
    } finally {
      await removeTempTree(fixtureResult.target);
    }
  }
});

test("already-migrated invocation remains idempotent after canonical lifecycle progression", async () => {
  const fixtureResult = await fixture();
  try {
    const migrated = await runTaskMigrateContractBootstrapRepair({ target: fixtureResult.target, packageRoot, taskId, acknowledgeMigration: true });
    assert.equal(migrated.migrated, true);
    await runPreflight({ target: fixtureResult.target, packageRoot, taskId });
    await runAdvance({ target: fixtureResult.target, packageRoot, taskId, to: "DESIGNING" });
    await runAdvance({ target: fixtureResult.target, packageRoot, taskId, to: "PLANNED" });

    const stateBefore = await readRawFixtureText(fixtureResult.target, path.join(fixtureResult.target, taskArtifactPath(taskId, "state")));
    const routeBefore = await readRawFixtureText(fixtureResult.target, path.join(fixtureResult.target, taskArtifactPath(taskId, "route")));
    const contractBefore = await readRawFixtureText(fixtureResult.target, path.join(fixtureResult.target, taskArtifactPath(taskId, "contract")));
    const eventsBefore = await readRawFixtureText(fixtureResult.target, fixtureResult.eventsPath);
    const second = await runTaskMigrateContractBootstrapRepair({ target: fixtureResult.target, packageRoot, taskId, acknowledgeMigration: true });
    assert.equal(second.migrated, false);
    assert.equal(second.alreadyMigrated, true);
    assert.equal(await readRawFixtureText(fixtureResult.target, path.join(fixtureResult.target, taskArtifactPath(taskId, "state"))), stateBefore);
    assert.equal(await readRawFixtureText(fixtureResult.target, path.join(fixtureResult.target, taskArtifactPath(taskId, "route"))), routeBefore);
    assert.equal(await readRawFixtureText(fixtureResult.target, path.join(fixtureResult.target, taskArtifactPath(taskId, "contract"))), contractBefore);
    assert.equal(await readRawFixtureText(fixtureResult.target, fixtureResult.eventsPath), eventsBefore);

    const ownership = await resolveTaskClaimState(fixtureResult.target, { taskId, packageRoot });
    assert.equal(ownership.claimState, "ACTIVE");
    assert.equal(ownership.ownershipValid, true);
    const repairRerun = await runTaskRepairContractBootstrap({ target: fixtureResult.target, packageRoot, taskId, acknowledgeRepair: true });
    assert.equal(repairRerun.alreadyRepaired, true);
  } finally {
    await removeTempTree(fixtureResult.target);
  }
});

test("next migration guidance executes through parser and COMMAND_EXECUTORS", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-bootstrap-migration-command-spec-"));
  const fixtureResult = { target };
  try {
    await withProjectStorage(target, () => fixture({ target }));
    await withProjectStorage(target, async () => {
      const historical = await readEvents(target, packageRoot, { taskId });
      const nextBefore = await getNextAction({ target: fixtureResult.target, packageRoot, taskId });
      assert.equal(nextBefore.nextAction, NEXT_ACTIONS.MIGRATE_CONTRACT_BOOTSTRAP_REPAIR);
      const spec = nextBefore.commandSpecs.find((candidate) => candidate.commandId === "task-migrate-contract-bootstrap-repair");
      assert.ok(spec);
      assert.ok(spec.argv.includes(`--task=${taskId}`));
      assert.ok(spec.argv.includes("--json"));
      assert.ok(spec.requiredInputs.some((input) => input.option === "--acknowledge-migration"));
      assert.equal(typeof COMMAND_EXECUTORS[spec.commandId], "function");

      const parsed = parseArgs([
        ...spec.argv,
        ...spec.requiredInputs.map((input) => input.option),
      ]);
      const execution = await COMMAND_EXECUTORS[spec.commandId]({
        target: fixtureResult.target,
        packageRoot,
        options: parsed.options,
    });
    assert.equal(execution.exitCode, 0);
    assert.equal(execution.result.migrated, true);
    assert.equal(execution.result.alreadyMigrated, false);

    const nextAfter = await getNextAction({ target: fixtureResult.target, packageRoot, taskId });
    assert.notEqual(nextAfter.nextAction, NEXT_ACTIONS.MIGRATE_CONTRACT_BOOTSTRAP_REPAIR);
    const ledger = await validateEventLedger(fixtureResult.target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);
    const ownership = await resolveTaskClaimState(fixtureResult.target, { taskId, packageRoot });
    assert.equal(ownership.claimState, "ACTIVE");
    assert.equal(ownership.ownershipValid, true);
    assert.equal(ownership.mutationAllowed, true);
    assert.deepEqual((await readEvents(target, packageRoot, { taskId })).slice(0, historical.length), historical);
    });
    await access(path.join(target, ".forgeloop/state.sqlite"));
    await assert.rejects(access(path.join(target, ".forgeloop/task-state")), { code: "ENOENT" });
  } finally {
    await removeTempTree(fixtureResult.target);
  }
});

test("migration CLI input requires task and acknowledgement and has no revision bypass", () => {
  assert.throws(
    () => parseArgs(["task-migrate-contract-bootstrap-repair", "--acknowledge-migration"]),
    /requires --task/,
  );
  assert.throws(
    () => parseArgs(["task-migrate-contract-bootstrap-repair", "--task", taskId]),
    /requires --acknowledge-migration/,
  );
  assert.throws(
    () => parseArgs(["task-migrate-contract-bootstrap-repair", "--task", taskId, "--acknowledge-migration", "--reconstructed-state-revision", "9"]),
    /Unknown option|not valid/,
  );
});

test("migration refuses live and corrupt task locks", async () => {
  const liveFixture = await fixture();
  try {
    const lock = await acquireTaskLock(liveFixture.target, taskId, "migration-lock-test");
    try {
      await assert.rejects(
        runTaskMigrateContractBootstrapRepair({ target: liveFixture.target, packageRoot, taskId, acknowledgeMigration: true }),
        (error) => error.code === "E_TASK_LOCKED",
      );
    } finally {
      await lock.release();
    }
  } finally {
    await removeTempTree(liveFixture.target);
  }

  const corruptFixture = await fixture();
  try {
    await overwriteFixtureLease(corruptFixture.target, taskId, "{}\n");
    await assert.rejects(
      runTaskMigrateContractBootstrapRepair({ target: corruptFixture.target, packageRoot, taskId, acknowledgeMigration: true }),
      (error) => error.code === "E_CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_INVALID",
    );
  } finally {
    await removeTempTree(corruptFixture.target);
  }
});
