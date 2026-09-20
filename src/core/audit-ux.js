import { runNext } from "../commands/next.js";
import { runReport } from "../commands/report.js";
import { runStatus } from "../commands/status.js";
import { evaluateAudit } from "./audit.js";
import { listApprovals } from "./approvals.js";
import { buildTaskHistory } from "./history.js";
import { INTEGRATION_LIMITS } from "./integration-limits.js";
import { resolveTaskClaimState } from "./task-claim-state.js";
import { findTaskById } from "./task-discovery.js";
import { buildTaskTrace } from "./trace.js";

export const AUDIT_UX_SCHEMA_VERSION = 1;

export const AUDIT_UX_CATEGORIES = Object.freeze([
  "LIFECYCLE",
  "CONTRACT",
  "ROUTING",
  "GATE",
  "CHECK",
  "DIAGNOSTIC",
  "ACTION",
  "APPROVAL",
  "OWNERSHIP",
  "COMPLETION",
  "RECOVERY",
  "INTEGRITY",
]);

export const AUDIT_UX_LIMITS = Object.freeze({
  maxTimelineItems: 200,
  maxChecks: 64,
  maxAttemptsPerCheck: 32,
  maxDiagnostics: 64,
  maxActions: 64,
  maxApprovals: 64,
  maxStringLength: 512,
  maxOutputBytes: 256 * 1024,
});

const PHASES = new Set([
  "RECEIVED", "DISCOVERING", "CONTRACT_READY", "ROUTED", "DESIGNING", "PLANNED",
  "EXECUTING", "VERIFYING", "DIAGNOSING", "CORRECTING", "REVIEWING", "COMPLETE",
]);

const SAFE_STATUSES = new Set([
  "PASSED", "FAILED", "BLOCKED", "PENDING", "CURRENT", "STALE", "VALID", "INVALID",
  "COMPLETE", "INCOMPLETE", "NOT_VERIFIED", "NOT_APPLICABLE", "UNKNOWN",
]);

const EVENT_TITLES = Object.freeze({
  TASK_RECEIVED: "Task received",
  CONTRACT_VALIDATED: "Contract validated",
  ROUTE_VALIDATED: "Route validated",
  GATE_SATISFIED: "Gate satisfied",
  PREFLIGHT_READY: "Preflight READY",
  PREFLIGHT_BLOCKED: "Preflight BLOCKED",
  DESIGN_GATE_STARTED: "Design phase started",
  PLAN_RECORDED: "Plan recorded",
  EXECUTION_STARTED: "Execution started",
  VERIFICATION_STARTED: "Verification started",
  VERIFICATION_RECORDED: "Verification recorded",
  CHECK_RECORDED: "Check recorded",
  TERMINAL_RESULT_RECORDED: "Terminal result recorded",
  REVIEW_STARTED: "Review started",
  DIAGNOSIS_RECORDED: "Diagnosis recorded",
  DIAGNOSTIC_CASE_RECORDED: "Diagnostic case recorded",
  HYPOTHESIS_DISPOSITION_RECORDED: "Hypothesis disposition recorded",
  INTERVENTION_RECORDED: "Intervention recorded",
  CONTINUITY_RECORDED: "Continuity recorded",
  CHECKPOINT_RECONCILED: "Checkpoint reconciled",
  TASK_RECOVERY_RECORDED: "Recovery recorded",
  TASK_RECOVERY_RESUMED: "Recovery resumed",
  OPERATOR_RECOVERY_RECORDED: "Operator recovery recorded",
  LEGACY_RECOVERY_MIGRATION_RECORDED: "Legacy recovery migration recorded",
  COMPLETION_VALIDATED: "Completion validated",
  COMPLETION_REJECTED: "Completion rejected",
  TRANSACTION_COMMITTED: "Transaction committed",
});

function auditUxError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function boundedText(value, fallback = null) {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > AUDIT_UX_LIMITS.maxStringLength
    ? `${normalized.slice(0, AUDIT_UX_LIMITS.maxStringLength - 1)}…`
    : normalized;
}

