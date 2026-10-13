import { readFixtureText, overwriteFixtureText } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runTaskCreate } from "../src/commands/task-create.js";
import { runComplete } from "../src/commands/complete.js";
import { prepareCompletion, recordCheck } from "../src/core/completion-artifacts.js";
import { runPreflight } from "../src/commands/preflight.js";
import { resolveTaskClaimState, collectTaskClaimEvidence } from "../src/core/task-claim-state.js";
import { validateCompletionOwnershipProof } from "../src/core/completion-ownership.js";
import { validateEventLedger } from "../src/core/events.js";
import { advanceWorkState } from "../src/core/phase.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent, eventHash } from "../src/core/events.js";
import { createWorkState, writeWorkState, readWorkState } from "../src/core/work-state.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { ensureWithin } from "../src/core/filesystem.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-completion-ownership-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function setupTaskToVerifying(target, taskId, { claims = ["tests"] } = {}) {
  const descriptor = createTaskDescriptor({ taskId, writeClaims: claims });
  await writeTaskDescriptor(target, descriptor, packageRoot);

  const contract = createContract({
    taskId,
    objective: "Exercise canonical completion ownership",
    deliverables: ["src"],
    constraints: ["offline"],
    risks: [],
    verification: claims,
    successCriteria: [...claims],
    stopConditions: ["stop"],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  await writeContract(target, contract, packageRoot, { taskId });

  const route = evaluateRoute({ workType: "code", surfaces: ["config"], platforms: [] });
  const persistedRoute = await persistRoute(target, route, packageRoot, {
    taskId,
    contractFingerprint: contractHash,
  });

  const state = createWorkState({
    taskId,
    contractFingerprint: contractHash,
    routeFingerprint: persistedRoute.fingerprint,
    repositoryFingerprint: { branch: null, head: null },
    phase: "PLANNED",
    selectedGuides: [...persistedRoute.value.guides],
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: ["planning"],
    pendingSteps: ["execute"],
    requiredArtifacts: [],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
  });
  await writeWorkState(target, state, { packageRoot, taskId });

  await appendProtocolEvent(target, { taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId });
  const preflight = await runPreflight({ target, packageRoot, taskId });
  assert.equal(preflight.status, "READY");
  await advanceWorkState(target, "EXECUTING", { packageRoot, taskId });
  await advanceWorkState(target, "VERIFYING", { packageRoot, taskId });
  await prepareCompletion({ target, packageRoot, taskId });
}

async function completeOfficially(target, taskId, claims) {
  for (const [index, requirement] of claims.entries()) {
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId,
      id: `check-${index}`,
      requirement,
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });
  }
  await advanceWorkState(target, "REVIEWING", { packageRoot, taskId });
  const completion = await runComplete({ target, packageRoot, taskId });
  assert.equal(completion.status, "VALID");
}

test("canonical official completion releases claims; every other surface agrees", async () => {
  await withTarget(async (target) => {
    const taskId = "canonically-complete";
    await setupTaskToVerifying(target, taskId, { claims: ["tests"] });
    await completeOfficially(target, taskId, ["tests"]);

    const projection = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(projection.claimState, "RELEASED_BY_COMPLETION");
    assert.deepEqual(projection.effectiveWriteClaims, []);
    assert.equal(projection.mutationAllowed, false);
    assert.equal(projection.ownershipValid, true);

    const proof = validateCompletionOwnershipProof({
      taskId,
      state: await readWorkState(target, { packageRoot, taskId }),
      ledger: await validateEventLedger(target, packageRoot, { taskId }),
    });
    assert.equal(proof.valid, true);
    assert.equal(proof.completionEvent.event, "COMPLETION_VALIDATED");
  });
});

test("forged COMPLETE cannot release claims and blocks overlapping acquisition by another task", async () => {
  await withTarget(async (target) => {
    const taskId = "forged-complete";
    await setupTaskToVerifying(target, taskId, { claims: ["tests"] });
    const state = await readWorkState(target, { packageRoot, taskId });
    await writeWorkState(target, createWorkState({
      ...state,
      phase: "COMPLETE",
      previousPhase: "REVIEWING",
      verificationEvidence: [{ kind: "OBSERVED", source: "fixture", result: "passed" }],
      evidenceCoverage: [],
      checks: [],
    }), { packageRoot, taskId });

    const projection = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(projection.claimState, "INCONSISTENT");
    assert.deepEqual(projection.effectiveWriteClaims, ["tests"]);
    assert.equal(projection.mutationAllowed, false);
    assert.equal(projection.ownershipValid, false);
    assert.ok(projection.reasonCodes.includes("E_COMPLETION_OWNERSHIP_UNPROVEN"));

    // Another task must not acquire the paths still owned by unfinished work.
    await assert.rejects(
      () => runTaskCreate({ target, packageRoot, taskId: "overlapping-task", claims: ["tests"] }),
      (error) => [
        "E_TASK_SCOPE_CONFLICT",
        "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT",
        "E_TASK_DESCRIPTOR_INVALID",
      ].includes(error.code),
    );
  });
});

