import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runActivate } from "../../src/commands/activate.js";
import { runAdvance } from "../../src/commands/advance.js";
import { runApprovalRequest } from "../../src/commands/approval-request.js";
import { runApprovalResolve } from "../../src/commands/approval-resolve.js";
import { runCheck } from "../../src/commands/run-check.js";
import { runContractCreate } from "../../src/commands/contract-create.js";
import { runDiscover } from "../../src/commands/discover.js";
import { runPreflight } from "../../src/commands/preflight.js";
import { runPrepareCompletion } from "../../src/commands/prepare-completion.js";
import { runRecordDiagnosis } from "../../src/commands/record-diagnosis.js";
import { runRoute } from "../../src/commands/route.js";
import { runAction } from "../../src/commands/run-action.js";
import { runActionVerify } from "../../src/commands/action-verify.js";
import { runTaskAbandon } from "../../src/commands/task-abandon.js";
import { runTaskCreate } from "../../src/commands/task-create.js";
import { runTaskResume } from "../../src/commands/task-resume.js";
import { createContract } from "../../src/core/contract.js";
import { listActions, proposeAction, validateActionLedgerConsistency } from "../../src/core/actions.js";
import { testSemanticProvider } from "../../src/core/decision/test-provider.js";
import { appendProtocolEvent, validateEventLedger, validateStateLedgerCoherence } from "../../src/core/events.js";
import { listApprovals } from "../../src/core/approvals.js";
import { readTaskRecovery } from "../../src/core/task-recovery.js";
import { resolveTaskClaimState } from "../../src/core/task-claim-state.js";
import { getPackageRoot } from "../../src/core/templates.js";
import { withTaskTransaction } from "../../src/core/transaction.js";
import { readWorkState } from "../../src/core/work-state.js";
import { seedPolicyEpoch } from "../../tests/helpers/durable-policy.js";

const APPROVAL_POLICY = Object.freeze({
  schemaVersion: 1,
  defaultDecision: "DENY",
  rules: [{ capability: "filesystem.write", decision: "REQUIRE_APPROVAL" }],
});

const ACTION_ID = "action-populated-rich";
const APPROVAL_ID = "approval-populated-rich";
const ACTION_REQUIREMENT = "rich-sentinel-written";

function refusal(message, details = {}) {
  const error = new Error(`RICH_FIXTURE_BASELINE_REFUSED: ${message}`);
  error.code = "E_BENCHMARK_BASELINE_RICH_FIXTURE_UNSUPPORTED";
  error.details = details;
  return error;
}

function publicFixtureRefusal(message, details = {}) {
  const error = new Error(`PUBLIC_FIXTURE_BASELINE_REFUSED: ${message}`);
  error.code = "E_BENCHMARK_BASELINE_PUBLIC_FIXTURE_UNSUPPORTED";
  error.details = details;
  return error;
}

function modulePath(root, relativePath) {
  return pathToFileURL(path.join(root, relativePath)).href;
}

async function importRequiredModule(root, relativePath) {
  try {
    return await import(modulePath(root, relativePath));
  } catch (error) {
    throw refusal(`baseline does not expose ${relativePath}`, {
      relativePath,
      causeCode: error.code ?? null,
      causeMessage: error.message,
    });
  }
}

async function importRequiredPublicModule(root, relativePath) {
  try {
    return await import(modulePath(root, relativePath));
  } catch (error) {
    throw publicFixtureRefusal(`baseline does not expose ${relativePath}`, {
      relativePath,
      causeCode: error.code ?? null,
      causeMessage: error.message,
    });
  }
}

function requireFunction(module, name, relativePath) {
  if (typeof module?.[name] !== "function") {
    throw refusal(`baseline ${relativePath} lacks ${name} required by the rich fixture`, {
      relativePath,
      name,
    });
  }
  return module[name];
}

function requirePublicFunction(module, name, relativePath) {
  if (typeof module?.[name] !== "function") {
    throw publicFixtureRefusal(`baseline ${relativePath} lacks ${name} required by the public fixture`, {
      relativePath,
      name,
    });
  }
  return module[name];
}

