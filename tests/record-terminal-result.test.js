import { openStorageDatabase } from "../src/storage/index.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { readRawFixtureText, overwriteFixtureText } from "./helpers/native-storage-fixture.js";

import { removeTempTree } from "./helpers/rm-safe.js";
import { runComplete } from "../src/commands/complete.js";
import { runPreflight } from "../src/commands/preflight.js";
import { runRecordTerminalResult } from "../src/commands/record-terminal-result.js";
import { prepareCompletion, recordCheck, recordTerminalResult } from "../src/core/completion-artifacts.js";

import { readJsonArtifact } from "../src/core/artifacts.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent, validateEventLedger } from "../src/core/events.js";
import { advanceWorkState } from "../src/core/phase.js";
import { NEXT_ACTIONS, getNextAction } from "../src/core/next-action.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, readWorkState, writeWorkState } from "../src/core/work-state.js";
import { isPublicationStatusSatisfied } from "../src/core/evidence-readiness.js";

const packageRoot = getPackageRoot();

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-terminal-result-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function setupTarget(target, { verification = ["tests"], successCriteria = ["tests"] } = {}) {
  const contract = createContract({
    taskId: "task-terminal-record",
    objective: "Exercise record-terminal-result protocol command",
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
  await writeTaskDescriptor(target, createTaskDescriptor({ taskId: contract.taskId, writeClaims: [] }), packageRoot);
  await writeContract(target, contract, packageRoot, { taskId: contract.taskId });
  const route = evaluateRoute({ workType: "code", surfaces: ["config"], platforms: [] });
  const persistedRoute = await persistRoute(target, route, packageRoot, {
    contractFingerprint: contractHash,
    taskId: contract.taskId,
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
  await writeWorkState(target, state, { packageRoot, taskId: "task-terminal-record" });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId: "task-terminal-record" });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId: "task-terminal-record" });
  const preflight = await runPreflight({ target, packageRoot, taskId: "task-terminal-record" });
  assert.equal(preflight.status, "READY");
  await advanceWorkState(target, "EXECUTING", { packageRoot, taskId: "task-terminal-record" });
}

test("publication precision levels and satisfaction logic", () => {
  assert.equal(isPublicationStatusSatisfied("local-only", "published"), false);
  assert.equal(isPublicationStatusSatisfied("committed", "published"), false);
  assert.equal(isPublicationStatusSatisfied("pushed", "published"), false);
  assert.equal(isPublicationStatusSatisfied("published", "published"), true);
  assert.equal(isPublicationStatusSatisfied("deployed", "published"), false);

  assert.equal(isPublicationStatusSatisfied("local-only", "pushed"), false);
  assert.equal(isPublicationStatusSatisfied("committed", "pushed"), false);
  assert.equal(isPublicationStatusSatisfied("pushed", "pushed"), true);
  assert.equal(isPublicationStatusSatisfied("published", "pushed"), true);
  assert.equal(isPublicationStatusSatisfied("deployed", "pushed"), false);

  assert.equal(isPublicationStatusSatisfied("local-only", "committed"), false);
  assert.equal(isPublicationStatusSatisfied("committed", "committed"), true);
  assert.equal(isPublicationStatusSatisfied("pushed", "committed"), true);
  assert.equal(isPublicationStatusSatisfied("published", "committed"), true);

  assert.equal(isPublicationStatusSatisfied("published", "deployed"), false);
  assert.equal(isPublicationStatusSatisfied("deployed", "deployed"), true);
});

