import { ledgerRelationMap, ledgerRelationSet } from "./ledger-relations.js";
import { ledgerEventAt, ledgerEventsOfTypes } from "./ledger-event-collection.js";
import { needsExistingProjectScope, withExistingProjectScope, isOperationalArtifactPath } from "../storage/existing-project-scope.js";

import { open, readFile, stat } from "node:fs/promises";
import { closeSync, lstatSync, openSync, readSync } from "node:fs";
import { createHash } from "node:crypto";

import { assertSafePath, ensureWithin, fileExists } from "./filesystem.js";
import { ARTIFACT_PATHS, canonicalFingerprint } from "./artifacts.js";
import { assertJsonBytes, assertJsonLimits } from "./json-safety.js";
import { assertSchema, readSchema } from "./schema-validation.js";
import { assertSecretFree } from "./receipt.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { isRecoverableCompletionEvidenceCode } from "./completion-recovery.js";
import {
  CONTRACT_BOOTSTRAP_REPAIR_EVENT,
  ROUTE_CHECKPOINT_BOUND_EVENT,
  assertContractBootstrapRepairDetails,
  assertContractBootstrapRepairMigrationDetails,
  isLegacyContractBootstrapRepairMarkerShape,
  validateContractBootstrapRepairMigrations,
  repairMarkerErrors,
} from "./contract-bootstrap-recovery.js";

import { taskArtifactPath } from "./task-paths.js";
import { getTaskTransaction, withTaskTransaction } from "./transaction.js";
import { getOperationalStore } from "../storage/operational-context.js";

import { assertDiagnosisDetails } from "./diagnosis-model.js";
import {
  assertActionEventDetails,
  assertApprovalEventDetails,
  isActionEventName,
  isApprovalEventName,
} from "./action-model.js";
import {
  assertDiagnosticCaseDetails,
  assertInterventionDetails,
  assertHypothesisDispositionDetails,
} from "./diagnostic-model.js";
import { assertDecisionCriterionDetails } from "./settlement-model.js";
import {
  LEGACY_RECOVERY_MIGRATION_EVENT,
  assertLegacyMigrationDetails,
  isLegacyRecoveryDetailsShape,
  isLegacyRecoveryEventShape,
  legacyRecoveryMigrationId,
} from "./task-recovery-migration.js";
import {
  CHECKPOINT_REVALIDATED_EVENT,
  assertCheckpointRevalidatedDetails,
  validateCheckpointRevalidationCurrentBinding,
  validateCheckpointRevalidationEventBindings,
} from "./checkpoint-revalidation.js";
import {
  CONTRACT_REVISED_EVENT,
  assertContractRevisedDetails,
  validateContractRevisionCurrentBinding,
  validateContractRevisionEventBindings,
} from "./contract-revision.js";
import {
  GATE_SATISFIED_EVENT,
  GATE_REVALIDATED_EVENT,
  assertGateSatisfiedDetails,
  assertGateRevalidatedDetails,
  hasCurrentGateEvidence,
  validateGateSatisfactionBindings,
} from "./gate-provenance.js";
import {
  assertSemanticDecisionDetails,
  validateSemanticDecisionArtifactBindings,
  validateSemanticDecisionEventBindings,
} from "./decision/events.js";
import { SEMANTIC_DECISION_RECORDED_EVENT, SEMANTIC_DECISION_SUPERSEDED_EVENT } from "./decision/constants.js";

const EVENT_SCHEMA_VERSION = 1;
export const LIFECYCLE_MILESTONES = Object.freeze([
  "CONTRACT_VALIDATED",
  "ROUTE_VALIDATED",
  "PREFLIGHT_READY",
  "EXECUTION_STARTED",
  "VERIFICATION_STARTED",
  "VERIFICATION_RECORDED",
  "COMPLETION_VALIDATED",
]);
export const ACTIVATION_EVENT_MATRIX = Object.freeze([
  Object.freeze({ stage: "task received", event: "TASK_RECEIVED", requiredFor: "new activation" }),
  Object.freeze({ stage: "contract validated", event: "CONTRACT_VALIDATED", requiredFor: "preflight readiness" }),
  Object.freeze({ stage: "route validated", event: "ROUTE_VALIDATED", requiredFor: "preflight readiness" }),
  Object.freeze({ stage: "gate satisfied", event: "GATE_SATISFIED", requiredFor: "each satisfied gate" }),
  Object.freeze({ stage: "preflight blocked", event: "PREFLIGHT_BLOCKED", requiredFor: "blocked activation" }),
  Object.freeze({ stage: "preflight ready", event: "PREFLIGHT_READY", requiredFor: "resumable readiness" }),
]);
const REPEATABLE_MILESTONES = new Set([
  "VERIFICATION_STARTED",
  "VERIFICATION_RECORDED",
  "REVIEW_STARTED",
  "TERMINAL_RESULT_RECORDED",
  "PREFLIGHT_READY",
]);

export function isRevisionEpochPlanRepeat(events = [], index = 0, event = null) {
  if (event?.event !== "PLAN_RECORDED") return false;
  const previousPlan = events.slice(0, index).findLast((candidate) => candidate.event === "PLAN_RECORDED");
  const revision = events.slice(0, index).findLast((candidate) => candidate.event === CONTRACT_REVISED_EVENT);
  return Boolean(previousPlan && revision && previousPlan.seq < revision.seq);
}

function validateMilestoneChronology(events, index, event, milestoneCounts, lastMilestone, errors) {
  const milestoneIndex = LIFECYCLE_MILESTONES.indexOf(event.event);
  if (milestoneIndex < 0) return lastMilestone;
  const count = (milestoneCounts.get(event.event) ?? 0) + 1;
  milestoneCounts.set(event.event, count);
  const revisionPlanRepeat = isRevisionEpochPlanRepeat(events, index, event);
  if (count > 1 && !REPEATABLE_MILESTONES.has(event.event) && !revisionPlanRepeat) {
    errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: `lifecycle milestone must not repeat: ${event.event}` });
  }
  if (milestoneIndex > lastMilestone + 1) {
    errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: `${event.event} is missing prerequisite milestone: ${LIFECYCLE_MILESTONES[lastMilestone + 1]}` });
  } else if (milestoneIndex < lastMilestone && event.event !== "VERIFICATION_STARTED" && event.event !== "PREFLIGHT_READY") {
    errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: `${event.event} is out of lifecycle order` });
  } else if (milestoneIndex === lastMilestone && !REPEATABLE_MILESTONES.has(event.event) && !revisionPlanRepeat) {
    errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: `lifecycle milestone must not repeat: ${event.event}` });
  }
  if (milestoneIndex > lastMilestone) return milestoneIndex;
  return lastMilestone;
}

