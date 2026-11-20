import { ARTIFACT_PATHS, canonicalFingerprint } from "./artifacts.js";
import { assertCheckList } from "./checks.js";
import { assertCoverageList, coverageForRequirements } from "./coverage.js";
import { assertEvidenceList } from "./evidence.js";
import { evaluateRequiredEvidence, latestAuthoritativeCheck, matchesRequirement } from "./evidence-readiness.js";
import { validateVerificationAuthority } from "./verification-capability.js";

function issue(code, message, artifacts = [], details = {}) {
  return { code, message, artifacts, ...details };
}

function sameValue(left, right) {
  return canonicalFingerprint(left) === canonicalFingerprint(right);
}

function addAssertion(errors, assertion, code, artifacts) {
  try {
    assertion();
  } catch (error) {
    errors.push(issue(code, error.message, artifacts));
  }
}

export function stateIdentityErrors({
  contract,
  route,
  state,
} = {}) {
  const errors = [];
  const contractValue = contract?.value ?? contract;
  const contractFingerprint = contract?.fingerprint;
  if (contractValue && state && contractValue.taskId !== state.taskId) {
    errors.push(issue("E_STATE_TASK_MISMATCH", "Work state does not belong to the current contract task", [ARTIFACT_PATHS.contract, ARTIFACT_PATHS.state]));
  }
  if (contractFingerprint && state && state.contractFingerprint !== contractFingerprint) {
    errors.push(issue("E_CONTRACT_STALE", "Work state does not match the current contract", [ARTIFACT_PATHS.contract, ARTIFACT_PATHS.state]));
  }
  if (contractFingerprint && route && route.value.contractFingerprint !== contractFingerprint) {
    errors.push(issue("E_ROUTE_STALE", "Routing result does not match the current contract", [ARTIFACT_PATHS.contract, ARTIFACT_PATHS.route]));
  }
  if (route && state && route.value.contractFingerprint !== undefined
    && route.value.contractFingerprint !== state.contractFingerprint) {
    errors.push(issue("E_ROUTE_STALE", "Routing result does not match the work state contract", [ARTIFACT_PATHS.route, ARTIFACT_PATHS.state]));
  }
  if (route && state && (state.routeFingerprint !== route.fingerprint || !sameValue(state.selectedGuides, route.value.guides))) {
    errors.push(issue("E_ROUTE_GUIDE_MISMATCH", "Work state does not match the persisted route identity", [ARTIFACT_PATHS.route, ARTIFACT_PATHS.state]));
  }
  return errors;
}

export function assertStateIdentity(input) {
  const errors = stateIdentityErrors(input);
  if (errors.length === 0) return;
  const first = errors[0];
  const error = new Error(first.message);
  error.code = first.code;
  error.artifacts = first.artifacts;
  throw error;
}

// Protocol core invariant 4.1.5: a contract verification item whose latest
// bound check failed or was blocked rejects completion. A later passing run of
// the same item supersedes the failure; an item with no check is left to the
// required-evidence rules.
export function failedVerificationPlanErrors(contractValue, checks = []) {
  const errors = [];
  for (const item of contractValue?.verification ?? []) {
    const requirement = typeof item === "string" ? { text: item } : item;
    if (!requirement?.text || (requirement.type && requirement.type !== "VERIFICATION")) continue;
    const latest = latestAuthoritativeCheck((checks ?? []).filter((check) => (
      (requirement.id && check?.id === requirement.id) || matchesRequirement(check, requirement)
    )));
    if (latest && (latest.status === "failed" || latest.status === "blocked")) {
      errors.push(issue(
        "E_CHECK_FAILED",
        `Contract verification ${requirement.id ? `"${requirement.id}" ` : ""}ends in a ${latest.status} check (${latest.id}): ${requirement.text}`,
        [ARTIFACT_PATHS.contract, ARTIFACT_PATHS.receipt],
        { requirementId: requirement.id ?? null, checkId: latest.id },
      ));
    }
  }
  return errors;
}