test("recording PUBLICATION terminal result satisfies explicit publication requirement", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests"],
      successCriteria: ["tests", "Package is published to npm registry"],
    });

    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal-record" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal-record" });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-terminal-record",
      id: "tests-check",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });

    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-terminal-record" });

    // nextAction in REVIEWING should direct RECORD_TERMINAL_RESULT
    const nextBefore = await getNextAction(target, packageRoot);
    assert.equal(nextBefore.nextAction, NEXT_ACTIONS.RECORD_TERMINAL_RESULT);
    assert.ok(nextBefore.commands.includes("forgeloop record-terminal-result"));
    assert.ok(nextBefore.commandSpecs.some((s) => s.commandId === "record-terminal-result"));

    // Attempt complete before recording publication -> REJECTED
    const compBefore = await runComplete({ target, packageRoot, taskId: "task-terminal-record" });
    assert.equal(compBefore.status, "REJECTED");
    assert.ok(compBefore.errors.some((e) => e.code === "E_PUBLICATION_REQUIREMENT_PENDING"));

    // Record publication terminal result
    const recResult = await runRecordTerminalResult({
      target,
      packageRoot,
      taskId: "task-terminal-record",
      requirement: "Package is published to npm registry",
      type: "PUBLICATION",
      status: "published",
      source: "npm publish",
      result: "Published @cassiomc1/forgeloop@0.1.11 to npm registry",
    });
    assert.equal(recResult.status, "published");
    assert.equal(recResult.type, "PUBLICATION");

    // Idempotency: repeated call returns idempotent
    const recIdempotent = await runRecordTerminalResult({
      target,
      packageRoot,
      taskId: "task-terminal-record",
      requirement: "Package is published to npm registry",
      type: "PUBLICATION",
      status: "published",
      source: "npm publish",
      result: "Published @cassiomc1/forgeloop@0.1.11 to npm registry",
    });
    assert.equal(recIdempotent.idempotent, true);

    // Verify ledger has TERMINAL_RESULT_RECORDED
    const ledger = await validateEventLedger(target, packageRoot, { taskId: "task-terminal-record" });
    const terminalEvents = ledger.events.filter((e) => e.event === "TERMINAL_RESULT_RECORDED");
    assert.equal(terminalEvents.length, 1);

    // nextAction should now be RUN_COMPLETE
    const nextAfter = await getNextAction(target, packageRoot);
    assert.equal(nextAfter.nextAction, NEXT_ACTIONS.RUN_COMPLETE);

    // Complete should now be VALID
    const compAfter = await runComplete({ target, packageRoot, taskId: "task-terminal-record" });
    assert.equal(compAfter.status, "VALID");
    assert.equal(compAfter.taskStatus, "COMPLETE");
    assert.equal(compAfter.publicationStatus, "published");
  });
});

test("recording PRODUCTION_READINESS terminal result satisfies explicit production requirement", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests"],
      successCriteria: ["tests", "Production smoke validation succeeds"],
    });

    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal-record" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal-record" });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-terminal-record",
      id: "tests-check",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });

    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-terminal-record" });

    // Record production readiness terminal result
    const recResult = await runRecordTerminalResult({
      target,
      packageRoot,
      taskId: "task-terminal-record",
      requirement: "Production smoke validation succeeds",
      type: "PRODUCTION_READINESS",
      status: "ready",
      source: "smoke-test.sh",
      result: "All 10 production smoke endpoints returned 200 OK",
    });
    assert.equal(recResult.status, "ready");
    assert.equal(recResult.type, "PRODUCTION_READINESS");

    // Complete should now be VALID
    const compAfter = await runComplete({ target, packageRoot, taskId: "task-terminal-record" });
    assert.equal(compAfter.status, "VALID");
    assert.equal(compAfter.taskStatus, "COMPLETE");
    assert.equal(compAfter.productionReadiness, "ready");
  });
});

test("record-terminal-result rejects unsupported types and invalid statuses", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests"],
      successCriteria: ["tests", "Package is published to npm registry"],
    });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal-record" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal-record" });

    // Rejects LIFECYCLE
    await assert.rejects(
      () => runRecordTerminalResult({
        target,
        packageRoot,
        requirement: "Lifecycle complete",
        type: "LIFECYCLE",
        status: "COMPLETE",
        source: "manual",
        result: "complete",
      }),
      (err) => err.code === "E_FUTURE_TERMINAL_EVIDENCE",
    );

    // Rejects invalid publication status
    await assert.rejects(
      () => runRecordTerminalResult({
        target,
        packageRoot,
        requirement: "Package is published to npm registry",
        type: "PUBLICATION",
        status: "invalid-status",
        source: "npm",
        result: "res",
      }),
      (err) => err.code === "E_CHECK_INVALID",
    );
  });
});