function validateExecutionGateChronology(events, index, seen, errors) {
  if (!seen.has("ROUTE_VALIDATED")) errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: "execution started before route validation" });
  if (!seen.has("CONTRACT_VALIDATED")) errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: "execution started before contract validation" });
  if (!seen.has("PREFLIGHT_READY")) errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: "execution started before preflight readiness" });
  const preflight = events.slice(0, index).findLast((candidate) => candidate.event === "PREFLIGHT_READY");
  const requiredGates = preflight?.details?.requiredGates ?? [];
  const latestContractRevisionSeq = events.slice(0, index).findLast((candidate) => candidate.event === CONTRACT_REVISED_EVENT)?.seq ?? 0;
  const beforeExecution = events.slice(0, index);
  for (const gate of requiredGates) {
    if (!hasCurrentGateEvidence(beforeExecution, ledgerEventAt(events, index)?.taskId, gate, latestContractRevisionSeq)) {
      errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: `execution started before gate satisfaction: ${gate}` });
    }
  }
}

function checkpointFromEvents(events) {
  const last = events.at(-1) ?? null;
  return {
    schemaVersion: 1,
    seq: last?.seq ?? 0,
    lastHash: last?.hash ?? null,
  };
}

async function readEventCheckpoint(target, packageRoot, relPath, options, transaction) {
  if (!transaction.eventCheckpoints) transaction.eventCheckpoints = new Map();
  const cached = transaction.eventCheckpoints.get(relPath);
  if (cached) return cached;
  const checkpoint = checkpointFromEvents(await readEventTail(target, packageRoot, { ...options, eventsPath: relPath, limit: 1 }));
  transaction.eventCheckpoints.set(relPath, checkpoint);
  return checkpoint;
}

export function validateKnownEventDetails(event) {
  if (!event || typeof event !== "object") return;
  switch (event.event) {
    case "DIAGNOSIS_RECORDED":
      assertDiagnosisDetails(event.details);
      return;
    case "DIAGNOSTIC_CASE_RECORDED":
      assertDiagnosticCaseDetails(event.details);
      return;
    case "INTERVENTION_RECORDED":
      assertInterventionDetails(event.details);
      return;
    case "HYPOTHESIS_DISPOSITION_RECORDED":
      assertHypothesisDispositionDetails(event.details);
      return;
    case "DECISION_CRITERION_RECORDED":
      assertDecisionCriterionDetails(event.details);
      return;
    case "CHECKPOINT_RECONCILED":
      assertReconcileClosureDetails(event.details);
      return;
    case CHECKPOINT_REVALIDATED_EVENT:
      assertCheckpointRevalidatedDetails(event.details);
      return;
    case CONTRACT_REVISED_EVENT:
      assertContractRevisedDetails(event.details);
      return;
    case GATE_SATISFIED_EVENT:
      assertGateSatisfiedDetails(event.details);
      return;
    case GATE_REVALIDATED_EVENT:
      assertGateRevalidatedDetails(event.details);
      return;
    case SEMANTIC_DECISION_RECORDED_EVENT:
    case SEMANTIC_DECISION_SUPERSEDED_EVENT:
      assertSemanticDecisionDetails(event.details, event.event);
      return;
    case "TASK_RECOVERY_RECORDED":
      assertRecoveryRecordedDetails(event.details);
      return;
    case "OPERATOR_RECOVERY_RECORDED":
      // The exact known legacy defect signature is tolerated here so the
      // ledger can be parsed and classified. It only becomes valid through an
      // official migration event (enforced by validateEventLedger).
      if (!event.details?.recoveryId && isLegacyRecoveryDetailsShape(event.details)) return;
      assertRecoveryRecordedDetails(event.details);
      return;
    case "TASK_ABANDONED":
      assertTaskAbandonedDetails(event.details);
      return;
    case "LEGACY_RECOVERY_MIGRATION_RECORDED":
      assertLegacyMigrationDetails(event.details);
      return;
    case CONTRACT_BOOTSTRAP_REPAIR_EVENT:
    case "CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_RECORDED":
      validateKnownContractBootstrapEvent(event);
      return;
    case "ROUTE_REBOUND":
      assertRouteReboundDetails(event.details);
      return;
    case ROUTE_CHECKPOINT_BOUND_EVENT:
      assertRouteCheckpointBoundDetails(event.details);
      return;
    case "TASK_RECOVERY_RESUMED":
      assertRecoveryResumedDetails(event.details);
      return;
    case "TRAJECTORY_EVALUATED":
      assertTrajectoryEvaluatedDetails(event);
      return;
    case "WORKSPACE_BOUND":
      assertStructuredArtifactEvent(event, ["workspaceFingerprint"], "WORKSPACE_BOUND");
      return;
    case "HANDOFF_CREATED":
      if (!event.details || typeof event.details !== "object" || Array.isArray(event.details)
        || typeof event.details.handoffId !== "string" || !/^handoff-[A-Za-z0-9_-]+$/.test(event.details.handoffId)
        || typeof event.details.artifact !== "string" || !event.details.artifact
        || typeof event.details.digest !== "string") {
        throw protocolError("E_EVENT_INVALID", "HANDOFF_CREATED requires a handoff ID, artifact path, and digest");
      }
      assertFingerprint(event.details.digest, "HANDOFF_CREATED details.digest");
      return;
    case "HANDOFF_ACCEPTED":
      assertHandoffAcceptedDetails(event);
      return;
    case "RESPONSIBILITY_SET":
      assertStructuredArtifactEvent(event, ["responsibilityFingerprint"], "RESPONSIBILITY_SET");
      if (typeof event.details.label !== "string" || !event.details.label) {
        throw protocolError("E_EVENT_INVALID", "RESPONSIBILITY_SET details.label must be a non-empty string");
      }
      return;
    case "VERIFICATION_SCOPE_CAPTURED":
      assertStructuredArtifactEvent(event, ["scopeFingerprint"], "VERIFICATION_SCOPE_CAPTURED");
      if (!["AUTO", "CHANGED", "CLAIMED", "FULL"].includes(event.details.resolvedMode)
        || !Number.isInteger(event.details.verificationCycle) || event.details.verificationCycle < 1) {
        throw protocolError("E_EVENT_INVALID", "VERIFICATION_SCOPE_CAPTURED requires a valid mode and verification cycle");
      }
      return;
    case "CODE_MANIFEST_CAPTURED":
      assertStructuredArtifactEvent(event, ["manifestFingerprint"], "CODE_MANIFEST_CAPTURED");
      assertFingerprint(event.details.contentDigest, "CODE_MANIFEST_CAPTURED details.contentDigest");
      if (!Number.isInteger(event.details.coveredPaths) || event.details.coveredPaths < 0) {
        throw protocolError("E_EVENT_INVALID", "CODE_MANIFEST_CAPTURED details.coveredPaths must be a non-negative integer");
      }
      return;
    case "ATTESTATION_STATEMENT_CREATED":
      assertStructuredArtifactEvent(event, ["statementFingerprint"], "ATTESTATION_STATEMENT_CREATED");
      assertFingerprint(event.details.manifestFingerprint, "ATTESTATION_STATEMENT_CREATED details.manifestFingerprint");
      return;
    default:
      if (isActionEventName(event.event)) {
        assertActionEventDetails(event);
        return;
      }
      if (isApprovalEventName(event.event)) {
        assertApprovalEventDetails(event);
        return;
      }
      return;
  }
}

