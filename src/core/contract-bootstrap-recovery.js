import { canonicalFingerprint } from "./artifacts.js";

export const CONTRACT_BOOTSTRAP_REPAIR_EVENT = "CONTRACT_BOOTSTRAP_REPAIR_RECORDED";
export const CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_EVENT = "CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_RECORDED";
export const ROUTE_CHECKPOINT_BOUND_EVENT = "ROUTE_CHECKPOINT_BOUND";
export const CONTRACT_BOOTSTRAP_REPAIR_VERSION = 1;
export const CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_VERSION = 1;
export const CONTRACT_BOOTSTRAP_REPAIR_DEFECT = "DUPLICATE_CONTRACT_VALIDATED_AFTER_CONTRACT_READY";
export const CONTRACT_BOOTSTRAP_REPAIR_AUTHORITY = "CALLER_ACKNOWLEDGED";
export const CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_DEFECT = "CONTRACT_BOOTSTRAP_REPAIR_MARKER_MISSING_RECONSTRUCTED_STATE_REVISION";

const FINGERPRINT = /^[a-f0-9]{64}$/;
const REPAIR_ID = /^repair-[a-f0-9]{64}$/;
const HISTORICAL_EVENTS = new Set([
  "DESIGN_GATE_STARTED",
  "PLAN_RECORDED",
  "EXECUTION_STARTED",
  "VERIFICATION_STARTED",
  "VERIFICATION_RECORDED",
  "DIAGNOSIS_RECORDED",
  "DIAGNOSTIC_CASE_RECORDED",
  "CORRECTION_STARTED",
  "REVIEW_STARTED",
  "COMPLETION_VALIDATED",
  "COMPLETION_REJECTED",
  "TASK_RECOVERY_RECORDED",
  "OPERATOR_RECOVERY_RECORDED",
  "TASK_RECOVERY_RESUMED",
  "LEGACY_RECOVERY_MIGRATION_RECORDED",
]);
const REPAIR_DETAIL_KEYS = new Set([
  "repairVersion", "taskId", "repairId", "defect",
  "canonicalContractEventSeq", "canonicalContractEventHash",
  "duplicateContractEventSeq", "duplicateContractEventHash",
  "contractCreateCommitSeq", "contractCreateCommitHash", "contractCreateTransactionId",
  "contractFingerprint", "reconstructedPhase", "routeFingerprint",
  "previousStateFingerprint", "reconstructedStateFingerprint", "reconstructedStateRevision",
  "repairedAt", "authorityKind",
]);
const LEGACY_REPAIR_DETAIL_KEYS = new Set([...REPAIR_DETAIL_KEYS].filter((key) => key !== "reconstructedStateRevision"));
const MIGRATION_DETAIL_KEYS = new Set([
  "migrationVersion", "defect", "legacyMarkerSeq", "legacyMarkerHash", "legacyRepairId",
  "legacyRepairCommitSeq", "legacyRepairCommitHash", "legacyRepairTransactionId", "taskId",
  "contractFingerprint", "reconstructedPhase", "routeFingerprint", "reconstructedStateFingerprint",
  "reconstructedStateRevision", "migratedAt", "authorityKind",
]);

function invalid(message) {
  const error = new Error(message);
  error.code = "E_EVENT_INVALID";
  return error;
}

function isFingerprint(value) {
  return typeof value === "string" && FINGERPRINT.test(value);
}

function isCommitFor(event, operation) {
  return event?.event === "TRANSACTION_COMMITTED"
    && event.details?.operation === operation
    && typeof event.details?.transactionId === "string"
    && event.details.transactionId.length > 0;
}

function canonicalGuideList(value) {
  if (!Array.isArray(value) || value.some((guide) => typeof guide !== "string" || !guide)) return null;
  const guides = [...value].sort();
  return new Set(guides).size === guides.length ? guides : null;
}

export function sameCanonicalGuideList(left, right) {
  const a = canonicalGuideList(left);
  const b = canonicalGuideList(right);
  return a !== null && b !== null && a.length === b.length && a.every((guide, index) => guide === b[index]);
}

const EXACT_DUPLICATE_CONTRACT_ERRORS = Object.freeze([
  "lifecycle milestone must not repeat: CONTRACT_VALIDATED",
  "CONTRACT_VALIDATED is out of lifecycle order",
]);
export const EXACT_DUPLICATE_CONTRACT_ERRORS_FROZEN = EXACT_DUPLICATE_CONTRACT_ERRORS;

