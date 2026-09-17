import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
import { recordDiagnosis } from "../src/core/diagnosis.js";
import { advanceWorkState } from "../src/core/phase.js";
import { NEXT_ACTIONS, getNextAction } from "../src/core/next-action.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";

const packageRoot = getPackageRoot();
const cliPath = path.join(packageRoot, "src", "cli.js");

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-executability-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

test("every lifecycle action recommended by next is executable and makes progress (P2-13)", async () => {
  await withTarget(async (target) => {
    // 1. Initial state: contract created, ready to route
    const contract = createContract({
      taskId: "task-executability",
      objective: "Verify next command executability across lifecycle",
      deliverables: ["src/app.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: [],
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

    // In PLANNED: next recommends START_EXECUTION or RUN_PREFLIGHT
    const preflight = await runPreflight({ target, packageRoot });
    assert.equal(preflight.status, "READY");

    let next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.START_EXECUTION);
    assert.ok(next.commands.length > 0);

    // Execute recommended advance to EXECUTING
    await advanceWorkState(target, "EXECUTING", { packageRoot });

    // In EXECUTING: next recommends ENTER_VERIFYING
    next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.ENTER_VERIFYING);
    assert.ok(next.commands.length > 0);

    // Execute recommended advance to VERIFYING
    await advanceWorkState(target, "VERIFYING", { packageRoot });

    // In VERIFYING without receipt: next recommends PREPARE_COMPLETION
    next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.PREPARE_COMPLETION);
    assert.ok(next.commands.length > 0);

    // Execute prepare completion
    await prepareCompletion({ target, packageRoot });

    // In VERIFYING with receipt but unverified: next recommends RECORD_VERIFICATION
    next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.RECORD_VERIFICATION);
    assert.ok(next.commands.length > 0);

    // Record check
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      id: "unit-tests",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });

    // With all evidence covered: next recommends ENTER_REVIEWING
    next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.ENTER_REVIEWING);
    assert.ok(next.commands.length > 0);

    // Execute advance to REVIEWING
    await advanceWorkState(target, "REVIEWING", { packageRoot });

    // In REVIEWING with valid evidence: next recommends RUN_COMPLETE
    next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.RUN_COMPLETE);
    assert.ok(next.commands.length > 0);

    // Execute runComplete
    const completion = await runComplete({ target, packageRoot });
    assert.equal(completion.status, "VALID");

    // In COMPLETE: next reports NONE
    next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.NONE);
  });
});

test("post-task-create discovery has an executable canonical transition", async () => {
  await withTarget(async (target) => {
    execFileSync(process.execPath, [cliPath, "task-create", "--task", "initial-discovery", "--claim", "src", "--path", target], {
      cwd: packageRoot,
      stdio: "pipe",
    });

    const next = JSON.parse(execFileSync(process.execPath, [cliPath, "next", "--task", "initial-discovery", "--path", target, "--json"], {
      cwd: packageRoot,
      encoding: "utf8",
    }));

    assert.equal(next.currentPhase, "RECEIVED");
    assert.equal(next.nextAction, NEXT_ACTIONS.DISCOVER);
    assert.equal(next.reasonCodes.includes("WORK_STATE_ABSENT"), true);
    assert.ok(next.commandSpecs.length > 0, "DISCOVER must expose a supported transition");

    const discover = JSON.parse(execFileSync(process.execPath, [cliPath, "discover", "--task", "initial-discovery", "--path", target, "--json"], {
      cwd: packageRoot,
      encoding: "utf8",
    }));
    assert.equal(discover.phase, "DISCOVERING");

    const afterDiscovery = JSON.parse(execFileSync(process.execPath, [cliPath, "next", "--task", "initial-discovery", "--path", target, "--json"], {
      cwd: packageRoot,
      encoding: "utf8",
    }));
    assert.equal(afterDiscovery.currentPhase, "DISCOVERING");
    assert.equal(afterDiscovery.nextAction, NEXT_ACTIONS.CREATE_CONTRACT);
    assert.ok(afterDiscovery.commandSpecs.length > 0, "CREATE_CONTRACT must expose a supported transition");

    const contract = JSON.parse(execFileSync(process.execPath, [cliPath, "contract-create", "--task", "initial-discovery", "--path", target, "--preset", "feature", "--json"], {
      cwd: packageRoot,
      encoding: "utf8",
    }));
    assert.equal(contract.phase, "CONTRACT_READY");

    const afterContract = JSON.parse(execFileSync(process.execPath, [cliPath, "task-show", "--task", "initial-discovery", "--path", target, "--json"], {
      cwd: packageRoot,
      encoding: "utf8",
    }));
    assert.equal(afterContract.artifacts.contract.exists, true);
    assert.equal(afterContract.artifacts.state.exists, true);

    const repeatedDiscover = JSON.parse(execFileSync(process.execPath, [cliPath, "discover", "--task", "initial-discovery", "--path", target, "--json"], {
      cwd: packageRoot,
      encoding: "utf8",
    }));
    assert.equal(repeatedDiscover.idempotent, true);
  });
});

