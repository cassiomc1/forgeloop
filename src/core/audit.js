import { withProjectReadSnapshot } from "../storage/project-read-snapshot.js";
import { ARTIFACT_PATHS } from "./artifacts.js";
import { evaluateCompletion } from "./completion.js";
import { readManifest } from "./manifest.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { readJsonArtifact } from "./artifacts.js";
import { currentChangedPaths } from "./repository.js";
import { validateReadyProtocolConsistency } from "./preflight.js";
import { taskArtifactPath } from "./task-paths.js";
import { findTaskById } from "./task-discovery.js";
import { validateActionLedgerConsistency } from "./actions.js";
import { readCodeManifest } from "./code-manifest.js";
import { readAttestationStatement, validateAttestationStatement } from "./attestation.js";
import { assertAttestationStatementBindings, verifyCodeManifestContent } from "./attestation-verifier.js";
import { projectStructuralQualityStatus } from "./structural-quality/status.js";

function sortErrors(errors) {
  return [...errors].sort((left, right) => left.code.localeCompare(right.code)
    || left.message.localeCompare(right.message));
}

async function compareChangedPaths(target, packageRoot, options = {}) {
  const receiptRel = options.receiptPath ?? (options.taskId ? taskArtifactPath(options.taskId, "receipt") : ARTIFACT_PATHS.receipt);
  let receipt;
  try {
    receipt = (await readJsonArtifact(target, receiptRel, "execution-receipt", packageRoot)).value;
  } catch {
    return { status: "NOT_VERIFIED", expected: [], observed: [], missing: [], unexpected: [] };
  }

  let writeClaims = [];
  if (options.taskId) {
    try {
      const task = await findTaskById(target, options.taskId, packageRoot);
      writeClaims = task?.writeClaims ?? [];
    } catch {
      // ignore
    }
  }

  let observed;
  if (writeClaims.length > 0) {
    observed = await currentChangedPaths(target, { paths: writeClaims });
  } else {
    observed = await currentChangedPaths(target);
  }

  if (observed === null) {
    return { status: "NOT_VERIFIED", expected: receipt.changedPaths ?? [], observed: [], missing: [], unexpected: [] };
  }
  const expected = [...new Set(receipt.changedPaths ?? [])].sort();
  const missing = expected.filter((relativePath) => !observed.includes(relativePath));
  const unexpected = observed.filter((relativePath) => !expected.includes(relativePath));
  return {
    status: missing.length === 0 && unexpected.length === 0 ? "MATCH" : "MISMATCH",
    expected,
    observed,
    missing,
    unexpected,
  };
}

async function evaluateLocalAttestation({ target, packageRoot, taskId, completion }) {
  const configured = completion.attestation ?? { mode: "off" };
  const base = {
    mode: configured.mode ?? "off",
    manifest: configured.mode === "off" ? "NOT_CHECKED" : configured.status === "CAPTURED" ? "VALID" : configured.status ?? "MISSING",
    statement: "NOT_CHECKED",
    signature: "NOT_CHECKED",
    coverage: "NOT_CHECKED",
    errors: [],
  };
  if (configured.mode === "off") return { ...base, status: "DISABLED" };
  if (configured.status !== "CAPTURED") {
    return { ...base, status: configured.status === "UNAVAILABLE" ? "UNAVAILABLE" : "MISSING" };
  }

  let manifest;
  try {
    manifest = await readCodeManifest({ target, packageRoot, taskId });
    await verifyCodeManifestContent({
      target,
      manifest: manifest.value,
      revisionProvider: manifest.value.capture.revisionProvider,
      revision: manifest.value.capture.mode === "WORKTREE" ? "WORKTREE" : manifest.value.capture.observedRevision,
    });
    base.coverage = "VALID";
  } catch (error) {
    base.manifest = "INVALID";
    base.status = "INVALID";
    base.errors.push({ code: error.code ?? "E_ATTESTATION_CONTENT_MISMATCH", message: error.message });
    return base;
  }

  try {
    const statement = await readAttestationStatement({ target, packageRoot, taskId });
    await validateAttestationStatement(statement.value, packageRoot);
    assertAttestationStatementBindings(statement.value, manifest.value, taskId, manifest.fingerprint);
    base.statement = "VALID";
  } catch (error) {
    if (error.code === "E_ATTESTATION_STATEMENT_MISSING") {
      return { ...base, status: "VALID" };
    }
    base.statement = "INVALID";
    base.status = "INVALID";
    base.errors.push({ code: error.code ?? "E_ATTESTATION_STATEMENT_INVALID", message: error.message });
    return base;
  }
  return { ...base, status: "VALID" };
}