function validateKnownContractBootstrapEvent(event) {
  if (event.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT) {
    if (isLegacyContractBootstrapRepairMarkerShape(event)) return;
    assertContractBootstrapRepairDetails(event.details);
    return;
  }
  assertContractBootstrapRepairMigrationDetails(event.details);
}

function assertTrajectoryEvaluatedDetails(event) {
  if (!event.details || !/^eval-[A-Za-z0-9_-]+$/.test(event.details.evaluationId ?? "")
    || typeof event.details.scenarioId !== "string" || !/^[a-f0-9]{64}$/.test(event.details.evaluationFingerprint ?? "")
    || event.fingerprint !== event.details.evaluationFingerprint) {
    throw protocolError("E_EVENT_INVALID", "TRAJECTORY_EVALUATED requires a bound evaluationId, scenarioId, and fingerprint");
  }
}

function assertHandoffAcceptedDetails(event) {
  if (!event.details || typeof event.details !== "object" || Array.isArray(event.details)
    || typeof event.details.handoffId !== "string" || !/^handoff-[A-Za-z0-9_-]+$/.test(event.details.handoffId)
    || typeof event.details.handoffDigest !== "string"
    || typeof event.details.consumerId !== "string" || !event.details.consumerId.trim()
    || (event.details.harness !== undefined && (typeof event.details.harness !== "string" || !event.details.harness.trim()))) {
    throw protocolError("E_EVENT_INVALID", "HANDOFF_ACCEPTED requires a valid handoffId, handoffDigest, and consumerId");
  }
  assertFingerprint(event.details.handoffDigest, "HANDOFF_ACCEPTED details.handoffDigest");
}

function assertStringList(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
    throw protocolError("E_EVENT_INVALID", `${label} must be an array of non-empty strings`);
  }
}

function assertFingerprint(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw protocolError("E_EVENT_INVALID", `${label} must be a lowercase SHA-256 fingerprint`);
  }
}

function assertStructuredArtifactEvent(event, requiredDetails, label) {
  if (!event.details || typeof event.details !== "object" || Array.isArray(event.details)) {
    throw protocolError("E_EVENT_INVALID", `${label} requires structured details`);
  }
  for (const key of requiredDetails) {
    if (typeof event.details[key] !== "string" || !event.details[key]) {
      throw protocolError("E_EVENT_INVALID", `${label} details.${key} must be a non-empty string`);
    }
    assertFingerprint(event.details[key], `${label} details.${key}`);
  }
  if (event.fingerprint !== event.details[requiredDetails[0]]) {
    throw protocolError("E_EVENT_INVALID", `${label} fingerprint must match details.${requiredDetails[0]}`);
  }
}

function assertRouteReboundDetails(details) {
  const keys = ["routeFingerprint", "contractFingerprint", "previousRouteFingerprint"];
  if (!details || typeof details !== "object" || Array.isArray(details)
    || Object.keys(details).length !== keys.length
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(details, key))) {
    throw protocolError("E_EVENT_INVALID", "ROUTE_REBOUND requires exactly route, contract, and previous route fingerprints");
  }
  assertFingerprint(details.routeFingerprint, "ROUTE_REBOUND details.routeFingerprint");
  assertFingerprint(details.contractFingerprint, "ROUTE_REBOUND details.contractFingerprint");
  if (details.previousRouteFingerprint !== null) {
    assertFingerprint(details.previousRouteFingerprint, "ROUTE_REBOUND details.previousRouteFingerprint");
  }
}

function assertRouteCheckpointBoundDetails(details) {
  const keys = ["routeFingerprint", "contractFingerprint", "selectedGuides"];
  if (!details || typeof details !== "object" || Array.isArray(details)
    || Object.keys(details).length !== keys.length
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(details, key))) {
    throw protocolError("E_EVENT_INVALID", "ROUTE_CHECKPOINT_BOUND requires exactly route, contract, and selected guide identity");
  }
  assertFingerprint(details.routeFingerprint, "ROUTE_CHECKPOINT_BOUND details.routeFingerprint");
  assertFingerprint(details.contractFingerprint, "ROUTE_CHECKPOINT_BOUND details.contractFingerprint");
  assertStringList(details.selectedGuides, "ROUTE_CHECKPOINT_BOUND details.selectedGuides");
  if (new Set(details.selectedGuides).size !== details.selectedGuides.length) {
    throw protocolError("E_EVENT_INVALID", "ROUTE_CHECKPOINT_BOUND details.selectedGuides must not contain duplicates");
  }
}

function assertRecoveryRecordedDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    throw protocolError("E_EVENT_INVALID", "recovery event requires structured details");
  }
  for (const key of ["recoveryId", "classification", "previousPhase", "authorityKind"]) {
    if (typeof details[key] !== "string" || !details[key]) {
      throw protocolError("E_EVENT_INVALID", `recovery event details.${key} must be a non-empty string`);
    }
  }
  if (!Number.isInteger(details.previousRevision) || details.previousRevision < 0) {
    throw protocolError("E_EVENT_INVALID", "recovery event details.previousRevision must be a non-negative integer");
  }
  if (!["STALE", "ABANDONED"].includes(details.classification)) {
    throw protocolError("E_EVENT_INVALID", "recovery event details.classification must be STALE or ABANDONED");
  }
  if (!["CALLER_ACKNOWLEDGED", "HOST_ATTESTED"].includes(details.authorityKind)) {
    throw protocolError("E_EVENT_INVALID", "recovery event details.authorityKind is invalid");
  }
  assertStringList(details.reasonCodes, "recovery event details.reasonCodes");
  assertStringList(details.releasedClaims, "recovery event details.releasedClaims");
}

function assertTaskAbandonedDetails(details) {
  const keys = [
    "recoveryId", "classification", "reasonCodes", "previousPhase", "previousRevision",
    "previousHead", "previousBranch", "currentHead", "currentBranch",
    "releasedClaims", "authorityKind",
  ];
  if (!details || typeof details !== "object" || Array.isArray(details)
    || Object.keys(details).length !== keys.length
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(details, key))) {
    throw protocolError("E_EVENT_INVALID", "TASK_ABANDONED requires the exact abandonment boundary details");
  }
  if (typeof details.recoveryId !== "string" || details.recoveryId.length === 0) {
    throw protocolError("E_EVENT_INVALID", "TASK_ABANDONED details.recoveryId must be a non-empty string");
  }
  if (details.classification !== "ABANDONED") {
    throw protocolError("E_EVENT_INVALID", "TASK_ABANDONED details.classification must be ABANDONED");
  }
  assertStringList(details.reasonCodes, "TASK_ABANDONED details.reasonCodes");
  if (details.reasonCodes.length !== 1 || details.reasonCodes[0] !== "CALLER_ABANDONED") {
    throw protocolError("E_EVENT_INVALID", "TASK_ABANDONED details.reasonCodes must be [CALLER_ABANDONED]");
  }
  if (typeof details.previousPhase !== "string" || details.previousPhase.length === 0) {
    throw protocolError("E_EVENT_INVALID", "TASK_ABANDONED details.previousPhase must be a non-empty string");
  }
  if (!Number.isInteger(details.previousRevision) || details.previousRevision < 0) {
    throw protocolError("E_EVENT_INVALID", "TASK_ABANDONED details.previousRevision must be a non-negative integer");
  }
  for (const key of ["previousHead", "previousBranch", "currentHead", "currentBranch"]) {
    if (typeof details[key] !== "string" && details[key] !== null) {
      throw protocolError("E_EVENT_INVALID", `TASK_ABANDONED details.${key} must be a string or null`);
    }
  }
  assertStringList(details.releasedClaims, "TASK_ABANDONED details.releasedClaims");
  if (details.authorityKind !== "CALLER_ACKNOWLEDGED") {
    throw protocolError("E_EVENT_INVALID", "TASK_ABANDONED details.authorityKind must be CALLER_ACKNOWLEDGED");
  }
}

function assertRecoveryResumedDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)
    || typeof details.recoveryId !== "string" || !details.recoveryId) {
    throw protocolError("E_EVENT_INVALID", "TASK_RECOVERY_RESUMED requires details.recoveryId");
  }
  assertStringList(details.reacquiredClaims, "TASK_RECOVERY_RESUMED details.reacquiredClaims");
}

function assertReconcileClosureDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    throw protocolError("E_EVENT_INVALID", "CHECKPOINT_RECONCILED requires structured details");
  }
  for (const key of ["checkId", "command", "executionId"]) {
    if (typeof details[key] !== "string") {
      throw protocolError("E_EVENT_INVALID", `CHECKPOINT_RECONCILED details.${key} must be a string`);
    }
  }
  for (const key of ["previousBranch", "currentBranch", "previousHead", "currentHead"]) {
    if (typeof details[key] !== "string" && details[key] !== null) {
      throw protocolError("E_EVENT_INVALID", `CHECKPOINT_RECONCILED details.${key} must be a string or null`);
    }
  }
  if (typeof details.exitCode !== "number" || !Number.isInteger(details.exitCode) || details.exitCode < 0) {
    throw protocolError("E_EVENT_INVALID", "CHECKPOINT_RECONCILED details.exitCode must be a non-negative integer");
  }
}

export function eventHash(event) {
  const { hash, ...body } = event;
  return canonicalFingerprint(body);
}

export function buildProtocolEvent(input, { checkpoint } = {}) {
  if (!checkpoint || !Number.isInteger(checkpoint.seq) || checkpoint.seq < 0
    || (checkpoint.lastHash !== null && !/^[a-f0-9]{64}$/.test(checkpoint.lastHash))) {
    throw protocolError("E_EVENT_INVALID", "event checkpoint is invalid");
  }
  const event = {
    seq: checkpoint.seq + 1,
    schemaVersion: EVENT_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    taskId: input.taskId,
    event: input.event,
    at: input.at ?? new Date().toISOString(),
    ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}),
    previousHash: checkpoint.lastHash,
    ...(input.details ? { details: structuredClone(input.details) } : {}),
  };
  validateKnownEventDetails(event);
  assertSecretFree(event);
  event.hash = eventHash(event);
  return event;
}

export async function previewProtocolEvent(target, input, packageRoot, options = {}) {
  const activeTransaction = (await getTaskTransaction(target));
  if (!activeTransaction) {
    return withTaskTransaction({
      target,
      taskId: options.taskId ?? input.taskId,
      lockTaskId: options.taskId ?? input.taskId,
      operation: "preview-event",
      packageRoot,
    }, async () => previewProtocolEvent(target, input, packageRoot, options));
  }
  const relPath = options?.eventsPath ?? options?.relativePath ?? (options?.taskId ? taskArtifactPath(options.taskId, "events") : ARTIFACT_PATHS.events);
  const checkpoint = await readEventCheckpoint(target, packageRoot, relPath, options, activeTransaction);
  return buildProtocolEvent(input, { checkpoint });
}

function protocolError(code, message, artifacts = [ARTIFACT_PATHS.events]) {
  const error = new Error(message);
  error.code = code;
  error.artifacts = artifacts;
  return error;
}

export async function readEvents(target, packageRoot, options = {}) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => readEvents(target, packageRoot, options), { readOnly: true });
  }
  const relPath = options?.eventsPath ?? options?.relativePath ?? (options?.taskId ? taskArtifactPath(options.taskId, "events") : ARTIFACT_PATHS.events);
  const store = getOperationalStore(target);
  if (store?.recognizes(relPath)) {
    const schema = await readSchema("event", packageRoot);
    const events = [];
    // Array callers consume the synchronous cursor directly. Streaming callers
    // retain iterateEvents; both paths validate and fully bind observed rows.
    for (const event of store.iterateEvents(relPath)) {
      validateStoredEvent(event, schema, `${relPath}[${events.length}]`);
      events.push(event);
    }
    return events;
  }
  if (await assertOperationalLedgerAbsent(target, relPath)) return [];
  return readPortableEvents(target, packageRoot, { ...options, eventsPath: relPath });
}

async function assertOperationalLedgerAbsent(target, relativePath) {
  await assertSafePath(target, relativePath);
  if (isOperationalArtifactPath(relativePath) && await fileExists(ensureWithin(target, relativePath))) {
    throw protocolError("E_STORAGE_MIGRATION_REQUIRED", "Operational ledger reads require canonical SQLite; inspect legacy exports explicitly", [relativePath]);
  }
  return isOperationalArtifactPath(relativePath);
}

/** Explicit read-only inspection of an import/export ledger; never selects native authority. */
export async function readPortableEvents(target, packageRoot, options = {}) {
  const relPath = options.eventsPath ?? options.relativePath ?? (options.taskId ? taskArtifactPath(options.taskId, "events") : ARTIFACT_PATHS.events);
  const filename = await assertSafePath(target, relPath);
  if (!(await fileExists(filename))) return [];
  return parseEventsText(await readFile(filename, "utf8"), relPath, packageRoot);
}

/** Stream schema-validated canonical rows within the captured operational scope. */
export function iterateEvents(target, packageRoot, options = {}) {
  const relPath = options?.eventsPath ?? options?.relativePath ?? (options?.taskId ? taskArtifactPath(options.taskId, "events") : ARTIFACT_PATHS.events);
  const store = getOperationalStore(target);
  return (async function* validatedEvents() {
    if (!store?.recognizes(relPath)) { yield* await readEvents(target, packageRoot, options); return; }
    const schema = await readSchema("event", packageRoot);
    let index = 0;
    for (const event of store.iterateEvents(relPath)) {
      validateStoredEvent(event, schema, `${relPath}[${index}]`);
      index += 1;
      yield event;
    }
  })();
}

export async function readEventTail(target, packageRoot, options = {}) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => readEventTail(target, packageRoot, options), { readOnly: true });
  }
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1) {
    throw protocolError("E_EVENT_INVALID", "ledger tail limit must be a positive integer");
  }
  const relPath = options?.eventsPath ?? options?.relativePath ?? (options?.taskId ? taskArtifactPath(options.taskId, "events") : ARTIFACT_PATHS.events);
  const store = getOperationalStore(target);
  if (store?.recognizes(relPath)) return validateStoredEvents(store.readEvents(relPath, limit), relPath, packageRoot);
  if (await assertOperationalLedgerAbsent(target, relPath)) return [];
  return readPortableEventTail(target, packageRoot, { ...options, eventsPath: relPath });
}

