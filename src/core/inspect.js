import { fileExists, ensureWithin, readBytes } from "./filesystem.js";
import { DISCOVERY_SURFACES } from "./discovery-surfaces.js";
import { readManifest } from "./manifest.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { inspectSchemaHealth } from "./schema-validation.js";
import { readAndClassifyWorkState, WORK_STATE_PATH } from "./work-state.js";
import { createEvidence } from "./evidence.js";
import { runDoctor } from "../commands/doctor.js";
import { findProfilePath } from "./profile.js";
import { FORGELOOP_KIT_DIR } from "./target-layout.js";
import { trustedAuthorityConfiguration } from "./trusted-authority.js";
import { reconcileContinuity } from "./continuity-reconciliation.js";
import { continuityFinding, continuityIsHealthy } from "./continuity-observability.js";
import { findTaskById } from "./task-discovery.js";
import { buildTaskTrace } from "./trace.js";
import { evaluateProgress } from "./progress.js";
import { readEvents } from "./events.js";
import { taskStructuralQualityDirectory } from "./task-paths.js";
import { projectStructuralQualityStatus } from "./structural-quality/status.js";
import { operationalArtifactExists } from "../storage/operational-context.js";
import { withProjectReadSnapshot } from "../storage/project-read-snapshot.js";

function reasonCodesFor({ state, trace, progress }) {
  const codes = [];
  codes.push(trace.integrity.valid ? "LEDGER_VALID" : "LEDGER_INCONSISTENT");
  if (state?.status === "VALID" || state?.status === "FRESH") codes.push("REPOSITORY_FRESH");
  if (["STALE", "REVALIDATION_REQUIRED"].includes(state?.status)) codes.push("REPOSITORY_STALE");
  if (trace.task.phase === "COMPLETE") codes.push("COMPLETION_VALID");
  else codes.push("COMPLETION_INCOMPLETE");
  if (progress.status === "ADVANCING") codes.push("DIAGNOSTIC_PROGRESS_ADVANCING");
  if (progress.status === "STALLED") codes.push("DIAGNOSTIC_PROGRESS_STALLED");
  return codes;
}

function structuralQualityIssues(quality, taskId) {
  if (!quality || quality.mode !== "gate") return [];
  const qualityPath = quality.current?.artifactRef ?? taskStructuralQualityDirectory(taskId);
  if (quality.baseline?.status !== "OBSERVED") {
    return [{
      code: "E_STRUCTURAL_QUALITY_BASELINE_MISSING",
      message: "Structural-quality gate evidence has no valid immutable baseline.",
      path: taskStructuralQualityDirectory(taskId),
    }];
  }
  if (!quality.current?.artifactRef) {
    return [{
      code: "E_STRUCTURAL_QUALITY_EVIDENCE_STALE",
      message: "Structural-quality gate has no evaluation for the current verification cycle.",
      path: qualityPath,
    }];
  }
  if (quality.current.status === "FAIL") {
    return [{
      code: "E_STRUCTURAL_QUALITY_REGRESSION",
      message: "Structural-quality verification detected a regression.",
      path: qualityPath,
    }];
  }
  if (quality.current.status === "BLOCKED") {
    return [{
      code: "E_STRUCTURAL_QUALITY_EVALUATION_INCOMPARABLE",
      message: "Structural-quality verification is blocked or incomparable.",
      path: qualityPath,
    }];
  }
  return [];
}

