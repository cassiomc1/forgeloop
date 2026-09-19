import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runCheckpointRevalidate } from "../src/commands/checkpoint-revalidate.js";
import { runPreflight } from "../src/commands/preflight.js";
import { runTaskMigrateContractBootstrapRepair } from "../src/commands/task-migrate-contract-bootstrap-repair.js";
import { runTaskRepairContractBootstrap } from "../src/commands/task-repair-contract-bootstrap.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import {
  appendProtocolEvent,
  eventHash,
  readEvents,
  validateEventLedger,
  validateStateLedgerCoherence,
} from "../src/core/events.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { getNextAction, NEXT_ACTIONS } from "../src/core/next-action.js";
import { evaluateRoute } from "../src/core/router.js";
import { writeJsonArtifact } from "../src/core/artifacts.js";
import { sha256 } from "../src/core/manifest.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";
import { withTaskTransaction } from "../src/core/transaction.js";
import { legacyContractBootstrapRepairId } from "../src/core/contract-bootstrap-recovery.js";
import { resolveTaskClaimState } from "../src/core/task-claim-state.js";
import { createWorkState, readWorkState, writeWorkState } from "../src/core/work-state.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const execFileAsync = promisify(execFile);
const packageRoot = getPackageRoot();

async function git(target, args) {
  await execFileAsync("git", ["-C", target, ...args]);
}

async function appendTransaction(target, taskId, operation, event, details = undefined, fingerprint = undefined) {
  await withTaskTransaction({ target, taskId, operation, packageRoot, recordCommitEvent: true }, async () => {
    await appendProtocolEvent(target, {
      taskId,
      event,
      ...(details ? { details } : {}),
      ...(fingerprint ? { fingerprint } : {}),
    }, packageRoot, { taskId });
  });
}

