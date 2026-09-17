import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTempTree } from "./helpers/rm-safe.js";
import { runComplete } from "../src/commands/complete.js";
import { runPreflight } from "../src/commands/preflight.js";
import { runRecordTerminalResult } from "../src/commands/record-terminal-result.js";
import { prepareCompletion, recordCheck } from "../src/core/completion-artifacts.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent, validateEventLedger, validateStateLedgerCoherence } from "../src/core/events.js";
import { advanceWorkState } from "../src/core/phase.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";
import { clearWorkState, createWorkState, readWorkState, writeWorkState } from "../src/core/work-state.js";
import { ARTIFACT_PATHS, canonicalFingerprint, readJsonArtifact } from "../src/core/artifacts.js";
import { NEXT_ACTIONS, getNextAction } from "../src/core/next-action.js";
import { terminalRequirementsForContract } from "../src/core/evidence-readiness.js";

const packageRoot = getPackageRoot();
const PUBLICATION_REQUIREMENT = {
  id: "release-publication",
  text: "Package published to npm registry",
  type: "PUBLICATION",
};
const PRODUCTION_REQUIREMENT = {
  id: "release-readiness",
  text: "Production deployment completed",
  type: "PRODUCTION_READINESS",
};

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-terminal-reachability-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function setupTarget(target, { verification, successCriteria }) {
  const contract = createContract({
    taskId: "task-terminal-reachability",
    objective: "Exercise terminal requirements declared only in contract verification",
    deliverables: ["src/app.js"],
    constraints: ["offline"],
    risks: [],
    verification,
    successCriteria,
    stopConditions: ["verification unavailable"],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  await writeContract(target, contract, packageRoot);
  const route = evaluateRoute({ workType: "code", surfaces: ["config"], platforms: [] });
  const persistedRoute = await persistRoute(target, route, packageRoot, {
    contractFingerprint: contractHash,
  });
  const state = createWorkState({
    taskId: contract.taskId,
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
  await writeWorkState(target, state, { packageRoot });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "CONTRACT_VALIDATED" }, packageRoot);
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "ROUTE_VALIDATED" }, packageRoot);
  const preflight = await runPreflight({ target, packageRoot });
  assert.equal(preflight.status, "READY");
  await advanceWorkState(target, "EXECUTING", { packageRoot });
}

async function reachReviewing(target, contractShape) {
  await setupTarget(target, contractShape);
  await advanceWorkState(target, "VERIFYING", { packageRoot });
  await prepareCompletion({ target, packageRoot });
  await recordCheck({ kind: "manual-review",
    target,
    packageRoot,
    id: "tests-check",
    requirement: "tests",
    status: "passed",
    evidenceKind: "OBSERVED",
    command: "npm test",
    result: "Passed",
  });
  await advanceWorkState(target, "REVIEWING", { packageRoot });
}

function assertLedgerPrefixUnchanged(before, after) {
  assert.ok(after.events.length >= before.events.length);
  for (let index = 0; index < before.events.length; index += 1) {
    assert.equal(after.events[index].seq, before.events[index].seq);
    assert.equal(after.events[index].event, before.events[index].event);
    assert.equal(after.events[index].hash, before.events[index].hash);
    assert.equal(after.events[index].previousHash, before.events[index].previousHash);
  }
}

test("canonical terminal derivation includes verification-only terminal requirements", () => {
  const derived = terminalRequirementsForContract({
    verification: ["tests", PUBLICATION_REQUIREMENT],
    successCriteria: ["tests"],
  });
  assert.deepEqual(derived.map((item) => item.id), ["release-publication"]);
});

test("publication requirement declared only in contract verification is reachable", async () => {
  await withTarget(async (target) => {
    await reachReviewing(target, {
      verification: ["tests", PUBLICATION_REQUIREMENT],
      successCriteria: ["tests"],
    });

    const ledgerBefore = await validateEventLedger(target, packageRoot);
    const recorded = await runRecordTerminalResult({
      target,
      packageRoot,
      requirement: "release-publication",
      type: "PUBLICATION",
      status: "published",
      source: "npm registry",
      result: "Published package version to registry",
    });
    assert.equal(recorded.requirementId, "release-publication");
    assert.equal(recorded.status, "published");

    const ledgerAfterRecord = await validateEventLedger(target, packageRoot);
    assertLedgerPrefixUnchanged(ledgerBefore, ledgerAfterRecord);
    assert.equal(ledgerAfterRecord.events.length, ledgerBefore.events.length + 1);
    assert.equal(ledgerAfterRecord.events.at(-1).event, "TERMINAL_RESULT_RECORDED");

    const completed = await runComplete({ target, packageRoot });
    assert.equal(completed.status, "VALID");
    assert.equal(completed.taskStatus, "COMPLETE");
  });
});

test("production readiness requirement declared only in contract verification is reachable", async () => {
  await withTarget(async (target) => {
    await reachReviewing(target, {
      verification: ["tests", PRODUCTION_REQUIREMENT],
      successCriteria: ["tests"],
    });

    const recorded = await runRecordTerminalResult({
      target,
      packageRoot,
      requirement: "release-readiness",
      type: "PRODUCTION_READINESS",
      status: "ready",
      source: "production smoke check",
      result: "Production deployment completed successfully",
    });
    assert.equal(recorded.requirementId, "release-readiness");

    const completed = await runComplete({ target, packageRoot });
    assert.equal(completed.status, "VALID");
    assert.equal(completed.taskStatus, "COMPLETE");
  });
});

