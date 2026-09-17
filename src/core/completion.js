import { ARTIFACT_PATHS, canonicalFingerprint, readJsonArtifact, writeJsonArtifact } from "./artifacts.js";
import { requiredEvidenceForTarget, validateChecksExecutionProvenance } from "./completion-artifacts.js";
import { appendProtocolEvent, previewProtocolEvent, LIFECYCLE_MILESTONES, validateEventLedger, validateStateLedgerCoherence } from "./events.js";
import { evaluatePreflight } from "./preflight.js";
import { readContract } from "./contract.js";
import { readPersistedRoute } from "./route-artifact.js";
import { readWorkState, mutateWorkState, classifyLoadedWorkState } from "./work-state.js";
import { createReceipt, validateReceipt } from "./receipt.js";
import { completionRelationshipErrors } from "./completion-relationships.js";
import { assertSafePath, ensureWithin, fileExists } from "./filesystem.js";
import { evaluateStartExecutionPrerequisites, hasExecutionStarted } from "./execution-prerequisites.js";
import { isRecoverableCompletionEvidenceCode } from "./completion-recovery.js";
import { evaluateTerminalRequirements, terminalRequirementsForContract } from "./evidence-readiness.js";
import { PROJECT_ARTIFACT_PATHS, taskArtifactPath, taskCodeManifestPath } from "./task-paths.js";
import { detectPolicyCapability, evaluateTargetPolicy } from "./policy-engine.js";
import { listActions } from "./actions.js";
import { readConfig } from "./config.js";
import { resolveResponsibilityStatus } from "./responsibility.js";
import { createCodeManifest, readCodeManifest, validateCodeManifestBindings, writeCodeManifest } from "./code-manifest.js";
import { getTaskTransaction, withTaskTransaction } from "./transaction.js";
import { validateStructuralQualityCheckProvenance } from "./structural-quality/service.js";

async function attestationConfiguration(target, packageRoot, errors) {
  try {
    const config = await readConfig(target, packageRoot);
    return {
      mode: config.attestation?.mode ?? "off",
      revisionProvider: config.attestation?.revisionProvider ?? "git",
      requireCompleteCoverage: config.attestation?.requireCompleteCoverage === true,
      signing: config.attestation?.signing ?? { provider: "none", required: false, policy: {} },
    };
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING") return { mode: "off", revisionProvider: "git", requireCompleteCoverage: false, signing: { provider: "none", required: false, policy: {} } };
    errors.push(issue(error.code ?? "E_ATTESTATION_INVALID", `Attestation configuration is invalid: ${error.message}`, [PROJECT_ARTIFACT_PATHS.config]));
    return { mode: "off", revisionProvider: "git", requireCompleteCoverage: false, signing: { provider: "none", required: false, policy: {} } };
  }
}

async function actionReceiptSummary(target, packageRoot, taskId) {
  const actions = await listActions(target, { packageRoot, taskId });
  const { evaluateRequiredActionReadiness } = await import("./action-readiness.js");
  const readiness = await evaluateRequiredActionReadiness({ target, packageRoot, taskId });
  return {
    count: actions.length,
    required: readiness.total,
    verified: actions.filter((action) => action.state === "VERIFIED").length,
    // Raw state counts are observability only; trusted completion is below.
    trustedSatisfied: readiness.satisfied,
    unresolvedRequired: readiness.unresolved,
    failed: actions.filter((action) => action.state === "FAILED").length,
    ambiguous: actions.filter((action) => action.state === "COMMIT_UNKNOWN").length,
    pending: actions.filter((action) => !["VERIFIED", "FAILED", "CANCELLED"].includes(action.state)).length,
    actionRefs: actions.map((action) => action.actionId),
  };
}

/**
 * Canonical completion return statuses shared by the runtime, tests, and
 * documentation conformance. The CLI reference's return-status prose is
 * mechanically checked against this set.
 */
export const COMPLETION_STATUSES = Object.freeze(["VALID", "REJECTED"]);

/**
 * Canonical completion verification-status values returned by
 * evaluateCompletion. The asymmetric casing (VALID / invalid) is the actual
 * runtime contract and is intentionally preserved; documentation conformance
 * checks documented examples and prose against this exact set, and the runtime
 * derives its output from these same named constants.
 */
export const VERIFICATION_STATUS_VALID = "VALID";
export const VERIFICATION_STATUS_INVALID = "invalid";
export const VERIFICATION_STATUSES = Object.freeze([
  VERIFICATION_STATUS_VALID,
  VERIFICATION_STATUS_INVALID,
]);

function issue(code, message, artifacts = [], details = {}) {
  return { code, message, artifacts, ...details };
}

export function completionIdentityErrors({ contract, state, receipt } = {}) {
  return completionRelationshipErrors({ contract, state, receipt })
    .filter((error) => ["E_STATE_TASK_MISMATCH", "E_RECEIPT_TASK_MISMATCH"].includes(error.code));
}