export function isExactDuplicateContractChronologyError(error) {
  return error?.code === "E_PHASE_CHRONOLOGY_INVALID"
    && EXACT_DUPLICATE_CONTRACT_ERRORS.includes(error.message);
}

export function eventHash(event) {
  const { hash, ...body } = event;
  return canonicalFingerprint(body);
}

function assertContractBootstrapRepairDetailsInternal(details, { legacy = false } = {}) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    throw invalid("contract bootstrap repair requires structured details");
  }
  assertRepairDetailKeys(details, legacy);
  for (const key of [
    "taskId", "repairId", "defect", "contractCreateTransactionId", "repairedAt", "authorityKind",
  ]) {
    if (typeof details[key] !== "string" || !details[key].trim()) {
      throw invalid(`contract bootstrap repair details.${key} must be a non-empty string`);
    }
  }
  if (details.repairVersion !== CONTRACT_BOOTSTRAP_REPAIR_VERSION) {
    throw invalid("contract bootstrap repair details.repairVersion is unsupported");
  }
  if (!REPAIR_ID.test(details.repairId)) throw invalid("contract bootstrap repair details.repairId is invalid");
  if (details.defect !== CONTRACT_BOOTSTRAP_REPAIR_DEFECT) throw invalid("contract bootstrap repair details.defect is invalid");
  if (details.authorityKind !== CONTRACT_BOOTSTRAP_REPAIR_AUTHORITY) throw invalid("contract bootstrap repair details.authorityKind is invalid");
  for (const key of [
    "canonicalContractEventHash", "duplicateContractEventHash", "contractCreateCommitHash",
    "contractFingerprint", "reconstructedStateFingerprint",
  ]) {
    if (!isFingerprint(details[key])) throw invalid(`contract bootstrap repair details.${key} must be a lowercase SHA-256 fingerprint`);
  }
  for (const key of ["canonicalContractEventSeq", "duplicateContractEventSeq", "contractCreateCommitSeq"]) {
    if (!Number.isInteger(details[key]) || details[key] < 1) throw invalid(`contract bootstrap repair details.${key} must be a positive integer`);
  }
  assertRepairDetailRevision(details, legacy);
  assertRepairDetailPhase(details);
  if (details.routeFingerprint !== null && !isFingerprint(details.routeFingerprint)) {
    throw invalid("contract bootstrap repair details.routeFingerprint must be a fingerprint or null");
  }
  if (details.previousStateFingerprint !== null && !isFingerprint(details.previousStateFingerprint)) {
    throw invalid("contract bootstrap repair details.previousStateFingerprint must be a fingerprint or null");
  }
  if (!Number.isFinite(Date.parse(details.repairedAt))) throw invalid("contract bootstrap repair details.repairedAt must be an ISO timestamp");
  return details;
}

function assertRepairDetailKeys(details, legacy) {
  const allowedKeys = legacy ? LEGACY_REPAIR_DETAIL_KEYS : REPAIR_DETAIL_KEYS;
  const unexpected = Object.keys(details).find((key) => !allowedKeys.has(key));
  if (unexpected) throw invalid(`contract bootstrap repair details contains unknown property: ${unexpected}`);
}

function assertRepairDetailRevision(details, legacy) {
  if (!legacy && (!Number.isInteger(details.reconstructedStateRevision) || details.reconstructedStateRevision < 0)) {
    throw invalid("contract bootstrap repair details.reconstructedStateRevision must be a non-negative integer");
  }
}

function assertRepairDetailPhase(details) {
  if (!["CONTRACT_READY", "ROUTED"].includes(details.reconstructedPhase)) {
    throw invalid("contract bootstrap repair details.reconstructedPhase is invalid");
  }
  if (details.reconstructedPhase === "ROUTED" && details.routeFingerprint === null) {
    throw invalid("ROUTED contract bootstrap repair requires routeFingerprint");
  }
}

export function assertContractBootstrapRepairDetails(details) {
  return assertContractBootstrapRepairDetailsInternal(details);
}

export function assertLegacyContractBootstrapRepairDetails(details) {
  return assertContractBootstrapRepairDetailsInternal(details, { legacy: true });
}