async function collectFixtureEvidence({ target, packageRoot, taskId }) {
  const ledger = await validateEventLedger(target, packageRoot, { taskId });
  assert.equal(ledger.valid, true, `rich fixture ledger is invalid: ${JSON.stringify(ledger.errors)}`);
  const state = await readWorkState(target, { packageRoot, taskId });
  assert.ok(state, "rich fixture state is present");
  assert.deepEqual(validateStateLedgerCoherence(state, ledger.events), [], "rich fixture state and ledger agree");

  const actions = await listActions(target, { packageRoot, taskId });
  const actionIssues = await validateActionLedgerConsistency(target, { packageRoot, taskId });
  assert.deepEqual(actionIssues, [], `rich fixture action ledger is invalid: ${JSON.stringify(actionIssues)}`);
  const approvals = await listApprovals(target, { packageRoot, taskId });
  const recoveryArtifact = await readTaskRecovery(target, { packageRoot, taskId });
  const claims = await resolveTaskClaimState(target, { packageRoot, taskId });

  return {
    ledger: ledger.events,
    state,
    actions,
    approvals,
    recovery: recoveryArtifact?.value ?? null,
    claims,
  };
}

/**
 * Append deterministic observations through the canonical event writer. The
 * caller supplies the target total because event-count dimensions are part of
 * the benchmark contract; a shorter target is refused instead of silently
 * changing the requested workload.
 */
export async function appendCanonicalObservationEvents({
  target,
  packageRoot = getPackageRoot(),
  taskId,
  eventCount,
  expectedInitialEventCount = null,
  pathPrefix = "src/benchmark/input.js",
} = {}) {
  assert.equal(typeof taskId, "string");
  assert.ok(Number.isInteger(eventCount) && eventCount >= 1);
  const before = await validateEventLedger(target, packageRoot, { taskId });
  assert.equal(before.valid, true, `cannot append observations to an invalid ledger: ${JSON.stringify(before.errors)}`);
  const initialCount = before.events.length;
  if (expectedInitialEventCount !== null && initialCount !== expectedInitialEventCount) {
    const error = new Error(`public fixture initial event count ${initialCount} differs from expected ${expectedInitialEventCount}`);
    error.code = "E_BENCHMARK_FIXTURE_IDENTITY_MISMATCH";
    throw error;
  }
  if (eventCount < initialCount) {
    const error = new Error(`requested event count ${eventCount} is below public fixture prelude ${initialCount}`);
    error.code = "E_BENCHMARK_FIXTURE_EVENT_COUNT_UNSUPPORTED";
    throw error;
  }
  if (eventCount === initialCount) return { ledger: before.events };

  const observedAt = new Date().toISOString();
  await withTaskTransaction({ target, packageRoot, taskId, operation: "benchmark-observations", recordCommitEvent: true }, async () => {
    // Reserve one event for the canonical transaction commit receipt.
    for (let observation = initialCount; observation < eventCount - 1; observation++) {
      await appendProtocolEvent(target, {
        taskId,
        event: "OBSERVATION",
        at: observedAt,
        details: {
          observation,
          path: pathPrefix,
          message: "Deterministic representative repository observation emitted by the canonical benchmark fixture.",
        },
      }, packageRoot, { taskId });
    }
  });
  const after = await validateEventLedger(target, packageRoot, { taskId });
  assert.equal(after.valid, true, `public observation fixture ledger is invalid: ${JSON.stringify(after.errors)}`);
  assert.equal(after.events.length, eventCount, "public fixture must emit the requested exact event count including commit");
  return { ledger: after.events };
}

/** Build one ordinary scale task through the public task-create/event APIs. */
export async function buildPublicScaleTaskFixture({
  target,
  packageRoot = getPackageRoot(),
  taskId,
  claims,
  eventCount,
  pathPrefix,
} = {}) {
  await runTaskCreate({ target, packageRoot, taskId, claims });
  return appendCanonicalObservationEvents({
    target,
    packageRoot,
    taskId,
    eventCount,
    expectedInitialEventCount: 2,
    pathPrefix,
  });
}

