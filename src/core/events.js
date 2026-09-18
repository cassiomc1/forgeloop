
import { appendFile, mkdir, open, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { assertSafePath, ensureWithin, fileExists } from "./filesystem.js";
import { ARTIFACT_PATHS, canonicalFingerprint } from "./artifacts.js";
import { assertJsonBytes, assertJsonLimits } from "./json-safety.js";
import { assertSchema, readSchema } from "./schema-validation.js";
import { assertSecretFree } from "./receipt.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { isRecoverableCompletionEvidenceCode } from "./completion-recovery.js";
import {
  CONTRACT_BOOTSTRAP_REPAIR_EVENT,
  assertContractBootstrapRepairDetails,
  repairMarkerErrors,
} from "./contract-bootstrap-recovery.js";

import { taskArtifactPath } from "./task-paths.js";
import { getTaskTransaction, withTaskTransaction } from "./transaction.js";

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

function eventIndexPath(eventsPath) {
  return `${eventsPath}.index.json`;
}

function parseEventIndex(text, relativePath) {
  if (typeof text !== "string") return null;
  try {
    const value = JSON.parse(text);
    if (!value || value.schemaVersion !== 1 || !Number.isInteger(value.seq) || value.seq < 0
      || (value.lastHash !== null && !/^[a-f0-9]{64}$/.test(value.lastHash))) return null;
    return value;
  } catch {
    return null;
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

  const indexPath = eventIndexPath(relPath);
  const indexed = parseEventIndex(await transaction.readText(indexPath), indexPath);
  const tail = await readEventTail(target, packageRoot, { ...options, eventsPath: relPath, limit: 1 });
  const last = tail.at(-1) ?? null;
  let checkpoint;
  if (indexed && indexed.seq === (last?.seq ?? 0) && indexed.lastHash === (last?.hash ?? null)) {
    checkpoint = indexed;
  } else {
    checkpoint = checkpointFromEvents(await readEvents(target, packageRoot, { ...options, eventsPath: relPath }));
  }
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
    case "LEGACY_RECOVERY_MIGRATION_RECORDED":
      assertLegacyMigrationDetails(event.details);
      return;
    case CONTRACT_BOOTSTRAP_REPAIR_EVENT:
      assertContractBootstrapRepairDetails(event.details);
      return;
    case "TASK_RECOVERY_RESUMED":
      assertRecoveryResumedDetails(event.details);
      return;
    case "TRAJECTORY_EVALUATED":
      if (!event.details || !/^eval-[A-Za-z0-9_-]+$/.test(event.details.evaluationId ?? "")
        || typeof event.details.scenarioId !== "string" || !/^[a-f0-9]{64}$/.test(event.details.evaluationFingerprint ?? "")
        || event.fingerprint !== event.details.evaluationFingerprint) {
        throw protocolError("E_EVENT_INVALID", "TRAJECTORY_EVALUATED requires a bound evaluationId, scenarioId, and fingerprint");
      }
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
      if (!event.details || typeof event.details !== "object" || Array.isArray(event.details)
        || typeof event.details.handoffId !== "string" || !/^handoff-[A-Za-z0-9_-]+$/.test(event.details.handoffId)
        || typeof event.details.handoffDigest !== "string"
        || typeof event.details.consumerId !== "string" || !event.details.consumerId.trim()
        || (event.details.harness !== undefined && (typeof event.details.harness !== "string" || !event.details.harness.trim()))) {
        throw protocolError("E_EVENT_INVALID", "HANDOFF_ACCEPTED requires a valid handoffId, handoffDigest, and consumerId");
      }
      assertFingerprint(event.details.handoffDigest, "HANDOFF_ACCEPTED details.handoffDigest");
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
  const relPath = options?.eventsPath ?? options?.relativePath ?? (options?.taskId ? taskArtifactPath(options.taskId, "events") : ARTIFACT_PATHS.events);
  await assertSafePath(target, relPath);
  const eventsPath = ensureWithin(target, relPath);
  const transaction = (await getTaskTransaction(target));
  if (transaction) {
    const stagedText = await transaction.readText(relPath);
    if (stagedText !== null) return parseEventsText(stagedText, relPath, packageRoot);
  }
  if (!(await fileExists(eventsPath))) return [];
  const text = await readFile(eventsPath, "utf8");
  return parseEventsText(text, relPath, packageRoot);
}

export async function readEventTail(target, packageRoot, options = {}) {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1) {
    throw protocolError("E_EVENT_INVALID", "ledger tail limit must be a positive integer");
  }
  const relPath = options?.eventsPath ?? options?.relativePath ?? (options?.taskId ? taskArtifactPath(options.taskId, "events") : ARTIFACT_PATHS.events);
  await assertSafePath(target, relPath);
  const eventsPath = ensureWithin(target, relPath);
  const transaction = (await getTaskTransaction(target));
  if (transaction) {
    const stagedText = await transaction.readText(relPath);
    if (stagedText !== null) {
      const lines = stagedText.split(/\r?\n/).filter((line) => line.trim() !== "");
      return parseEventsText(lines.slice(-limit).join("\n"), relPath, packageRoot);
    }
  }
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

export async function appendProtocolEvent(target, input, packageRoot, options = {}) {
  const activeTransaction = (await getTaskTransaction(target));
  if (typeof input?.taskId !== "string" || !input.taskId) throw protocolError("E_EVENT_INVALID", "event taskId is required");
  if (typeof input?.event !== "string" || !input.event) throw protocolError("E_EVENT_INVALID", "event type is required");
  const relPath = options?.eventsPath ?? options?.relativePath ?? (options?.taskId ? taskArtifactPath(options.taskId, "events") : ARTIFACT_PATHS.events);
  if (!activeTransaction) {
    return withTaskTransaction({
      target,
      taskId: options.taskId ?? input.taskId,
      lockTaskId: relPath === ARTIFACT_PATHS.events ? "__legacy-events__" : (options.taskId ?? input.taskId),
      operation: "append-event",
    }, async () => appendProtocolEvent(target, input, packageRoot, options));
  }
  const checkpoint = await readEventCheckpoint(target, packageRoot, relPath, options, activeTransaction);
  const event = buildProtocolEvent(input, { checkpoint });
  const schema = await readSchema("event", packageRoot);
  assertSchema(event, schema, relPath);
  event.hash = eventHash(event);
  if (!options.dryRun) {
    if (activeTransaction) {
      await activeTransaction.appendText(relPath, `${JSON.stringify(event)}\n`);
      const nextCheckpoint = { schemaVersion: 1, seq: event.seq, lastHash: event.hash };
      await activeTransaction.stageText(eventIndexPath(relPath), `${JSON.stringify(nextCheckpoint)}\n`);
      activeTransaction.eventCheckpoints.set(relPath, nextCheckpoint);
    } else {
      const eventsPath = ensureWithin(target, relPath);
      await mkdir(path.dirname(eventsPath), { recursive: true });
      await appendFile(eventsPath, `${JSON.stringify(event)}\n`, { encoding: "utf8" });
    }
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
  const migrationBySeq = new Map();
  for (const event of events) {
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
    migrationBySeq.set(event.details.legacyEventSeq, event);
  }
  for (const event of events) {
    if (!isLegacyRecoveryEventShape(event)) continue;
    const migration = migrationBySeq.get(event.seq);
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
  for (const [legacySeq, migration] of migrationBySeq) {
    errors.push({
      code: "E_EVENT_INVALID",
      message: `migration event ${migration.seq} references unknown legacy recovery event seq ${legacySeq}`,
    });
  }
}

export async function validateEventLedger(target, packageRoot, options = {}) {
  const relPath = options?.eventsPath ?? options?.relativePath ?? (options?.taskId ? taskArtifactPath(options.taskId, "events") : ARTIFACT_PATHS.events);
  let events;
  try {
    events = await readEvents(target, packageRoot, { ...options, eventsPath: relPath });
  } catch (error) {
    return { valid: false, events: [], errors: [{ code: error.code ?? "E_EVENT_INVALID", message: error.message, artifacts: [relPath] }] };
  }
  const errors = [];
  let taskId = null;
  const seen = new Set();
  let lastMilestone = -1;
  const milestoneCounts = new Map();
  const createdHandoffs = new Map();
  const acceptedHandoffs = new Set();
  for (const [index, event] of events.entries()) {
    if (event.seq !== index + 1) {
      errors.push({ code: "E_EVENT_INVALID", message: `event sequence must be ${index + 1}` });
    }
    if (taskId === null) taskId = event.taskId;
    if (event.taskId !== taskId) errors.push({ code: "E_EVENT_INVALID", message: "event task IDs must remain stable" });
    if (event.previousHash !== (index === 0 ? null : events[index - 1].hash)) {
      errors.push({ code: "E_LEDGER_HASH_INVALID", message: `event ${event.seq} previousHash does not match` });
    }
    if (event.hash !== eventHash(event)) {
      errors.push({ code: "E_LEDGER_HASH_INVALID", message: `event ${event.seq} hash does not match its content` });
    }
    try {
      validateKnownEventDetails(event);
    } catch (err) {
      errors.push({ code: err.code ?? "E_EVENT_INVALID", message: `event ${event.seq} (${event.event}): ${err.message}` });
    }
    const milestoneIndex = LIFECYCLE_MILESTONES.indexOf(event.event);
    if (milestoneIndex >= 0) {
      const count = (milestoneCounts.get(event.event) ?? 0) + 1;
      milestoneCounts.set(event.event, count);
      if (count > 1 && !REPEATABLE_MILESTONES.has(event.event)) {
        errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: `lifecycle milestone must not repeat: ${event.event}` });
      }
      if (milestoneIndex > lastMilestone + 1) {
        errors.push({
          code: "E_PHASE_CHRONOLOGY_INVALID",
          message: `${event.event} is missing prerequisite milestone: ${LIFECYCLE_MILESTONES[lastMilestone + 1]}`,
        });
      } else if (milestoneIndex < lastMilestone && event.event !== "VERIFICATION_STARTED"
        && event.event !== "PREFLIGHT_READY") {
        // VERIFICATION_STARTED re-enters per verification cycle; PREFLIGHT_READY
        // may be refreshed mid-lifecycle (policy/contract evolution) after its
        // prerequisites were already satisfied by the earlier occurrence.
        errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: `${event.event} is out of lifecycle order` });
      } else if (milestoneIndex === lastMilestone && !REPEATABLE_MILESTONES.has(event.event)) {
        errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: `lifecycle milestone must not repeat: ${event.event}` });
      }
      if (milestoneIndex > lastMilestone) lastMilestone = milestoneIndex;
    }
    seen.add(event.event);
    if (event.event === "EXECUTION_STARTED" && !seen.has("ROUTE_VALIDATED")) {
      errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: "execution started before route validation" });
    }
    if (event.event === "EXECUTION_STARTED" && !seen.has("CONTRACT_VALIDATED")) {
      errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: "execution started before contract validation" });
    }
    if (event.event === "EXECUTION_STARTED" && !seen.has("PREFLIGHT_READY")) {
      errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: "execution started before preflight readiness" });
    }
    if (event.event === "EXECUTION_STARTED") {
      const preflight = events.slice(0, index).findLast((candidate) => candidate.event === "PREFLIGHT_READY");
      const requiredGates = preflight?.details?.requiredGates ?? [];
      const satisfiedGates = new Set(events.slice(0, index)
        .filter((candidate) => candidate.event === "GATE_SATISFIED")
        .map((candidate) => candidate.details?.gate));
      for (const gate of requiredGates) {
        if (!satisfiedGates.has(gate)) {
          errors.push({ code: "E_PHASE_CHRONOLOGY_INVALID", message: `execution started before gate satisfaction: ${gate}` });
        }
      }
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
  const markerCount = events.filter((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT).length;
  if (markerCount > 1) errors.push({ code: "E_CONTRACT_BOOTSTRAP_REPAIR_INVALID", message: "contract bootstrap repair marker must occur at most once" });
  const repairedErrors = repairMarkerErrors(events, errors);
  return { valid: repairedErrors.length === 0, events, errors: repairedErrors };
}

export function validateStateLedgerCoherence(state, events) {
  const errors = [];
  if (!Number.isInteger(state.verificationCycle)) return errors;
  const taskEvents = events.filter((event) => event.taskId === state.taskId);
  const observed = new Set(taskEvents.map((event) => event.event));
  const supportsReviewEvents = taskEvents.some((event) => event.event === "REVIEW_STARTED"
    || (event.event === "VERIFICATION_STARTED" && Number.isInteger(event.details?.verificationCycle)));
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
    const verificationEvents = taskEvents
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.event === "VERIFICATION_STARTED");
    const cycles = verificationEvents.map(({ event }) => event.details?.verificationCycle ?? 1);
    if (cycles.at(-1) !== state.verificationCycle) {
      errors.push({
        code: "E_STATE_LEDGER_DIVERGENCE",
        message: "Work-state verification cycle does not match the lifecycle ledger",
      });
    }
    const latestVerification = verificationEvents.at(-1);
    const latestReview = taskEvents
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.event === "REVIEW_STARTED")
      .at(-1);
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