export async function evaluateAudit(options = {}) {
  return withProjectReadSnapshot(options.target, () => evaluateSelectedAudit(options));
}

async function evaluateSelectedAudit({
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
  const completion = await evaluateCompletion({
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
  const attestation = await evaluateLocalAttestation({ target, packageRoot, taskId, completion });
  const preflightRel = preflightPath ?? (taskId ? taskArtifactPath(taskId, "preflight") : ARTIFACT_PATHS.preflight);
  const receiptRel = receiptPath ?? (taskId ? taskArtifactPath(taskId, "receipt") : ARTIFACT_PATHS.receipt);
  const stateRel = statePath ?? (taskId ? taskArtifactPath(taskId, "state") : ARTIFACT_PATHS.state);
  const contractRel = contractPath ?? (taskId ? taskArtifactPath(taskId, "contract") : ARTIFACT_PATHS.contract);
  const routeRel = routePath ?? (taskId ? taskArtifactPath(taskId, "route") : ARTIFACT_PATHS.route);

  let manifest = null;
  let manifestError = null;
  try {
    manifest = await readManifest(target);
  } catch (error) {
    manifestError = error.message;
  }
  let readyConsistencyErrors = [];
  try {
    const persistedPreflight = await readJsonArtifact(target, preflightRel, "preflight", packageRoot);
    if (persistedPreflight.value.status === "READY") {
      readyConsistencyErrors = await validateReadyProtocolConsistency({
        target,
        packageRoot,
        persisted: persistedPreflight.value,
        current: completion.preflight,
        taskId,
      });
    }
  } catch {
    // Completion already reports missing or invalid preflight artifacts.
  }
  const taskInfo = taskId ? await findTaskById(target, taskId, packageRoot) : null;
  const ownershipErrors = taskInfo?.ownershipValid === false
    ? (taskInfo.ownershipErrors ?? taskInfo.errors ?? []).map((error) => ({
      ...error,
      artifacts: error.artifacts ?? [taskArtifactPath(taskId, "recovery"), taskArtifactPath(taskId, "events")],
    }))
    : [];
  const errors = sortErrors([
    ...completion.errors,
    ...readyConsistencyErrors,
    ...ownershipErrors,
    ...attestation.errors,
  ]);
  if (taskId) {
    for (const actionError of await validateActionLedgerConsistency(target, { packageRoot, taskId })) {
      errors.push({ ...actionError, artifacts: [taskArtifactPath(taskId, "actions"), taskArtifactPath(taskId, "events")] });
    }
    // Surface specific untrusted/ambiguous required actions with reasons.
    const { evaluateRequiredActionReadiness } = await import("./action-readiness.js");
    const readiness = await evaluateRequiredActionReadiness({ target, packageRoot, taskId });
    for (const item of readiness.actions) {
      if (item.status === "SATISFIED" || item.status === "PENDING") continue;
      const code = item.status === "AMBIGUOUS"
        ? "E_ACTION_RECONCILIATION_REQUIRED"
        : item.status === "UNTRUSTED"
          ? "E_ACTION_VERIFICATION_REQUIRED"
          : "E_ACTION_STATE_MISMATCH";
      errors.push({
        code,
        message: `Required action ${item.actionId} is not trusted-satisfied (${item.status}): ${item.reasons[0] ?? ""}`,
        artifacts: [taskArtifactPath(taskId, "actions"), taskArtifactPath(taskId, "events")],
        actionId: item.actionId,
        readiness: item.status,
        reasons: item.reasons,
      });
    }
  }
  const changedPaths = await compareChangedPaths(target, packageRoot, { taskId, receiptPath });
  if (changedPaths.status === "MISMATCH") {
    errors.push({
      code: "E_RECEIPT_PATH_MISMATCH",
      message: "Receipt changedPaths do not match observed repository paths",
      artifacts: [receiptRel],
      missing: changedPaths.missing,
      unexpected: changedPaths.unexpected,
      next: "Run forgeloop prepare-completion to refresh changed paths, then rerun audit.",
    });
  }
  const stale = errors.some((error) => error.code.includes("STALE") || error.code === "E_PHASE_ARTIFACT_STALE");
  const blocked = errors.some((error) => ["E_GATE_UNVERIFIED", "E_GATE_STALE", "E_EVIDENCE_COVERAGE_PARTIAL", "E_PHASE_PREREQUISITE_MISSING"].includes(error.code));
  const status = errors.length === 0 && completion.status === "VALID"
    ? "VALID"
    : stale
      ? "STALE"
      : blocked
        ? "INCOMPLETE"
        : "INVALID";
  let policyStatus = null;
  const { detectPolicyCapability, evaluateTargetPolicy } = await import("./policy-engine.js");
  const policyCapability = await detectPolicyCapability(target, packageRoot);
  if (policyCapability === "AVAILABLE") {
    try {
      const policyEval = await evaluateTargetPolicy({ target, packageRoot, taskId });
      policyStatus = {
        status: policyEval.status,
        provenRules: policyEval.provenRules,
        inertRules: policyEval.inertRules,
        unsupportedRules: policyEval.unsupportedRules,
        baselineViolations: policyEval.baselineViolations,
        drift: policyEval.drift?.detected ?? false,
      };
    } catch {
      policyStatus = { status: "INVALID", provenRules: 0, inertRules: 0, unsupportedRules: 0, baselineViolations: 0, drift: false };
    }
  } else if (policyCapability === "INVALID") {
    policyStatus = { status: "INVALID", provenRules: 0, inertRules: 0, unsupportedRules: 0, baselineViolations: 0, drift: false };
  } else {
    policyStatus = { status: "NOT_APPLICABLE", provenRules: 0, inertRules: 0, unsupportedRules: 0, baselineViolations: 0, drift: false };
  }

  let structuralQuality = {
    mode: "off",
    provider: null,
    baseline: { status: "NOT_REQUESTED", qualitySignal: null, artifactRef: null, fingerprint: null },
    current: { status: "NOT_OBSERVED", verificationCycle: null, attempt: null, qualitySignal: null, delta: null, bottleneck: null, artifactRef: null },
    comparable: null,
    completionRequired: false,
    reasonCodes: [],
    next: null,
  };
  if (taskId) {
    try {
      structuralQuality = await projectStructuralQualityStatus({ target, packageRoot, taskId });
    } catch (error) {
      structuralQuality = {
        ...structuralQuality,
        mode: "unknown",
        reasonCodes: [error.code ?? "E_STRUCTURAL_QUALITY_EVIDENCE_STALE"],
      };
    }
  }
  const qualityEvidenceKind = structuralQuality.current.status === "PASS" || structuralQuality.current.status === "FAIL"
    ? "OBSERVED"
    : structuralQuality.current.status === "BLOCKED" || (structuralQuality.mode === "gate" && structuralQuality.baseline.status !== "OBSERVED")
      ? "BLOCKED"
      : structuralQuality.mode === "off" ? "NOT_REQUESTED" : "NOT_VERIFIED";

  return {
    schemaVersion: 1,
    protocolVersion: PROTOCOL_VERSION,
    status,
    strict,
    errors,
    warnings: [...completion.warnings, ...(manifestError ? [{ code: "E_INSTALLATION_INVALID", message: manifestError }] : [])],
    installation: {
      status: manifest ? "ready" : manifestError ? "invalid" : "missing",
      manifest: Boolean(manifest),
    },
    policy: policyStatus,
    structuralQuality: {
      ...structuralQuality,
      policy: structuralQuality.mode === "off" ? null : {
        mode: structuralQuality.mode,
        provider: structuralQuality.provider,
        result: structuralQuality.current.status,
      },
      evidenceKind: qualityEvidenceKind,
    },
    completion,
    attestation: {
      mode: attestation.mode,
      manifest: attestation.manifest,
      statement: attestation.statement,
      signature: attestation.signature,
      coverage: attestation.coverage,
      status: attestation.status,
    },
    recovery: taskInfo?.recovery ?? null,
    claims: taskInfo ? {
      state: taskInfo.claimState,
      historical: taskInfo.historicalWriteClaims,
      effective: taskInfo.effectiveWriteClaims,
      mutationAllowed: taskInfo.mutationAllowed,
      ownershipValid: taskInfo.ownershipValid,
      ownershipErrors: taskInfo.ownershipErrors ?? taskInfo.errors ?? [],
    } : null,
    changedPaths,
    publicationStatus: completion.publicationStatus,
    productionReadiness: completion.productionReadiness,
    artifacts: {
      contract: contractRel,
      route: routeRel,
      state: stateRel,
      receipt: receiptRel,
      structuralQuality: taskId ? taskArtifactPath(taskId, "structuralQuality") : null,
    },
  };
}