function safeText(value, fallback = null) {
  const text = boundedText(value, fallback);
  if (!text) return text;
  return text
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|private|tmp|var)\/)[^\s,;)]*/gu, "<path>")
    .replace(/\b[A-Z_][A-Z0-9_]{2,}=[^\s]+/gu, "<environment>");
}

function safeIdentifier(value) {
  const text = boundedText(value);
  return text && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(text) ? text : null;
}

function safeStatus(value) {
  const normalized = typeof value === "string" ? value.toUpperCase() : "UNKNOWN";
  return SAFE_STATUSES.has(normalized) ? normalized : "UNKNOWN";
}

function safePhase(value) {
  return typeof value === "string" && PHASES.has(value) ? value : null;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value))].sort();
}

function projectErrors(errors = []) {
  return errors.map((error) => ({
    code: safeIdentifier(error?.code) ?? "E_AUDIT_UX_INVALID_ERROR",
    message: safeText(error?.message, "Canonical validation reported an error."),
  }));
}

function categoryForEvent(event) {
  const type = event?.type ?? "";
  if (type.startsWith("ACTION_")) return "ACTION";
  if (type.startsWith("APPROVAL_")) return "APPROVAL";
  if (type.includes("RECOVERY") || type === "CHECKPOINT_RECONCILED") return "RECOVERY";
  if (type.startsWith("DIAGNOSTIC") || type.startsWith("DIAGNOSIS")
    || type === "INTERVENTION_RECORDED" || type === "HYPOTHESIS_DISPOSITION_RECORDED") return "DIAGNOSTIC";
  if (type === "GATE_SATISFIED") return "GATE";
  if (type === "VERIFICATION_RECORDED" || type === "CHECK_RECORDED" || type === "TERMINAL_RESULT_RECORDED") return "CHECK";
  if (type === "COMPLETION_VALIDATED" || type === "COMPLETION_REJECTED") return "COMPLETION";
  if (type === "CONTRACT_VALIDATED" || type === "PLAN_RECORDED" || type === "DECISION_CRITERION_RECORDED") return "CONTRACT";
  if (type === "ROUTE_VALIDATED") return "ROUTING";
  if (type === "TRANSACTION_COMMITTED") return "INTEGRITY";
  return "LIFECYCLE";
}

function eventLabel(event) {
  const data = event?.data ?? {};
  const title = EVENT_TITLES[event?.type] ?? "Protocol event";
  if (event?.type === "GATE_SATISFIED") {
    const gate = safeIdentifier(data.gate);
    return gate ? `${title}: ${gate}` : title;
  }
  if (["VERIFICATION_RECORDED", "CHECK_RECORDED"].includes(event?.type)) {
    const check = safeIdentifier(data.id ?? data.checkId ?? data.requirement);
    const status = safeStatus(data.status);
    return check ? `${title}: ${check} ${status}` : `${title}: ${status}`;
  }
  if (event?.type?.startsWith("ACTION_") || event?.type?.startsWith("APPROVAL_")) {
    const id = safeIdentifier(data.actionId ?? data.approvalId);
    return id ? `${title}: ${id}` : title;
  }
  return title;
}

function timelineItem(event) {
  const data = event?.data ?? {};
  const category = categoryForEvent(event);
  const status = typeof data.status === "string" ? safeStatus(data.status) : null;
  const phase = safePhase(event?.phase);
  return {
    id: `event-${event.sequence}`,
    sequence: event.sequence,
    timestamp: typeof event.timestamp === "string" ? event.timestamp : null,
    timestampQuality: event.timestampQuality === "authoritative" ? "authoritative" : "unknown",
    kind: safeIdentifier(event.type) ?? "UNKNOWN_EVENT",
    phase,
    status,
    title: eventLabel(event),
    summary: safeText(event.summary, "Protocol event recorded."),
    category,
    ...(event.phaseQuality ? { phaseQuality: event.phaseQuality } : {}),
  };
}