function repairNext(error) {
  switch (error.code) {
    case "E_RECEIPT_MISSING":
      return "Run forgeloop prepare-completion after recording verification evidence.";
    case "E_RECEIPT_INVALID":
    case "E_RECEIPT_CONTRACT_MISMATCH":
    case "E_RECEIPT_ROUTE_MISMATCH":
    case "E_RECEIPT_STATE_MISMATCH":
    case "E_RECEIPT_CYCLE_MISMATCH":
      return "Run forgeloop prepare-completion, inspect the receipt, and validate it before retrying completion.";
    case "E_PHASE_PREREQUISITE_MISSING":
      return "Advance from EXECUTING through VERIFYING and REVIEWING, resolving the named prerequisite before completion.";
    case "E_PHASE_CHRONOLOGY_INVALID":
      return "Record the missing lifecycle event through the normal phase transition or forgeloop record-check path.";
    case "E_EVIDENCE_REQUIRED":
    case "E_EVIDENCE_COVERAGE_INVALID":
    case "E_EVIDENCE_COVERAGE_PARTIAL":
    case "E_EVIDENCE_KIND_INVALID":
    case "E_CHECK_INVALID":
    case "E_CHECK_STATUS_CONTRADICTION":
      return "Run forgeloop record-check with compatible observed evidence for the named requirement.";
    case "E_COMMAND_PROVENANCE_UNATTESTED":
    case "E_EXECUTION_REF_INVALID":
      return "Run forgeloop run-check with the exact argv, or record the result as manual/NOT_VERIFIED evidence without claiming command execution.";
    case "E_EVIDENCE_PARTIAL":
      return "Run or finish the missing component checks and record observed evidence.";
    case "E_EVIDENCE_INVALID":
      return "Resolve the invalid evidence format or failure status with forgeloop record-check.";
    case "E_FUTURE_LIFECYCLE_EVIDENCE":
      return "Remove the premature terminal claim; the lifecycle event must satisfy it.";
    case "E_CIRCULAR_COMPLETION_REQUIREMENT":
    case "E_MIXED_TERMINAL_REQUIREMENT":
      return "Split ordinary verification from terminal lifecycle criteria.";
    case "E_PUBLICATION_REQUIREMENT_PENDING":
      return "The contract explicitly requires publication. Record authoritative publication evidence or revise the contract if publication is not in scope.";
    case "E_PRODUCTION_READINESS_REQUIREMENT_PENDING":
    case "E_PRODUCTION_REQUIREMENT_PENDING":
      return "The contract explicitly requires production readiness. Record authoritative deployment/readiness evidence before completion.";
    case "E_TERMINAL_REQUIREMENT_PENDING":
      return "The contract contains an unresolved terminal requirement. Ensure all terminal lifecycle criteria are satisfied.";
    case "E_TERMINAL_REQUIREMENT_UNKNOWN":
      return "Terminal results must reference an existing canonical requirement declared in the contract.";
    case "E_TERMINAL_REQUIREMENT_NOT_TERMINAL":
      return "Use forgeloop record-check for ordinary verification requirements.";
    case "E_TERMINAL_REQUIREMENT_TYPE_MISMATCH":
      return "Ensure the supplied terminal type matches the canonical requirement type.";
    case "E_TERMINAL_STATUS_REGRESSION":
      return "Terminal publication status cannot regress to a weaker state.";
    case "E_STATE_LEDGER_DIVERGENCE":
      return "Do not edit work-state or receipt manually; recover through supported lifecycle commands.";
    case "E_COMPLETION_RECOVERY_UNAUTHORIZED":
    case "E_COMPLETION_REJECTION_LEDGER_MISMATCH":
    case "E_CYCLE_CLOSED":
      return "Advance the task through valid lifecycle phases (PLANNED -> EXECUTING -> VERIFYING -> REVIEWING).";
    case "E_LEDGER_INVALID":
    case "E_LEDGER_STALE":
    case "E_STATE_LEDGER_MISMATCH":
      return "Inspect the event ledger and repair sequence or integrity violations.";
    case "E_EVIDENCE_MISSING":
    case "E_EVIDENCE_BLOCKED":
    case "E_CHECK_FAILED":
    case "E_REQUIREMENT_UNMET":
      return "Execute and pass all required checks using forgeloop run-check before completion.";
    case "E_CHECK_EXECUTION_PROVENANCE_MISSING":
      return "Re-run checks via forgeloop run-check to ensure ForgeLoop execution provenance.";
    case "E_CONTRACT_PROFILE_STRICT_UNVERIFIED":
      return "Use Standard mode for a fresh target, or verify PROJECT_PROFILE.md before Strict completion.";
    case "E_INSTALLATION_AUTHORITY_REQUIRED":
    case "E_AUTHORITY_INVALID":
    case "E_AUTHORITY_SCOPE_MISMATCH":
    case "E_AUTHORITY_UNTRUSTED_SOURCE":
      return "Do not execute installation-capable verification commands without explicit scoped installation authority; use local equivalents or record NOT_VERIFIED.";
    case "E_VERIFICATION_TOOL_UNAVAILABLE":
      return "Use an available local verifier, an existing equivalent, or record NOT_VERIFIED if installation was not authorized.";
    case "E_STRUCTURAL_QUALITY_CONFIGURATION_INVALID":
      return "Repair structuralQuality configuration in .forgeloop/config.json and rerun preflight.";
    case "E_STRUCTURAL_QUALITY_PROVIDER_UNAVAILABLE":
    case "E_STRUCTURAL_QUALITY_PROVIDER_PROTOCOL_INVALID":
    case "E_STRUCTURAL_QUALITY_SCAN_FAILED":
    case "E_STRUCTURAL_QUALITY_TIMEOUT":
    case "E_STRUCTURAL_QUALITY_OUTPUT_LIMIT":
      return "Restore the trusted structural-quality provider and rerun quality-verify; do not promote an unavailable or malformed scan.";
    case "E_STRUCTURAL_QUALITY_BASELINE_MISSING":
      return "Run forgeloop quality-baseline --task <id> while the task is PLANNED, before execution begins.";
    case "E_STRUCTURAL_QUALITY_BASELINE_EXISTS":
    case "E_STRUCTURAL_QUALITY_BASELINE_PHASE_INVALID":
      return "Keep the original baseline and correct the task against it; baseline replacement is only allowed before EXECUTING.";
    case "E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH":
    case "E_STRUCTURAL_QUALITY_EVALUATION_INCOMPARABLE":
      return "Reconcile provider, version, rules, policy, scope, contract, or route drift, then rerun quality-verify in the active cycle.";
    case "E_STRUCTURAL_QUALITY_EVIDENCE_STALE":
      return "Run quality-verify for the current verification cycle and refresh the receipt through the canonical completion pipeline.";
    case "E_STRUCTURAL_QUALITY_REGRESSION":
      return "Use the bottleneck and root-cause deltas to record an evidence-backed diagnosis, correct within scope, and verify a new cycle.";
    case "E_NEW_POLICY_VIOLATION":
      return "Resolve the new policy violation or record baseline if adopted debt before completion.";
    case "E_POLICY_WEAKENING":
      return "Restore the original policy configuration or obtain explicit project authority before retrying completion.";
    case "E_CHECK_INERT":
      return "Configure an applicable target scope or mark the inert check unsupported.";
    case "E_CHECK_MUTATION_NOT_DETECTED":
      return "Fix checker logic to properly detect intentional mutation fixtures.";
    case "E_CHECK_MUTATION_EXECUTION_ERROR":
      return "Repair the checker execution path and rerun rule verification.";
    case "E_POLICY_LOCK_MISMATCH":
      return "Re-evaluate effective rules and update policy.lock or restore modified rules.";
    case "E_POLICY_DRIFT":
    case "E_POLICY_DRIFT_UNKNOWN":
      return "Re-verify affected checks or restore original policy.";
    case "E_POLICY_INVALID":
      return "Validate and repair rules.json, baseline.json, or discovery.json against schema.";
    case "E_POLICY_EVALUATION_FAILED":
      return "Inspect policy configuration and checker adapters for unhandled errors.";
    case "E_BASELINE_EXPANSION":
    case "E_BASELINE_RECORD_DURING_ACTIVE_TASK":
      return "Resolve new violations rather than expanding the baseline.";
    default:
      return "Resolve this validator finding in the named artifact before retrying completion.";
  }
}