/** Build a complete public task population without direct storage seeding. */
export async function buildPublicTaskDataset({
  target,
  packageRoot = getPackageRoot(),
  size,
  startIndex = 0,
  taskIdAt,
  claimsForIndex,
  pathForIndex,
  eventCount,
  eventCountForIndex,
} = {}) {
  assert.ok(Number.isInteger(size) && size >= 1);
  assert.ok(Number.isInteger(startIndex) && startIndex >= 0 && startIndex <= size);
  assert.equal(typeof taskIdAt, "function");
  assert.ok(typeof eventCountForIndex === "function" || Number.isInteger(eventCount));
  const taskIds = [];
  for (let index = startIndex; index < size; index++) {
    const taskId = taskIdAt(index);
    const claims = claimsForIndex ? claimsForIndex(index) : [`src/populated-cli-task-${index}`];
    const pathPrefix = pathForIndex ? pathForIndex(index) : `src/populated-cli-task-${index}/input.js`;
    const requestedEventCount = eventCountForIndex ? eventCountForIndex(index) : eventCount;
    assert.ok(Number.isInteger(requestedEventCount) && requestedEventCount >= 2,
      "public task datasets require the two task-create events before observations");
    await buildPublicScaleTaskFixture({
      target,
      packageRoot,
      taskId,
      claims,
      eventCount: requestedEventCount,
      pathPrefix,
    });
    taskIds.push(taskId);
  }
  return taskIds;
}

/** Describe the exact event composition emitted by an ordinary public task. */
export function describePublicFixtureEventComposition(eventCount) {
  assert.ok(Number.isInteger(eventCount) && eventCount >= 2);
  const transactionCommitEvents = eventCount > 2 ? 1 : 0;
  return {
    totalEvents: eventCount,
    taskCreateEvents: 2,
    observationEvents: eventCount - 2 - transactionCommitEvents,
    transactionCommitEvents,
  };
}

/**
 * Build one selected task through the public lifecycle and public durable
 * action/recovery surfaces. Bulk tasks remain a separate scale-only lane in
 * the caller; this fixture is the domain-valid selected-task lane.
 */