export function contractBootstrapRepairId(details) {
  const identity = {
    taskId: details.taskId,
    defect: details.defect,
    canonicalContractEventSeq: details.canonicalContractEventSeq,
    canonicalContractEventHash: details.canonicalContractEventHash,
    duplicateContractEventSeq: details.duplicateContractEventSeq,
    duplicateContractEventHash: details.duplicateContractEventHash,
    contractCreateCommitSeq: details.contractCreateCommitSeq,
    contractCreateCommitHash: details.contractCreateCommitHash,
    contractCreateTransactionId: details.contractCreateTransactionId,
    contractFingerprint: details.contractFingerprint,
    reconstructedPhase: details.reconstructedPhase,
    routeFingerprint: details.routeFingerprint,
    reconstructedStateRevision: details.reconstructedStateRevision,
  };
  return `repair-${canonicalFingerprint(identity)}`;
}

export function legacyContractBootstrapRepairId(details) {
  const identity = {
    taskId: details.taskId,
    defect: details.defect,
    canonicalContractEventSeq: details.canonicalContractEventSeq,
    canonicalContractEventHash: details.canonicalContractEventHash,
    duplicateContractEventSeq: details.duplicateContractEventSeq,
    duplicateContractEventHash: details.duplicateContractEventHash,
    contractCreateCommitSeq: details.contractCreateCommitSeq,
    contractCreateCommitHash: details.contractCreateCommitHash,
    contractCreateTransactionId: details.contractCreateTransactionId,
    contractFingerprint: details.contractFingerprint,
    reconstructedPhase: details.reconstructedPhase,
    routeFingerprint: details.routeFingerprint,
  };
  return `repair-${canonicalFingerprint(identity)}`;
}

function isRepairTransactionCommit(event, taskId) {
  if (!event || event.taskId !== taskId || event.event !== "TRANSACTION_COMMITTED") return false;
  const details = event.details;
  return details && typeof details === "object" && !Array.isArray(details)
    && Object.keys(details).length === 2
    && typeof details.transactionId === "string" && details.transactionId.length > 0
    && details.operation === "task-repair-contract-bootstrap"
    && event.hash === eventHash(event);
}

/**
 * Resolves the immutable repair marker and its transaction boundary. Events
 * after the commit are normal lifecycle history and never become part of the
 * repair transaction merely because they follow the marker.
 */
