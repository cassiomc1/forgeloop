import { assertTaskId, taskStorageKey } from "./task-identity.js";

export const TASK_STATE_ROOT = ".forgeloop/task-state";
export const TASK_LOCK_ROOT = ".forgeloop/locks";
export const SESSIONS_ROOT = ".forgeloop/sessions";

export const TASK_ARTIFACT_FILES = Object.freeze({
  descriptor: "task.json",
  contract: "contract.json",
  route: "routing-result.json",
  preflight: "preflight.json",
  state: "work-state.json",
  continuity: "continuity.json",
  receipt: "execution-receipt.json",
  events: "events.ndjson",
  gates: "gates",
  executions: "executions",
  actions: "actions",
  approvals: "approvals",
  evaluations: "evaluations",
  usage: "usage.json",
  policySnapshot: "policy-snapshot.json",
  recovery: "recovery.json",
  workspaceBinding: "workspace-binding.json",
  handoffs: "handoffs",
  responsibility: "responsibility.json",
  verificationScope: "verification-scope.json",
  attestations: "attestations",
  structuralQuality: "structural-quality",
  decisions: "decisions",
  testUtility: "test-utility.json",
});

export const POLICY_ROOT = ".forgeloop/policy";

export const PROJECT_ARTIFACT_PATHS = Object.freeze({
  config: ".forgeloop/config.json",
  sources: ".forgeloop/sources.json",
  manifest: ".forgeloop/.manifest.json",
  kit: ".forgeloop/kit",
  gitignore: ".forgeloop/.gitignore",
  policyDir: ".forgeloop/policy",
  policyRules: ".forgeloop/policy/rules.json",
  policyBaseline: ".forgeloop/policy/baseline.json",
  policyLock: ".forgeloop/policy/policy.lock",
  policyDiscovery: ".forgeloop/policy/discovery.json",
  capabilityPolicy: ".forgeloop/policy/capabilities.json",
});

export const LEGACY_TASK_ARTIFACT_PATHS = Object.freeze({
  contract: ".forgeloop/current-contract.json",
  route: ".forgeloop/routing-result.json",
  preflight: ".forgeloop/preflight.json",
  state: ".forgeloop/work-state.json",
  continuity: ".forgeloop/continuity.json",
  receipt: ".forgeloop/execution-receipt.json",
  events: ".forgeloop/events.ndjson",
  gates: ".forgeloop/gates",
  executions: ".forgeloop/executions",
  session: ".forgeloop/session.json",
});

export function taskDirectory(taskId) {
  return `${TASK_STATE_ROOT}/${taskStorageKey(taskId)}`;
}

export function taskArtifactPath(taskId, key) {
  const relative = TASK_ARTIFACT_FILES[key];
  if (!relative) {
    throw new Error(`Unknown task artifact: ${key}`);
  }
  return `${taskDirectory(taskId)}/${relative}`;
}

export function taskGatePath(taskId, gateId) {
  if (typeof gateId !== "string" || !gateId || gateId.includes("/") || gateId.includes("\\") || gateId.includes("..")) {
    throw new Error(`Invalid gate ID: ${gateId}`);
  }
  const cleanId = gateId.endsWith(".json") ? gateId : `${gateId}.json`;
  return `${taskDirectory(taskId)}/${TASK_ARTIFACT_FILES.gates}/${cleanId}`;
}

export function taskExecutionPath(taskId, executionId) {
  if (typeof executionId !== "string" || !/^exec-[A-Za-z0-9_-]+$/.test(executionId)) {
    throw new Error(`Invalid execution ID: ${executionId}`);
  }
  return `${taskDirectory(taskId)}/${TASK_ARTIFACT_FILES.executions}/${executionId}.json`;
}

export function taskActionPath(taskId, actionId) {
  if (typeof actionId !== "string" || !/^action-[A-Za-z0-9_-]+$/.test(actionId)) {
    throw new Error(`Invalid action ID: ${actionId}`);
  }
  return `${taskDirectory(taskId)}/${TASK_ARTIFACT_FILES.actions}/${actionId}.json`;
}

export function taskApprovalPath(taskId, approvalId) {
  if (typeof approvalId !== "string" || !/^approval-[A-Za-z0-9_-]+$/.test(approvalId)) {
    throw new Error(`Invalid approval ID: ${approvalId}`);
  }
  return `${taskDirectory(taskId)}/${TASK_ARTIFACT_FILES.approvals}/${approvalId}.json`;
}

export function taskEvaluationPath(taskId, evaluationId) {
  if (typeof evaluationId !== "string" || !/^eval-[A-Za-z0-9_-]+$/.test(evaluationId)) {
    throw new Error(`Invalid evaluation ID: ${evaluationId}`);
  }
  return `${taskDirectory(taskId)}/${TASK_ARTIFACT_FILES.evaluations}/${evaluationId}.json`;
}

export function taskDecisionDirectory(taskId) {
  return taskArtifactPath(taskId, "decisions");
}

export function taskDecisionPath(taskId, decisionId) {
  assertArtifactId(decisionId, /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, "decision ID");
  return `${taskDecisionDirectory(taskId)}/${decisionId}.json`;
}

function assertArtifactId(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}

export function taskWorkspaceBindingPath(taskId) {
  return taskArtifactPath(taskId, "workspaceBinding");
}

export function taskResponsibilityPath(taskId) {
  return taskArtifactPath(taskId, "responsibility");
}

export function taskVerificationScopePath(taskId) {
  return taskArtifactPath(taskId, "verificationScope");
}

export function taskHandoffDirectory(taskId) {
  return taskArtifactPath(taskId, "handoffs");
}

