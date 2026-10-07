import { withTaskSnapshot } from "./task-snapshot.js";
import { ledgerEventsOfTypes } from "./ledger-event-collection.js";
import {
  assertDiagnosticCaseDetails,
  assertInterventionDetails,
  assertHypothesisDispositionDetails,
} from "./diagnostic-model.js";
import { projectFailureSignatures } from "./failure-signature.js";
import { projectFailureSurfaces } from "./failure-surface.js";
import { listActions } from "./actions.js";

export const EVENT_CATEGORIES = Object.freeze([
  "task",
  "contract",
  "routing",
  "lifecycle",
  "execution",
  "verification",
  "diagnosis",
  "intervention",
  "evidence",
  "review",
  "continuity",
  "recovery",
  "policy",
  "audit",
  "completion",
  "integrity",
]);

const EVENT_CATEGORY_MAP = Object.freeze({
  TASK_RECEIVED: "task",
  CONTRACT_VALIDATED: "contract",
  DECISION_CRITERION_RECORDED: "contract",
  PLAN_RECORDED: "contract",
  ROUTE_VALIDATED: "routing",
  PREFLIGHT_READY: "lifecycle",
  PREFLIGHT_BLOCKED: "lifecycle",
  EXECUTION_STARTED: "execution",
  VERIFICATION_STARTED: "lifecycle",
  VERIFICATION_RECORDED: "verification",
  CHECK_RECORDED: "verification",
  TERMINAL_RESULT_RECORDED: "verification",
  REVIEW_STARTED: "review",
  DIAGNOSIS_RECORDED: "diagnosis",
  DIAGNOSTIC_CASE_RECORDED: "diagnosis",
  HYPOTHESIS_DISPOSITION_RECORDED: "diagnosis",
  INTERVENTION_RECORDED: "intervention",
  CONTINUITY_RECORDED: "continuity",
  CHECKPOINT_RECONCILED: "continuity",
  TASK_RECOVERY_RECORDED: "recovery",
  TASK_RECOVERY_RESUMED: "recovery",
  OPERATOR_RECOVERY_RECORDED: "recovery",
  TASK_ABANDONED: "recovery",
  LEGACY_RECOVERY_MIGRATION_RECORDED: "recovery",
  GATE_SATISFIED: "policy",
  COMPLETION_VALIDATED: "completion",
  COMPLETION_REJECTED: "completion",
  TRANSACTION_COMMITTED: "integrity",
  ACTION_PROPOSED: "execution",
  ACTION_AUTHORIZED: "execution",
  ACTION_STARTED: "execution",
  ACTION_COMMIT_RECORDED: "execution",
  ACTION_VERIFIED: "execution",
  ACTION_FAILED: "execution",
  ACTION_COMMIT_UNKNOWN: "execution",
  ACTION_RECONCILED: "execution",
  ACTION_CANCELLED: "execution",
  APPROVAL_REQUESTED: "execution",
  APPROVAL_RESOLVED: "execution",
  TRAJECTORY_EVALUATED: "audit",
  USAGE_RECORDED: "audit",
});

const LIFECYCLE_TRANSITIONS = Object.freeze([
  "CONTRACT_VALIDATED",
  "ROUTE_VALIDATED",
  "PREFLIGHT_READY",
  "EXECUTION_STARTED",
  "VERIFICATION_STARTED",
  "REVIEW_STARTED",
  "COMPLETION_VALIDATED",
  "COMPLETION_REJECTED",
]);

const STATIC_EVENT_SUMMARIES = Object.freeze({
  TASK_RECOVERY_RESUMED: "Task resumed after recovery",
  OPERATOR_RECOVERY_RECORDED: "Operator recovery recorded",
  TASK_ABANDONED: "Task explicitly abandoned",
  LEGACY_RECOVERY_MIGRATION_RECORDED: "Legacy recovery migration recorded",
});

export function eventCategory(eventType) {
  return EVENT_CATEGORY_MAP[eventType] ?? "integrity";
}

export function timestampQuality(event) {
  if (typeof event?.at === "string" && !Number.isNaN(Date.parse(event.at))) return "authoritative";
  return "unknown";
}