test("T-P0-01 & T-P0-02 & T-P0-03: rejects unknown, ordinary, and mismatched terminal requirements without mutation", async () => {
  const { canonicalFingerprint } = await import("../src/core/artifacts.js");
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests"],
      successCriteria: ["tests", "Package is published to npm registry"],
    });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal-record" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal-record" });

    const stateBefore = await readWorkState(target, { packageRoot, taskId: "task-terminal-record" });
    const receiptBefore = (await readJsonArtifact(target, taskArtifactPath("task-terminal-record", "receipt"), "execution-receipt", packageRoot)).value;
    const ledgerBefore = await validateEventLedger(target, packageRoot, { taskId: "task-terminal-record" });

    const stateHashBefore = canonicalFingerprint(stateBefore);
    const receiptHashBefore = canonicalFingerprint(receiptBefore);
    const ledgerCountBefore = ledgerBefore.events.length;

    // T-P0-01: Unknown terminal requirement
    await assert.rejects(
      () => runRecordTerminalResult({
        target,
        packageRoot,
        requirement: "Unrelated publication",
        type: "PUBLICATION",
        status: "published",
        source: "manual",
        result: "published",
      }),
      (err) => err.code === "E_TERMINAL_REQUIREMENT_UNKNOWN",
    );

    // T-P0-02: Ordinary requirement passed to terminal recorder
    await assert.rejects(
      () => runRecordTerminalResult({
        target,
        packageRoot,
        requirement: "tests",
        type: "PUBLICATION",
        status: "published",
        source: "manual",
        result: "published",
      }),
      (err) => err.code === "E_TERMINAL_REQUIREMENT_NOT_TERMINAL",
    );

    // T-P0-03: Terminal type mismatch
    await assert.rejects(
      () => runRecordTerminalResult({
        target,
        packageRoot,
        requirement: "Package is published to npm registry",
        type: "PRODUCTION_READINESS",
        status: "ready",
        source: "manual",
        result: "ready",
      }),
      (err) => err.code === "E_TERMINAL_REQUIREMENT_TYPE_MISMATCH",
    );

    // Assert zero partial mutation on failure
    const stateAfter = await readWorkState(target, { packageRoot, taskId: "task-terminal-record" });
    const receiptAfter = (await readJsonArtifact(target, taskArtifactPath("task-terminal-record", "receipt"), "execution-receipt", packageRoot)).value;
    const ledgerAfter = await validateEventLedger(target, packageRoot, { taskId: "task-terminal-record" });

    assert.equal(canonicalFingerprint(stateAfter), stateHashBefore);
    assert.equal(canonicalFingerprint(receiptAfter), receiptHashBefore);
    assert.equal(ledgerAfter.events.length, ledgerCountBefore);
  });
});

test("T-P0-04 & T-P0-05: requirement-specific evidence binding and multi-terminal criteria", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests"],
      successCriteria: [
        "tests",
        { id: "REQ_NPM", text: "Package is published to npm", type: "PUBLICATION", requiredPublicationStatus: "published" },
        { id: "REQ_RELEASE", text: "GitHub release is published", type: "PUBLICATION", requiredPublicationStatus: "published" },
      ],
    });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal-record" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal-record" });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-terminal-record",
      id: "tests-check",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-terminal-record" });

    // Record only REQ_NPM
    await runRecordTerminalResult({
      target,
      packageRoot,
      taskId: "task-terminal-record",
      requirement: "REQ_NPM",
      type: "PUBLICATION",
      status: "published",
      source: "npm publish",
      result: "npm published",
    });

    // Complete must be REJECTED because REQ_RELEASE is still pending
    const comp1 = await runComplete({ target, packageRoot, taskId: "task-terminal-record" });
    assert.equal(comp1.status, "REJECTED");
    assert.ok(comp1.errors.some((e) => e.requirementId === "REQ_RELEASE" && e.code === "E_PUBLICATION_REQUIREMENT_PENDING"));

    // Record REQ_RELEASE
    await runRecordTerminalResult({
      target,
      packageRoot,
      taskId: "task-terminal-record",
      requirement: "REQ_RELEASE",
      type: "PUBLICATION",
      status: "published",
      source: "gh release",
      result: "release published",
    });

    // Complete must now be VALID
    const comp2 = await runComplete({ target, packageRoot, taskId: "task-terminal-record" });
    assert.equal(comp2.status, "VALID");
    assert.equal(comp2.taskStatus, "COMPLETE");
  });
});