function withRepairGuidance(error) {
  const normalized = {
    ...error,
    code: error.code ?? "E_COMPLETION_REJECTED",
    message: error.message ?? String(error),
    artifacts: error.artifacts ?? [],
  };
  if (normalized.next) return normalized;
  return { ...normalized, next: repairNext(normalized) };
}

function sortIssues(issues) {
  return issues
    .map(withRepairGuidance)
    .sort((a, b) => (a.code || "").localeCompare(b.code || "") || (a.message || "").localeCompare(b.message || ""));
}

async function loadRequired(readArtifact, errorCode, errorMessage, artifacts, errors) {
  try {
    return await readArtifact();
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING") {
      errors.push(issue(errorCode, errorMessage, artifacts));
      return null;
    }
    errors.push(issue(error.code ?? errorCode, error.message ?? errorMessage, artifacts));
    return null;
  }
}

function publicationStatus(receipt) {
  if (receipt.publicationStatus) return receipt.publicationStatus;
  if (receipt.publication?.deployed) return "deployed";
  if (receipt.publication?.pushed) return "pushed";
  if (receipt.publication?.committed) return "committed";
  return receipt.changedPaths?.length > 0 ? "local-only" : "not-published";
}

async function validateLedger(target, scopedTaskId, contractTaskId, state, errors, packageRoot, options = {}) {
  const eventsRel = options.eventsPath ?? (scopedTaskId ? taskArtifactPath(scopedTaskId, "events") : ARTIFACT_PATHS.events);
  const stateRel = options.statePath ?? (scopedTaskId ? taskArtifactPath(scopedTaskId, "state") : ARTIFACT_PATHS.state);
  await assertSafePath(target, eventsRel);
  const eventsFilePath = ensureWithin(target, eventsRel);
  if (!(await fileExists(eventsFilePath))) {
    errors.push(issue("E_PHASE_CHRONOLOGY_INVALID", "Protocol event ledger is required before completion", [eventsRel]));
    return { valid: false, events: [], errors: [] };
  }
  const ledger = await validateEventLedger(target, packageRoot, { taskId: scopedTaskId, eventsPath: options.eventsPath });
  for (const error of ledger.errors) errors.push({ ...error, artifacts: [eventsRel] });
  for (const error of validateStateLedgerCoherence(state, ledger.events)) {
    errors.push({ ...error, artifacts: [stateRel, eventsRel] });
  }
  const requiredEvents = LIFECYCLE_MILESTONES.slice(0, state?.phase === "COMPLETE" ? undefined : -1);
  const observed = new Set(ledger.events.filter((event) => event.taskId === contractTaskId).map((event) => event.event));
  for (const event of requiredEvents) {
    if (!observed.has(event)) {
      errors.push(issue("E_PHASE_CHRONOLOGY_INVALID", `Required protocol event is missing: ${event}`, [eventsRel], { event }));
    }
  }
  if (ledger.events.some((event) => event.taskId !== contractTaskId)) {
    errors.push(issue("E_PHASE_CHRONOLOGY_INVALID", "Protocol events must belong to the current task", [eventsRel]));
  }
  if (state?.phase !== "COMPLETE" && observed.has("COMPLETION_VALIDATED")) {
    errors.push(issue("E_PHASE_CHRONOLOGY_INVALID", "COMPLETION_VALIDATED requires COMPLETE state", [eventsRel]));
  }
  return ledger;
}