function eventSummary(event) {
  const d = event.details ?? {};
  const staticSummary = STATIC_EVENT_SUMMARIES[event.event];
  if (staticSummary) return staticSummary;
  switch (event.event) {
    case "TASK_RECEIVED":
      return `Task received${d.taskId ? ` (${d.taskId})` : ""}`;
    case "CONTRACT_VALIDATED":
      return "Contract validated";
    case "ROUTE_VALIDATED":
      return `Route selected${Array.isArray(d.selectedGuides) ? `: ${d.selectedGuides.join(", ")}` : ""}`;
    case "PREFLIGHT_READY":
      return "Preflight READY";
    case "PREFLIGHT_BLOCKED":
      return "Preflight BLOCKED";
    case "EXECUTION_STARTED":
      return "Execution started";
    case "VERIFICATION_RECORDED": {
      const id = d.id ?? d.checkId ?? d.requirement ?? "check";
      return `${id} ${String(d.status ?? "recorded").toUpperCase()}${d.exitCode !== undefined ? ` (exit ${d.exitCode})` : ""}`;
    }
    case "TERMINAL_RESULT_RECORDED":
      return `Terminal result ${d.type ?? ""} ${d.status ?? ""}`.trim();
    case "REVIEW_STARTED":
      return `Review started${Number.isInteger(d.verificationCycle) ? ` for cycle ${d.verificationCycle}` : ""}`;
    case "DIAGNOSIS_RECORDED":
      return `Diagnosis recorded (${d.informationGain ?? "gain unknown"})`;
    case "DIAGNOSTIC_CASE_RECORDED":
      return `Diagnostic case recorded (cycle ${d.verificationCycle}, revision ${d.diagnosticRevision})`;
    case "INTERVENTION_RECORDED":
      return `Intervention recorded (${d.intervention?.id ?? "unknown"})`;
    case "HYPOTHESIS_DISPOSITION_RECORDED":
      return `Hypothesis ${d.hypothesisRef ?? "unknown"} ${d.status ?? "dispositioned"}`;
    case "DECISION_CRITERION_RECORDED":
      return "Decision criterion recorded";
    case "GATE_SATISFIED":
      return `Gate satisfied: ${d.gate ?? "unknown"}`;
    case "CHECKPOINT_RECONCILED":
      return "Checkpoint reconciled";
    case "CONTINUITY_RECORDED":
      return "Continuity checkpoint recorded";
    case "TASK_RECOVERY_RECORDED":
      return `Task recovery recorded (${d.classification ?? "unknown"})`;
    case "COMPLETION_VALIDATED":
      return "Completion validated";
    case "COMPLETION_REJECTED":
      return "Completion rejected";
    case "TRANSACTION_COMMITTED":
      return "Transaction committed";
    case "ACTION_PROPOSED":
      return `Action proposed (${d.actionId ?? "unknown"})`;
    case "ACTION_AUTHORIZED":
      return `Action authorized (${d.actionId ?? "unknown"})`;
    case "ACTION_STARTED":
      return `Action started (${d.actionId ?? "unknown"})`;
    case "ACTION_COMMIT_RECORDED":
      return `Action commit recorded (${d.actionId ?? "unknown"})`;
    case "ACTION_VERIFIED":
      return `Action verified (${d.actionId ?? "unknown"})`;
    case "ACTION_FAILED":
      return `Action failed (${d.actionId ?? "unknown"})`;
    case "ACTION_COMMIT_UNKNOWN":
      return `Action commit unknown (${d.actionId ?? "unknown"})`;
    case "ACTION_RECONCILED":
      return `Action reconciled (${d.actionId ?? "unknown"})`;
    case "ACTION_CANCELLED":
      return `Action cancelled (${d.actionId ?? "unknown"})`;
    default:
      return event.event;
  }
}