function normalizeOptions(options = {}) {
  const limit = options.limit === undefined ? 100 : options.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_UX_LIMITS.maxTimelineItems) {
    throw auditUxError("E_AUDIT_UX_INPUT_INVALID", `limit must be an integer between 1 and ${AUDIT_UX_LIMITS.maxTimelineItems}`);
  }
  for (const key of ["beforeSequence", "afterSequence"]) {
    if (options[key] !== undefined && (!Number.isInteger(options[key]) || options[key] < 0)) {
      throw auditUxError("E_AUDIT_UX_INPUT_INVALID", `${key} must be a non-negative integer`);
    }
  }
  let categories = options.categories ?? [];
  if (typeof categories === "string") categories = categories.split(",").map((value) => value.trim()).filter(Boolean);
  if (!Array.isArray(categories) || categories.length > AUDIT_UX_CATEGORIES.length) {
    throw auditUxError("E_AUDIT_UX_INPUT_INVALID", "categories must be a bounded array of category names");
  }
  const normalizedCategories = uniqueStrings(categories.map((value) => String(value).toUpperCase()));
  if (normalizedCategories.some((category) => !AUDIT_UX_CATEGORIES.includes(category))) {
    throw auditUxError("E_AUDIT_UX_INPUT_INVALID", "categories contains an unknown audit timeline category");
  }
  return {
    limit,
    beforeSequence: options.beforeSequence,
    afterSequence: options.afterSequence,
    categories: normalizedCategories,
  };
}

function projectTimeline(events, options) {
  const filtered = events
    .filter((event) => options.beforeSequence === undefined || event.sequence < options.beforeSequence)
    .filter((event) => options.afterSequence === undefined || event.sequence > options.afterSequence)
    .filter((event) => options.categories.length === 0 || options.categories.includes(categoryForEvent(event)))
    .sort((left, right) => left.sequence - right.sequence);
  const hasMore = filtered.length > options.limit;
  const items = (hasMore ? filtered.slice(-options.limit) : filtered).map(timelineItem);
  return {
    items,
    totalAvailable: filtered.length,
    truncated: hasMore,
    cursor: {
      beforeSequence: options.beforeSequence ?? null,
      afterSequence: options.afterSequence ?? null,
      nextBeforeSequence: hasMore ? items[0]?.sequence ?? null : null,
    },
  };
}

function projectChecks(trace) {
  return trace.checks.slice(0, AUDIT_UX_LIMITS.maxChecks).map((check) => ({
    id: safeIdentifier(check.id) ?? "unknown-check",
    requirement: safeText(check.requirement),
    attemptCount: check.attemptCount,
    failedAttempts: check.failedAttempts,
    currentResult: check.currentResult ? safeStatus(check.currentResult) : null,
    attempts: check.attempts.slice(-AUDIT_UX_LIMITS.maxAttemptsPerCheck).map((attempt) => ({
      sequence: Number.isInteger(attempt.sequence) ? attempt.sequence : null,
      timestamp: typeof attempt.at === "string" ? attempt.at : null,
      status: safeStatus(attempt.status),
      exitCode: Number.isInteger(attempt.exitCode) ? attempt.exitCode : null,
      requirement: safeText(attempt.requirement),
      verificationCycle: Number.isInteger(attempt.verificationCycle) ? attempt.verificationCycle : null,
      provenance: safeIdentifier(attempt.provenance),
      executionMode: safeIdentifier(attempt.executionMode),
    })),
  }));
}

function projectDiagnostics(trace) {
  const cases = trace.diagnostics.cases.slice(0, AUDIT_UX_LIMITS.maxDiagnostics).map((entry) => ({
    sequence: entry.sequence,
    timestamp: typeof entry.at === "string" ? entry.at : null,
    verificationCycle: Number.isInteger(entry.verificationCycle) ? entry.verificationCycle : null,
    diagnosticRevision: Number.isInteger(entry.diagnosticRevision) ? entry.diagnosticRevision : null,
    failureClass: safeIdentifier(entry.failureClass),
    informationGain: safeIdentifier(entry.informationGain),
  }));
  return {
    legacyDiagnosisCount: trace.diagnostics.legacyDiagnoses.length,
    cases,
    caseCount: trace.diagnostics.cases.length,
    interventionCount: trace.diagnostics.interventions.length,
    dispositionCount: trace.diagnostics.dispositions.length,
    invalidRevisionCount: trace.diagnostics.invalidRevisions.length,
  };
}