export function taskHandoffPath(taskId, handoffId) {
  assertArtifactId(handoffId, /^handoff-[A-Za-z0-9_-]+$/, "handoff ID");
  return `${taskHandoffDirectory(taskId)}/${handoffId}.json`;
}

export function taskAttestationDirectory(taskId) {
  return taskArtifactPath(taskId, "attestations");
}

export function taskCodeManifestPath(taskId) {
  return `${taskAttestationDirectory(taskId)}/code-manifest.json`;
}

export function taskAttestationStatementPath(taskId) {
  return `${taskAttestationDirectory(taskId)}/statement.json`;
}

export function taskAttestationBundlePath(taskId) {
  return `${taskAttestationDirectory(taskId)}/statement.sigstore.json`;
}

export function taskAttestationHistoryDirectory(taskId, verificationCycle) {
  if (!Number.isInteger(verificationCycle) || verificationCycle < 1) {
    throw new Error(`Invalid attestation verification cycle: ${verificationCycle}`);
  }
  return `${taskAttestationDirectory(taskId)}/history/cycle-${verificationCycle}`;
}

export function taskStructuralQualityDirectory(taskId) {
  return `${taskDirectory(taskId)}/${TASK_ARTIFACT_FILES.structuralQuality}`;
}

export function taskStructuralQualityBaselinePath(taskId) {
  return `${taskStructuralQualityDirectory(taskId)}/baseline.json`;
}

export function taskStructuralQualityEvaluationsDirectory(taskId) {
  return `${taskStructuralQualityDirectory(taskId)}/evaluations`;
}

export function taskStructuralQualityEvaluationPath(taskId, verificationCycle, attempt) {
  if (!Number.isInteger(verificationCycle) || verificationCycle < 1) {
    throw new Error(`Invalid structural quality verification cycle: ${verificationCycle}`);
  }
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`Invalid structural quality evaluation attempt: ${attempt}`);
  }
  return `${taskStructuralQualityEvaluationsDirectory(taskId)}/cycle-${verificationCycle}-attempt-${attempt}.json`;
}

export function taskCodeManifestHistoryPath(taskId, verificationCycle) {
  return `${taskAttestationHistoryDirectory(taskId, verificationCycle)}/code-manifest.json`;
}

export function taskAttestationStatementHistoryPath(taskId, verificationCycle) {
  return `${taskAttestationHistoryDirectory(taskId, verificationCycle)}/statement.json`;
}

export function taskLockPath(taskId) {
  assertTaskId(taskId);
  return `${TASK_LOCK_ROOT}/${taskStorageKey(taskId)}.lock`;
}

export function sessionArtifactPath(sessionId) {
  if (typeof sessionId !== "string" || !sessionId || sessionId.includes("/") || sessionId.includes("\\") || sessionId.includes("..")) {
    throw new Error(`Invalid session ID: ${sessionId}`);
  }
  const cleanId = sessionId.endsWith(".json") ? sessionId : `${sessionId}.json`;
  return `${SESSIONS_ROOT}/${cleanId}`;
}

export function buildTaskArtifactPaths(taskId) {
  assertTaskId(taskId);
  const dir = taskDirectory(taskId);
  return Object.freeze({
    descriptor: `${dir}/${TASK_ARTIFACT_FILES.descriptor}`,
    contract: `${dir}/${TASK_ARTIFACT_FILES.contract}`,
    route: `${dir}/${TASK_ARTIFACT_FILES.route}`,
    preflight: `${dir}/${TASK_ARTIFACT_FILES.preflight}`,
    state: `${dir}/${TASK_ARTIFACT_FILES.state}`,
    continuity: `${dir}/${TASK_ARTIFACT_FILES.continuity}`,
    receipt: `${dir}/${TASK_ARTIFACT_FILES.receipt}`,
    events: `${dir}/${TASK_ARTIFACT_FILES.events}`,
    gates: `${dir}/${TASK_ARTIFACT_FILES.gates}`,
    executions: `${dir}/${TASK_ARTIFACT_FILES.executions}`,
    actions: `${dir}/${TASK_ARTIFACT_FILES.actions}`,
    approvals: `${dir}/${TASK_ARTIFACT_FILES.approvals}`,
    evaluations: `${dir}/${TASK_ARTIFACT_FILES.evaluations}`,
    decisions: `${dir}/${TASK_ARTIFACT_FILES.decisions}`,
    testUtility: `${dir}/${TASK_ARTIFACT_FILES.testUtility}`,
    usage: `${dir}/${TASK_ARTIFACT_FILES.usage}`,
    lock: taskLockPath(taskId),
    policySnapshot: `${dir}/${TASK_ARTIFACT_FILES.policySnapshot}`,
    recovery: `${dir}/${TASK_ARTIFACT_FILES.recovery}`,
    workspaceBinding: `${dir}/${TASK_ARTIFACT_FILES.workspaceBinding}`,
    handoffs: `${dir}/${TASK_ARTIFACT_FILES.handoffs}`,
    responsibility: `${dir}/${TASK_ARTIFACT_FILES.responsibility}`,
    verificationScope: `${dir}/${TASK_ARTIFACT_FILES.verificationScope}`,
    attestations: `${dir}/${TASK_ARTIFACT_FILES.attestations}`,
    structuralQuality: `${dir}/${TASK_ARTIFACT_FILES.structuralQuality}`,
    codeManifest: taskCodeManifestPath(taskId),
    attestationStatement: taskAttestationStatementPath(taskId),
    attestationBundle: taskAttestationBundlePath(taskId),
  });
}