/** Bounded tail inspection for explicit legacy/import/export tooling. */
export async function readPortableEventTail(target, packageRoot, options = {}) {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1) throw protocolError("E_EVENT_INVALID", "ledger tail limit must be a positive integer");
  const relPath = options.eventsPath ?? options.relativePath ?? (options.taskId ? taskArtifactPath(options.taskId, "events") : ARTIFACT_PATHS.events);
  const eventsPath = await assertSafePath(target, relPath);
  if (!(await fileExists(eventsPath))) return [];
  const size = (await stat(eventsPath)).size;
  let window = Math.min(size, 64 * 1024);
  while (true) {
    const position = size - window;
    const handle = await open(eventsPath, "r");
    const bytes = Buffer.alloc(window);
    try {
      await handle.read(bytes, 0, window, position);
    } finally {
      await handle.close();
    }
    let text = bytes.toString("utf8");
    if (position > 0) {
      const firstLineEnd = text.indexOf("\n");
      if (firstLineEnd < 0) {
        window = Math.min(size, window * 2);
        continue;
      }
      text = text.slice(firstLineEnd + 1);
    }
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
    if (lines.length >= limit || position === 0) {
      return parseEventsText(lines.slice(-limit).join("\n"), relPath, packageRoot);
    }
    window = Math.min(size, window * 2);
  }
}

async function parseEventsText(text, relPath, packageRoot) {
  assertJsonBytes(text, relPath);
  const schema = await readSchema("event", packageRoot);
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  return lines.map((line, index) => {
    let event;
    try {
      event = JSON.parse(line);
      assertJsonLimits(event, `${relPath}[${index}]`);
      assertSchema(event, schema, `${relPath}[${index}]`);
      validateKnownEventDetails(event);
    } catch (error) {
      throw protocolError(error.code ?? "E_EVENT_INVALID", `${relPath} line ${index + 1}: ${error.message}`, [relPath]);
    }
    return event;
  });
}

async function validateStoredEvents(events, relativePath, packageRoot) {
  const schema = await readSchema("event", packageRoot);
  for (const [index, event] of events.entries()) {
    validateStoredEvent(event, schema, `${relativePath}[${index}]`);
  }
  return events;
}

function validateStoredEvent(event, schema, label) {
  assertJsonBytes(JSON.stringify(event), label);
  assertJsonLimits(event, label);
  assertSchema(event, schema, label);
  validateKnownEventDetails(event);
}

export async function appendProtocolEvent(target, input, packageRoot, options = {}) {
  const activeTransaction = (await getTaskTransaction(target));
  if (typeof input?.taskId !== "string" || !input.taskId) throw protocolError("E_EVENT_INVALID", "event taskId is required");
  if (typeof input?.event !== "string" || !input.event) throw protocolError("E_EVENT_INVALID", "event type is required");
  const relPath = options?.eventsPath ?? options?.relativePath ?? (options?.taskId ? taskArtifactPath(options.taskId, "events") : ARTIFACT_PATHS.events);
  if (!activeTransaction) {
    // Only a standalone append is replayable: nested domain mutations and
    // external observations never enter this retry boundary.
    const capturedInput = structuredClone(input);
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await withTaskTransaction({
          target,
          taskId: options.taskId ?? capturedInput.taskId,
          operation: "append-event",
        }, () => appendProtocolEvent(target, capturedInput, packageRoot, options));
      } catch (error) {
        if (error.code !== "E_STATE_REVISION_CONFLICT" || attempt >= 2) throw error;
      }
    }
  }
  const checkpoint = await readEventCheckpoint(target, packageRoot, relPath, options, activeTransaction);
  const event = buildProtocolEvent(input, { checkpoint });
  const schema = await readSchema("event", packageRoot);
  assertSchema(event, schema, relPath);
  event.hash = eventHash(event);
  if (!options.dryRun) {
    await activeTransaction.appendText(relPath, `${JSON.stringify(event)}\n`);
    activeTransaction.eventCheckpoints.set(relPath, { schemaVersion: 1, seq: event.seq, lastHash: event.hash });
  }
  return event;
}

/**
 * Validates the append-only pairing between unmigrated legacy recovery events
 * and their official migration events. Strict by default; the official repair
 * command validates intermediate state with `allowUnmigratedLegacyRecoveryEvents`
 * before appending the migration events.
 */
function validateLegacyRecoveryMigrations(events, errors, { allowUnmigratedLegacyRecoveryEvents = false } = {}) {
  const migrationBySeq = ledgerRelationMap();
  for (const event of ledgerEventsOfTypes(events, [LEGACY_RECOVERY_MIGRATION_EVENT])) {
    if (event.event !== LEGACY_RECOVERY_MIGRATION_EVENT) continue;
    try {
      assertLegacyMigrationDetails(event.details);
    } catch (err) {
      errors.push({ code: err.code ?? "E_EVENT_INVALID", message: `event ${event.seq} (${event.event}): ${err.message}` });
      continue;
    }
    if (migrationBySeq.has(event.details.legacyEventSeq)) {
      errors.push({
        code: "E_EVENT_INVALID",
        message: `event ${event.seq} (${event.event}): duplicate migration for legacy recovery event seq ${event.details.legacyEventSeq}`,
      });
      continue;
    }
    migrationBySeq.set(event.details.legacyEventSeq, events.indexOf(event));
  }
  for (const event of ledgerEventsOfTypes(events, ["OPERATOR_RECOVERY_RECORDED"])) {
    if (!isLegacyRecoveryEventShape(event)) continue;
    const migrationPosition = migrationBySeq.get(event.seq);
    const migration = migrationPosition === undefined ? undefined : ledgerEventAt(events, migrationPosition);
    if (!migration) {
      if (!allowUnmigratedLegacyRecoveryEvents) {
        errors.push({
          code: "E_EVENT_INVALID",
          message: `legacy recovery event ${event.seq} is not officially migrated (run forgeloop task-repair-legacy-recovery)`,
        });
      }
      continue;
    }
    migrationBySeq.delete(event.seq);
    const expectedRecoveryId = legacyRecoveryMigrationId({ taskId: event.taskId, seq: event.seq, hash: event.hash });
    // Tail-binding: the migration event is appended at the ledger tail and may
    // sit anywhere after its historical source. It binds by reference only.
    if (migration.seq <= event.seq) {
      errors.push({
        code: "E_EVENT_INVALID",
        message: `migration event ${migration.seq} must follow legacy recovery event ${event.seq}`,
      });
    }
    if (migration.taskId !== event.taskId
      || migration.details.legacyTaskId !== event.taskId
      || migration.details.recoveryId !== expectedRecoveryId
      || migration.details.legacyEventHash !== event.hash
      || migration.details.legacyEventAt !== event.at
      || migration.details.legacyEventType !== event.event) {
      errors.push({
        code: "E_LEDGER_HASH_INVALID",
        message: `migration event ${migration.seq} does not bind legacy recovery event ${event.seq}`,
      });
    }
  }
  for (const [legacySeq, position] of migrationBySeq) {
    const migration = ledgerEventAt(events, position);
    errors.push({
      code: "E_EVENT_INVALID",
      message: `migration event ${migration.seq} references unknown legacy recovery event seq ${legacySeq}`,
    });
  }
}