async function buildTaskInspection({ target, packageRoot, taskId, state, classifiedStatus = null }) {
  const trace = await buildTaskTrace({ target, packageRoot, taskId });
  const events = await readEvents(target, packageRoot, { taskId });
  const progress = evaluateProgress({ state, events });
  const failedRequirements = [...new Set(
    trace.checks
      .filter((check) => check.currentResult === "failed" || check.currentResult === "blocked")
      .map((check) => check.requirement ?? check.id),
  )].sort();

  const issues = [];
  let structuralQuality;
  try {
    structuralQuality = await projectStructuralQualityStatus({ target, packageRoot, taskId });
  } catch (error) {
    structuralQuality = {
      mode: "off",
      provider: null,
      baseline: { status: "INVALID", qualitySignal: null, artifactRef: null, fingerprint: null },
      current: { status: "NOT_OBSERVED", verificationCycle: null, attempt: null, qualitySignal: null, delta: null, bottleneck: null, artifactRef: null },
      comparable: null,
      completionRequired: false,
      reasonCodes: [error.code ?? "E_STRUCTURAL_QUALITY_EVIDENCE_STALE"],
      next: null,
    };
  }
  issues.push(...structuralQualityIssues(structuralQuality, taskId));
  if (!trace.snapshot.consistent) {
    issues.push({ code: "E_TRACE_SNAPSHOT_INCONSISTENT", message: "Task artifacts changed while being read; rerun inspect for a consistent view." });
  }
  for (const error of trace.integrity.errors) {
    issues.push({ code: error.code ?? "E_EVENT_INVALID", message: error.message });
  }
  if (failedRequirements.length > 0 && trace.diagnostics.cases.length === 0 && trace.diagnostics.legacyDiagnoses.length === 0) {
    issues.push({ code: "E_DIAGNOSIS_REQUIRED", message: "Failed requirements have no recorded diagnosis." });
  }

  const explanation = {
    result: failedRequirements.length > 0 ? "INCOMPLETE_VERIFICATION" : (trace.task.phase === "COMPLETE" ? "COMPLETE" : "INCOMPLETE"),
    reasons: reasonCodesFor({ state: { status: classifiedStatus }, trace, progress }),
  };

  return {
    task: taskId,
    snapshot: {
      consistent: trace.snapshot.consistent,
      stateRevision: trace.snapshot.stateRevision,
      ledgerTailSequence: trace.snapshot.ledgerTailSequence,
    },
    lifecycle: {
      phase: trace.task.phase,
      verificationCycle: trace.task.verificationCycle,
      transitions: trace.transitions,
    },
    history: {
      eventCount: trace.events.length,
      quality: trace.historyQuality,
    },
    verification: {
      checks: trace.checks.map((check) => ({
        id: check.id,
        requirement: check.requirement,
        currentResult: check.currentResult,
        attemptCount: check.attemptCount,
        failedAttempts: check.failedAttempts,
      })),
      failedRequirements,
    },
    diagnostics: {
      legacyDiagnosisCount: trace.diagnostics.legacyDiagnoses.length,
      diagnosticCaseCount: trace.diagnostics.cases.length,
      interventionCount: trace.diagnostics.interventions.length,
      dispositionCount: trace.diagnostics.dispositions.length,
      latestCase: trace.diagnostics.cases.at(-1) ?? null,
    },
    progress,
    failureSurfaces: trace.failureSurfaces,
    failureSignatures: trace.failureSignatures.map((entry) => ({
      signature: entry.signature,
      requirements: entry.requirements,
      cycles: entry.cycles,
    })),
    integrity: {
      valid: trace.integrity.valid,
      errors: trace.integrity.errors,
    },
    structuralQuality,
    audit: {},
    completion: {},
    issues,
    explanation,
    next: { command: `forgeloop next --task ${taskId} --json` },
  };
}

function profileMetadata(bytes) {
  const text = bytes.toString("utf8");
  return {
    mode: text.match(/^profile-mode:\s*([^\s]+)\s*$/m)?.[1] ?? null,
    status: text.match(/^profile-status:\s*([^\s]+)\s*$/m)?.[1] ?? null,
  };
}

import { taskArtifactPath } from "./task-paths.js";

async function inspectStatePresence(target, relativePath) {
  return operationalArtifactExists(target, relativePath) ?? await fileExists(ensureWithin(target, relativePath));
}

export async function inspectTarget(options = {}) {
  return withProjectReadSnapshot(options.target, () => inspectSelectedTarget(options));
}