export async function buildRichSelectedTaskFixture({
  target,
  packageRoot = getPackageRoot(),
  taskId,
  claims = ["src/populated-cli-selected"],
} = {}) {
  assert.equal(typeof target, "string");
  assert.equal(typeof taskId, "string");
  assert.ok(Array.isArray(claims) && claims.length > 0);

  await runTaskCreate({ target, packageRoot, taskId, claims });
  await seedPolicyEpoch(target, packageRoot, taskId, APPROVAL_POLICY);
  await runDiscover({ target, packageRoot, taskId });

  const contract = createContract({
    taskId,
    objective: "Exercise the supported lifecycle, approved action, diagnosis, and recovery paths.",
    deliverables: ["benchmark-sentinel.txt"],
    constraints: [],
    risks: [],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
    verification: [{ id: ACTION_REQUIREMENT, text: "The approved action writes the deterministic sentinel.", type: "VERIFICATION" }],
    successCriteria: ["The selected task preserves canonical lifecycle and recovery invariants."],
  });
  await writeFile(path.join(target, "fixture-contract.json"), JSON.stringify(contract), "utf8");
  await runContractCreate({ target, packageRoot, taskId, contractFile: "fixture-contract.json", semanticProvider: testSemanticProvider });
  await runRoute({ target, packageRoot, taskId, workType: "code", surfaces: ["config"], executableChange: true, semanticProvider: testSemanticProvider });
  const preflight = await runPreflight({ target, packageRoot, taskId });
  assert.equal(preflight.status, "READY", `rich fixture preflight was ${preflight.status}`);
  await runActivate({ target, packageRoot, taskId });
  for (const phase of ["PLANNED", "EXECUTING", "VERIFYING"]) {
    await runAdvance({ target, packageRoot, taskId, to: phase });
  }
  await runPrepareCompletion({ target, packageRoot, taskId });

  const sentinel = path.join(target, "benchmark-sentinel.txt");
  const actionArgv = [process.execPath, "-e", `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "rich-fixture")`];
  const actionInput = {
    actionId: ACTION_ID,
    effectClass: "REVERSIBLE_WRITE",
    capability: "filesystem.write",
    target: "benchmark-sentinel.txt",
    operation: actionArgv.join(" ").slice(0, 512),
    idempotencyKey: `${taskId}:rich-sentinel:v1`,
    requiredForCompletion: true,
    requirement: ACTION_REQUIREMENT,
    provenance: "FORGELOOP_EXECUTED",
  };
  const proposed = await proposeAction(target, { packageRoot, taskId, input: actionInput });
  assert.equal(proposed.action.state, "PROPOSED");
  const requested = await runApprovalRequest({
    target,
    packageRoot,
    taskId,
    approvalId: APPROVAL_ID,
    actionId: ACTION_ID,
    reason: "Deterministic selected-task benchmark action.",
  });
  assert.equal(requested.approval.status, "PENDING");
  const resolved = await runApprovalResolve({
    target,
    packageRoot,
    taskId,
    approvalId: APPROVAL_ID,
    decision: "APPROVED",
    authorityKind: "HOST_ATTESTED",
    hostGrantRef: "benchmark-fixture-grant",
    authorityContext: {
      trustMode: "HOST_ATTESTED",
      hostSupplied: true,
      source: "host-boundary",
      grantRef: "benchmark-fixture-grant",
    },
    reason: "The deterministic benchmark host approved the fixture action.",
  });
  assert.equal(resolved.approvalId, APPROVAL_ID);

  const action = await runAction({
    target,
    packageRoot,
    taskId,
    actionId: ACTION_ID,
    capability: "filesystem.write",
    effectClass: "REVERSIBLE_WRITE",
    actionTarget: "benchmark-sentinel.txt",
    idempotencyKey: `${taskId}:rich-sentinel:v1`,
    requirement: ACTION_REQUIREMENT,
    requiredForCompletion: true,
    approvalId: APPROVAL_ID,
    argv: actionArgv,
  });
  assert.equal(action.action.state, "COMMITTED");

  const passed = await runCheck({
    target,
    packageRoot,
    taskId,
    id: "rich-sentinel-check",
    requirement: ACTION_REQUIREMENT,
    argv: [process.execPath, "-e", `require("node:fs").accessSync(${JSON.stringify(sentinel)})`],
  });
  assert.equal(passed.check.status, "passed");
  const verified = await runActionVerify({
    target,
    packageRoot,
    taskId,
    actionId: ACTION_ID,
    evidenceRef: passed.execution.executionId,
  });
  assert.equal(verified.state, "VERIFIED");

  const failed = await runCheck({
    target,
    packageRoot,
    taskId,
    id: "rich-diagnosis-check",
    requirement: "rich-diagnosis-evidence",
    argv: [process.execPath, "-e", "process.exit(1)"],
  });
  assert.equal(failed.check.status, "failed");
  await runAdvance({ target, packageRoot, taskId, to: "DIAGNOSING" });
  const diagnosis = await runRecordDiagnosis({
    target,
    packageRoot,
    taskId,
    failureClass: "VERIFICATION_FAILURE",
    hypothesis: "The selected-task diagnostic probe intentionally failed for the recovery fixture.",
    evidenceRefs: ["rich-diagnosis-check"],
    settledBy: "The deterministic benchmark fixture binds this diagnosis to the failed check.",
    nextSafeAction: "Resume the abandoned task and preserve its released claims.",
  });
  await runTaskAbandon({ target, packageRoot, taskId, acknowledgeAbandonment: true });
  await runTaskResume({ target, packageRoot, taskId, claims });

  const evidence = await collectFixtureEvidence({ target, packageRoot, taskId });
  return {
    taskId,
    claims: [...claims],
    action: action.action,
    approval: resolved,
    execution: action.execution,
    passedCheck: passed.check,
    verifiedAction: verified,
    failedCheck: failed.check,
    diagnosis: diagnosis.diagnosis,
    ...evidence,
  };
}

