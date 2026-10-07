import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runPreflight } from "../src/commands/preflight.js";
import { proposeAction, transitionAction, transitionAuthorizedAction } from "../src/core/actions.js";
import { prepareCompletion, recordCheck } from "../src/core/completion-artifacts.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { advanceWorkState } from "../src/core/phase.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { recordIntervention, recordStructuredDiagnosticCase } from "../src/core/diagnostic-record.js";
import { buildTaskReflection } from "../src/core/reflection.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";

const packageRoot = getPackageRoot();
const TASK_ID = "task-reflection-ambiguity";

async function setupToDiagnosing(target) {
  await writeTaskDescriptor(target, createTaskDescriptor({ taskId: TASK_ID, writeClaims: ["src/app.js"] }), packageRoot);
  const contract = createContract({
    taskId: TASK_ID,
    objective: "Preserve diagnostic truth while an external action is ambiguous",
    deliverables: ["src/app.js"],
    constraints: ["offline"],
    risks: [],
    verification: ["lint"],
    successCriteria: ["lint"],
    stopConditions: ["verification unavailable"],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  await writeContract(target, contract, packageRoot, { taskId: TASK_ID });
  const route = evaluateRoute({ workType: "code", surfaces: ["config"], platforms: [] });
  const persistedRoute = await persistRoute(target, route, packageRoot, {
    contractFingerprint: contractHash,
    taskId: TASK_ID,
  });
  const state = createWorkState({
    taskId: TASK_ID,
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
  await writeWorkState(target, state, { packageRoot, taskId: TASK_ID });
  await appendProtocolEvent(target, { taskId: TASK_ID, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId: TASK_ID });
  await appendProtocolEvent(target, { taskId: TASK_ID, event: "ROUTE_VALIDATED" }, packageRoot, { taskId: TASK_ID });
  const preflight = await runPreflight({ target, packageRoot, taskId: TASK_ID });
  assert.equal(preflight.status, "READY");
  await advanceWorkState(target, "EXECUTING", { packageRoot, taskId: TASK_ID });
  await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: TASK_ID });
  await prepareCompletion({ target, packageRoot, taskId: TASK_ID });
  await recordCheck({ kind: "manual-review",
    target,
    packageRoot,
    taskId: TASK_ID,
    id: "check-lint",
    requirement: "lint",
    status: "failed",
    evidenceKind: "OBSERVED",
    command: "npm run lint",
    result: "same lint failure",
    exitCode: 1,
  });
  await advanceWorkState(target, "DIAGNOSING", { packageRoot, taskId: TASK_ID });
}

function diagnosticCase() {
  return {
    schemaVersion: 1,
    failureClass: "VERIFICATION_FAILURE",
    observations: [{ id: "obs-lint", kind: "CHECK_RESULT", evidenceRef: "check-lint", statement: "Lint still fails." }],
    contributors: [{ id: "c-code", type: "CODE", statement: "Same code path remains suspect.", basis: ["obs-lint"], status: "SUSPECTED" }],
    hypotheses: [{
      id: "h-lint",
      statement: "The same defect is still present.",
      contributorRefs: ["c-code"],
      evidenceRefs: ["check-lint"],
      settledBy: { type: "CHECK_STATUS", checkId: "check-lint", expectedStatus: "passed" },
    }],
    nextSafeAction: { statement: "Change the diagnostic strategy." },
  };
}

async function recordCase(target, fileName) {
  await writeFile(path.join(target, fileName), JSON.stringify(diagnosticCase()));
  await recordStructuredDiagnosticCase({ target, packageRoot, taskId: TASK_ID, caseFile: fileName });
}

test("COMMIT_UNKNOWN adds reconciliation guidance without downgrading STALLED", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-reflection-ambiguity-"));
  try {
    await setupToDiagnosing(target);
    await recordCase(target, "case-1.json");
    await advanceWorkState(target, "CORRECTING", { packageRoot, taskId: TASK_ID });
    await recordIntervention({
      target,
      packageRoot,
      taskId: TASK_ID,
      interventionInput: {
        id: "i-1",
        kind: "CODE_CHANGE",
        reversible: true,
        hypothesisRefs: ["h-lint"],
        statement: "Apply the same ineffective change.",
      },
    });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: TASK_ID });
    await prepareCompletion({ target, packageRoot, taskId: TASK_ID });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: TASK_ID,
      id: "check-lint",
      requirement: "lint",
      status: "failed",
      evidenceKind: "OBSERVED",
      command: "npm run lint",
      result: "same lint failure",
      exitCode: 1,
    });
    await advanceWorkState(target, "DIAGNOSING", { packageRoot, taskId: TASK_ID });
    await recordCase(target, "case-2.json");

    const { action } = await proposeAction(target, { packageRoot, taskId: TASK_ID, input: {
      actionId: "action-external",
      effectClass: "EXTERNAL_PUBLICATION",
      capability: "external.publish",
      target: "external/service",
      operation: "publish result",
      idempotencyKey: "reflection:external:v1",
      requiredForCompletion: false,
      requirement: null,
      provenance: "FORGELOOP_EXECUTED",
    } });
    const authorized = await transitionAuthorizedAction(target, {
      packageRoot,
      taskId: TASK_ID,
      actionId: action.actionId,
      expectedRevision: 0,
      expectedFingerprint: action.actionFingerprint,
      details: {
        actionFingerprint: action.actionFingerprint,
        capabilityDecision: "ALLOW",
        capabilityPolicyFingerprint: "a".repeat(64),
        policyLockDigest: `sha256:${"b".repeat(64)}`,
        taskPolicyDigest: `sha256:${"c".repeat(64)}`,
      },
    });
    const started = await transitionAction(target, { packageRoot, taskId: TASK_ID, actionId: action.actionId, to: "STARTED", expectedRevision: authorized.revision });
    await transitionAction(target, {
      packageRoot,
      taskId: TASK_ID,
      actionId: action.actionId,
      to: "COMMIT_UNKNOWN",
      expectedRevision: started.revision,
      details: { reason: "remote outcome lost" },
    });

    const reflection = await buildTaskReflection({ target, packageRoot, taskId: TASK_ID });
    assert.equal(reflection.stallAnalysis.latestNoGain, true);
    assert.equal(reflection.status, "STALLED");
    assert.ok(reflection.signals.includes("EXTERNAL_ACTION_RECONCILIATION_REQUIRED"));
    assert.equal(reflection.recommendedProtocolAction, "RECONCILE_EXTERNAL_ACTION");
  } finally {
    await removeTempTree(target);
  }
});
