import { isLedgerEventCollection } from "./ledger-event-collection.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { createEvidence } from "./evidence.js";
import { canonicalFingerprint } from "./artifacts.js";
import { evaluateContinuityConformance } from "./continuity-conformance.js";

function error(code, message, artifacts = []) {
  return { code, message, artifacts };
}

function addVersionErrors(artifact, label, errors) {
  if (!artifact) return;
  if (artifact.schemaVersion !== 1 || artifact.protocolVersion !== PROTOCOL_VERSION) {
    errors.push(error(
      "UNSUPPORTED_PROTOCOL_VERSION",
      `${label} must use schemaVersion 1 and protocolVersion ${PROTOCOL_VERSION}`,
      [label],
    ));
  }
}

function sortErrors(errors) {
  return errors.sort((left, right) => left.code.localeCompare(right.code)
    || left.artifacts.join("\0").localeCompare(right.artifacts.join("\0"))
    || left.message.localeCompare(right.message));
}

export function delegationIsInScope({
  state = null,
  receipt = null,
  events = [],
  taskBriefs = [],
  delegatedResults = [],
} = {}) {
  if (taskBriefs && taskBriefs.length > 0) return true;
  if (delegatedResults && delegatedResults.length > 0) return true;
  if (state?.delegatedTasks && state.delegatedTasks.length > 0) return true;
  if (state?.delegatedTaskIds && state.delegatedTaskIds.length > 0) return true;
  if (receipt?.delegatedTasks && receipt.delegatedTasks.length > 0) return true;
  if (isLedgerEventCollection(events) && events.some((event) => typeof event?.type === "string" && event.type.toLowerCase().includes("delegat"))) {
    return true;
  }
  return false;
}