export function completionRelationshipErrors({
  contract,
  route,
  state,
  receipt,
  requiredEvidence = [],
  requireReceiptStateFingerprint = true,
  requireRequiredChecks = true,
  target,
  taskId,
  authorities,
  authorityContext,
  runtimeContext,
} = {}) {
  const errors = stateIdentityErrors({ contract, route, state });
  const contractValue = contract?.value ?? contract;
  const contractFingerprint = contract?.fingerprint;
  const effectiveTaskId = taskId ?? contractValue?.taskId ?? state?.taskId ?? receipt?.taskId;
  const authOptions = {
    ...(target ? { target } : {}),
    ...(effectiveTaskId ? { taskId: effectiveTaskId } : {}),
    ...(authorities ? { authorities } : {}),
    ...(authorityContext ? { authorityContext } : {}),
    ...(runtimeContext ? { runtimeContext } : {}),
  };
  if (contractValue && receipt && contractValue.taskId !== receipt.taskId) {
    errors.push(issue("E_RECEIPT_TASK_MISMATCH", "Execution receipt does not belong to the current contract task", [ARTIFACT_PATHS.contract, ARTIFACT_PATHS.receipt]));
  }
  if (route && receipt && (receipt.routeFingerprint !== route.fingerprint || !sameValue(receipt.selectedGuides, route.value.guides))) {
    errors.push(issue("E_ROUTE_GUIDE_MISMATCH", "Execution receipt does not match the persisted route identity", [ARTIFACT_PATHS.route, ARTIFACT_PATHS.receipt]));
  }
  if (contractFingerprint && receipt && receipt.contractFingerprint !== contractFingerprint) {
    errors.push(issue("E_RECEIPT_CONTRACT_MISMATCH", "Execution receipt does not match the current contract", [ARTIFACT_PATHS.contract, ARTIFACT_PATHS.receipt]));
  }

  if (state) {
    addAssertion(errors, () => assertCheckList(state.checks, "work-state.checks", authOptions), "E_CHECK_INVALID", [ARTIFACT_PATHS.state]);
    addAssertion(errors, () => assertEvidenceList(state.verificationEvidence, "work-state.verificationEvidence"), "E_EVIDENCE_INVALID", [ARTIFACT_PATHS.state]);
    for (const check of state.checks ?? []) {
      if (check.status === "passed") {
        const auth = validateVerificationAuthority(check, authOptions);
        if (!auth.valid) {
          errors.push(issue(auth.error.code, auth.error.message, [ARTIFACT_PATHS.state]));
        }
      }
    }
  }
  if (receipt) {
    addAssertion(errors, () => assertCheckList(receipt.checks, "receipt.checks", authOptions), "E_CHECK_INVALID", [ARTIFACT_PATHS.receipt]);
    addAssertion(errors, () => assertEvidenceList(receipt.evidence ?? [], "receipt.evidence"), "E_EVIDENCE_INVALID", [ARTIFACT_PATHS.receipt]);
    for (const check of receipt.checks ?? []) {
      if (check.status === "passed") {
        const auth = validateVerificationAuthority(check, authOptions);
        if (!auth.valid) {
          errors.push(issue(auth.error.code, auth.error.message, [ARTIFACT_PATHS.receipt]));
        }
      }
    }
    if (requireRequiredChecks) {
      errors.push(...failedVerificationPlanErrors(contractValue, receipt.checks));
      const readiness = evaluateRequiredEvidence({ requirements: requiredEvidence, checks: receipt.checks, options: authOptions });
      for (const requirement of readiness.missing) {
        errors.push(issue("E_EVIDENCE_REQUIRED", `Required check is missing: ${requirement.text}`, [ARTIFACT_PATHS.receipt], { requirementId: requirement.id }));
      }
      for (const requirement of readiness.partial) {
        errors.push(issue("E_EVIDENCE_PARTIAL", `Required evidence is partial: ${requirement.text}`, [ARTIFACT_PATHS.receipt], { requirementId: requirement.id }));
      }
      for (const requirement of readiness.invalid) {
        errors.push(issue(requirement.reasonCode ?? "E_EVIDENCE_INVALID", `Required evidence is invalid: ${requirement.text}`, [ARTIFACT_PATHS.receipt], { requirementId: requirement.id }));
      }
    }
  }

  const expectedCoverage = state ? coverageForRequirements(requiredEvidence, state.checks, {
    target,
    taskId: effectiveTaskId,
    authorities,
    options: authOptions,
  }) : [];
  if (state?.evidenceCoverage !== undefined) {
    addAssertion(errors, () => assertCoverageList(state.evidenceCoverage, "work-state.evidenceCoverage"), "E_EVIDENCE_COVERAGE_INVALID", [ARTIFACT_PATHS.state]);
    if (!sameValue(state.evidenceCoverage, expectedCoverage)) {
      errors.push(issue("E_EVIDENCE_COVERAGE_INVALID", "Work state evidence coverage does not match its checks", [ARTIFACT_PATHS.state]));
    }
  }
  if (receipt) {
    if (receipt.evidenceCoverage === undefined) {
      errors.push(issue("E_EVIDENCE_COVERAGE_INVALID", "Execution receipt requires evidence coverage", [ARTIFACT_PATHS.receipt]));
    } else {
      addAssertion(errors, () => assertCoverageList(receipt.evidenceCoverage, "receipt.evidenceCoverage"), "E_EVIDENCE_COVERAGE_INVALID", [ARTIFACT_PATHS.receipt]);
      if (!sameValue(receipt.evidenceCoverage, expectedCoverage)) {
        errors.push(issue("E_EVIDENCE_COVERAGE_INVALID", "Execution receipt evidence coverage does not match current checks", [ARTIFACT_PATHS.receipt]));
      }
    }
  }

  if (state && receipt) {
    if (state.verificationCycle !== undefined && receipt.verificationCycle !== undefined
      && state.verificationCycle !== receipt.verificationCycle) {
      errors.push(issue("E_RECEIPT_CYCLE_MISMATCH", "Work state and execution receipt verification cycles diverge", [ARTIFACT_PATHS.state, ARTIFACT_PATHS.receipt]));
    }
    if (requireReceiptStateFingerprint) {
      if (receipt.stateFingerprint === undefined) {
        errors.push(issue("E_RECEIPT_STATE_MISMATCH", "Execution receipt requires the current work-state fingerprint", [ARTIFACT_PATHS.state, ARTIFACT_PATHS.receipt]));
      } else if (receipt.stateFingerprint !== canonicalFingerprint(state)) {
        errors.push(issue("E_RECEIPT_STATE_MISMATCH", "Execution receipt does not match the recorded work state", [ARTIFACT_PATHS.state, ARTIFACT_PATHS.receipt]));
      }
    }
    if (!sameValue(state.checks, receipt.checks)) {
      errors.push(issue("E_RECEIPT_STATE_MISMATCH", "Work state and execution receipt checks diverge", [ARTIFACT_PATHS.state, ARTIFACT_PATHS.receipt]));
    }
    if (!sameValue(state.verificationEvidence, receipt.evidence ?? [])) {
      errors.push(issue("E_RECEIPT_STATE_MISMATCH", "Work state and execution receipt evidence diverge", [ARTIFACT_PATHS.state, ARTIFACT_PATHS.receipt]));
    }
    if (state.evidenceCoverage !== undefined && receipt.evidenceCoverage !== undefined
      && !sameValue(state.evidenceCoverage, receipt.evidenceCoverage)) {
      errors.push(issue("E_RECEIPT_STATE_MISMATCH", "Work state and execution receipt coverage diverge", [ARTIFACT_PATHS.state, ARTIFACT_PATHS.receipt]));
    }
  }
  return errors;
}

export function assertCompletionRelationships(input) {
  const errors = completionRelationshipErrors(input);
  if (errors.length === 0) return;
  const first = errors[0];
  const error = new Error(first.message);
  error.code = first.code;
  error.artifacts = first.artifacts;
  throw error;
}