test("T-P0-06: global publication status without matching requirement evidence is rejected", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests"],
      successCriteria: [
        "tests",
        { id: "REQ_NPM", text: "Package is published to npm", type: "PUBLICATION", requiredPublicationStatus: "published" },
      ],
    });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal-record" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal-record" });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-terminal-record",
      id: "tests-check",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-terminal-record" });

    // Forged receipt with publicationStatus = "published", but no matching requirement-bound evidence in evidence[]
    const receipt = (await readJsonArtifact(target, taskArtifactPath("task-terminal-record", "receipt"), "execution-receipt", packageRoot)).value;
    receipt.publicationStatus = "published";
    receipt.publication = { ...receipt.publication, pushed: true, deployed: false };
    const { writeJsonArtifact } = await import("../src/core/artifacts.js");
    await writeJsonArtifact(target, taskArtifactPath("task-terminal-record", "receipt"), receipt, "execution-receipt", packageRoot);

    const comp = await runComplete({ target, packageRoot, taskId: "task-terminal-record" });
    assert.equal(comp.status, "REJECTED");
    assert.ok(comp.errors.some((e) => e.code === "E_PUBLICATION_REQUIREMENT_PENDING"));
  });
});

test("T-P1-01: simulated valid ledger-tail loss repairs missing terminal event on retry", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests"],
      successCriteria: ["tests", "Package is published to npm registry"],
    });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal-record" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal-record" });

    // Record terminal result normally
    const result1 = await runRecordTerminalResult({
      target,
      packageRoot,
      taskId: "task-terminal-record",
      requirement: "Package is published to npm registry",
      type: "PUBLICATION",
      status: "published",
      source: "npm publish",
      result: "Published package",
    });
    assert.equal(result1.idempotent, undefined);

    // Deliberately truncate disposable authority before the terminal event and
    // its commit witness. Native commits are atomic; this models imported damage.

    const lines = (await readRawFixtureText(target, taskArtifactPath("task-terminal-record", "events"))).trim().split("\n");
    const terminalIndex = lines.findIndex(line => JSON.parse(line).event === "TERMINAL_RESULT_RECORDED");
    assert.ok(terminalIndex >= 0);
    const filteredLines = lines.slice(0, terminalIndex);
    await overwriteFixtureText(target, taskArtifactPath("task-terminal-record", "events"), `${filteredLines.join("\n")}\n`);

    // Retry recording same terminal result
    const result2 = await runRecordTerminalResult({
      target,
      packageRoot,
      taskId: "task-terminal-record",
      requirement: "Package is published to npm registry",
      type: "PUBLICATION",
      status: "published",
      source: "npm publish",
      result: "Published package",
    });
    assert.equal(result2.idempotent, true);
    assert.equal(result2.repaired, true);

    // Verify ledger has exactly 1 repaired event and evidence is not duplicated
    const ledger = await validateEventLedger(target, packageRoot, { taskId: "task-terminal-record" });
    const termEvents = ledger.events.filter((e) => e.event === "TERMINAL_RESULT_RECORDED");
    assert.equal(termEvents.length, 1);

    const receipt = (await readJsonArtifact(target, taskArtifactPath("task-terminal-record", "receipt"), "execution-receipt", packageRoot)).value;
    const termEv = receipt.evidence.filter((e) => e.details?.terminalType === "PUBLICATION");
    assert.equal(termEv.length, 1);
  });
});

test("T-P1-03: publication status regression is rejected with E_TERMINAL_STATUS_REGRESSION", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests"],
      successCriteria: ["tests", "Package is published to npm registry"],
    });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal-record" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal-record" });

    // Step 1: published
    await runRecordTerminalResult({
      target,
      packageRoot,
      taskId: "task-terminal-record",
      requirement: "Package is published to npm registry",
      type: "PUBLICATION",
      status: "published",
      source: "npm publish",
      result: "Published package",
    });

    // Step 2: attempt regression to pushed -> MUST REJECT
    await assert.rejects(
      () => runRecordTerminalResult({
        target,
        packageRoot,
        requirement: "Package is published to npm registry",
        type: "PUBLICATION",
        status: "pushed",
        source: "git push",
        result: "Pushed",
      }),
      (err) => err.code === "E_TERMINAL_STATUS_REGRESSION",
    );
  });
});