export async function evaluateCompletion({
  target,
  packageRoot,
  strict = false,
  authorityContext,
  runtimeContext,
  taskId = null,
  contractPath = null,
  routePath = null,
  statePath = null,
  receiptPath = null,
  eventsPath = null,
  preflightPath = null,
} = {}) {
  const errors = [];
  const preflight = await evaluatePreflight({ target, packageRoot, strict, taskId, contractPath, routePath, statePath });
  errors.push(...preflight.errors);

  const contractRel = contractPath ?? (taskId ? taskArtifactPath(taskId, "contract") : ARTIFACT_PATHS.contract);
  const routeRel = routePath ?? (taskId ? taskArtifactPath(taskId, "route") : ARTIFACT_PATHS.route);
  const stateRel = statePath ?? (taskId ? taskArtifactPath(taskId, "state") : ARTIFACT_PATHS.state);
  const receiptRel = receiptPath ?? (taskId ? taskArtifactPath(taskId, "receipt") : ARTIFACT_PATHS.receipt);

  const contract = await loadRequired(
    () => readContract(target, packageRoot, { taskId, contractPath }),
    "E_CONTRACT_MISSING",
    "Current contract is not available",
    [contractRel],
    errors,
  );
  const route = await loadRequired(
    () => readPersistedRoute(target, packageRoot, { taskId, routePath }),
    "E_ROUTE_MISSING",
    "Persisted routing result is not available",
    [routeRel],
    errors,
  );
  const state = await loadRequired(
    () => readWorkState(target, { packageRoot, taskId, statePath }).then((value) => {
      if (!value) {
        const error = new Error("Work state is missing");
        error.code = "ARTIFACT_MISSING";
        throw error;
      }
      return value;
    }),
    "E_STATE_MISSING",
    "Work state is not available",
    [stateRel],
    errors,
  );
  const receipt = await loadRequired(
    () => readJsonArtifact(target, receiptRel, "execution-receipt", packageRoot),
    "E_RECEIPT_MISSING",
    "Execution receipt is not available",
    [receiptRel],
    errors,
  );
  const attestationConfig = await attestationConfiguration(target, packageRoot, errors);
  let attestation = {
    mode: attestationConfig.mode,
    status: attestationConfig.mode === "off" ? "DISABLED" : "MISSING",
    level: "PROCESSED",
    manifest: null,
    revisionProvider: attestationConfig.revisionProvider,
    requireCompleteCoverage: attestationConfig.requireCompleteCoverage,
  };

  if (state?.phase === "COMPLETE" && attestationConfig.mode !== "off") {
    try {
      const manifest = await readCodeManifest({ target, packageRoot, taskId: contract?.value?.taskId ?? taskId });
      await validateCodeManifestBindings({
        target,
        packageRoot,
        taskId: contract?.value?.taskId ?? taskId,
        manifest: manifest.value,
        revisionProvider: attestationConfig.revisionProvider,
      });
      attestation = {
        ...attestation,
        status: "CAPTURED",
        level: "VERIFIED",
        manifest: { path: manifest.path, fingerprint: manifest.fingerprint, contentDigest: manifest.value.contentDigest },
      };
    } catch (error) {
      if (attestationConfig.mode === "required") {
        errors.push(issue(error.code === "ARTIFACT_MISSING" ? "E_ATTESTATION_MANIFEST_MISSING" : error.code ?? "E_ATTESTATION_MANIFEST_STALE", error.message, error.artifacts ?? [taskArtifactPath(contract?.value?.taskId ?? taskId, "attestations")]));
      }
      attestation = {
        ...attestation,
        status: error.code === "ARTIFACT_MISSING" ? "MISSING" : "UNAVAILABLE",
        error: { code: error.code ?? "E_ATTESTATION_MANIFEST_STALE", message: error.message },
      };
    }
  }

  let responsibility = { status: "NOT_APPLICABLE", taskId: contract?.value?.taskId ?? taskId, errors: [] };
  if (taskId || contract?.value?.taskId) {
    try {
      responsibility = await resolveResponsibilityStatus(target, {
        packageRoot,
        taskId: contract?.value?.taskId ?? taskId,
      });
      for (const error of responsibility.errors ?? []) {
        errors.push(issue(error.code, error.message, [responsibility.path ?? taskArtifactPath(taskId, "responsibility")]));
      }
    } catch (error) {
      errors.push(issue(error.code ?? "E_RESPONSIBILITY_INVALID", error.message, [taskArtifactPath(taskId, "responsibility")]));
      responsibility = { status: "INVALID", taskId: contract?.value?.taskId ?? taskId, errors: [{ code: error.code ?? "E_RESPONSIBILITY_INVALID", message: error.message }] };
    }
  }

  if (state && hasExecutionStarted(state.phase)) {
    const prerequisites = await evaluateStartExecutionPrerequisites({ target, state, packageRoot, taskId, statePath, contractPath, routePath });
    errors.push(...prerequisites.errors);
  }

  if (receipt) {
    try {
      await validateReceipt(receipt.value, packageRoot, {
        target,
        taskId: contract?.value?.taskId,
        authorityContext,
        runtimeContext,
      });
    } catch (error) {
      errors.push(issue(error.code ?? "E_RECEIPT_INVALID", `Execution receipt is invalid: ${error.message}`, [receiptRel]));
    }
  }

  if (contract) {
    try {
      await validateChecksExecutionProvenance(state?.checks, {
        target,
        packageRoot,
        taskId: contract.value.taskId,
        artifactPath: stateRel,
      });
    } catch (error) {
      errors.push(issue(error.code ?? "E_EXECUTION_REF_INVALID", error.message, error.artifacts ?? [stateRel]));
    }
    try {
      await validateChecksExecutionProvenance(receipt?.value?.checks, {
        target,
        packageRoot,
        taskId: contract.value.taskId,
        artifactPath: receiptRel,
      });
    } catch (error) {
      errors.push(issue(error.code ?? "E_EXECUTION_REF_INVALID", error.message, error.artifacts ?? [receiptRel]));
    }
  }

  if (state && !["REVIEWING", "COMPLETE"].includes(state.phase)) {
    errors.push(issue("E_PHASE_PREREQUISITE_MISSING", `Completion requires REVIEWING or COMPLETE state, found ${state.phase}`, [stateRel]));
  }

  let coverage = [];
  if (contract && route) {
    const requiredEvidence = await requiredEvidenceForTarget({
      target,
      contract,
      route,
      packageRoot,
      additionalEvidence: preflight?.policy?.requiredEvidence ?? [],
    });
    const relationshipErrors = completionRelationshipErrors({
      contract,
      route,
      state,
      receipt: receipt?.value,
      requiredEvidence,
      target,
      taskId: contract?.value?.taskId,
      authorityContext,
      runtimeContext,
    });
    errors.push(...relationshipErrors);
    coverage = receipt?.value?.evidenceCoverage ?? [];
  }

  if (contract && route && state) {
    const qualityChecks = [...new Map([
      ...(state.checks ?? []),
      ...(receipt?.value?.checks ?? []),
    ].filter((check) => check?.kind === "structural-quality").map((check) => [check.id, check])).values()];
    for (const check of qualityChecks) {
      const provenanceErrors = await validateStructuralQualityCheckProvenance(check, {
        target,
        packageRoot,
        taskId: contract.value.taskId,
        state,
        contract,
        route,
        runtimeContext,
      });
      for (const error of provenanceErrors) {
        errors.push(issue(error.code ?? "E_STRUCTURAL_QUALITY_EVIDENCE_STALE", error.message, error.artifacts ?? [stateRel, receiptRel]));
      }
    }
  }

  const ledger = contract && state
    ? await validateLedger(target, taskId, contract.value.taskId, state, errors, packageRoot, { eventsPath, statePath })
    : { valid: false, events: [], errors: [] };

  if (state) {
    try {
      const classification = await classifyLoadedWorkState({
        target,
        state,
        contractFile: contractRel,
      });
      if (classification.status === "REVALIDATION_REQUIRED") {
        for (const reason of classification.reasons) {
          errors.push(issue(reason === "CONTRACT_CHANGED" ? "E_CONTRACT_STALE" : "E_PHASE_ARTIFACT_STALE", `State freshness check failed: ${reason}`, [stateRel]));
        }
      }
    } catch (error) {
      errors.push(issue("E_PHASE_ARTIFACT_STALE", error.message, [stateRel]));
    }
  }

  const receiptValue = receipt?.value;
  const publication = receiptValue ? publicationStatus(receiptValue) : "not-published";

  if (contract) {
    const terminalEval = evaluateTerminalRequirements({
      requirements: terminalRequirementsForContract(contract.value, {
        additionalEvidence: preflight.policy?.requiredEvidence ?? [],
      }),
      receipt: receiptValue,
    });
    for (const termErr of terminalEval.errors) {
      errors.push(issue(
        termErr.code,
        termErr.message,
        [contractRel, receiptRel],
        { requirementId: termErr.requirementId },
      ));
    }
  }

  const policyCapability = await detectPolicyCapability(target, packageRoot);
  if (policyCapability === "INVALID") {
    errors.push(issue(
      "E_POLICY_INVALID",
      "Policy configuration or baseline artifacts are malformed or fail schema validation.",
      [PROJECT_ARTIFACT_PATHS.policyRules, PROJECT_ARTIFACT_PATHS.policyBaseline],
    ));
  } else if (policyCapability === "AVAILABLE") {
    try {
      const policyEval = await evaluateTargetPolicy({
        target,
        packageRoot,
        taskId: contract?.value?.taskId ?? taskId,
      });
      for (const policyErr of policyEval.errors ?? []) {
        const code = policyErr.code === "NEW_VIOLATION" ? "E_NEW_POLICY_VIOLATION"
          : policyErr.code === "POLICY_WEAKENING" ? "E_POLICY_WEAKENING"
          : policyErr.code === "CHECK_INERT" ? "E_CHECK_INERT"
          : policyErr.code === "CHECK_MUTATION_NOT_DETECTED" ? "E_CHECK_MUTATION_NOT_DETECTED"
          : policyErr.code === "CHECK_MUTATION_EXECUTION_ERROR" ? "E_CHECK_MUTATION_EXECUTION_ERROR"
          : policyErr.code === "POLICY_LOCK_MISMATCH" ? "E_POLICY_LOCK_MISMATCH"
          : policyErr.code === "POLICY_DRIFT_UNKNOWN" ? "E_POLICY_DRIFT_UNKNOWN"
          : policyErr.code === "POLICY_EVALUATION_FAILED" ? "E_POLICY_EVALUATION_FAILED"
          : policyErr.code;
        errors.push(issue(
          code,
          policyErr.why || policyErr.message,
          [PROJECT_ARTIFACT_PATHS.policyLock],
          { ruleId: policyErr.ruleId, fix: policyErr.fix },
        ));
      }
    } catch (error) {
      errors.push(issue(
        "E_POLICY_EVALUATION_FAILED",
        `Policy evaluation threw an unexpected error: ${error.message}`,
        [PROJECT_ARTIFACT_PATHS.policyLock],
      ));
    }
  }

  const actionTaskId = contract?.value?.taskId ?? taskId;
  const durableActions = actionTaskId
    ? await listActions(target, { packageRoot, taskId: actionTaskId })
    : [];
  const contractRequirements = new Set([
    ...(contract?.value?.verification ?? []), ...(contract?.value?.successCriteria ?? []),
  ]);
  // Completion truth consumes the canonical action-readiness projection, not
  // raw state labels: a forged VERIFIED label can never satisfy a required
  // action (INV-VERIFY-02).
  const { evaluateRequiredActionReadiness } = await import("./action-readiness.js");
  const requiredActionReadiness = actionTaskId
    ? await evaluateRequiredActionReadiness({ target, packageRoot, taskId: actionTaskId })
    : { total: 0, satisfied: 0, unresolved: 0, ambiguous: 0, failed: 0, untrusted: 0, actions: [] };
  for (const readiness of requiredActionReadiness.actions) {
    if (readiness.status === "SATISFIED") continue;
    const action = durableActions.find((candidate) => candidate.actionId === readiness.actionId);
    if (
      readiness.status === "FAILED"
      && action?.state === "CANCELLED"
      && action.requirement
      && !contractRequirements.has(action.requirement)
    ) {
      continue;
    }
    const code = readiness.status === "AMBIGUOUS"
      ? "E_ACTION_RECONCILIATION_REQUIRED"
      : readiness.status === "UNTRUSTED"
        ? "E_ACTION_VERIFICATION_REQUIRED"
        : "E_ACTION_STATE_MISMATCH";
    errors.push(issue(
      code,
      `Required action ${readiness.actionId} is not trusted-satisfied (${readiness.status}): ${readiness.reasons[0] ?? ""}`,
      [taskArtifactPath(action?.taskId ?? actionTaskId, "actions")],
      { actionId: readiness.actionId, actionState: action?.state, readiness: readiness.status },
    ));
  }

  const sortedErrors = sortIssues(errors);
  const valid = sortedErrors.length === 0;
  return {
    status: valid ? COMPLETION_STATUSES[0] : COMPLETION_STATUSES[1],
    taskStatus: valid ? "COMPLETE" : receiptValue?.status === "blocked" ? "BLOCKED" : "INCOMPLETE",
    verificationStatus: valid ? VERIFICATION_STATUS_VALID : VERIFICATION_STATUS_INVALID,
    publicationStatus: publication,
    productionReadiness: receiptValue?.productionReadiness ?? "not-verified",
    errors: sortedErrors,
    warnings: [],
    preflight,
    coverage,
    ledger: {
      status: ledger.valid ? "valid" : "invalid",
      events: ledger.events.length,
    },
    actions: {
      count: durableActions.length,
      required: requiredActionReadiness.total,
      verified: durableActions.filter((action) => action.state === "VERIFIED").length,
      trustedSatisfied: requiredActionReadiness.satisfied,
      unresolvedRequired: requiredActionReadiness.unresolved,
      failed: durableActions.filter((action) => action.state === "FAILED").length,
      ambiguous: durableActions.filter((action) => action.state === "COMMIT_UNKNOWN").length,
      pending: durableActions.filter((action) => !["VERIFIED", "FAILED", "CANCELLED"].includes(action.state)).length,
      actionRefs: durableActions.map((action) => action.actionId),
    },
    responsibility: {
      status: responsibility.status,
      ...(responsibility.fingerprint ? { fingerprint: responsibility.fingerprint } : {}),
    },
    attestation,
  };
}