export function resolveContractBootstrapRepairBoundary(events, marker = null) {
  if (!Array.isArray(events)) return null;
  const markers = events.filter((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT);
  if (markers.length !== 1) return null;
  const resolvedMarker = marker ?? markers[0];
  const markerIndex = events.indexOf(resolvedMarker);
  if (markerIndex < 0 || resolvedMarker.seq !== markerIndex + 1) return null;
  const repairCommit = events[markerIndex + 1];
  if (!isRepairTransactionCommit(repairCommit, resolvedMarker.taskId)
    || repairCommit.seq !== resolvedMarker.seq + 1) return null;
  return {
    marker: resolvedMarker,
    markerIndex,
    repairCommit,
    repairCommitIndex: markerIndex + 1,
    postRepairEvents: events.slice(markerIndex + 2),
  };
}

export function resolveCanonicalPostRepairRouteBinding(events, marker, currentRouteFingerprint) {
  const boundary = resolveContractBootstrapRepairBoundary(events, marker);
  if (!boundary || !isFingerprint(currentRouteFingerprint)) return null;
  let previousFingerprint = boundary.marker.details.routeFingerprint;
  let binding = null;
  const reboundEvents = [];
  for (let index = 0; index < boundary.postRepairEvents.length; index += 1) {
    const reboundEvent = boundary.postRepairEvents[index];
    if (reboundEvent.event !== "ROUTE_REBOUND") continue;
    const routeCommit = boundary.postRepairEvents[index + 1];
    if (reboundEvent.taskId !== boundary.marker.taskId
      || reboundEvent.hash !== eventHash(reboundEvent)
      || reboundEvent.details?.contractFingerprint !== boundary.marker.details.contractFingerprint
      || reboundEvent.details?.previousRouteFingerprint !== previousFingerprint
      || !isFingerprint(reboundEvent.details?.routeFingerprint)
      || !isCommitFor(routeCommit, "route")
      || routeCommit.taskId !== boundary.marker.taskId
      || routeCommit.hash !== eventHash(routeCommit)) {
      return null;
    }
    reboundEvents.push({ reboundEvent, routeCommit, previousFingerprint });
    previousFingerprint = reboundEvent.details.routeFingerprint;
    binding = { valid: true, reboundEvent, routeCommit };
  }
  return binding?.reboundEvent.details.routeFingerprint === currentRouteFingerprint
    ? { ...binding, reboundEvents }
    : null;
}

const CHECKPOINT_PHASE_EVENTS = new Set(["DESIGN_GATE_STARTED", "PLAN_RECORDED"]);

export function resolveCanonicalPostRepairCheckpointBinding(events, marker) {
  const boundary = resolveContractBootstrapRepairBoundary(events, marker);
  if (!boundary) return null;
  const checkpointEvents = boundary.postRepairEvents.filter((event) => event.event === ROUTE_CHECKPOINT_BOUND_EVENT);
  if (checkpointEvents.length !== 1) return null;
  const checkpointEvent = checkpointEvents[0];
  const checkpointIndex = boundary.postRepairEvents.indexOf(checkpointEvent);
  const phaseEvent = boundary.postRepairEvents[checkpointIndex + 1];
  const transactionCommit = boundary.postRepairEvents[checkpointIndex + 2];
  const details = checkpointEvent.details;
  if (checkpointEvent.taskId !== boundary.marker.taskId
    || checkpointEvent.hash !== eventHash(checkpointEvent)
    || details?.contractFingerprint !== boundary.marker.details.contractFingerprint
    || !isFingerprint(details?.routeFingerprint)
    || canonicalGuideList(details?.selectedGuides) === null
    || !CHECKPOINT_PHASE_EVENTS.has(phaseEvent?.event)
    || phaseEvent.taskId !== boundary.marker.taskId
    || phaseEvent.hash !== eventHash(phaseEvent)
    || !isCommitFor(transactionCommit, "advance")
    || transactionCommit.taskId !== boundary.marker.taskId
    || transactionCommit.hash !== eventHash(transactionCommit)) {
    return null;
  }
  return {
    valid: true,
    checkpointEvent,
    phaseEvent,
    transactionCommit,
    routeFingerprint: details.routeFingerprint,
    contractFingerprint: details.contractFingerprint,
    selectedGuides: [...details.selectedGuides],
  };
}

export function isContractBootstrapRepairCandidate(events, ledgerErrors = [], taskId = null) {
  if (!Array.isArray(events) || events.length < 4) return null;
  const effectiveTaskId = taskId ?? events[0]?.taskId;
  if (typeof effectiveTaskId !== "string" || !effectiveTaskId) return null;
  if (events.some((event) => event.taskId !== effectiveTaskId)) return null;
  if (events.some((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT)) return null;
  if (events[0]?.event !== "TASK_RECEIVED" || events[1]?.event !== "TRANSACTION_COMMITTED"
    || events[1]?.details?.operation !== "task-create") return null;
  if (!events.some((event) => event.event === "DISCOVERY_STARTED")) return null;
  const contractEvents = events.filter((event) => event.event === "CONTRACT_VALIDATED");
  if (contractEvents.length !== 2) return null;
  const [canonical, duplicate] = contractEvents;
  if (!isFingerprint(canonical.details?.contractFingerprint)
    || canonical.details.contractFingerprint !== duplicate.details?.contractFingerprint) return null;
  if (canonical.hash !== eventHash(canonical) || duplicate.hash !== eventHash(duplicate)) return null;
  const canonicalIndex = events.indexOf(canonical);
  const duplicateIndex = events.indexOf(duplicate);
  const canonicalCommit = events[canonicalIndex + 1];
  const duplicateCommit = events[duplicateIndex + 1];
  if (!isCommitFor(canonicalCommit, "contract-create") || !isCommitFor(duplicateCommit, "contract-create")) return null;
  if (duplicateIndex !== events.length - 2 || events.at(-1) !== duplicateCommit) return null;
  if (events.some((event) => HISTORICAL_EVENTS.has(event.event))) return null;
  if (!Array.isArray(ledgerErrors) || ledgerErrors.length < 1) return null;
  if (ledgerErrors.some((error) => !isExactDuplicateContractChronologyError(error))) return null;
  if (!ledgerErrors.some((error) => error.message === "lifecycle milestone must not repeat: CONTRACT_VALIDATED")) return null;
  return {
    taskId: effectiveTaskId,
    canonicalContractEvent: canonical,
    duplicateContractEvent: duplicate,
    canonicalContractCommit: canonicalCommit,
    duplicateContractCommit: duplicateCommit,
    contractFingerprint: canonical.details.contractFingerprint,
  };
}

export function isContractBootstrapRepairMarkerValid(events, marker) {
  try {
    if (!marker || marker.event !== CONTRACT_BOOTSTRAP_REPAIR_EVENT) return false;
    if (!resolveContractBootstrapRepairBoundary(events, marker)) return false;
    assertContractBootstrapRepairDetails(marker.details);
    if (marker.taskId !== marker.details.taskId || marker.hash !== eventHash(marker)) return false;
    if (marker.seq < 1 || events[marker.seq - 1] !== marker) return false;
    const prefix = events.slice(0, marker.seq - 1);
    const prefixErrors = [];
    const candidate = isContractBootstrapRepairCandidate(prefix, prefixErrors, marker.taskId);
    if (!candidate) {
      const duplicateErrors = [
        { code: "E_PHASE_CHRONOLOGY_INVALID", message: "lifecycle milestone must not repeat: CONTRACT_VALIDATED" },
        { code: "E_PHASE_CHRONOLOGY_INVALID", message: "CONTRACT_VALIDATED is out of lifecycle order" },
      ];
      const recognized = isContractBootstrapRepairCandidate(prefix, duplicateErrors, marker.taskId);
      if (!recognized) return false;
      return isMarkerBound(marker, recognized);
    }
    return isMarkerBound(marker, candidate);
  } catch {
    return false;
  }
}

function isMarkerBound(marker, candidate) {
  const details = marker.details;
  const expected = {
    taskId: candidate.taskId,
    defect: CONTRACT_BOOTSTRAP_REPAIR_DEFECT,
    canonicalContractEventSeq: candidate.canonicalContractEvent.seq,
    canonicalContractEventHash: candidate.canonicalContractEvent.hash,
    duplicateContractEventSeq: candidate.duplicateContractEvent.seq,
    duplicateContractEventHash: candidate.duplicateContractEvent.hash,
    contractCreateCommitSeq: candidate.duplicateContractCommit.seq,
    contractCreateCommitHash: candidate.duplicateContractCommit.hash,
    contractCreateTransactionId: candidate.duplicateContractCommit.details.transactionId,
    contractFingerprint: candidate.contractFingerprint,
  };
  for (const [key, value] of Object.entries(expected)) if (details[key] !== value) return false;
  if (details.repairId !== contractBootstrapRepairId(details)) return false;
  return true;
}

export function isLegacyContractBootstrapRepairMarkerShape(event) {
  try {
    if (!event || event.event !== CONTRACT_BOOTSTRAP_REPAIR_EVENT) return false;
    assertLegacyContractBootstrapRepairDetails(event.details);
    if (typeof event.taskId !== "string" || !event.taskId
      || event.taskId !== event.details.taskId
      || !Number.isInteger(event.seq) || event.seq < 1
      || !isFingerprint(event.hash)
      || event.hash !== eventHash(event)
      || event.details.repairId !== legacyContractBootstrapRepairId(event.details)) return false;
    return true;
  } catch {
    return false;
  }
}

function migrationInvalid(message) {
  const error = new Error(message);
  error.code = "E_EVENT_INVALID";
  return error;
}

export function assertContractBootstrapRepairMigrationDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    throw migrationInvalid("contract bootstrap repair migration requires structured details");
  }
  const unexpected = Object.keys(details).find((key) => !MIGRATION_DETAIL_KEYS.has(key));
  if (unexpected) throw migrationInvalid(`contract bootstrap repair migration details contains unknown property: ${unexpected}`);
  for (const key of ["defect", "legacyRepairId", "legacyRepairTransactionId", "taskId", "migratedAt", "authorityKind"]) {
    if (typeof details[key] !== "string" || !details[key].trim()) {
      throw migrationInvalid(`contract bootstrap repair migration details.${key} must be a non-empty string`);
    }
  }
  if (details.migrationVersion !== CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_VERSION) {
    throw migrationInvalid("contract bootstrap repair migration details.migrationVersion is unsupported");
  }
  if (details.defect !== CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_DEFECT) {
    throw migrationInvalid("contract bootstrap repair migration details.defect is invalid");
  }
  if (details.authorityKind !== CONTRACT_BOOTSTRAP_REPAIR_AUTHORITY) {
    throw migrationInvalid("contract bootstrap repair migration details.authorityKind is invalid");
  }
  for (const key of ["legacyMarkerHash", "legacyRepairCommitHash", "contractFingerprint", "reconstructedStateFingerprint"]) {
    if (!isFingerprint(details[key])) throw migrationInvalid(`contract bootstrap repair migration details.${key} must be a lowercase SHA-256 fingerprint`);
  }
  if (!/^repair-[a-f0-9]{64}$/.test(details.legacyRepairId)) {
    throw migrationInvalid("contract bootstrap repair migration details.legacyRepairId is invalid");
  }
  for (const key of ["legacyMarkerSeq", "legacyRepairCommitSeq", "reconstructedStateRevision"]) {
    if (!Number.isInteger(details[key]) || details[key] < 0) {
      throw migrationInvalid(`contract bootstrap repair migration details.${key} must be a non-negative integer`);
    }
  }
  assertMigrationSourceSequence(details);
  if (!isFingerprint(details.routeFingerprint) && details.routeFingerprint !== null) {
    throw migrationInvalid("contract bootstrap repair migration details.routeFingerprint must be a fingerprint or null");
  }
  if (!isFingerprint(details.reconstructedStateFingerprint)) {
    throw migrationInvalid("contract bootstrap repair migration details.reconstructedStateFingerprint must be a fingerprint");
  }
  if (!Number.isFinite(Date.parse(details.migratedAt))) {
    throw migrationInvalid("contract bootstrap repair migration details.migratedAt must be an ISO timestamp");
  }
  return details;
}