export function validateTaskArtifactSet({
  route = null,
  state = null,
  stateClassification = null,
  receipt = null,
  taskBriefs = [],
  delegatedResults = [],
  events = [],
  continuity = null,
  continuityContext = {},
} = {}) {
  const errors = [];
  const incomplete = [];
  const continuityResult = evaluateContinuityConformance({ continuity, state, ...continuityContext });
  errors.push(...continuityResult.errors);

  addVersionErrors(route, "route", errors);
  addVersionErrors(state, "state", errors);
  addVersionErrors(receipt, "receipt", errors);
  for (const brief of taskBriefs) addVersionErrors(brief, `taskBrief:${brief?.taskId ?? "unknown"}`, errors);
  for (const result of delegatedResults) addVersionErrors(result, `delegatedResult:${result?.taskId ?? "unknown"}`, errors);

  if (route && state && route.protocolVersion !== state.protocolVersion) {
    errors.push(error("ROUTE_STATE_PROTOCOL_MISMATCH", "routing-result and work-state protocol versions differ", ["route", "state"]));
  }
  if (state && receipt && state.contractFingerprint !== receipt.contractFingerprint) {
    errors.push(error("STATE_RECEIPT_CONTRACT_MISMATCH", "work-state and execution-receipt contract fingerprints differ", ["state", "receipt"]));
  }
  if (state && receipt && state.taskId !== receipt.taskId) {
    errors.push(error("STATE_RECEIPT_TASK_MISMATCH", "work-state and execution-receipt task IDs differ", ["state", "receipt"]));
  }
  if (route && state && JSON.stringify(route.guides) !== JSON.stringify(state.selectedGuides)) {
    errors.push(error("ROUTE_STATE_GUIDES_MISMATCH", "work-state.selectedGuides must equal routing-result.guides", ["route", "state"]));
  }
  if (route && state && state.routeFingerprint !== undefined && state.routeFingerprint !== canonicalFingerprint(route)) {
    errors.push(error("ROUTE_STATE_FINGERPRINT_MISMATCH", "work-state.routeFingerprint must match routing-result", ["route", "state"]));
  }
  if (route && receipt && receipt.routeFingerprint !== undefined && receipt.routeFingerprint !== canonicalFingerprint(route)) {
    errors.push(error("STATE_RECEIPT_ROUTE_MISMATCH", "execution-receipt.routeFingerprint must match routing-result", ["route", "receipt"]));
  }
  if (state && receipt && JSON.stringify(state.selectedGuides) !== JSON.stringify(receipt.selectedGuides)) {
    errors.push(error("STATE_RECEIPT_GUIDES_MISMATCH", "execution-receipt.selectedGuides must equal work-state.selectedGuides", ["state", "receipt"]));
  }

  const delegationActive = delegationIsInScope({ state, receipt, events, taskBriefs, delegatedResults });
  const briefIds = new Set();
  for (const brief of taskBriefs) {
    if (!brief?.taskId) continue;
    if (briefIds.has(brief.taskId)) {
      errors.push(error("DUPLICATE_TASK_ID", `task brief ID is duplicated: ${brief.taskId}`, [`taskBrief:${brief.taskId}`]));
    }
    briefIds.add(brief.taskId);
    if (state && brief.parentTaskId !== state.taskId) {
      errors.push(error("TASK_PARENT_MISMATCH", `task brief ${brief.taskId} does not belong to ${state.taskId}`, [`taskBrief:${brief.taskId}`, "state"]));
    }
  }

  const delegatedIds = new Set();
  for (const result of delegatedResults) {
    if (!result?.taskId) continue;
    if (delegatedIds.has(result.taskId)) {
      errors.push(error("DUPLICATE_DELEGATED_RESULT", `delegated result is duplicated: ${result.taskId}`, [`delegatedResult:${result.taskId}`]));
    }
    delegatedIds.add(result.taskId);
    if (!briefIds.has(result.taskId)) {
      errors.push(error("UNKNOWN_DELEGATED_TASK", `delegated result has no corresponding task brief: ${result.taskId}`, [`delegatedResult:${result.taskId}`]));
    }
  }

  if (delegationActive) {
    if (taskBriefs.length > 0) {
      for (const taskId of [...briefIds].sort()) {
        if (!delegatedIds.has(taskId)) incomplete.push(`missing delegated result: ${taskId}`);
      }
    } else if (delegatedResults.length > 0) {
      incomplete.push("task briefs are required when delegated results are supplied");
    } else {
      incomplete.push("task briefs and delegated results were not supplied for delegated task");
    }
  }

  if (!route || !state || !receipt) incomplete.push("route, state, and receipt are all required for a complete artifact set");

  const sortedErrors = sortErrors(errors);
  let status = "VALID";
  if (sortedErrors.some((item) => item.code === "UNSUPPORTED_PROTOCOL_VERSION") || continuityResult.status === "INVALID") {
    status = "INVALID";
  } else if (sortedErrors.length > 0) {
    status = "INCONSISTENT";
  } else if (stateClassification?.status === "REVALIDATION_REQUIRED" || continuityResult.status === "STALE") {
    status = "STALE";
  } else if (incomplete.length > 0) {
    status = "INCOMPLETE";
  }

  const stale = status === "STALE"
    ? {
      reasons: [...(stateClassification?.reasons ?? [])],
      warnings: [...(stateClassification?.warnings ?? [])],
      repositoryComparison: stateClassification?.repositoryComparison ?? "NOT_VERIFIED",
      contractComparison: stateClassification?.contractComparison ?? "NOT_VERIFIED",
      artifactComparison: stateClassification?.artifactComparison ?? "NOT_APPLICABLE",
    }
    : null;

  const delegation = delegationActive
    ? {
      status: sortedErrors.some((e) => e.code.includes("DELEGAT") || e.code.includes("TASK"))
        ? "INCONSISTENT"
        : incomplete.some((i) => i.includes("delegat") || i.includes("brief"))
          ? "INCOMPLETE"
          : "VALID",
      required: true,
      errors: sortedErrors.filter((e) => e.code.includes("DELEGAT") || e.code.includes("TASK")),
    }
    : {
      status: "NOT_APPLICABLE",
      required: false,
      errors: [],
    };

  const evidenceKind = status === "VALID"
    ? "OBSERVED"
    : status === "INCOMPLETE"
      ? "NOT_VERIFIED"
      : status === "STALE"
        ? "INFERRED"
        : status === "INVALID"
          ? "BLOCKED"
          : "OBSERVED";
  return {
    status,
    errors: sortedErrors,
    incomplete: [...new Set(incomplete)].sort(),
    stale,
    delegation,
    continuity: continuityResult,
    evidence: [createEvidence({
      kind: evidenceKind,
      source: "ForgeLoop protocol conformance",
      result: status,
    })],
  };
}