async function runCompleteInternal({
  target,
  packageRoot,
  strict = false,
  persist = true,
  authorityContext,
  runtimeContext,
  taskId = null,
  contractPath = null,
  routePath = null,
  statePath = null,
  receiptPath = null,
  eventsPath = null,
  preflightPath = null,
} = {}) {
  const result = await evaluateCompletion({
    target,
    packageRoot,
    strict,
    authorityContext,
    runtimeContext,
    taskId,
    contractPath,
    routePath,
    statePath,
    receiptPath,
    eventsPath,
    preflightPath,
  });

  const receiptRel = receiptPath ?? (taskId ? taskArtifactPath(taskId, "receipt") : ARTIFACT_PATHS.receipt);

  const rejectionCodes = [...new Set(result.errors.map((error) => error.code))].sort();
  const evidenceOnlyRejection = rejectionCodes.length > 0
    && rejectionCodes.every(isRecoverableCompletionEvidenceCode);
  const authorityRejection = rejectionCodes.some((code) => [
    "E_INSTALLATION_AUTHORITY_REQUIRED",
    "E_AUTHORITY_INVALID",
    "E_AUTHORITY_SCOPE_MISMATCH",
    "E_AUTHORITY_UNTRUSTED_SOURCE",
  ].includes(code));
  if (persist && result.status === "REJECTED" && evidenceOnlyRejection && !authorityRejection) {
    const state = await readWorkState(target, { packageRoot, taskId, statePath });
    if (state?.phase === "REVIEWING") {
      const reasonCodes = rejectionCodes;
      const missingRequirementIds = [...new Set(result.errors.map((error) => error.requirementId).filter(Boolean))].sort();
      const currentCycle = state.verificationCycle ?? 1;
      const alreadyRejected = state.lastCompletionAttempt?.status === "REJECTED"
        && (state.lastCompletionAttempt.verificationCycle ?? 1) === currentCycle
        && JSON.stringify([...(state.lastCompletionAttempt.reasonCodes ?? [])].sort()) === JSON.stringify(reasonCodes)
        && JSON.stringify([...(state.lastCompletionAttempt.missingRequirementIds ?? [])].sort()) === JSON.stringify(missingRequirementIds);

      if (alreadyRejected) {
        return result;
      }

      const now = new Date().toISOString();
      const next = {
        ...state,
        lastCompletionAttempt: {
          status: "REJECTED",
          reasonCodes,
          missingRequirementIds,
          verificationCycle: currentCycle,
          timestamp: now,
        },
        lastUpdated: now,
      };
      let receipt = null;
      try {
        receipt = await readJsonArtifact(target, receiptRel, "execution-receipt", packageRoot);
      } catch {
        // The evaluator already reports a missing or invalid receipt; evidence-only rejection can persist without one.
      }
      next.revision = (state.revision ?? 0) + 1;
      await mutateWorkState(target, {
        expectedRevision: state.revision ?? 0,
        packageRoot,
        taskId,
        statePath,
      }, () => next);
      let nextReceipt = null;
      if (receipt) {
        nextReceipt = await createReceipt({
          ...receipt.value,
          actions: await actionReceiptSummary(target, packageRoot, state.taskId),
          stateFingerprint: canonicalFingerprint(next),
          verificationCycle: next.verificationCycle ?? receipt.value.verificationCycle ?? 1,
        }, packageRoot, { target, taskId: state.taskId, authorityContext, runtimeContext });
        await writeJsonArtifact(target, receiptRel, nextReceipt, "execution-receipt", packageRoot);
      }
      const ledger = await validateEventLedger(target, packageRoot, { taskId, eventsPath });
      const lastRejection = ledger.events.filter((e) => e.taskId === state.taskId && e.event === "COMPLETION_REJECTED").at(-1);
      const lastDetails = lastRejection?.details ?? {};
      const isIdentical = lastRejection
        && (lastDetails.verificationCycle ?? 1) === currentCycle
        && JSON.stringify([...(lastDetails.reasonCodes ?? [])].sort()) === JSON.stringify(reasonCodes)
        && JSON.stringify([...(lastDetails.missingRequirementIds ?? [])].sort()) === JSON.stringify(missingRequirementIds)
        && lastDetails.stateFingerprint === canonicalFingerprint(next)
        && lastDetails.receiptFingerprint === (nextReceipt ? canonicalFingerprint(nextReceipt) : undefined);

      if (!isIdentical) {
        await appendProtocolEvent(target, {
          taskId: state.taskId,
          event: "COMPLETION_REJECTED",
          details: {
            verificationCycle: currentCycle,
            reasonCodes,
            missingRequirementIds,
            stateFingerprint: canonicalFingerprint(next),
            ...(nextReceipt ? { receiptFingerprint: canonicalFingerprint(nextReceipt) } : {}),
          },
        }, packageRoot, { taskId, eventsPath });
      }
    }
  }
  if (persist && result.status === "VALID") {
    const state = await readWorkState(target, { packageRoot, taskId, statePath });
    if (state && state.phase !== "COMPLETE") {
      const receipt = await readJsonArtifact(target, receiptRel, "execution-receipt", packageRoot);
      const contract = await readContract(target, packageRoot, { taskId, contractPath });
      const next = {
        ...state,
        previousPhase: state.phase,
        phase: "COMPLETE",
        evidenceCoverage: result.coverage,
        verificationEvidence: receipt.value.evidence,
        publicationStatus: result.publicationStatus,
        lastUpdated: new Date().toISOString(),
      };
      next.revision = (state.revision ?? 0) + 1;
      const nextReceipt = await createReceipt({
        ...receipt.value,
        actions: await actionReceiptSummary(target, packageRoot, state.taskId),
        stateFingerprint: canonicalFingerprint(next),
        verificationCycle: next.verificationCycle ?? receipt.value.verificationCycle ?? 1,
      }, packageRoot, { target, taskId: state.taskId, authorityContext, runtimeContext });
      const ledger = await validateEventLedger(target, packageRoot, { taskId, eventsPath });
      const existingCompletion = ledger.events.find((event) => event.taskId === contract.value.taskId && event.event === "COMPLETION_VALIDATED");
      const completionEvent = existingCompletion ?? await previewProtocolEvent(target, {
        taskId: contract.value.taskId,
        event: "COMPLETION_VALIDATED",
      }, packageRoot, { taskId, eventsPath });
      let manifestCapture = null;
      const attestationConfig = result.attestation ?? { mode: "off", revisionProvider: "git" };
      if (attestationConfig.mode !== "off") {
        try {
          manifestCapture = await createCodeManifest({
            target,
            packageRoot,
            taskId: contract.value.taskId,
            revisionProvider: attestationConfig.revisionProvider,
            baseRevision: state.repositoryFingerprint?.head ?? null,
            headRevision: "WORKTREE",
            captureMode: "WORKTREE",
            candidateState: next,
            candidateReceipt: nextReceipt,
            candidateCompletionCheckpoint: { seq: completionEvent.seq, hash: completionEvent.hash },
          });
          result.attestation = {
            ...result.attestation,
            status: "CAPTURED",
            level: "VERIFIED",
            manifest: {
              path: taskCodeManifestPath(contract.value.taskId),
              fingerprint: manifestCapture.fingerprint,
              contentDigest: manifestCapture.manifest.contentDigest,
            },
          };
        } catch (error) {
          if (attestationConfig.mode === "required") throw error;
          result.attestation = {
            ...result.attestation,
            status: "UNAVAILABLE",
            error: { code: error.code ?? "E_ATTESTATION_MANIFEST_INVALID", message: error.message },
          };
        }
      }
      await mutateWorkState(target, {
        expectedRevision: state.revision ?? 0,
        packageRoot,
        taskId,
        statePath,
      }, () => next);
      await writeJsonArtifact(target, receiptRel, nextReceipt, "execution-receipt", packageRoot);
      if (!existingCompletion) {
        const persistedCompletion = await appendProtocolEvent(target, {
          taskId: contract.value.taskId,
          event: "COMPLETION_VALIDATED",
          at: completionEvent.at,
        }, packageRoot, { taskId, eventsPath });
        if (persistedCompletion.hash !== completionEvent.hash) {
          throw new Error("Precomputed completion event changed before persistence");
        }
      }
      if (manifestCapture) {
        const manifestArtifact = await writeCodeManifest({
          target,
          packageRoot,
          taskId: contract.value.taskId,
          manifest: manifestCapture.manifest,
        });
        await appendProtocolEvent(target, {
          taskId: contract.value.taskId,
          event: "CODE_MANIFEST_CAPTURED",
          fingerprint: manifestArtifact.fingerprint,
          details: {
            manifestFingerprint: manifestArtifact.fingerprint,
            contentDigest: manifestCapture.manifest.contentDigest,
            coveredPaths: new Set(manifestCapture.manifest.entries.flatMap((entry) => [entry.path, entry.sourcePath].filter(Boolean))).size,
            verificationCycle: manifestCapture.manifest.verificationCycle,
          },
        }, packageRoot, { taskId, eventsPath });
      }
    } else if (state?.phase === "COMPLETE" && result.attestation?.status === "MISSING" && result.attestation.mode === "required") {
      const error = new Error("Required code manifest is missing from a COMPLETE task");
      error.code = "E_ATTESTATION_MANIFEST_MISSING";
      throw error;
    }
  }
  return result;
}

export async function runComplete(options = {}) {
  const taskId = options.taskId ?? null;
  if (options.persist !== false && taskId && !(await getTaskTransaction(options.target))) {
    return withTaskTransaction({
      target: options.target,
      taskId,
      packageRoot: options.packageRoot,
      operation: "complete",
      recordCommitEvent: true,
    }, () => runCompleteInternal(options));
  }
  return runCompleteInternal(options);
}