async function comparePublicTaskParity({
  nativeRoot,
  portableRoot,
  currentRoot,
  baselineRoot,
  taskIds,
  validateBaselineLedger,
  resolveBaselineClaims,
  readBaselineWorkState,
  refusalFactory,
} = {}) {
  const taskParity = [];
  for (const candidateTaskId of taskIds ?? []) {
    const nativeLedger = await validateEventLedger(nativeRoot, currentRoot, { taskId: candidateTaskId });
    const baselineLedger = await validateBaselineLedger(portableRoot, baselineRoot, { taskId: candidateTaskId });
    if (!nativeLedger.valid || !baselineLedger.valid) {
      throw refusalFactory("a public task failed ledger validation on one backend", {
        taskId: candidateTaskId,
        nativeErrors: nativeLedger.errors,
        baselineErrors: baselineLedger.errors,
      });
    }
    assert.deepEqual(baselineLedger.events, nativeLedger.events, `public task ${candidateTaskId} ledger differs after export`);
    const nativeState = await readWorkState(nativeRoot, { packageRoot: currentRoot, taskId: candidateTaskId });
    const baselineState = await readBaselineWorkState(portableRoot, { packageRoot: baselineRoot, taskId: candidateTaskId });
    assert.deepEqual(baselineState, nativeState, `public task ${candidateTaskId} state differs after export`);
    const nativeClaims = await resolveTaskClaimState(nativeRoot, { packageRoot: currentRoot, taskId: candidateTaskId });
    const baselineClaims = await resolveBaselineClaims(portableRoot, { packageRoot: baselineRoot, taskId: candidateTaskId });
    assert.deepEqual(baselineClaims, nativeClaims, `public task ${candidateTaskId} claims differ after export`);
    taskParity.push({
      taskId: candidateTaskId,
      eventCount: nativeLedger.events.length,
      phase: nativeState?.phase ?? null,
      claimState: nativeClaims.claimState,
    });
  }
  return taskParity;
}

/** Validate ordinary public task projections against the pinned baseline. */
export async function validatePublicTaskParity({
  nativeRoot,
  portableRoot,
  currentRoot = getPackageRoot(),
  baselineRoot,
  taskIds = [],
} = {}) {
  assert.ok(Array.isArray(taskIds) && taskIds.length > 0);
  const eventModule = await importRequiredPublicModule(baselineRoot, "src/core/events.js");
  const claimsModule = await importRequiredPublicModule(baselineRoot, "src/core/task-claim-state.js");
  const workStateModule = await importRequiredPublicModule(baselineRoot, "src/core/work-state.js");
  const taskParity = await comparePublicTaskParity({
    nativeRoot,
    portableRoot,
    currentRoot,
    baselineRoot,
    taskIds,
    validateBaselineLedger: requirePublicFunction(eventModule, "validateEventLedger", "src/core/events.js"),
    resolveBaselineClaims: requirePublicFunction(claimsModule, "resolveTaskClaimState", "src/core/task-claim-state.js"),
    readBaselineWorkState: requirePublicFunction(workStateModule, "readWorkState", "src/core/work-state.js"),
    refusalFactory: publicFixtureRefusal,
  });
  return {
    status: "VALIDATED",
    tasks: taskParity.length,
    taskParity,
  };
}

/**
 * Compare the rich selected-task artifacts, and optionally every public scale
 * task, through the pinned baseline's read/validation APIs. Missing baseline
 * APIs or a non-identical portable result is an explicit admission refusal,
 * never a partial benchmark pass.
 */