test("next and completion report the same verification-only terminal requirement", async () => {
  await withTarget(async (target) => {
    await reachReviewing(target, {
      verification: ["tests", PUBLICATION_REQUIREMENT],
      successCriteria: ["tests"],
    });

    const next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.RECORD_TERMINAL_RESULT);
    const nextIds = next.commandSpecs
      .map((spec) => spec.argv.find((arg) => arg.startsWith("--requirement=")))
      .filter(Boolean)
      .map((arg) => arg.slice("--requirement=".length))
      .sort();

    const rejected = await runComplete({ target, packageRoot });
    assert.equal(rejected.status, "REJECTED");
    const pendingIds = rejected.errors
      .filter((error) => error.code === "E_PUBLICATION_REQUIREMENT_PENDING")
      .map((error) => error.requirementId)
      .sort();

    assert.deepEqual(nextIds, pendingIds);
    assert.deepEqual(pendingIds, ["release-publication"]);
  });
});

test("unrelated terminal result is rejected without mutation", async () => {
  await withTarget(async (target) => {
    await reachReviewing(target, {
      verification: ["tests", PUBLICATION_REQUIREMENT],
      successCriteria: ["tests"],
    });

    const stateBefore = await readWorkState(target, packageRoot);
    const receiptBefore = (await readJsonArtifact(target, ARTIFACT_PATHS.receipt, "execution-receipt", packageRoot)).value;
    const ledgerBefore = await validateEventLedger(target, packageRoot);

    await assert.rejects(
      () => runRecordTerminalResult({
        target,
        packageRoot,
        requirement: "another-release",
        type: "PUBLICATION",
        status: "published",
        source: "npm registry",
        result: "Published an unrelated package",
      }),
      (error) => error.code === "E_TERMINAL_REQUIREMENT_UNKNOWN",
    );

    const stateAfter = await readWorkState(target, packageRoot);
    const receiptAfter = (await readJsonArtifact(target, ARTIFACT_PATHS.receipt, "execution-receipt", packageRoot)).value;
    const ledgerAfter = await validateEventLedger(target, packageRoot);
    assert.equal(canonicalFingerprint(stateAfter), canonicalFingerprint(stateBefore));
    assert.equal(canonicalFingerprint(receiptAfter), canonicalFingerprint(receiptBefore));
    assertLedgerPrefixUnchanged(ledgerBefore, ledgerAfter);
    assert.equal(ledgerAfter.events.length, ledgerBefore.events.length);
  });
});

test("ordinary check cannot satisfy a verification-only terminal requirement", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests", PUBLICATION_REQUIREMENT],
      successCriteria: ["tests"],
    });
    await advanceWorkState(target, "VERIFYING", { packageRoot });
    await prepareCompletion({ target, packageRoot });

    await assert.rejects(
      () => recordCheck({ kind: "manual-review",
        target,
        packageRoot,
        id: "publication-check",
        requirement: "release-publication",
        status: "passed",
        evidenceKind: "OBSERVED",
        command: "npm publish --dry-run",
        result: "published",
      }),
      (error) => error.code === "E_FUTURE_LIFECYCLE_EVIDENCE",
    );
  });
});

test("superseded receipt remains auditable while terminal result is recorded", async () => {
  await withTarget(async (target) => {
    await reachReviewing(target, {
      verification: ["tests", PUBLICATION_REQUIREMENT],
      successCriteria: ["tests"],
    });
    const ledgerBeforeLoss = await validateEventLedger(target, packageRoot);

    await clearWorkState(target, { packageRoot });
    const rebuiltPreflight = await runPreflight({ target, packageRoot });
    assert.equal(rebuiltPreflight.status, "READY");
    const rebuilt = await readWorkState(target, packageRoot);
    assert.equal(rebuilt.phase, "REVIEWING");
    assert.deepEqual(
      validateStateLedgerCoherence(rebuilt, (await validateEventLedger(target, packageRoot)).events),
      [],
    );

    await prepareCompletion({ target, packageRoot });
    const refreshed = await readWorkState(target, packageRoot);
    const refreshedReceipt = (await readJsonArtifact(target, ARTIFACT_PATHS.receipt, "execution-receipt", packageRoot)).value;
    assert.equal(refreshedReceipt.stateFingerprint, canonicalFingerprint(refreshed));
    assert.deepEqual(refreshedReceipt.checks ?? [], []);

    const recorded = await runRecordTerminalResult({
      target,
      packageRoot,
      requirement: "release-publication",
      type: "PUBLICATION",
      status: "published",
      source: "npm registry",
      result: "Published package version to registry",
    });
    assert.equal(recorded.requirementId, "release-publication");

    const ledgerAfter = await validateEventLedger(target, packageRoot);
    assert.equal(ledgerAfter.valid, true);
    assertLedgerPrefixUnchanged(ledgerBeforeLoss, ledgerAfter);
  });
});