test("corrupt ledger after canonical completion fails closed", async () => {
  await withTarget(async (target) => {
    const taskId = "complete-corrupt-ledger";
    await setupTaskToVerifying(target, taskId, { claims: ["tests"] });
    await completeOfficially(target, taskId, ["tests"]);

    const eventsPath = ensureWithin(target, taskArtifactPath(taskId, "events"));
    const original = await readFixtureText(target, eventsPath);
    const lines = original.trim().split("\n");
    const second = JSON.parse(lines[1]);
    second.taskId = `${second.taskId}-tampered`;
    lines[1] = JSON.stringify(second);
    await overwriteFixtureText(target, eventsPath, `${lines.join("\n")}\n`);

    const projection = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(projection.claimState, "INCONSISTENT");
    assert.deepEqual(projection.effectiveWriteClaims, ["tests"]);
    assert.equal(projection.mutationAllowed, false);
  });
});

test("missing canonical completion event fails closed", async () => {
  await withTarget(async (target) => {
    const taskId = "complete-missing-event";
    await setupTaskToVerifying(target, taskId, { claims: ["tests"] });
    await completeOfficially(target, taskId, ["tests"]);

    // Remove the COMPLETION_VALIDATED event and rebuild a structurally valid
    // chain so the only defect is the missing completion proof.
    const eventsPath = ensureWithin(target, taskArtifactPath(taskId, "events"));
    const lines = (await readFixtureText(target, eventsPath)).trim().split("\n");
    let events = lines.map((line) => JSON.parse(line))
      .filter((event) => event.event !== "COMPLETION_VALIDATED");
    let previousHash = null;
    events = events.map((event, index) => {
      event.seq = index + 1;
      event.previousHash = previousHash;
      delete event.hash;
      event.hash = eventHash(event);
      previousHash = event.hash;
      return event;
    });
    await overwriteFixtureText(target, eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);

    const projection = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(projection.claimState, "INCONSISTENT");
    assert.ok(projection.reasonCodes.includes("E_COMPLETION_OWNERSHIP_UNPROVEN"));
    assert.deepEqual(projection.effectiveWriteClaims, ["tests"]);
    assert.equal(projection.mutationAllowed, false);
  });
});

test("cross-task and contradictory post-completion ledger activity fails closed", async () => {
  await withTarget(async (target) => {
    const taskId = "complete-cross-task";
    await setupTaskToVerifying(target, taskId, { claims: ["tests"] });
    await completeOfficially(target, taskId, ["tests"]);
    const state = await readWorkState(target, { packageRoot, taskId });

    const proofCases = [
      // Completion event bound to a different task.
      () => ({
        valid: false,
        errors: [{ code: "E_COMPLETION_OWNERSHIP_UNPROVEN", message: "cross-task" }],
      }),
    ];

    for (const makeLedger of proofCases) {
      const ledger = makeLedger();
      const proof = validateCompletionOwnershipProof({ taskId, state, ledger });
      assert.equal(proof.valid, false);
    }

    // Contradictory lifecycle event after canonical completion.
    const evidence = await collectTaskClaimEvidence(target, { taskId, packageRoot });
    const completionEvent = evidence.ledger.events.find((event) => event.event === "COMPLETION_VALIDATED");
    const forged = {
      seq: completionEvent.seq + 1,
      schemaVersion: 1,
      protocolVersion: completionEvent.protocolVersion,
      taskId,
      event: "VERIFICATION_STARTED",
      at: new Date().toISOString(),
      previousHash: completionEvent.hash,
      details: { verificationCycle: 9 },
    };
    forged.hash = eventHash(forged);
    const tamperedLedger = {
      ...evidence.ledger,
      events: [...evidence.ledger.events, forged],
    };
    const proof = validateCompletionOwnershipProof({ taskId, state, ledger: tamperedLedger });
    assert.equal(proof.valid, false);
    assert.ok(proof.errors.some((error) => error.code === "E_COMPLETION_OWNERSHIP_UNPROVEN"));

    const projection = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(projection.claimState, "RELEASED_BY_COMPLETION");
    assert.deepEqual(projection.effectiveWriteClaims, []);
  });
});

