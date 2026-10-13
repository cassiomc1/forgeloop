import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTempTree } from "./helpers/rm-safe.js";
import { runComplete } from "../src/commands/complete.js";
import { runPreflight } from "../src/commands/preflight.js";
import { prepareCompletion, recordCheck } from "../src/core/completion-artifacts.js";

import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { advanceWorkState } from "../src/core/phase.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { classifyRequirement, evaluateRequiredEvidence, isMixedTerminalRequirement } from "../src/core/evidence-readiness.js";

const packageRoot = getPackageRoot();

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-terminal-"));
  try {
    await ensureFixtureTask(target, "task-terminal", packageRoot);
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function setupTarget(target, { verification = ["tests"], successCriteria = ["tests"] } = {}) {
  const contract = createContract({
    taskId: "task-terminal",
    objective: "Exercise terminal-owned requirement handling",
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
  await writeWorkState(target, state, { packageRoot, taskId: "task-terminal" });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId: "task-terminal" });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId: "task-terminal" });
  const preflight = await runPreflight({ target, packageRoot, taskId: "task-terminal" });
  assert.equal(preflight.status, "READY");
  await advanceWorkState(target, "EXECUTING", { packageRoot, taskId: "task-terminal" });
}

test("cannot claim premature passed OBSERVED check for LIFECYCLE requirement (Matrix H)", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests", "Lifecycle reaches validator-backed COMPLETE state"],
      successCriteria: ["tests", "Lifecycle reaches validator-backed COMPLETE state"],
    });

    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal" });

    // Attempting to record passed + OBSERVED for lifecycle requirement must throw E_FUTURE_LIFECYCLE_EVIDENCE
    await assert.rejects(
      () => recordCheck({ kind: "manual-review",
        target,
        packageRoot,
        taskId: "task-terminal",
        id: "lifecycle-check",
        requirement: "Lifecycle reaches validator-backed COMPLETE state",
        status: "passed",
        evidenceKind: "OBSERVED",
        command: "echo complete",
        result: "complete",
      }),
      (err) => err.code === "E_FUTURE_LIFECYCLE_EVIDENCE",
    );
  });
});

test("cannot claim premature passed OBSERVED check for PUBLICATION requirement (Matrix I)", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests", "Package published to npm registry"],
      successCriteria: ["tests", "Package published to npm registry"],
    });

    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal" });

    // Attempting to record passed + OBSERVED for publication requirement must throw E_FUTURE_LIFECYCLE_EVIDENCE
    await assert.rejects(
      () => recordCheck({ kind: "manual-review",
        target,
        packageRoot,
        taskId: "task-terminal",
        id: "pub-check",
        requirement: "Package published to npm registry",
        status: "passed",
        evidenceKind: "OBSERVED",
        command: "npm publish --dry-run",
        result: "published",
      }),
      (err) => err.code === "E_FUTURE_LIFECYCLE_EVIDENCE",
    );
  });
});

test("cannot claim premature passed OBSERVED check for PRODUCTION_READINESS requirement (Matrix J)", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests", "Production deployment readiness verified"],
      successCriteria: ["tests", "Production deployment readiness verified"],
    });

    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal" });

    // Attempting to record passed + OBSERVED for production readiness requirement must throw E_FUTURE_LIFECYCLE_EVIDENCE
    await assert.rejects(
      () => recordCheck({ kind: "manual-review",
        target,
        packageRoot,
        taskId: "task-terminal",
        id: "deploy-check",
        requirement: "Production deployment readiness verified",
        status: "passed",
        evidenceKind: "OBSERVED",
        command: "deploy --check",
        result: "ready",
      }),
      (err) => err.code === "E_FUTURE_LIFECYCLE_EVIDENCE",
    );
  });
});

test("mixed lifecycle requirement is detected and rejected (Matrix K)", async () => {
  const mixedText = "All unit tests pass and lifecycle reaches COMPLETE";
  assert.equal(isMixedTerminalRequirement(mixedText), true);

  assert.throws(
    () => createContract({
      taskId: "task-mixed",
      objective: "Exercise mixed criteria detection",
      deliverables: ["src/app.js"],
      constraints: [],
      risks: [],
      verification: [mixedText],
      successCriteria: [mixedText],
      stopConditions: [],
      unresolvedDecisions: [],
      sourceRefs: [],
    }),
    (err) => err.code === "E_CIRCULAR_COMPLETION_REQUIREMENT",
  );
});