test("duplicate requirement text with distinct IDs requires independent evidence for each ID", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests"],
      successCriteria: [
        "tests",
        { id: "PUB_A", text: "Release is published", type: "PUBLICATION", requiredPublicationStatus: "published" },
        { id: "PUB_B", text: "Release is published", type: "PUBLICATION", requiredPublicationStatus: "published" },
      ],
    });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal-record" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal-record" });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-terminal-record",
      id: "tests-check",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-terminal-record" });

    // Record only PUB_A
    await runRecordTerminalResult({
      target,
      packageRoot,
      taskId: "task-terminal-record",
      requirement: "PUB_A",
      type: "PUBLICATION",
      status: "published",
      source: "npm publish",
      result: "Published to npm",
    });

    // Complete must be REJECTED because PUB_B is still pending, despite sharing identical text
    const comp1 = await runComplete({ target, packageRoot, taskId: "task-terminal-record" });
    assert.equal(comp1.status, "REJECTED");
    assert.ok(comp1.errors.some((e) => e.requirementId === "PUB_B" && e.code === "E_PUBLICATION_REQUIREMENT_PENDING"));

    // Next action in REVIEWING must recommend PUB_B specifically with its canonical requirement ID
    const next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.RECORD_TERMINAL_RESULT);
    const pubBSpec = next.commandSpecs.find((spec) => spec.argv.some((arg) => arg.includes("--requirement=PUB_B")));
    assert.ok(pubBSpec, "Expected commandSpec targeting PUB_B");

    // Record PUB_B
    await runRecordTerminalResult({
      target,
      packageRoot,
      taskId: "task-terminal-record",
      requirement: "PUB_B",
      type: "PUBLICATION",
      status: "published",
      source: "gh release",
      result: "Published to GitHub",
    });

    // Complete must now be VALID
    const comp2 = await runComplete({ target, packageRoot, taskId: "task-terminal-record" });
    assert.equal(comp2.status, "VALID");
    assert.equal(comp2.taskStatus, "COMPLETE");
  });
});

test("duplicate production readiness text with distinct IDs requires independent evidence for each ID", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests"],
      successCriteria: [
        "tests",
        { id: "PROD_A", text: "Production readiness verified", type: "PRODUCTION_READINESS" },
        { id: "PROD_B", text: "Production readiness verified", type: "PRODUCTION_READINESS" },
      ],
    });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal-record" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal-record" });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-terminal-record",
      id: "tests-check",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-terminal-record" });

    // Record only PROD_A
    await runRecordTerminalResult({
      target,
      packageRoot,
      taskId: "task-terminal-record",
      requirement: "PROD_A",
      type: "PRODUCTION_READINESS",
      status: "ready",
      source: "smoke-east.sh",
      result: "East region ready",
    });

    // Complete must be REJECTED because PROD_B is still pending
    const comp1 = await runComplete({ target, packageRoot, taskId: "task-terminal-record" });
    assert.equal(comp1.status, "REJECTED");
    assert.ok(comp1.errors.some((e) => e.requirementId === "PROD_B" && e.code === "E_PRODUCTION_REQUIREMENT_PENDING"));

    // Record PROD_B
    await runRecordTerminalResult({
      target,
      packageRoot,
      taskId: "task-terminal-record",
      requirement: "PROD_B",
      type: "PRODUCTION_READINESS",
      status: "ready",
      source: "smoke-west.sh",
      result: "West region ready",
    });

    // Complete must now be VALID
    const comp2 = await runComplete({ target, packageRoot, taskId: "task-terminal-record" });
    assert.equal(comp2.status, "VALID");
    assert.equal(comp2.taskStatus, "COMPLETE");
  });
});