async function rewriteEvents(target, taskId, transform) {
  const eventsPath = path.join(target, taskArtifactPath(taskId, "events"));
  const events = (await readEvents(target, packageRoot, { taskId })).map((event) => structuredClone(event));
  const transformed = transform(events) ?? events;
  for (let index = 0; index < transformed.length; index += 1) {
    transformed[index].seq = index + 1;
    transformed[index].previousHash = index === 0 ? null : transformed[index - 1].hash;
    transformed[index].hash = eventHash(transformed[index]);
  }
  await writeFile(eventsPath, `${transformed.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

async function commitChange(target, fileName, contents, message) {
  await writeFile(path.join(target, fileName), contents);
  await git(target, ["add", fileName]);
  await git(target, ["commit", "-qm", message]);
}

async function fixture({ repositoryFingerprint = { branch: "old-branch", head: "0".repeat(40) } } = {}) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-checkpoint-revalidate-"));
  const taskId = "checkpoint-revalidation-fixture";
  await git(target, ["init", "-q", "-b", "main"]);
  await git(target, ["config", "user.email", "test@example.invalid"]);
  await git(target, ["config", "user.name", "ForgeLoop Test"]);
  await writeFile(path.join(target, "tracked.txt"), "fixture\n");
  await git(target, ["add", "tracked.txt"]);
  await git(target, ["commit", "-qm", "fixture"]);

  const contract = createContract({
    taskId,
    objective: "Revalidate a safe pre-execution checkpoint",
    deliverables: ["src/example.js"],
    constraints: ["preserve identity"],
    risks: [],
    verification: ["focused tests"],
    successCriteria: ["checkpoint is rebound exactly once"],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  await writeTaskDescriptor(target, createTaskDescriptor({ taskId, writeClaims: [] }), packageRoot);
  await writeContract(target, contract, packageRoot, { taskId });
  await appendTransaction(target, taskId, "task-create", "TASK_RECEIVED", { createdAt: new Date().toISOString() });
  await appendTransaction(target, taskId, "discover", "DISCOVERY_STARTED", { source: "test" });
  await appendTransaction(target, taskId, "contract-create", "CONTRACT_VALIDATED", { contractFingerprint: contractHash });
  const route = evaluateRoute({ workType: "code", surfaces: ["config"], executableChange: true });
  const routeArtifact = await writeJsonArtifact(
    target,
    taskArtifactPath(taskId, "route"),
    { ...route, contractFingerprint: contractHash },
    "routing-result",
    packageRoot,
    { taskId },
  );
  await appendTransaction(target, taskId, "route", "ROUTE_VALIDATED", undefined, routeArtifact.fingerprint);
  await writeWorkState(target, createWorkState({
    taskId,
    contractFingerprint: contractHash,
    routeFingerprint: routeArtifact.fingerprint,
    repositoryFingerprint,
    phase: "ROUTED",
    selectedGuides: [...routeArtifact.value.guides],
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: ["contract", "route"],
    pendingSteps: ["planning", "implementation", "verification"],
    requiredArtifacts: [],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
  }), { packageRoot, taskId });
  return { target, taskId, contractHash, routeFingerprint: routeArtifact.fingerprint };
}

test("next exposes and the real executor revalidates repository-only ROUTED drift", async () => {
  const { target, taskId, contractHash, routeFingerprint } = await fixture();
  try {
    const before = await getNextAction({ target, packageRoot, taskId });
    assert.equal(before.nextAction, NEXT_ACTIONS.REVALIDATE_CHECKPOINT);
    assert.equal(before.commandSpecs[0].commandId, "checkpoint-revalidate");

    const execution = await executeForgeLoopCommand({
      projectPath: target,
      command: "checkpoint-revalidate",
      input: { taskId },
    });
    assert.equal(execution.ok, true);
    assert.equal(execution.exitCode, 0);
    assert.equal(execution.result.revalidated, true);

    const state = await readWorkState(target, { packageRoot, taskId });
    assert.equal(state.phase, "ROUTED");
    assert.equal(state.revision, 1);
    assert.equal(state.contractFingerprint, contractHash);
    assert.equal(state.routeFingerprint, routeFingerprint);
    const after = await getNextAction({ target, packageRoot, taskId });
    assert.notEqual(after.nextAction, NEXT_ACTIONS.REVALIDATE_CHECKPOINT);
    assert.notEqual(after.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);
    const revalidation = ledger.events.find((event) => event.event === "CHECKPOINT_REVALIDATED");
    assert.ok(revalidation);
    assert.equal(revalidation.details.revalidatedStateRevision, 1);
    assert.equal(ledger.events.at(-1).details.operation, "checkpoint-revalidate");
  } finally {
    await removeTempTree(target);
  }
});

test("checkpoint revalidation is idempotent and does not append an empty transaction", async () => {
  const { target, taskId } = await fixture();
  try {
    await runCheckpointRevalidate({ target, packageRoot, taskId });
    const beforeEvents = await readFile(path.join(target, taskArtifactPath(taskId, "events")), "utf8");
    const beforeState = await readWorkState(target, { packageRoot, taskId });
    const second = await runCheckpointRevalidate({ target, packageRoot, taskId });
    assert.equal(second.revalidated, false);
    assert.equal(second.alreadyFresh, true);
    assert.equal(await readFile(path.join(target, taskArtifactPath(taskId, "events")), "utf8"), beforeEvents);
    const afterState = await readWorkState(target, { packageRoot, taskId });
    assert.equal(afterState.revision, beforeState.revision);
  } finally {
    await removeTempTree(target);
  }
});

test("concurrent revalidation commits one transition and makes the loser a no-op", async () => {
  const { target, taskId } = await fixture();
  try {
    const results = await Promise.all([
      runCheckpointRevalidate({ target, packageRoot, taskId }),
      runCheckpointRevalidate({ target, packageRoot, taskId }),
    ]);
    assert.deepEqual(results.map((result) => result.revalidated).sort(), [false, true]);
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);
    assert.equal(ledger.events.filter((event) => event.event === "CHECKPOINT_REVALIDATED").length, 1);
    assert.equal(ledger.events.filter((event) => event.event === "TRANSACTION_COMMITTED"
      && event.details.operation === "checkpoint-revalidate").length, 1);
  } finally {
    await removeTempTree(target);
  }
});

test("checkpoint revalidation fails closed for route and contract identity drift", async () => {
  const routeFixture = await fixture();
  try {
    const routePath = path.join(routeFixture.target, taskArtifactPath(routeFixture.taskId, "route"));
    const route = JSON.parse(await readFile(routePath, "utf8"));
    route.guides = ["clean"];
    await writeFile(routePath, `${JSON.stringify(route, null, 2)}\n`);
    await assert.rejects(
      runCheckpointRevalidate({ target: routeFixture.target, packageRoot, taskId: routeFixture.taskId }),
      (error) => error.code === "E_CHECKPOINT_REVALIDATION_UNSAFE",
    );
  } finally {
    await removeTempTree(routeFixture.target);
  }

  const contractFixture = await fixture();
  try {
    const contractPath = path.join(contractFixture.target, taskArtifactPath(contractFixture.taskId, "contract"));
    const contract = JSON.parse(await readFile(contractPath, "utf8"));
    contract.objective = "different identity";
    await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
    await assert.rejects(
      runCheckpointRevalidate({ target: contractFixture.target, packageRoot, taskId: contractFixture.taskId }),
      (error) => error.code === "E_CHECKPOINT_REVALIDATION_UNSAFE",
    );
  } finally {
    await removeTempTree(contractFixture.target);
  }
});

test("rehashing a semantically altered revalidation event remains invalid", async () => {
  const { target, taskId } = await fixture();
  try {
    await runCheckpointRevalidate({ target, packageRoot, taskId });
    const eventsPath = path.join(target, taskArtifactPath(taskId, "events"));
    const events = (await readEvents(target, packageRoot, { taskId })).map((event) => structuredClone(event));
    const index = events.findIndex((event) => event.event === "CHECKPOINT_REVALIDATED");
    events[index].details.revalidatedStateFingerprint = "0".repeat(64);
    for (let cursor = index; cursor < events.length; cursor += 1) {
      events[cursor].previousHash = cursor === 0 ? null : events[cursor - 1].hash;
      events[cursor].hash = eventHash(events[cursor]);
    }
    await writeFile(eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    const state = await readWorkState(target, { packageRoot, taskId });
    const coherence = validateStateLedgerCoherence(state, ledger.events);
    assert.ok(coherence.some((error) => error.code === "E_CHECKPOINT_REVALIDATION_UNSAFE"));
  } finally {
    await removeTempTree(target);
  }
});

test("each checkpoint revalidation has an adjacent canonical transaction witness", async () => {
  for (const mutation of [
    (events, index) => events.splice(index + 1, 1),
    (events, index) => { events[index + 1].details.operation = "other-operation"; },
    (events, index) => {
      events.splice(index + 1, 0, {
        ...events[index + 1],
        details: { transactionId: "txn-unrelated", operation: "other-operation" },
      });
    },
    (events, index) => { events[index + 1].taskId = "different-task"; },
  ]) {
    const { target, taskId } = await fixture();
    try {
      await runCheckpointRevalidate({ target, packageRoot, taskId });
      await rewriteEvents(target, taskId, (events) => {
        const index = events.findIndex((event) => event.event === "CHECKPOINT_REVALIDATED");
        mutation(events, index);
      });
      const ledger = await validateEventLedger(target, packageRoot, { taskId });
      assert.equal(ledger.valid, false);
      assert.ok(ledger.errors.some((error) => error.code === "E_CHECKPOINT_REVALIDATION_UNSAFE"));
    } finally {
      await removeTempTree(target);
    }
  }
});

test("multiple repository-only revalidations preserve repository and revision continuity", async () => {
  const { target, taskId } = await fixture();
  try {
    const first = await runCheckpointRevalidate({ target, packageRoot, taskId });
    await runPreflight({ target, packageRoot, taskId });
    await commitChange(target, "tracked.txt", "second\n", "second repository checkpoint");
    const beforeSecond = await getNextAction({ target, packageRoot, taskId });
    assert.equal(beforeSecond.nextAction, NEXT_ACTIONS.REVALIDATE_CHECKPOINT);
    const second = await runCheckpointRevalidate({ target, packageRoot, taskId });
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    const revalidations = ledger.events.filter((event) => event.event === "CHECKPOINT_REVALIDATED");
    assert.equal(ledger.valid, true);
    assert.equal(revalidations.length, 2);
    assert.equal(ledger.events.filter((event) => event.event === "TRANSACTION_COMMITTED"
      && event.details.operation === "checkpoint-revalidate").length, 2);
    assert.ok(second.previousRevision >= first.revalidatedRevision);
    assert.deepEqual(revalidations[1].details.previousRepositoryFingerprint, revalidations[0].details.repositoryFingerprint);
    assert.notDeepEqual(revalidations[1].details.repositoryFingerprint, revalidations[0].details.repositoryFingerprint);
    assert.notEqual((await getNextAction({ target, packageRoot, taskId })).nextAction, NEXT_ACTIONS.REVALIDATE_CHECKPOINT);
  } finally {
    await removeTempTree(target);
  }
});

test("a migrated repair anchor survives two later checkpoint revalidations", async () => {
  const { target, taskId } = await fixture();
  try {
    await appendTransaction(target, taskId, "contract-create", "CONTRACT_VALIDATED", {
      contractFingerprint: (await readWorkState(target, { packageRoot, taskId })).contractFingerprint,
    });
    await runTaskRepairContractBootstrap({ target, packageRoot, taskId, acknowledgeRepair: true });
    const events = await readEvents(target, packageRoot, { taskId });
    const marker = events.find((event) => event.event === "CONTRACT_BOOTSTRAP_REPAIR_RECORDED");
    delete marker.details.reconstructedStateRevision;
    marker.details.repairId = legacyContractBootstrapRepairId(marker.details);
    let previousHash = null;
    for (let index = 0; index < events.length; index += 1) {
      events[index].seq = index + 1;
      events[index].previousHash = previousHash;
      events[index].hash = eventHash(events[index]);
      previousHash = events[index].hash;
    }
    await writeFile(path.join(target, taskArtifactPath(taskId, "events")), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    await runTaskMigrateContractBootstrapRepair({ target, packageRoot, taskId, acknowledgeMigration: true });
    await commitChange(target, "tracked.txt", "repaired-first-drift\n", "repaired checkpoint drift");
    await runCheckpointRevalidate({ target, packageRoot, taskId });
    await runPreflight({ target, packageRoot, taskId });
    await commitChange(target, "tracked.txt", "repaired-second-drift\n", "repaired second checkpoint drift");
    await runCheckpointRevalidate({ target, packageRoot, taskId });
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    const claim = await resolveTaskClaimState(target, { packageRoot, taskId });
    assert.equal(ledger.valid, true);
    assert.equal(ledger.events.filter((event) => event.event === "CHECKPOINT_REVALIDATED").length, 2);
    assert.equal(ledger.events.filter((event) => event.event === "CONTRACT_BOOTSTRAP_REPAIR_RECORDED").length, 1);
    assert.equal(ledger.events.filter((event) => event.event === "CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_RECORDED").length, 1);
    assert.equal(claim.claimState, "ACTIVE");
    assert.equal(claim.ownershipValid, true);
    assert.equal(claim.mutationAllowed, true);
  } finally {
    await removeTempTree(target);
  }
});

test("a second revalidation without an intermediate mutation preserves the exact prior state fingerprint", async () => {
  const { target, taskId } = await fixture();
  try {
    await runCheckpointRevalidate({ target, packageRoot, taskId });
    await commitChange(target, "tracked.txt", "second\n", "second repository checkpoint");
    await runCheckpointRevalidate({ target, packageRoot, taskId });
    const revalidations = (await readEvents(target, packageRoot, { taskId }))
      .filter((event) => event.event === "CHECKPOINT_REVALIDATED");
    assert.equal(revalidations[1].details.previousStateRevision, revalidations[0].details.revalidatedStateRevision);
    assert.equal(revalidations[1].details.previousStateFingerprint, revalidations[0].details.revalidatedStateFingerprint);
  } finally {
    await removeTempTree(target);
  }
});

test("a revalidation revision rollback remains invalid after hash-chain repair", async () => {
  const { target, taskId } = await fixture();
  try {
    await runCheckpointRevalidate({ target, packageRoot, taskId });
    await commitChange(target, "tracked.txt", "second\n", "second repository checkpoint");
    await runCheckpointRevalidate({ target, packageRoot, taskId });
    await rewriteEvents(target, taskId, (events) => {
      const indexes = events
        .map((event, eventIndex) => event.event === "CHECKPOINT_REVALIDATED" ? eventIndex : -1)
        .filter((eventIndex) => eventIndex >= 0);
      const index = indexes.at(-1);
      events[index].details.previousStateRevision = 0;
      events[index].details.revalidatedStateRevision = 1;
    });
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, false);
    assert.ok(ledger.errors.some((error) => error.code === "E_CHECKPOINT_REVALIDATION_UNSAFE"));
  } finally {
    await removeTempTree(target);
  }
});

test("historical identity tampering remains visible after later checkpoint progression", async () => {
  const { target, taskId } = await fixture();
  try {
    await runCheckpointRevalidate({ target, packageRoot, taskId });
    await runPreflight({ target, packageRoot, taskId });
    await commitChange(target, "tracked.txt", "second\n", "second repository checkpoint");
    await runCheckpointRevalidate({ target, packageRoot, taskId });
    await rewriteEvents(target, taskId, (events) => {
      const index = events.findIndex((event) => event.event === "CHECKPOINT_REVALIDATED");
      events[index].details.routeFingerprint = "0".repeat(64);
    });
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    const state = await readWorkState(target, { packageRoot, taskId });
    assert.equal(ledger.valid, false);
    assert.ok(validateStateLedgerCoherence(state, ledger.events)
      .some((error) => error.code === "E_CHECKPOINT_REVALIDATION_UNSAFE"));
  } finally {
    await removeTempTree(target);
  }
});

test("required-artifact drift, execution start, and invalid ownership never downgrade to revalidation", async () => {
  const artifactFixture = await fixture();
  try {
    const artifactPath = path.join(artifactFixture.target, "required.txt");
    const contents = "required\n";
    await writeFile(artifactPath, contents);
    const state = await readWorkState(artifactFixture.target, { packageRoot, taskId: artifactFixture.taskId });
    await writeWorkState(artifactFixture.target, createWorkState({
      ...state,
      requiredArtifacts: [{ path: "required.txt", sha256: sha256(Buffer.from(contents)) }],
    }), { packageRoot, taskId: artifactFixture.taskId });
    await writeFile(artifactPath, "changed\n");
    const next = await getNextAction({ target: artifactFixture.target, packageRoot, taskId: artifactFixture.taskId });
    assert.notEqual(next.nextAction, NEXT_ACTIONS.REVALIDATE_CHECKPOINT);
    await assert.rejects(
      runCheckpointRevalidate({ target: artifactFixture.target, packageRoot, taskId: artifactFixture.taskId }),
      (error) => error.code === "E_CHECKPOINT_REVALIDATION_UNSAFE",
    );
    await rm(artifactPath);
    const missing = await getNextAction({ target: artifactFixture.target, packageRoot, taskId: artifactFixture.taskId });
    assert.notEqual(missing.nextAction, NEXT_ACTIONS.REVALIDATE_CHECKPOINT);
    await assert.rejects(
      runCheckpointRevalidate({ target: artifactFixture.target, packageRoot, taskId: artifactFixture.taskId }),
      (error) => error.code === "E_CHECKPOINT_REVALIDATION_UNSAFE",
    );
  } finally {
    await removeTempTree(artifactFixture.target);
  }

  const executionFixture = await fixture();
  try {
    await runPreflight({ target: executionFixture.target, packageRoot, taskId: executionFixture.taskId });
    await appendTransaction(executionFixture.target, executionFixture.taskId, "execute", "EXECUTION_STARTED", {
      executionId: "execution-checkpoint-test",
    });
    const next = await getNextAction({ target: executionFixture.target, packageRoot, taskId: executionFixture.taskId });
    assert.notEqual(next.nextAction, NEXT_ACTIONS.REVALIDATE_CHECKPOINT);
    await assert.rejects(
      runCheckpointRevalidate({ target: executionFixture.target, packageRoot, taskId: executionFixture.taskId }),
      (error) => error.code === "E_CHECKPOINT_REVALIDATION_UNSAFE",
    );
  } finally {
    await removeTempTree(executionFixture.target);
  }

  const ownershipFixture = await fixture();
  try {
    const descriptorPath = path.join(ownershipFixture.target, taskArtifactPath(ownershipFixture.taskId, "descriptor"));
    const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
    descriptor.writeClaims = ["../outside"];
    await writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
    await assert.rejects(
      runCheckpointRevalidate({ target: ownershipFixture.target, packageRoot, taskId: ownershipFixture.taskId }),
      (error) => error.code === "E_CHECKPOINT_REVALIDATION_UNSAFE",
    );
  } finally {
    await removeTempTree(ownershipFixture.target);
  }
});