test("terminal requirements do not block readiness during verification review", async () => {
  const req1 = classifyRequirement("All unit tests pass");
  const req2 = classifyRequirement("Lifecycle reaches validator-backed COMPLETE");
  const req3 = classifyRequirement("Package published to registry");

  assert.equal(req1.type, "VERIFICATION");
  assert.equal(req1.lifecycleOwned, false);
  assert.equal(req2.type, "LIFECYCLE");
  assert.equal(req2.lifecycleOwned, true);
  assert.equal(req3.type, "PUBLICATION");
  assert.equal(req3.terminalOwned, true);

  const checks = [
    {
      id: "unit-tests",
      requirement: req1.id,
      status: "passed",
      evidenceKind: "OBSERVED",
    },
  ];

  const readiness = evaluateRequiredEvidence({
    requirements: [req1, req2, req3],
    checks,
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.covered.length, 1);
  assert.equal(readiness.lifecyclePending.length, 2);
});

test("standard vs strict closure requirements (Matrix P & Q)", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal" });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-terminal",
      id: "tests-pass",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-terminal" });

    // Standard completion passes
    const standardResult = await runComplete({ target, packageRoot, strict: false });
    assert.equal(standardResult.status, "VALID");
  });
});

test("local task without publication requirement completes with local-only and not-verified (P1-6 Test A)", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests"],
      successCriteria: ["tests"],
    });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal" });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-terminal",
      id: "tests-pass",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-terminal" });

    const result = await runComplete({ target, packageRoot, taskId: "task-terminal" });
    assert.equal(result.status, "VALID");
    assert.equal(result.taskStatus, "COMPLETE");
    assert.equal(result.publicationStatus, "local-only");
    assert.equal(result.productionReadiness, "not-verified");
  });
});

test("publication explicitly required but local-only rejects completion (P1-6 Test B)", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests"],
      successCriteria: ["tests", "Package is published to npm registry"],
    });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal" });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-terminal",
      id: "tests-pass",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-terminal" });

    const result = await runComplete({ target, packageRoot, taskId: "task-terminal" });
    assert.equal(result.status, "REJECTED");
    assert.ok(result.errors.some((e) => e.code === "E_PUBLICATION_REQUIREMENT_PENDING"));
  });
});

test("production readiness explicitly required but not-verified rejects completion (P1-6 Test D)", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, {
      verification: ["tests"],
      successCriteria: ["tests", "Production deployment succeeds"],
    });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: "task-terminal" });
    await prepareCompletion({ target, packageRoot, taskId: "task-terminal" });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: "task-terminal",
      id: "tests-pass",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: "task-terminal" });

    const result = await runComplete({ target, packageRoot, taskId: "task-terminal" });
    assert.equal(result.status, "REJECTED");
    assert.ok(result.errors.some((e) => e.code === "E_PRODUCTION_REQUIREMENT_PENDING"));
  });
});

test("requirement classification helpers (P2-7)", async () => {
  const {
    ordinaryRequirements,
    terminalRequirements,
    lifecycleRequirements,
    publicationRequirements,
    productionReadinessRequirements,
  } = await import("../src/core/evidence-readiness.js");

  const reqs = [
    "All unit tests pass",
    "Lifecycle reaches validator-backed COMPLETE",
    "Package is published to npm",
    "Production deployment succeeds",
  ];

  const ordinary = ordinaryRequirements(reqs);
  assert.equal(ordinary.length, 1);
  assert.equal(ordinary[0].text, "All unit tests pass");

  const terminal = terminalRequirements(reqs);
  assert.equal(terminal.length, 3);

  const lifecycle = lifecycleRequirements(reqs);
  assert.equal(lifecycle.length, 1);
  assert.equal(lifecycle[0].type, "LIFECYCLE");

  const pub = publicationRequirements(reqs);
  assert.equal(pub.length, 1);
  assert.equal(pub[0].type, "PUBLICATION");

  const prod = productionReadinessRequirements(reqs);
  assert.equal(prod.length, 1);
  assert.equal(prod[0].type, "PRODUCTION_READINESS");
});