export async function validateRichFixtureAcrossBackends({
  nativeRoot,
  portableRoot,
  currentRoot = getPackageRoot(),
  baselineRoot,
  taskId,
  taskIds = [],
} = {}) {
  const native = await collectFixtureEvidence({ target: nativeRoot, packageRoot: currentRoot, taskId });
  const eventModule = await importRequiredModule(baselineRoot, "src/core/events.js");
  const actionModule = await importRequiredModule(baselineRoot, "src/core/actions.js");
  const approvalModule = await importRequiredModule(baselineRoot, "src/core/approvals.js");
  const recoveryModule = await importRequiredModule(baselineRoot, "src/core/task-recovery.js");
  const claimsModule = await importRequiredModule(baselineRoot, "src/core/task-claim-state.js");
  const workStateModule = await importRequiredModule(baselineRoot, "src/core/work-state.js");
  const validateBaselineLedger = requireFunction(eventModule, "validateEventLedger", "src/core/events.js");
  const listBaselineActions = requireFunction(actionModule, "listActions", "src/core/actions.js");
  const validateBaselineActions = requireFunction(actionModule, "validateActionLedgerConsistency", "src/core/actions.js");
  const listBaselineApprovals = requireFunction(approvalModule, "listApprovals", "src/core/approvals.js");
  const readBaselineRecovery = requireFunction(recoveryModule, "readTaskRecovery", "src/core/task-recovery.js");
  const resolveBaselineClaims = requireFunction(claimsModule, "resolveTaskClaimState", "src/core/task-claim-state.js");
  const readBaselineWorkState = requireFunction(workStateModule, "readWorkState", "src/core/work-state.js");

  let baseline;
  try {
    const ledger = await validateBaselineLedger(portableRoot, baselineRoot, { taskId });
    if (!ledger.valid) throw refusal("baseline rejected the exported rich event ledger", { errors: ledger.errors });
    const actions = await listBaselineActions(portableRoot, { packageRoot: baselineRoot, taskId });
    const actionIssues = await validateBaselineActions(portableRoot, { packageRoot: baselineRoot, taskId });
    if (actionIssues.length > 0) throw refusal("baseline action-ledger validation rejected the exported action", { actionIssues });
    const approvals = await listBaselineApprovals(portableRoot, { packageRoot: baselineRoot, taskId });
    const recoveryArtifact = await readBaselineRecovery(portableRoot, { packageRoot: baselineRoot, taskId });
    const claims = await resolveBaselineClaims(portableRoot, { packageRoot: baselineRoot, taskId });
    const state = await readBaselineWorkState(portableRoot, { packageRoot: baselineRoot, taskId });
    baseline = {
      ledger: ledger.events,
      state,
      actions,
      approvals,
      recovery: recoveryArtifact?.value ?? null,
      claims,
    };
  } catch (error) {
    if (error.code === "E_BENCHMARK_BASELINE_RICH_FIXTURE_UNSUPPORTED") throw error;
    throw refusal("baseline could not consume the exported rich fixture", {
      causeCode: error.code ?? null,
      causeMessage: error.message,
    });
  }

  for (const field of ["ledger", "state", "actions", "approvals", "recovery", "claims"]) {
    assert.deepEqual(baseline[field], native[field], `portable baseline ${field} differs from native rich fixture`);
  }

  const taskParity = await comparePublicTaskParity({
    nativeRoot,
    portableRoot,
    currentRoot,
    baselineRoot,
    taskIds,
    validateBaselineLedger,
    resolveBaselineClaims,
    readBaselineWorkState,
    refusalFactory: refusal,
  });

  return {
    status: "VALIDATED",
    taskId,
    requiredApis: [
      "events.validateEventLedger",
      "actions.listActions",
      "actions.validateActionLedgerConsistency",
      "approvals.listApprovals",
      "task-recovery.readTaskRecovery",
      "task-claim-state.resolveTaskClaimState",
    ],
    eventCount: native.ledger.length,
    actionCount: native.actions.length,
    approvalCount: native.approvals.length,
    recoveryStatus: native.recovery?.status ?? null,
    claimState: native.claims.claimState,
    identitiesEqual: true,
    ...(taskParity.length > 0 ? { publicTaskParity: { status: "VALIDATED", tasks: taskParity.length, taskParity } } : {}),
  };
}