/**
 * Pure ledger validation over an already-loaded event array.
 *
 * This is the smallest reusable seam between the filesystem path and a
 * database-backed reader: every rule below is computed from the events alone,
 * with no filesystem access. `validateEventLedger` keeps its existing signature
 * and delegates here after reading events, so behavior is unchanged for every
 * existing caller.
 *
 * Callers that already hold events (for example a database reader) can obtain
 * exactly the same guarantees without materializing files first.
 */
export function validateLedgerEvents(events, options = {}) {
  const errors = [];
  let taskId = null;
  let previousHash = null;
  const seen = new Set();
  let lastMilestone = -1;
  const milestoneCounts = new Map();
  const createdHandoffs = ledgerRelationMap();
  const acceptedHandoffs = ledgerRelationSet();
  for (const [index, event] of events.entries()) {
    if (event.seq !== index + 1) {
      errors.push({ code: "E_EVENT_INVALID", message: `event sequence must be ${index + 1}` });
    }
    if (taskId === null) taskId = event.taskId;
    if (event.taskId !== taskId) errors.push({ code: "E_EVENT_INVALID", message: "event task IDs must remain stable" });
    if (event.previousHash !== previousHash) {
      errors.push({ code: "E_LEDGER_HASH_INVALID", message: `event ${event.seq} previousHash does not match` });
    }
    previousHash = event.hash;
    if (event.hash !== eventHash(event)) {
      errors.push({ code: "E_LEDGER_HASH_INVALID", message: `event ${event.seq} hash does not match its content` });
    }
    try {
      validateKnownEventDetails(event);
    } catch (err) {
      errors.push({ code: err.code ?? "E_EVENT_INVALID", message: `event ${event.seq} (${event.event}): ${err.message}` });
    }
    lastMilestone = validateMilestoneChronology(events, index, event, milestoneCounts, lastMilestone, errors);
    seen.add(event.event);
    if (event.event === "EXECUTION_STARTED") {
      validateExecutionGateChronology(events, index, seen, errors);
    }
    if (event.event === "VERIFICATION_RECORDED" && !seen.has("VERIFICATION_STARTED")) {
      errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: "verification evidence recorded before verification started" });
    }
    if (event.event === "COMPLETION_VALIDATED" && !seen.has("VERIFICATION_RECORDED")) {
      errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: "completion validated before verification evidence" });
    }
    if (event.event === "COMPLETION_REJECTED" && !seen.has("VERIFICATION_STARTED")) {
      errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: "completion rejected before verification started" });
    }
    if (event.event === "HANDOFF_CREATED") {
      if (event.details?.handoffId) {
        createdHandoffs.set(event.details.handoffId, event.details.digest);
      }
    }
    if (event.event === "HANDOFF_ACCEPTED") {
      const hId = event.details?.handoffId;
      if (hId) {
        if (acceptedHandoffs.has(hId)) {
          errors.push({ code: "E_HANDOFF_ALREADY_ACCEPTED", message: `duplicate HANDOFF_ACCEPTED for handoffId ${hId}` });
        } else {
          acceptedHandoffs.add(hId);
          if (!createdHandoffs.has(hId)) {
            errors.push({ code: "E_HANDOFF_ACCEPTANCE_INCONSISTENT", message: `HANDOFF_ACCEPTED has no preceding HANDOFF_CREATED for handoffId ${hId}` });
          } else if (createdHandoffs.get(hId) !== event.details?.handoffDigest) {
            errors.push({ code: "E_HANDOFF_ACCEPTANCE_INCONSISTENT", message: `HANDOFF_ACCEPTED digest mismatch for handoffId ${hId}` });
          }
        }
      }
    }
  }
  validateLegacyRecoveryMigrations(events, errors, {
    allowUnmigratedLegacyRecoveryEvents: options?.allowUnmigratedLegacyRecoveryEvents === true,
  });
  errors.push(...validateCheckpointRevalidationEventBindings(events));
  errors.push(...validateContractRevisionEventBindings(events));
  errors.push(...validateGateSatisfactionBindings(events));
  errors.push(...validateSemanticDecisionEventBindings(events));
  const repairedErrors = validateContractBootstrapRepairLedger(events, errors, options);
  return { valid: repairedErrors.length === 0, events, errors: repairedErrors };
}

/** Validate canonical native or non-operational interchange ledger with all domain bindings. */
export async function validateEventLedger(target, packageRoot, options = {}) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => validateEventLedger(target, packageRoot, options), { readOnly: true });
  }
  return validateReadLedger(target, packageRoot, options, readEvents);
}

/** Explicit legacy source validation; never makes the source writable authority. */
export async function validatePortableEventLedger(target, packageRoot, options = {}) {
  return validateReadLedger(target, packageRoot, options, readPortableEvents);
}

async function validateReadLedger(target, packageRoot, options, reader) {
  const relPath = options?.eventsPath ?? options?.relativePath ?? (options?.taskId ? taskArtifactPath(options.taskId, "events") : ARTIFACT_PATHS.events);
  let events;
  try {
    events = await reader(target, packageRoot, { ...options, eventsPath: relPath });
  } catch (error) {
    return { valid: false, events: [], errors: [{ code: error.code ?? "E_EVENT_INVALID", message: error.message, artifacts: [relPath] }] };
  }
  const result = validateLedgerEvents(events, options);
  const bindingErrors = await validateSemanticDecisionArtifactBindings(target, packageRoot, events);
  if (bindingErrors.length === 0) return result;
  return { valid: false, events, errors: [...result.errors, ...bindingErrors] };
}

// Proof reuse is minted only for one owned read-only backup callback. Public
// collections and caller-supplied auditSource metadata cannot opt into it.
const ownedLedgerProofs = new WeakMap();