export function normalizeProtocolEvent(event, context = {}) {
  const phase = typeof context.phase === "string" ? context.phase : null;
  return {
    sequence: event.seq,
    timestamp: event.at ?? null,
    timestampSource: "ledger",
    timestampQuality: timestampQuality(event),
    type: event.event,
    category: eventCategory(event.event),
    phase,
    phaseQuality: context.phaseQuality ?? "unknown",
    source: {
      kind: "ledger",
      artifact: context.artifactPath ?? ".forgeloop/task-state/<task-key>/events.ndjson",
    },
    summary: eventSummary(event),
    data: event.details ?? {},
    references: {
      checkIds: [event.details?.id, event.details?.checkId].filter((v) => typeof v === "string"),
      evidenceRefs: Array.isArray(event.details?.evidenceRefs) ? event.details.evidenceRefs : [],
      hypothesisRefs: Array.isArray(event.details?.hypothesisRefs)
        ? event.details.hypothesisRefs
        : [event.details?.hypothesisRef].filter((v) => typeof v === "string"),
      interventionRefs: [event.details?.intervention?.id].filter((v) => typeof v === "string"),
      relatedSequences: [],
    },
    hash: event.hash,
  };
}

function lifecycleTransitions(events) {
  const transitions = [];
  let lastPhaseEvent = null;
  for (const event of events) {
    if (!LIFECYCLE_TRANSITIONS.includes(event.event)) continue;
    transitions.push({
      sequence: event.seq,
      at: event.at,
      type: event.event,
      details: event.details ?? {},
      previous: lastPhaseEvent?.type ?? null,
    });
    lastPhaseEvent = event;
  }
  return transitions;
}