function assertMigrationSourceSequence(details) {
  if (details.legacyMarkerSeq < 1 || details.legacyRepairCommitSeq <= details.legacyMarkerSeq) {
    throw migrationInvalid("contract bootstrap repair migration source sequence boundary is invalid");
  }
  if (!["CONTRACT_READY", "ROUTED"].includes(details.reconstructedPhase)) {
    throw migrationInvalid("contract bootstrap repair migration details.reconstructedPhase is invalid");
  }
  if (details.reconstructedPhase === "ROUTED" && details.routeFingerprint === null) {
    throw migrationInvalid("ROUTED contract bootstrap repair migration requires routeFingerprint");
  }
}

function migrationCommitFor(event, taskId) {
  return event?.event === "TRANSACTION_COMMITTED"
    && event.taskId === taskId
    && event.details?.operation === "task-migrate-contract-bootstrap-repair"
    && typeof event.details?.transactionId === "string"
    && event.details.transactionId.length > 0
    && event.hash === eventHash(event);
}

function resolveContractBootstrapRepairMigration(events, migration) {
  if (!Array.isArray(events) || !migration || migration.event !== CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_EVENT) return null;
  const marker = events.find((event) => event.seq === migration.details?.legacyMarkerSeq);
  const markerIndex = marker ? events.indexOf(marker) : -1;
  const commit = events[events.indexOf(migration) + 1];
  if (!marker || !isLegacyContractBootstrapRepairMarkerShape(marker)
    || markerIndex < 0 || !resolveContractBootstrapRepairBoundary(events, marker)
    || migration.seq <= marker.seq
    || migration.taskId !== marker.taskId
    || migration.details?.legacyMarkerHash !== marker.hash
    || migration.details?.legacyRepairId !== marker.details.repairId
    || migration.details?.taskId !== marker.taskId
    || migration.details?.legacyRepairCommitSeq !== marker.seq + 1
    || migration.details?.legacyRepairCommitHash !== events[markerIndex + 1]?.hash
    || !migrationCommitFor(commit, migration.taskId)
    || commit.seq !== migration.seq + 1) return null;
  return { marker, migration, migrationCommit: commit };
}