function ownedSnapshotFileIdentity(filename) {
  // The WAL is durable database content that can change while a read cursor
  // pins the main file. The SHM sidecar only carries transient lock/index
  // state, so it is intentionally excluded from the byte identity.
  const paths = [filename, `${filename}-wal`];
  const files = paths.map(current => {
    try {
      const file = lstatSync(current, { bigint: true });
      if (!file.isFile()) throw protocolError("E_STATE_REVISION_CONFLICT", "Owned ledger snapshot file changed during its audit");
      return file;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  });
  const identity = files.map(file => file
    ? [file.dev, file.ino, file.size, file.mtimeNs, file.ctimeNs].join(":")
    : "missing").join("|");
  if (process.platform !== "win32") return identity;
  // Windows may defer file timestamps until SQLite's open handle closes.
  // Hash readable bytes with bounded memory so raw writes cannot reuse a proof.
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  for (const [index, current] of paths.entries()) {
    hash.update(`${index}:`);
    if (!files[index]) continue;
    const fd = openSync(current, "r");
    try {
      let count;
      while ((count = readSync(fd, buffer, 0, buffer.length, null)) !== 0) hash.update(buffer.subarray(0, count));
    } finally { closeSync(fd); }
  }
  return `${identity}:${hash.digest("hex")}`;
}

function assertOwnedLedgerUnchanged(events) {
  const owned = ownedLedgerProofs.get(events);
  if (owned && (owned.db.prepare("PRAGMA data_version").get().data_version !== owned.version
    || ownedSnapshotFileIdentity(owned.filename) !== owned.fileIdentity)) {
    throw protocolError("E_STATE_REVISION_CONFLICT", "Owned ledger snapshot changed during its audit");
  }
  return owned;
}

function validateOwnedLedgerEvents(events, options) {
  const owned = assertOwnedLedgerUnchanged(events);
  if (!owned) return validateLedgerEvents(events, options);
  const flags = {
    allowUnmigratedLegacyRecoveryEvents: options?.allowUnmigratedLegacyRecoveryEvents === true,
    allowUnmigratedLegacyContractBootstrapRepairMarkers: options?.allowUnmigratedLegacyContractBootstrapRepairMarkers === true,
  };
  const key = JSON.stringify(flags);
  if (owned.successes.has(key)) return { valid: true, events, errors: [] };
  const result = validateLedgerEvents(events, flags);
  assertOwnedLedgerUnchanged(events);
  if (result.valid) owned.successes.add(key);
  return result;
}

async function evaluateCallbackLedgerAudit(target, packageRoot, options, callback, events, relPath) {
  let result;
  try {
    result = validateOwnedLedgerEvents(events, options);
    const owned = assertOwnedLedgerUnchanged(events);
    const sameScope = owned && owned.store === getOperationalStore(target)
      && owned.db === owned.store.db && owned.packageRoot === packageRoot
      && owned.relPath === relPath && owned.taskId === options?.taskId;
    const bindingErrors = sameScope && owned.semanticValidated
      ? [] : await validateSemanticDecisionArtifactBindings(target, packageRoot, events);
    assertOwnedLedgerUnchanged(events);
    if (sameScope && result.valid && bindingErrors.length === 0) owned.semanticValidated = true;
    if (bindingErrors.length) result = { valid: false, events, errors: [...result.errors, ...bindingErrors] };
  } catch (error) {
    result = { valid: false, events: [], errors: [{ code: error.code ?? "E_EVENT_INVALID", message: error.message, artifacts: [relPath] }] };
  }
  const initiallyValid = result.valid;
  const callbackResult = await callback(result);
  // The caller may await other work or mutate its result object. Keep the
  // private snapshot proof valid for the entire successful observation.
  if (initiallyValid) assertOwnedLedgerUnchanged(events);
  return callbackResult;
}

/** Internal callback audit: events remain owned by one immutable native snapshot. */
export async function withEventLedgerAudit(target, packageRoot, options, callback) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => withEventLedgerAudit(target, packageRoot, options, callback), { readOnly: true });
  }
  const relPath = options?.eventsPath ?? options?.relativePath ?? (options?.taskId ? taskArtifactPath(options.taskId, "events") : ARTIFACT_PATHS.events);
  const store = getOperationalStore(target);
  // Prepared mutations retain their existing read-set/CAS and staged-overlay semantics.
  if (!store?.recognizes(relPath) || !relPath.endsWith("/events.ndjson") || store.transaction || store.writes.size || store.events.size || store.attachments.size) {
    return callback(await validateEventLedger(target, packageRoot, options));
  }
  const taskId = store.taskId({ taskKey: relPath.split("/")[2] });
  if (!taskId) return callback(await validateEventLedger(target, packageRoot, options));
  if (store.auditSource?.taskId === taskId && store.auditSource.packageRoot === packageRoot && store.auditSource.relPath === relPath) {
    return evaluateCallbackLedgerAudit(target, packageRoot, options, callback, store.auditSource.events, relPath);
  }
  const schema = await readSchema("event", packageRoot);
  const { withDetachedLedgerSnapshot } = await import("../storage/ledger-event-snapshot.js");
  const { withOperationalReadSnapshot } = await import("../storage/unit-of-work.js");
  let completeObservation;
  return withDetachedLedgerSnapshot(store.db, taskId, (events, db) => withOperationalReadSnapshot({ db, target }, async snapshotStore => {
    completeObservation = snapshotStore.beginEventSnapshotObservation(relPath);
    snapshotStore.auditSource = { taskId, packageRoot, relPath, events };
    const filename = db.prepare("PRAGMA database_list").all().find(row => row.name === "main").file;
    ownedLedgerProofs.set(events, { db, filename, store: snapshotStore, taskId, packageRoot, relPath, semanticValidated: false, fileIdentity: ownedSnapshotFileIdentity(filename),
      version: db.prepare("PRAGMA data_version").get().data_version, successes: new Set() });
    try { return await evaluateCallbackLedgerAudit(target, packageRoot, options, callback, events, relPath); }
    finally { ownedLedgerProofs.delete(events); }
  }), {
    validate(event, index) { validateStoredEvent(event, schema, `${relPath}[${index}]`); return event; },
    onFullScan: store.captureObservations ? digest => completeObservation(digest) : null,
    // Keep the private schema/index proof valid for every collection read,
    // including a cursor resumed after the caller yielded an event. The guard
    // deliberately uses the full owned snapshot identity check on all
    // platforms; Windows may defer filesystem timestamps, so a cheap-only
    // resume check would expose a raw-tampered payload before the outer audit
    // boundary noticed it.
    guard(_events, _phase) { assertOwnedLedgerUnchanged(_events); },
  });
}

function validateContractBootstrapRepairLedger(events, errors, options) {
  const allowUnmigrated = options?.allowUnmigratedLegacyContractBootstrapRepairMarkers === true;
  validateContractBootstrapRepairMigrations(events, errors, {
    allowUnmigratedLegacyContractBootstrapRepairMarkers: allowUnmigrated,
  });
  return repairMarkerErrors(events, errors, {
    allowUnmigratedLegacyContractBootstrapRepairMarkers: allowUnmigrated,
  });
}

function summarizeStateEvents(state, events) {
  const milestones = ["EXECUTION_STARTED", "VERIFICATION_STARTED", "REVIEW_STARTED", "COMPLETION_VALIDATED"];
  const observed = new Set();
  let supportsReviewEvents = false;
  let latestVerification;
  let latestReview;
  let index = 0;
  for (const event of ledgerEventsOfTypes(events, milestones)) {
    if (event.taskId !== state.taskId) continue;
    observed.add(event.event);
    if (event.event === "VERIFICATION_STARTED") {
      latestVerification = { event, index };
      if (Number.isInteger(event.details?.verificationCycle)) supportsReviewEvents = true;
    }
    if (event.event === "REVIEW_STARTED") {
      supportsReviewEvents = true;
      latestReview = { event, index };
    }
    index += 1;
  }
  return { observed, supportsReviewEvents, latestVerification, latestReview };
}