function projectChecks(snapshot) {
  const state = snapshot.state;
  const attemptsByCheck = new Map();
  const pushAttempt = (key, attempt) => {
    if (!attemptsByCheck.has(key)) attemptsByCheck.set(key, []);
    attemptsByCheck.get(key).push(attempt);
  };

  // Ledger chronology is the primary source of historical attempts.
  const ledgerIdentityKeys = new Set();
  for (const event of snapshot.events) {
    if (event.event !== "VERIFICATION_RECORDED") continue;
    const d = event.details ?? {};
    const key = d.id ?? d.checkId ?? d.requirement ?? null;
    if (!key) continue;
    ledgerIdentityKeys.add(`${key}@@${d.verificationCycle ?? "*"}`);
    pushAttempt(key, {
      sequence: event.seq,
      at: event.at,
      status: d.status ?? null,
      exitCode: d.exitCode ?? null,
      requirement: d.requirement ?? null,
      verificationCycle: d.verificationCycle ?? null,
      provenance: d.provenance ?? null,
      executionMode: d.provenance === "FORGELOOP_EXECUTED"
        ? "executed"
        : (d.provenance === "ACTOR_REPORTED" || d.provenance === "MANUAL_OBSERVATION" ? "observed" : (d.executionId ? "executed" : "unknown")),
      failureToken: d.failureToken ?? d.details?.failureToken ?? null,
      source: "ledger",
    });
  }

  // State checks only enrich or fill legacy gaps; never duplicate ledger attempts.
  for (const check of state?.checks ?? []) {
    const key = check.id ?? check.checkId ?? null;
    if (!key) continue;
    const identityKey = `${key}@@${check.details?.verificationCycle ?? "*"}`;
    if (ledgerIdentityKeys.has(identityKey) || ledgerIdentityKeys.has(`${key}@@*`)) continue;
    pushAttempt(key, {
      sequence: null,
      at: check.at ?? check.lastUpdatedAt ?? null,
      status: check.status,
      exitCode: check.exitCode ?? null,
      requirement: check.requirement ?? null,
      verificationCycle: check.details?.verificationCycle ?? null,
      provenance: check.provenance ?? null,
      executionMode: check.provenance === "ACTOR_REPORTED" || check.provenance === "MANUAL_OBSERVATION" ? "observed" : "executed",
      failureToken: check.details?.failureToken ?? null,
      source: "state-fallback",
    });
  }

  const checks = [];
  const MAX = Number.MAX_SAFE_INTEGER;
  for (const [id, attempts] of [...attemptsByCheck.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    attempts.sort((a, b) =>
      ((a.verificationCycle ?? MAX) - (b.verificationCycle ?? MAX))
      || ((a.sequence ?? MAX) - (b.sequence ?? MAX)));
    checks.push({
      id,
      requirement: attempts.findLast((a) => a.requirement)?.requirement ?? null,
      attemptCount: attempts.length,
      failedAttempts: attempts.filter((a) => a.status === "failed" || a.status === "blocked").length,
      currentResult: attempts.at(-1)?.status ?? null,
      attempts,
    });
  }
  return checks;
}

function legacyDiagnoses(events, taskId) {
  return [...ledgerEventsOfTypes(events, ["DIAGNOSIS_RECORDED"])]
    .filter(event => !taskId || event.taskId === taskId).map((event) => ({
    sequence: event.seq,
    at: event.at,
    sourceModel: "LEGACY_DIAGNOSIS_V1",
    ...event.details,
  }));
}

function structuredDiagnostics(events) {
  const cases = [];
  const interventions = [];
  const dispositions = [];
  const invalidRevisions = [];
  const lastCaseByCycle = new Map();
  for (const event of events) {
    try {
      if (event.event === "DIAGNOSTIC_CASE_RECORDED") {
        assertDiagnosticCaseDetails(event.details);
        const cycle = event.details?.verificationCycle;
        const previous = lastCaseByCycle.get(cycle);
        if (Number.isInteger(event.details?.diagnosticRevision) && event.details.diagnosticRevision > 1 && previous) {
          if (event.details.previousDiagnosticFingerprint !== previous.diagnosticFingerprint) {
            invalidRevisions.push({
              sequence: event.seq,
              verificationCycle: cycle,
              code: "E_DIAGNOSTIC_CASE_INVALID",
              message: "Revision chain broken: previousDiagnosticFingerprint does not match the prior case fingerprint.",
            });
            continue;
          }
        }
        lastCaseByCycle.set(cycle, event.details);
        cases.push({ sequence: event.seq, at: event.at, ...event.details });
      } else if (event.event === "INTERVENTION_RECORDED") {
        assertInterventionDetails(event.details);
        interventions.push({ sequence: event.seq, at: event.at, ...event.details });
      } else if (event.event === "HYPOTHESIS_DISPOSITION_RECORDED") {
        assertHypothesisDispositionDetails(event.details);
        dispositions.push({ sequence: event.seq, at: event.at, ...event.details });
      }
    } catch {
      // Invalid diagnostic details surface through ledger integrity errors;
      // projections must not crash on them.
    }
  }
  return { cases, interventions, dispositions, invalidRevisions };
}

const PHASE_MILESTONES = Object.freeze({
  TASK_RECEIVED: { phase: "RECEIVED", quality: "authoritative" },
  CONTRACT_VALIDATED: { phase: "CONTRACT_READY", quality: "authoritative" },
  ROUTE_VALIDATED: { phase: "ROUTED", quality: "authoritative" },
  DESIGN_GATE_STARTED: { phase: "DESIGNING", quality: "authoritative" },
  PLAN_RECORDED: { phase: "PLANNED", quality: "authoritative" },
  EXECUTION_STARTED: { phase: "EXECUTING", quality: "authoritative" },
  VERIFICATION_STARTED: { phase: "VERIFYING", quality: "authoritative" },
  REVIEW_STARTED: { phase: "REVIEWING", quality: "authoritative" },
  COMPLETION_VALIDATED: { phase: "COMPLETE", quality: "authoritative" },
});

const PHASE_DERIVATIONS = Object.freeze({
  VERIFICATION_RECORDED: (details) => (["failed", "blocked"].includes(details?.status) ? "DIAGNOSING" : null),
  DIAGNOSIS_RECORDED: () => "DIAGNOSING",
  DIAGNOSTIC_CASE_RECORDED: () => "DIAGNOSING",
  HYPOTHESIS_DISPOSITION_RECORDED: () => "CORRECTING",
  INTERVENTION_RECORDED: () => "CORRECTING",
});

function phaseStep(event, currentPhase) {
  const milestone = PHASE_MILESTONES[event.event];
  if (milestone) return { phase: milestone.phase, quality: milestone.quality };
  const derive = PHASE_DERIVATIONS[event.event];
  const derived = derive ? derive(event.details ?? {}) : null;
  return { phase: derived ?? currentPhase, quality: derived || currentPhase ? "derived" : "unknown" };
}

function orderedSequences(events) {
  let previous = -Infinity;
  return events.every(event => {
    if (!Number.isFinite(event.seq) || event.seq <= previous) return false;
    previous = event.seq;
    return true;
  });
}

function* phasedEvents(events) {
  let currentPhase = null;
  if (orderedSequences(events)) {
    for (const event of events) {
      const step = phaseStep(event, currentPhase);
      currentPhase = step.phase;
      yield { event, ...step };
    }
    return;
  }
  // Legacy duplicate sequence keys retain the original last-write projection.
  const phases = new Map();
  for (const event of events) {
    const step = phaseStep(event, currentPhase);
    currentPhase = step.phase;
    phases.set(event.seq, step);
  }
  for (const event of events) yield { event, ...phases.get(event.seq) };
}

export function historyQualityFor({ snapshot, normalizedEvents }) {
  const reasons = [];
  const hasLedger = normalizedEvents.length > 0;
  if (!hasLedger) reasons.push("LEDGER_ABSENT");
  if (normalizedEvents.some((event) => event.timestampQuality !== "authoritative")) {
    reasons.push("LEGACY_PHASE_TIMESTAMPS_UNAVAILABLE");
  }
  if (snapshot.state && Number.isInteger(snapshot.state.verificationCycle) && snapshot.state.verificationCycle > 1
    && !snapshot.events.some((event) => event.event === "DIAGNOSIS_RECORDED" || event.event === "DIAGNOSTIC_CASE_RECORDED")) {
    reasons.push("STRUCTURED_DIAGNOSTICS_UNAVAILABLE");
  }
  const level = reasons.length === 0 ? "COMPLETE" : (hasLedger ? "PARTIAL" : "MINIMAL");
  return { level, reasons };
}

export async function buildTaskTrace({ target, packageRoot, taskId = null, eventsPath = null } = {}) {
  return withTaskSnapshot({ target, packageRoot, taskId, eventsPath }, snapshot =>
    buildTraceFromSnapshot({ target, packageRoot, taskId, eventsPath, snapshot }));
}

async function buildTraceFromSnapshot({ target, packageRoot, taskId, eventsPath, snapshot }) {
  const artifactPath = eventsPath ?? ".forgeloop/task-state/<task-key>/events.ndjson";

  const belongsToTask = event => !event.taskId || event.taskId === taskId;
  const taskEvents = taskId && !snapshot.events.every(belongsToTask)
    ? snapshot.events.filter(belongsToTask) : snapshot.events;
  const normalizedEvents = [];
  for (const { event, phase, quality } of phasedEvents(taskEvents)) {
    normalizedEvents.push(normalizeProtocolEvent(event, {
      phase: phase ?? null,
      artifactPath,
      phaseQuality: quality ?? "unknown",
    }));
  }

  const integrity = {
    valid: snapshot.integrity.valid,
    errors: snapshot.integrity.errors,
  };
  const historyQuality = historyQualityFor({ snapshot, normalizedEvents });
  const diagnostics = structuredDiagnostics(taskEvents);

  const failureSignatures = projectFailureSignatures({ state: snapshot.state, events: taskEvents });
  const failureSurfaces = projectFailureSurfaces({ state: snapshot.state, events: taskEvents });

  const executions = [];
  const seenExecutions = new Set();
  for (const event of taskEvents) {
    const d = event.details ?? {};
    const executionId = d.executionId ?? d.executionRef ?? null;
    if (!executionId || seenExecutions.has(executionId)) continue;
    seenExecutions.add(executionId);
    executions.push({
      executionId,
      sequence: event.seq,
      at: event.at,
      status: d.status ?? null,
      exitCode: d.exitCode ?? null,
      resolution: d.resolution ?? null,
    });
  }

  const evidenceSources = new Map();
  for (const event of taskEvents) {
    const refs = [
      ...(Array.isArray(event.details?.evidenceRefs) ? event.details.evidenceRefs : []),
      ...(Array.isArray(event.details?.hypotheses)
        ? event.details.hypotheses.flatMap((hypothesis) => hypothesis.evidenceRefs ?? [])
        : []),
    ];
    for (const ref of refs) {
      if (!ref) continue;
      if (!evidenceSources.has(ref)) evidenceSources.set(ref, { ref, sources: [] });
      if (!evidenceSources.get(ref).sources.includes(event.event)) evidenceSources.get(ref).sources.push(event.event);
    }
  }
  const evidence = [...evidenceSources.values()].sort((a, b) => a.ref.localeCompare(b.ref));

  const recovery = taskEvents
    .filter((event) => ["TASK_RECOVERY_RECORDED", "TASK_RECOVERY_RESUMED", "OPERATOR_RECOVERY_RECORDED", "TASK_ABANDONED", "LEGACY_RECOVERY_MIGRATION_RECORDED"].includes(event.event))
    .map((event) => ({ sequence: event.seq, at: event.at, type: event.event, details: event.details ?? {} }));

  const completionEvents = taskEvents.filter((event) => ["COMPLETION_VALIDATED", "COMPLETION_REJECTED"].includes(event.event));
  const completion = {
    validatedAt: completionEvents.findLast((event) => event.event === "COMPLETION_VALIDATED")?.at ?? null,
    rejectedAt: completionEvents.findLast((event) => event.event === "COMPLETION_REJECTED")?.at ?? null,
    attempts: completionEvents.map((event) => ({ sequence: event.seq, at: event.at, type: event.event })),
  };

  const actions = snapshot.taskId
    ? await listActions(target, { packageRoot, taskId: snapshot.taskId })
    : [];
  // Artifacts are the current-state materialization; chronology comes from
  // the canonical ledger replay projection, never from artifacts alone.
  const { projectActionLedger } = await import("./action-ledger-projection.js");
  const projections = [];
  for (const action of actions) {
    projections.push(await projectActionLedger({
      target,
      packageRoot,
      taskId: snapshot.taskId,
      actionId: action.actionId,
      artifact: action,
    }));
  }
  const actionEvents = taskEvents.filter((event) => event.event.startsWith("ACTION_") || event.event.startsWith("APPROVAL_"));
  const byState = Object.fromEntries([...new Set(actions.map((action) => action.state))].sort()
    .map((state) => [state, actions.filter((action) => action.state === state).length]));
  const byCapability = Object.fromEntries([...new Set(actions.map((action) => action.capability))].sort()
    .map((capability) => [capability, actions.filter((action) => action.capability === capability).length]));
  const idempotencyAttempts = actions.map((action) => action.idempotencyKey).filter(Boolean);
  const repeatedIdempotencyAttempts = idempotencyAttempts.length - new Set(idempotencyAttempts).size;
  const actionProjection = {
    total: actions.length,
    byState,
    byCapability,
    required: actions.filter((action) => action.requiredForCompletion).length,
    ambiguous: actions.filter((action) => action.state === "COMMIT_UNKNOWN").length,
    failed: actions.filter((action) => action.state === "FAILED").length,
    verified: actions.filter((action) => action.state === "VERIFIED").length,
    trustedSatisfied: projections.filter(
      (projection) => projection.valid && projection.state === "VERIFIED"
        && projection.authorization.valid && projection.verification.valid,
    ).length,
    untrustedRequired: projections.filter((projection) =>
      !projection.valid
      || (projection.state === "VERIFIED" && !(projection.authorization.valid && projection.verification.valid))
    ).length,
    repeatedIdempotencyAttempts,
    reconciliationCount: taskEvents.filter((event) => event.event === "ACTION_RECONCILED").length,
    eventCount: actionEvents.length,
  };

  return {
    schemaVersion: 1,
    protocolVersion: 1,
    command: "trace",
    task: {
      id: snapshot.taskId,
      phase: snapshot.state?.phase ?? null,
      status: snapshot.state?.status ?? null,
      revision: snapshot.state?.revision ?? null,
      verificationCycle: snapshot.state?.verificationCycle ?? null,
      present: Boolean(snapshot.state),
    },
    snapshot: {
      consistent: snapshot.consistent,
      stateRevision: snapshot.anchors.stateRevision,
      ledgerTailSequence: snapshot.anchors.sequence,
      capturedAt: snapshot.capturedAt,
    },
    historyQuality,
    integrity,
    artifacts: {},
    events: normalizedEvents,
    transitions: lifecycleTransitions(taskEvents),
    executions,
    checks: projectChecks(snapshot),
    evidence,
    diagnostics: {
      legacyDiagnoses: legacyDiagnoses(taskEvents, snapshot.taskId),
      ...diagnostics,
    },
    failureSignatures,
    failureSurfaces,
    continuity: taskEvents
      .filter((event) => ["CONTINUITY_RECORDED", "CHECKPOINT_RECONCILED"].includes(event.event))
      .map((event) => ({ sequence: event.seq, at: event.at, type: event.event })),
    recovery,
    policy: {},
    audit: {},
    completion,
    actions: actionProjection,
  };
}
