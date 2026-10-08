import { buildTaskTrace } from "./trace.js";

export const HISTORY_FILTER_OPTIONS = Object.freeze([
  "type",
  "phase",
  "failures",
  "checks",
  "since",
  "until",
  "limit",
]);

export async function buildTaskHistory({
  target,
  packageRoot,
  taskId = null,
  filters = {},
} = {}) {
  const trace = await buildTaskTrace({ target, packageRoot, taskId });
  let events = [...trace.events];

  if (filters.type) {
    const types = String(filters.type).split(",").map((value) => value.trim()).filter(Boolean);
    if (types.length > 0) {
      events = events.filter((event) => types.includes(event.type) || types.includes(event.category));
    }
  }
  if (filters.phase) {
    const phases = String(filters.phase).split(",").map((value) => value.trim()).filter(Boolean);
    if (phases.length > 0) events = events.filter((event) => phases.includes(event.phase));
  }
  if (filters.failures) {
    events = events.filter((event) => event.category === "verification"
      && ["failed", "blocked"].includes(String(event.data?.status ?? "")));
  }
  if (filters.checks) {
    events = events.filter((event) => event.category === "verification");
  }
  if (filters.since) {
    const since = Date.parse(filters.since);
    if (!Number.isNaN(since)) events = events.filter((event) => event.timestamp && Date.parse(event.timestamp) >= since);
  }
  if (filters.until) {
    const until = Date.parse(filters.until);
    if (!Number.isNaN(until)) events = events.filter((event) => event.timestamp && Date.parse(event.timestamp) <= until);
  }

  let omittedEvents = 0;
  if (Number.isInteger(filters.limit) && filters.limit >= 0 && events.length > filters.limit) {
    omittedEvents = events.length - filters.limit;
    events = filters.limit === 0 ? [] : events.slice(-filters.limit);
  }

  const checkAttempts = trace.checks.reduce(
    (total, check) => total + check.attemptCount,
    0,
  );
  const failedAttempts = trace.checks.reduce(
    (total, check) => total + check.failedAttempts,
    0,
  );

  return {
    schemaVersion: 1,
    command: "history",
    task: trace.task,
    snapshot: trace.snapshot,
    summary: {
      eventCount: events.length,
      totalEventCount: trace.events.length,
      checkAttemptCount: checkAttempts,
      failedAttemptCount: failedAttempts,
      diagnosticCaseCount: trace.diagnostics.cases.length,
      interventionCount: trace.diagnostics.interventions.length,
    },
    historyQuality: trace.historyQuality,
    integrity: trace.integrity,
    events,
    ...(omittedEvents > 0 ? { truncated: true, truncation: { reason: "OUTPUT_LIMIT", omittedEvents } } : {}),
  };
}

export function formatHistoryEvent(event) {
  const time = event.timestamp && !Number.isNaN(Date.parse(event.timestamp))
    ? new Date(event.timestamp).toISOString().slice(11, 19)
    : "--:--:--";
  const lines = [`${time}  ${event.type}`];
  if (event.summary && event.summary !== event.type) lines.push(`           ${event.summary}`);
  if (event.data?.provenance) lines.push(`           provenance: ${event.data.provenance}`);
  return lines.join("\n");
}

export function formatHistoryResult(result) {
  const lines = [
    "ForgeLoop Execution History",
    "─".repeat(56),
    "",
    `Task:      ${result.task.id ?? "unknown"}`,
    `Phase:     ${result.task.phase ?? "UNKNOWN"}`,
    `Integrity: ${result.integrity.valid ? "VALID" : "INCONSISTENT"}`,
    `History quality: ${result.historyQuality.level}`,
    result.historyQuality.reasons.length > 0 ? `Reasons: ${result.historyQuality.reasons.join(", ")}` : null,
    "",
    ...result.events.map(formatHistoryEvent),
  ].filter((line) => line !== null);
  if (result.truncated) {
    lines.push("", `[truncated: ${result.truncation.omittedEvents} earlier events omitted]`);
  }
  return lines.join("\n") + "\n";
}