function projectApprovals(approvals) {
  return approvals.slice(0, AUDIT_UX_LIMITS.maxApprovals).map((approval) => ({
    approvalId: safeIdentifier(approval.approvalId) ?? "unknown-approval",
    actionId: safeIdentifier(approval.actionId),
    status: safeStatus(approval.status),
    decision: safeIdentifier(approval.decision),
    requestedAt: typeof approval.requestedAt === "string" ? approval.requestedAt : null,
    resolvedAt: typeof approval.resolvedAt === "string" ? approval.resolvedAt : null,
    authorityKind: safeIdentifier(approval.authorityKind),
  }));
}

function projectCompletion(audit, ownership) {
  const completion = audit.completion ?? {};
  const coverage = Array.isArray(completion.coverage) ? completion.coverage : [];
  const requirementsSatisfied = coverage.length > 0 && coverage.every((item) => item.status === "COVERED");
  const valid = completion.status === "VALID";
  return {
    state: valid ? "COMPLETE" : "INCOMPLETE",
    valid,
    requirementsSatisfied,
    claimsReleased: ownership.claimState === "RELEASED_BY_COMPLETION",
    publicationStatus: safeIdentifier(audit.publicationStatus),
    productionReadiness: safeIdentifier(audit.productionReadiness),
    reasonCodes: uniqueStrings(projectErrors(audit.errors).map((error) => error.code)),
    coverage: coverage.slice(0, AUDIT_UX_LIMITS.maxChecks).map((item) => ({
      requirement: safeText(item.requirement),
      status: safeStatus(item.status),
    })),
  };
}

function projectReasonCodes(...collections) {
  return uniqueStrings(collections.flat().map((value) => {
    if (typeof value === "string") return value;
    return value?.code;
  }).filter((value) => typeof value === "string"));
}