test("product correction loop commands recommended by next are executable (P2-8 Case A)", async () => {
  await withTarget(async (target) => {
    const contract = createContract({
      taskId: "task-correction-exec",
      objective: "Verify next command executability across correction loop",
      deliverables: ["src/app.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: [],
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
    await advanceWorkState(target, "VERIFYING", { packageRoot });
    await prepareCompletion({ target, packageRoot });

    // 1. Record failed check
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      id: "unit-tests-c1",
      requirement: "tests",
      status: "failed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Assertion failed",
    });

    // 2. In VERIFYING with failed check: next recommends DIAGNOSE
    let next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.DIAGNOSE);
    assert.ok(next.commands.length > 0);

    // 3. Execute advance to DIAGNOSING
    await advanceWorkState(target, "DIAGNOSING", { packageRoot });

    // 4. Before diagnosis is recorded: next recommends RECORD_DIAGNOSIS
    next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.RECORD_DIAGNOSIS);

    // Record diagnosis
    await recordDiagnosis({
      target,
      packageRoot,
      hypothesis: "Fixed logic off-by-one error",
      failureClass: "VERIFICATION_FAILURE",
      evidenceRefs: ["unit-tests-c1"],
      settledBy: "Tests pass",
      nextSafeAction: "Fix logic",
    });

    // 5. In DIAGNOSING with hypothesis: next recommends CORRECT
    next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.CORRECT);
    assert.ok(next.commands.length > 0);

    // 6. Execute advance to CORRECTING
    await advanceWorkState(target, "CORRECTING", { packageRoot });

    // 7. In CORRECTING: next recommends ENTER_VERIFYING
    next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.ENTER_VERIFYING);
    assert.ok(next.commands.length > 0);

    // 8. Execute advance to VERIFYING (cycle 2)
    await advanceWorkState(target, "VERIFYING", { packageRoot });

    // 9. In VERIFYING (cycle 2): record passing check
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      id: "unit-tests-c2",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "All passed",
    });

    // 10. Next recommends ENTER_REVIEWING
    next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.ENTER_REVIEWING);

    // 11. Advance to REVIEWING and complete
    await advanceWorkState(target, "REVIEWING", { packageRoot });
    const completion = await runComplete({ target, packageRoot });
    assert.equal(completion.status, "VALID");
  });
});

test("evidence recovery loop commands recommended by next are executable (P2-8 Case B)", async () => {
  await withTarget(async (target) => {
    const contract = createContract({
      taskId: "task-recovery-exec",
      objective: "Verify next command executability across evidence recovery loop",
      deliverables: ["src/app.js"],
      constraints: ["offline"],
      risks: [],
      verification: ["tests", "build"],
      successCriteria: ["tests", "build"],
      stopConditions: [],
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
    await advanceWorkState(target, "VERIFYING", { packageRoot });
    await prepareCompletion({ target, packageRoot });

    // Only record 1 of 2 checks
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      id: "unit-tests",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm test",
      result: "Passed",
    });

    await advanceWorkState(target, "REVIEWING", { packageRoot });

    // Run complete -> REJECTED
    const completion1 = await runComplete({ target, packageRoot });
    assert.equal(completion1.status, "REJECTED");

    // In REVIEWING after rejection: next recommends ENTER_VERIFYING
    let next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.ENTER_VERIFYING);
    assert.ok(next.commands.length > 0);

    // Execute recommended advance to VERIFYING (cycle 2)
    await advanceWorkState(target, "VERIFYING", { packageRoot });

    // Record missing check
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      id: "build-check",
      requirement: "build",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npm run build",
      result: "Built",
    });

    // Next recommends ENTER_REVIEWING
    next = await getNextAction(target, packageRoot);
    assert.equal(next.nextAction, NEXT_ACTIONS.ENTER_REVIEWING);

    // Advance to REVIEWING and complete
    await advanceWorkState(target, "REVIEWING", { packageRoot });
    const completion2 = await runComplete({ target, packageRoot });
    assert.equal(completion2.status, "VALID");
  });
});