export function validateStateLedgerCoherence(state, events) {
  const errors = [
    ...validateCheckpointRevalidationCurrentBinding(state, events),
    ...validateContractRevisionCurrentBinding(state, events),
  ];
  if (!Number.isInteger(state.verificationCycle)) return errors;
  const { observed, supportsReviewEvents, latestVerification, latestReview } = summarizeStateEvents(state, events);
  const phaseRequirements = {
    EXECUTING: ["EXECUTION_STARTED"],
    VERIFYING: ["EXECUTION_STARTED", "VERIFICATION_STARTED"],
    DIAGNOSING: ["EXECUTION_STARTED", "VERIFICATION_STARTED"],
    CORRECTING: ["EXECUTION_STARTED", "VERIFICATION_STARTED"],
    REVIEWING: ["EXECUTION_STARTED", "VERIFICATION_STARTED", ...(supportsReviewEvents ? ["REVIEW_STARTED"] : [])],
    COMPLETE: ["EXECUTION_STARTED", "VERIFICATION_STARTED", ...(supportsReviewEvents ? ["REVIEW_STARTED"] : []), "COMPLETION_VALIDATED"],
  };
  for (const required of phaseRequirements[state.phase] ?? []) {
    if (!observed.has(required)) {
      errors.push({
        code: "E_STATE_LEDGER_DIVERGENCE",
        message: `Work-state phase ${state.phase} requires ledger event ${required}`,
      });
    }
  }
  if (Number.isInteger(state.verificationCycle)) {
    if ((latestVerification ? latestVerification.event.details?.verificationCycle ?? 1 : undefined) !== state.verificationCycle) {
      errors.push({
        code: "E_STATE_LEDGER_DIVERGENCE",
        message: "Work-state verification cycle does not match the lifecycle ledger",
      });
    }
    const latestReviewCycle = latestReview?.event.details?.verificationCycle;
    if (state.phase === "VERIFYING"
      && latestReviewCycle === state.verificationCycle
      && latestReview.index > (latestVerification?.index ?? -1)) {
      errors.push({
        code: "E_STATE_LEDGER_DIVERGENCE",
        message: "Work-state returned to VERIFYING without a new verification cycle in the lifecycle ledger",
      });
    }
    if (["REVIEWING", "COMPLETE"].includes(state.phase)
      && supportsReviewEvents
      && (latestReviewCycle !== state.verificationCycle
        || latestReview.index < (latestVerification?.index ?? -1))) {
      errors.push({
        code: "E_STATE_LEDGER_DIVERGENCE",
        message: "Work-state review phase does not match the current lifecycle ledger cycle",
      });
    }
  }
  return errors;
}

export function validateCompletionRecoveryAuthorization({ state, receipt, events } = {}) {
  const errors = [];
  if (!state) {
    return {
      authorized: false,
      errors: [{ code: "E_STATE_MISSING", message: "Work-state is required for recovery validation" }],
    };
  }
  const attempt = state.lastCompletionAttempt;
  if (!attempt || attempt.status !== "REJECTED") {
    return {
      authorized: false,
      errors: [{ code: "E_COMPLETION_RECOVERY_UNAUTHORIZED", message: "Recovery requires a persisted REJECTED completion attempt" }],
    };
  }
  const hasRecoverableReason = Array.isArray(attempt.reasonCodes)
    && attempt.reasonCodes.length > 0
    && attempt.reasonCodes.every((code) => isRecoverableCompletionEvidenceCode(code));
  if (!hasRecoverableReason) {
    return {
      authorized: false,
      errors: [{ code: "E_COMPLETION_RECOVERY_UNAUTHORIZED", message: "Completion attempt contains no recoverable evidence reason codes" }],
    };
  }

  const taskEvents = (events ?? []).filter((event) => event.taskId === state.taskId);
  const targetCycle = state.verificationCycle ?? 1;

  if (attempt.verificationCycle !== targetCycle) {
    errors.push({
      code: "E_COMPLETION_REJECTION_LEDGER_MISMATCH",
      message: `Work-state rejection verificationCycle ${attempt.verificationCycle} does not match state verificationCycle ${targetCycle}`,
    });
    return { authorized: false, errors };
  }

  const reviewEvents = taskEvents
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.event === "REVIEW_STARTED" && (event.details?.verificationCycle ?? 1) === targetCycle);
  const latestReviewIndex = reviewEvents.at(-1)?.index ?? -1;

  const rejectionEvents = taskEvents
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.event === "COMPLETION_REJECTED");

  if (rejectionEvents.length === 0) {
    errors.push({
      code: "E_COMPLETION_RECOVERY_UNAUTHORIZED",
      message: "No COMPLETION_REJECTED event found in protocol ledger",
    });
    return { authorized: false, errors };
  }

  const matchingEvent = rejectionEvents.findLast(({ event, index }) => {
    const eventCycle = event.details?.verificationCycle ?? 1;
    if (eventCycle !== targetCycle) return false;
    if (latestReviewIndex >= 0 && index < latestReviewIndex) return false;
    return true;
  });

  if (!matchingEvent) {
    errors.push({
      code: "E_COMPLETION_REJECTION_LEDGER_MISMATCH",
      message: `No matching COMPLETION_REJECTED event found for verification cycle ${targetCycle}`,
    });
    return { authorized: false, errors };
  }

  const eventDetails = matchingEvent.event.details ?? {};
  const stateReasons = [...new Set(attempt.reasonCodes ?? [])].sort();
  const eventReasons = [...new Set(eventDetails.reasonCodes ?? [])].sort();
  if (stateReasons.join(",") !== eventReasons.join(",")) {
    errors.push({
      code: "E_COMPLETION_REJECTION_LEDGER_MISMATCH",
      message: "Work-state rejection reasonCodes do not match ledger COMPLETION_REJECTED event",
    });
  }

  const stateMissing = [...new Set(attempt.missingRequirementIds ?? [])].sort();
  const eventMissing = [...new Set(eventDetails.missingRequirementIds ?? [])].sort();
  if (stateMissing.join(",") !== eventMissing.join(",")) {
    errors.push({
      code: "E_COMPLETION_REJECTION_LEDGER_MISMATCH",
      message: "Work-state missingRequirementIds do not match ledger COMPLETION_REJECTED event",
    });
  }

  const currentStateFingerprint = canonicalFingerprint(state);
  if (eventDetails.stateFingerprint && eventDetails.stateFingerprint !== currentStateFingerprint) {
    errors.push({
      code: "E_COMPLETION_REJECTION_STATE_FINGERPRINT_MISMATCH",
      message: "Current work-state no longer matches the rejected completion snapshot",
    });
  }

  if (eventDetails.receiptFingerprint !== undefined) {
    const currentReceiptFingerprint = receipt ? canonicalFingerprint(receipt) : undefined;
    if (currentReceiptFingerprint !== eventDetails.receiptFingerprint) {
      errors.push({
        code: "E_COMPLETION_REJECTION_RECEIPT_FINGERPRINT_MISMATCH",
        message: "Current receipt no longer matches the rejected completion snapshot",
      });
    }
  }

  return {
    authorized: errors.length === 0,
    errors,
  };
}