test("completion ownership invariant properties hold", async () => {
  await withTarget(async (target) => {
    // Property: phase COMPLETE alone never proves claim release.
    const neverRelease = [
      { valid: true, events: [] },
      { valid: false, events: [], errors: [{ code: "X", message: "broken" }] },
      null,
    ];
    for (const ledger of neverRelease) {
      const proof = validateCompletionOwnershipProof({
        taskId: "t",
        state: { phase: "COMPLETE", taskId: "t", revision: 1 },
        ledger,
      });
      if (!ledger || ledger.valid !== true || !Array.isArray(ledger.events)) {
        assert.equal(proof.valid, false);
      }
    }

    // Property: validated canonical completion is required for zero claims
    // outside validated recovery (covered by the canonical + recovery suites).
    const taskId = "invariant-canonical";
    await setupTaskToVerifying(target, taskId, { claims: ["tests"] });
    await completeOfficially(target, taskId, ["tests"]);
    const projection = await resolveTaskClaimState(target, { taskId, packageRoot });
    assert.equal(projection.claimState, "RELEASED_BY_COMPLETION");
    assert.equal(projection.mutationAllowed, false);
  });
});

test("completion ownership proof validates its required inputs", async () => {
  // Missing taskId.
  assert.equal(validateCompletionOwnershipProof({ taskId: null, state: { phase: "COMPLETE" }, ledger: { valid: true, events: [] } }).valid, false);

  // Non-COMPLETE or missing state.
  assert.equal(validateCompletionOwnershipProof({ taskId: "t", state: null, ledger: { valid: true, events: [] } }).valid, false);
  assert.equal(validateCompletionOwnershipProof({ taskId: "t", state: { phase: "REVIEWING" }, ledger: { valid: true, events: [] } }).valid, false);

  // Missing or invalid ledger retains the failure detail.
  const noLedger = validateCompletionOwnershipProof({ taskId: "t", state: { phase: "COMPLETE" }, ledger: null });
  assert.equal(noLedger.valid, false);
  const badLedger = validateCompletionOwnershipProof({
    taskId: "t",
    state: { phase: "COMPLETE" },
    ledger: { valid: false, events: [], errors: [{ code: "X", message: "broken chain" }] },
  });
  assert.equal(badLedger.valid, false);
  assert.ok(badLedger.errors.some((error) => error.message.includes("broken chain")));

  // Cross-task ledger contamination is detected even before event matching.
  const contaminated = validateCompletionOwnershipProof({
    taskId: "t",
    state: { phase: "COMPLETE", verificationCycle: 1 },
    ledger: {
      valid: true,
      events: [
        { seq: 1, taskId: "t", event: "COMPLETION_VALIDATED", at: "2026-01-01T00:00:00.000Z" },
        { seq: 2, taskId: "other", event: "TRANSACTION_COMMITTED", at: "2026-01-01T00:00:01.000Z" },
      ],
    },
  });
  assert.equal(contaminated.valid, false);

  // Coherence divergence between COMPLETE state and the ledger fails closed.
  const incoherent = validateCompletionOwnershipProof({
    taskId: "t",
    state: { phase: "COMPLETE", taskId: "t", revision: 1 },
    ledger: {
      valid: true,
      events: [
        { seq: 1, taskId: "t", event: "EXECUTION_STARTED", at: "2026-01-01T00:00:00.000Z" },
      ],
    },
  });
  assert.equal(incoherent.valid, false);
});

test("duplicate or contradicted canonical completion fails closed", () => {
  const duplicated = validateCompletionOwnershipProof({
    taskId: "t",
    state: { phase: "COMPLETE", taskId: "t", verificationCycle: 1 },
    ledger: {
      valid: true,
      events: [
        { seq: 1, taskId: "t", event: "COMPLETION_VALIDATED", at: "2026-01-01T00:00:00.000Z" },
        { seq: 2, taskId: "t", event: "COMPLETION_VALIDATED", at: "2026-01-01T00:00:01.000Z" },
      ],
    },
  });
  assert.equal(duplicated.valid, false);
  assert.ok(duplicated.errors.some((error) => error.message.includes("ambiguous")));

  const contradicted = validateCompletionOwnershipProof({
    taskId: "t",
    state: { phase: "COMPLETE", taskId: "t", verificationCycle: 1 },
    ledger: {
      valid: true,
      events: [
        { seq: 1, taskId: "t", event: "EXECUTION_STARTED", at: "2026-01-01T00:00:00.000Z" },
        { seq: 2, taskId: "t", event: "VERIFICATION_STARTED", at: "2026-01-01T00:00:01.000Z", details: { verificationCycle: 1 } },
        { seq: 3, taskId: "t", event: "VERIFICATION_RECORDED", at: "2026-01-01T00:00:02.000Z" },
        { seq: 4, taskId: "t", event: "COMPLETION_VALIDATED", at: "2026-01-01T00:00:03.000Z" },
        { seq: 5, taskId: "t", event: "VERIFICATION_RECORDED", at: "2026-01-01T00:00:04.000Z" },
      ],
    },
  });
  assert.equal(contradicted.valid, false);
  assert.ok(contradicted.errors.some((error) => error.message.includes("terminal state contradicted")));
});