test("observation A event does not satisfy observation B during retry reconciliation", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests"],
      successCriteria: ["tests", "Package is published to npm registry"],
    });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal-record" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal-record" });

    // Observation A recorded normally with event A
    const resA = await runRecordTerminalResult({
      target,
      packageRoot,
      taskId: "task-terminal-record",
      requirement: "Package is published to npm registry",
      type: "PUBLICATION",
      status: "published",
      source: "source-A",
      result: "result-A",
    });
    assert.ok(resA.event);

    // Now record observation B into state and receipt manually (simulating interrupted write where event B was omitted)
    const state = await readWorkState(target, { packageRoot, taskId: "task-terminal-record" });
    const receipt = (await readJsonArtifact(target, taskArtifactPath("task-terminal-record", "receipt"), "execution-receipt", packageRoot)).value;
    const { createEvidence } = await import("../src/core/evidence.js");
    const { createReceipt } = await import("../src/core/receipt.js");
    const { canonicalFingerprint, writeJsonArtifact } = await import("../src/core/artifacts.js");

    const { classifyRequirement } = await import("../src/core/evidence-readiness.js");
    const targetReq = classifyRequirement("Package is published to npm registry");

    const evidenceB = createEvidence({
      kind: "OBSERVED",
      source: "source-B",
      result: "result-B",
      verificationCycle: state.verificationCycle ?? 1,
      details: {
        requirementId: targetReq.id,
        requirementText: targetReq.text,
        terminalType: "PUBLICATION",
        terminalStatus: "published",
        verificationCycle: state.verificationCycle ?? 1,
      },
    });

    const nextStateEvidence = [...(state.verificationEvidence ?? []), evidenceB];
    const nextState = {
      ...state,
      verificationEvidence: nextStateEvidence,
      lastUpdated: new Date().toISOString(),
    };
    const nextReceiptEvidence = [...(receipt.evidence ?? []), evidenceB];
    const nextReceipt = await createReceipt({
      ...receipt,
      evidence: nextReceiptEvidence,
      stateFingerprint: canonicalFingerprint(nextState),
    }, packageRoot);

    await writeWorkState(target, nextState, { packageRoot, taskId: "task-terminal-record" });
    await writeJsonArtifact(target, taskArtifactPath("task-terminal-record", "receipt"), nextReceipt, "execution-receipt", packageRoot);

    // Retrying observation B must detect evidence B and append event B specifically (not satisfied by event A)
    const retryB = await runRecordTerminalResult({
      target,
      packageRoot,
      taskId: "task-terminal-record",
      requirement: "Package is published to npm registry",
      type: "PUBLICATION",
      status: "published",
      source: "source-B",
      result: "result-B",
    });
    assert.equal(retryB.idempotent, true);
    assert.equal(retryB.repaired, true);

    const ledger = await validateEventLedger(target, packageRoot, { taskId: "task-terminal-record" });
    const termEvents = ledger.events.filter((e) => e.event === "TERMINAL_RESULT_RECORDED");
    assert.equal(termEvents.length, 2);
    assert.equal(termEvents[0].details.source, "source-A");
    assert.equal(termEvents[1].details.source, "source-B");
  });
});



test("direct terminal result rolls back state and receipt when its event fails", async () => {
  await withTarget(async target => {
    const taskId = "task-terminal-record";
    await setupTarget(target, { verification: ["tests"], successCriteria: ["tests", "Package is published to npm registry"] });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId });
    await prepareCompletion({ target, packageRoot, taskId });
    const before = {
      state: await readRawFixtureText(target, taskArtifactPath(taskId, "state")),
      receipt: await readRawFixtureText(target, taskArtifactPath(taskId, "receipt")),
      events: await readRawFixtureText(target, taskArtifactPath(taskId, "events")),
    };
    const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    try { db.exec("CREATE TRIGGER fail_direct_terminal BEFORE INSERT ON events WHEN NEW.event_type = 'TERMINAL_RESULT_RECORDED' BEGIN SELECT RAISE(ABORT, 'injected terminal event failure'); END"); }
    finally { db.close(); }
    await assert.rejects(() => recordTerminalResult({ target, packageRoot, taskId,
      requirement: "Package is published to npm registry", type: "PUBLICATION", status: "published",
      source: "offline fixture observation", result: "fixture publication assertion" }), /injected terminal event failure/);
    assert.deepEqual({
      state: await readRawFixtureText(target, taskArtifactPath(taskId, "state")),
      receipt: await readRawFixtureText(target, taskArtifactPath(taskId, "receipt")),
      events: await readRawFixtureText(target, taskArtifactPath(taskId, "events")),
    }, before);
    const recovered = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    try { recovered.exec("DROP TRIGGER fail_direct_terminal"); } finally { recovered.close(); }
    const accepted = await recordTerminalResult({ target, packageRoot, taskId,
      requirement: "Package is published to npm registry", type: "PUBLICATION", status: "published",
      source: "offline fixture observation", result: "fixture publication assertion" });
    assert.equal(accepted.status, "published");
  });
});