async function inspectSelectedTarget({ target, packageRoot, contractFile = null, authorityContext, runtimeContext, taskId = null, stateFile = null } = {}) {
  let manifest = null;
  let manifestError = null;
  try {
    manifest = await readManifest(target);
  } catch (error) {
    manifestError = error.message;
  }

  const profileRelativePath = await findProfilePath(target);
  const profilePath = profileRelativePath ? ensureWithin(target, profileRelativePath) : null;
  const profile = (profilePath && await fileExists(profilePath))
    ? { ...profileMetadata(await readBytes(profilePath)), path: profileRelativePath }
    : { mode: null, status: null };
  const effectiveStateRel = stateFile ?? (taskId ? taskArtifactPath(taskId, "state") : WORK_STATE_PATH);
  const statePresent = await inspectStatePresence(target, effectiveStateRel);
  const classifiedState = await readAndClassifyWorkState({ target, packageRoot, contractFile, taskId, stateFile: effectiveStateRel });
  const rawState = classifiedState?.state ?? null;
  const taskInfo = taskId ? await findTaskById(target, taskId, packageRoot) : null;
  const continuity = await reconcileContinuity({ target, packageRoot, taskId });
  const schemaRoot = manifest?.layoutVersion >= 2
    ? ensureWithin(target, FORGELOOP_KIT_DIR)
    : target;
  const schemaHealth = await inspectSchemaHealth(schemaRoot);
  const schemaPathPrefix = manifest?.layoutVersion >= 2
    ? `${FORGELOOP_KIT_DIR}/schemas`
    : "schemas";
  const doctor = await runDoctor({ target, packageRoot });
  const surfaces = await Promise.all(DISCOVERY_SURFACES.map(async (surface) => ({
    id: surface.id,
    path: surface.path,
    kind: surface.kind,
    available: await fileExists(ensureWithin(target, surface.path)),
  })));
  const availableSurfaces = surfaces.filter((surface) => surface.available);
  const protocolActivated = availableSurfaces.length > 0;

  const findings = [...doctor.findings];
  for (const schema of schemaHealth.schemas) {
    if (schema.status !== "valid") {
      findings.push({
        code: `schema-${schema.status}`,
        severity: "error",
        path: `${schemaPathPrefix}/${schema.name}.schema.json`,
        message: schema.error ?? `Schema is ${schema.status}.`,
        remediation: "Restore the shipped schema and rerun inspect.",
        evidence: createEvidence({
          kind: schema.status === "missing" ? "NOT_VERIFIED" : "OBSERVED",
          source: `${schemaPathPrefix}/${schema.name}.schema.json`,
          result: schema.status,
        }),
      });
    }
  }
  const continuityIssue = continuityFinding(continuity);
  if (continuityIssue) findings.push(continuityIssue);

  if (taskInfo?.ownershipValid === false) {
    findings.push({
      code: "task-claim-ownership-inconsistent",
      severity: "error",
      path: taskArtifactPath(taskId, "recovery"),
      message: "Task claim ownership cannot be validated from recovery state and ledger history.",
      remediation: `Run forgeloop validate-protocol --task ${taskId} --json and repair the reported protocol-owned artifact.`,
      evidence: createEvidence({
        kind: "BLOCKED",
        source: taskArtifactPath(taskId, "events"),
        result: "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT",
      }),
    });
  }

  if (classifiedState.status === "INVALID") {
    findings.push({
      code: "state-invalid",
      severity: "error",
      path: effectiveStateRel,
      message: classifiedState.error ?? "Work state is invalid.",
      remediation: "Repair or clear the checkpoint after reviewing the parse error.",
      evidence: createEvidence({ kind: "BLOCKED", source: WORK_STATE_PATH, result: "invalid" }),
    });
  }

  const protocolEvidence = schemaHealth.evidence ?? [createEvidence({
    kind: schemaHealth.status === "valid" ? "OBSERVED" : "NOT_VERIFIED",
    source: "ForgeLoop schema health",
    result: schemaHealth.status,
  })];
  const evidence = [
    ...(doctor.evidence ?? []),
    ...(classifiedState.evidence ?? []),
    ...protocolEvidence,
  ];
  const taskInspection = taskId
    ? await buildTaskInspection({ target, packageRoot, taskId, state: rawState, classifiedStatus: classifiedState.status })
    : null;
  for (const issue of taskInspection?.issues ?? []) {
    if (!issue.code.startsWith("E_STRUCTURAL_QUALITY")) continue;
    findings.push({
      code: issue.code,
      severity: "error",
      path: issue.path,
      message: issue.message,
      remediation: `Run forgeloop next --task ${taskId} --json and follow the structural-quality guidance.`,
      evidence: createEvidence({ kind: "BLOCKED", source: issue.path, result: issue.code }),
    });
  }
  return {
    target: { path: target },
    authority: trustedAuthorityConfiguration({ target, authorityContext, runtimeContext }),
    manifest: {
      present: manifest !== null,
      status: manifestError ? "invalid" : manifest ? "ready" : "missing",
      packageVersion: manifest?.packageVersion ?? null,
      layoutVersion: manifest?.layoutVersion ?? 1,
      error: manifestError,
    },
    profile,
    integration: {
      protocolActivated,
      protocolMarker: "FORGELOOP_PROJECT_PROTOCOL=REQUIRED",
      discovery: {
        status: protocolActivated ? "INSTRUCTION_DISCOVERED" : "INSTRUCTION_ABSENT",
        surfaces,
      },
      capability: {
        status: "NOT_VERIFIED",
      },
    },
    adapters: {
      detected: availableSurfaces.map((s) => s.path),
      surfaces,
    },
    protocol: {
      version: PROTOCOL_VERSION,
      schemaStatus: schemaHealth.status,
      schemas: schemaHealth.schemas,
      evidence: protocolEvidence,
    },
    state: { ...classifiedState, path: effectiveStateRel, present: statePresent },
    recovery: taskInfo?.recovery ?? null,
    claims: taskInfo ? {
      state: taskInfo.claimState,
      historical: taskInfo.historicalWriteClaims,
      effective: taskInfo.effectiveWriteClaims,
      mutationAllowed: taskInfo.mutationAllowed,
      ownershipValid: taskInfo.ownershipValid,
      ownershipErrors: taskInfo.ownershipErrors ?? taskInfo.errors ?? [],
    } : null,
    continuity,
    compatibility: {
      deprecated: true,
      agents: [],
    },
    findings,
    evidence,
    ...(taskInspection ? { taskInspection } : {}),
    ok: doctor.ok
      && !manifestError
      && schemaHealth.status === "valid"
      && taskInfo?.ownershipValid !== false
      && !["INVALID", "REVALIDATION_REQUIRED"].includes(classifiedState.status)
      && continuityIsHealthy(continuity),
  };
}