function buildProjection({ status, audit, report, history, trace, ownership, next, approvals, timeline }) {
  const integrityErrors = [
    ...projectErrors(audit.errors),
    ...projectErrors(trace.integrity.errors),
    ...projectErrors(history.integrity.errors),
    ...projectErrors(ownership.ownershipErrors),
  ];
  const checks = projectChecks(trace);
  const completion = projectCompletion(audit, ownership);
  const reasonCodes = projectReasonCodes(
    status.reasonCodes,
    audit.errors,
    trace.integrity.errors,
    ownership.reasonCodes,
    next.reasonCodes,
  );
  const auditStatus = safeIdentifier(audit.status) ?? "INVALID";
  const reportVerdict = safeIdentifier(report.verdict);
  const traceValid = trace.integrity.valid === true;
  const historyValid = history.integrity.valid === true;
  return {
    schemaVersion: AUDIT_UX_SCHEMA_VERSION,
    protocolVersion: trace.protocolVersion,
    taskId: trace.task.id,
    readOnly: true,
    authority: {
      readOnly: true,
      lifecycleAuthority: false,
      evidenceAuthority: false,
      completionAuthority: false,
      mutationAuthority: false,
      externalExecution: false,
    },
    health: {
      phase: safePhase(status.phase ?? trace.task.phase),
      protocolValid: status.protocol?.status === "VALID",
      auditStatus,
      reportVerdict,
      completionStatus: completion.valid ? "VALID" : "INCOMPLETE",
      ownershipValid: ownership.ownershipValid === true,
      claimState: safeIdentifier(ownership.claimState),
      mutationAllowed: ownership.mutationAllowed === true,
      recoveryStatus: safeIdentifier(ownership.recoveryStatus),
      currentNextAction: safeIdentifier(next.nextAction),
      historyQuality: safeIdentifier(history.historyQuality.level),
      traceIntegrity: traceValid,
      reasonCodes,
    },
    lifecycle: {
      phase: safePhase(trace.task.phase),
      status: safeIdentifier(trace.task.status),
      revision: Number.isInteger(trace.task.revision) ? trace.task.revision : null,
      verificationCycle: Number.isInteger(trace.task.verificationCycle) ? trace.task.verificationCycle : null,
      nextAction: safeIdentifier(next.nextAction),
      terminal: next.terminal === true,
    },
    timeline,
    verification: {
      checks,
      checkCount: trace.checks.length,
      totalAttempts: trace.checks.reduce((total, check) => total + check.attemptCount, 0),
      failedAttempts: trace.checks.reduce((total, check) => total + check.failedAttempts, 0),
      coverage: completion.coverage,
    },
    ownership: {
      claimState: safeIdentifier(ownership.claimState),
      ownershipValid: ownership.ownershipValid === true,
      mutationAllowed: ownership.mutationAllowed === true,
      recoveryStatus: safeIdentifier(ownership.recoveryStatus),
      historicalWriteClaims: ownership.historicalWriteClaims.slice(0, AUDIT_UX_LIMITS.maxActions).map(safeText).filter(Boolean),
      effectiveWriteClaims: ownership.effectiveWriteClaims.slice(0, AUDIT_UX_LIMITS.maxActions).map(safeText).filter(Boolean),
      reasonCodes: projectReasonCodes(ownership.reasonCodes, ownership.ownershipErrors),
    },
    diagnostics: projectDiagnostics(trace),
    completion,
    integrity: {
      valid: auditStatus === "VALID" && traceValid && historyValid,
      auditStatus,
      traceValid,
      historyValid,
      reasonCodes: projectReasonCodes(integrityErrors),
    },
    history: {
      quality: safeIdentifier(history.historyQuality.level),
      totalEventCount: history.summary.totalEventCount,
      returnedEventCount: timeline.items.length,
      truncated: timeline.truncated,
    },
    actions: {
      ...trace.actions,
      bounded: trace.actions.total > AUDIT_UX_LIMITS.maxActions,
    },
    approvals: projectApprovals(approvals),
    recovery: {
      active: ownership.recoveryStatus === "RELEASED_BY_RECOVERY",
      status: safeIdentifier(ownership.recoveryStatus),
      events: trace.recovery.slice(0, AUDIT_UX_LIMITS.maxDiagnostics).map((event) => ({
        sequence: event.sequence,
        timestamp: typeof event.at === "string" ? event.at : null,
        kind: safeIdentifier(event.type),
      })),
    },
    links: {
      status: "task/status",
      ownership: "task/ownership",
      contract: "task/contract",
      auditView: "task/audit-view",
    },
  };
}

export async function buildAuditUxView({
  target,
  packageRoot,
  taskId,
  limit,
  beforeSequence,
  afterSequence,
  categories,
  authorityContext,
  runtimeContext,
} = {}) {
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw auditUxError("E_TASK_REQUIRED", "Resource task/audit-view requires a taskId");
  }
  const options = normalizeOptions({ limit, beforeSequence, afterSequence, categories });
  const task = await findTaskById(target, taskId, packageRoot);
  if (!task) throw auditUxError("E_TASK_NOT_FOUND", `Task ${taskId} does not exist`);

  const [status, audit, report, history, trace, ownership, next, approvals] = await Promise.all([
    runStatus({ target, packageRoot, taskId }),
    evaluateAudit({ target, packageRoot, taskId, authorityContext, runtimeContext }),
    runReport({ target, packageRoot, taskId }),
    buildTaskHistory({ target, packageRoot, taskId }),
    buildTaskTrace({ target, packageRoot, taskId }),
    resolveTaskClaimState(target, { packageRoot, taskId }),
    runNext({ target, packageRoot, taskId, authorityContext, runtimeContext, compact: false }),
    listApprovals(target, { packageRoot, taskId }),
  ]);
  const timeline = projectTimeline(trace.events, options);
  const projection = buildProjection({ status, audit, report, history, trace, ownership, next, approvals, timeline });
  const serializedBytes = Buffer.byteLength(JSON.stringify(projection), "utf8");
  if (serializedBytes > AUDIT_UX_LIMITS.maxOutputBytes || serializedBytes > INTEGRATION_LIMITS.maxOutputBytes) {
    throw auditUxError("E_AUDIT_UX_OUTPUT_LIMIT", "Audit UX projection exceeds its bounded output limit");
  }
  return projection;
}