export function validateContractBootstrapRepairMigrations(events, errors, { allowUnmigratedLegacyContractBootstrapRepairMarkers = false } = {}) {
  const markers = events.filter((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT);
  const migrations = events.filter((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_EVENT);
  const migrationBySeq = new Map();
  for (const migration of migrations) {
    try {
      assertContractBootstrapRepairMigrationDetails(migration.details);
    } catch (error) {
      errors.push({ code: error.code ?? "E_EVENT_INVALID", message: `event ${migration.seq} (${migration.event}): ${error.message}` });
      continue;
    }
    if (typeof migration.taskId !== "string" || migration.taskId !== migration.details.taskId) {
      errors.push({
        code: "E_EVENT_INVALID",
        message: `event ${migration.seq} (${migration.event}): migration taskId must match details.taskId`,
      });
      continue;
    }
    if (migrationBySeq.has(migration.details.legacyMarkerSeq)) {
      errors.push({
        code: "E_EVENT_INVALID",
        message: `event ${migration.seq} (${migration.event}): duplicate migration for legacy marker seq ${migration.details.legacyMarkerSeq}`,
      });
      continue;
    }
    migrationBySeq.set(migration.details.legacyMarkerSeq, migration);
  }
  if (markers.length > 1) {
    errors.push({ code: "E_CONTRACT_BOOTSTRAP_REPAIR_INVALID", message: "contract bootstrap repair marker must occur at most once" });
  }
  for (const marker of markers) {
    if (!isLegacyContractBootstrapRepairMarkerShape(marker)) continue;
    const migration = migrationBySeq.get(marker.seq);
    if (!migration) {
      if (!allowUnmigratedLegacyContractBootstrapRepairMarkers) {
        errors.push({
          code: "E_EVENT_INVALID",
          message: `legacy contract bootstrap repair marker ${marker.seq} is not officially migrated (run forgeloop task-migrate-contract-bootstrap-repair)`,
        });
      }
      continue;
    }
    migrationBySeq.delete(marker.seq);
    const binding = resolveContractBootstrapRepairMigration(events, migration);
    if (!binding) {
      errors.push({
        code: "E_LEDGER_HASH_INVALID",
        message: `migration event ${migration.seq} does not bind legacy contract bootstrap repair marker ${marker.seq}`,
      });
    }
  }
  for (const [legacySeq, migration] of migrationBySeq) {
    errors.push({
      code: "E_EVENT_INVALID",
      message: `migration event ${migration.seq} references unknown legacy contract bootstrap repair marker seq ${legacySeq}`,
    });
  }
}

export function isLegacyContractBootstrapRepairMigrationCandidate(events, taskId = null) {
  if (!Array.isArray(events)) return null;
  const markers = events.filter((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT);
  if (markers.length !== 1) return null;
  const marker = markers[0];
  if (!isLegacyContractBootstrapRepairMarkerShape(marker)) return null;
  const effectiveTaskId = taskId ?? marker.taskId;
  if (marker.taskId !== effectiveTaskId || events.some((event) => event.taskId !== effectiveTaskId)) return null;
  if (events.some((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_EVENT)) return null;
  const boundary = resolveContractBootstrapRepairBoundary(events, marker);
  if (!boundary || boundary.postRepairEvents.length > 0) return null;
  return { taskId: effectiveTaskId, marker, repairCommit: boundary.repairCommit };
}

export function resolveEffectiveContractBootstrapRepairAnchor(events) {
  if (!Array.isArray(events)) return null;
  const markers = events.filter((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT);
  if (markers.length !== 1) return null;
  const sourceMarker = markers[0];
  if (isContractBootstrapRepairMarkerValid(events, sourceMarker)) {
    return { kind: "MODERN", sourceMarker, details: sourceMarker.details };
  }
  if (!isLegacyContractBootstrapRepairMarkerShape(sourceMarker)) return null;
  const migration = events
    .filter((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_EVENT)
    .find((event) => event.details?.legacyMarkerSeq === sourceMarker.seq);
  const binding = resolveContractBootstrapRepairMigration(events, migration);
  if (!binding) return null;
  return {
    kind: "MIGRATED_LEGACY",
    sourceMarker,
    migrationEvent: migration,
    details: {
      ...sourceMarker.details,
      reconstructedStateRevision: migration.details.reconstructedStateRevision,
    },
  };
}

export function repairMarkerErrors(events, errors, { allowUnmigratedLegacyContractBootstrapRepairMarkers = false } = {}) {
  const marker = events.find((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT);
  const boundary = resolveContractBootstrapRepairBoundary(events, marker);
  const migratedLegacy = resolveEffectiveContractBootstrapRepairAnchor(events)?.kind === "MIGRATED_LEGACY";
  const recognized = isContractBootstrapRepairMarkerValid(events, marker)
    || migratedLegacy
    || (allowUnmigratedLegacyContractBootstrapRepairMarkers && isLegacyContractBootstrapRepairMarkerShape(marker));
  if (!boundary || !recognized) return errors;
  if (boundary.postRepairEvents.some((event) => event.event === "CONTRACT_VALIDATED")) return errors;
  return errors.filter((error) => !isExactDuplicateContractChronologyError(error));
}
