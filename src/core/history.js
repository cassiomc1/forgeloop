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

function historyEventProjection(filters) {
  const predicates = [];
  for (const key of ["type", "phase"]) {
    if (!filters[key]) continue;
    const values = String(filters[key]).split(",").map(value => value.trim()).filter(Boolean);
    if (values.length) predicates.push(event => values.includes(event[key])
      || (key === "type" && values.includes(event.category)));
  }
  if (filters.failures) predicates.push(event => event.category === "verification"
    && ["failed", "blocked"].includes(String(event.data?.status ?? "")));
  if (filters.checks) predicates.push(event => event.category === "verification");
  for (const key of ["since", "until"]) {
    if (!filters[key]) continue;
    const bound = Date.parse(filters[key]);
    if (!Number.isNaN(bound)) predicates.push(event => event.timestamp
      && (key === "since" ? Date.parse(event.timestamp) >= bound : Date.parse(event.timestamp) <= bound));
  }
  const limit = Number.isInteger(filters.limit) && filters.limit >= 0 ? filters.limit : null;
  const events = [];
  let matched = 0;
  let cursor = 0;
  return {
    add(event) {
      if (!predicates.every(predicate => predicate(event))) return;
      matched += 1;
      if (limit === 0) return;
      if (limit === null || events.length < limit) events.push(event);
      else { events[cursor] = event; cursor = (cursor + 1) % limit; }
    },
    result: () => cursor === 0 ? events : events.slice(cursor).concat(events.slice(0, cursor)),
    get omittedEvents() { return matched - events.length; },
  };
}

export async function buildTaskHistory({
  target,
  packageRoot,
  taskId = null,
  filters = {},
} = {}) {
  const projection = historyEventProjection(filters);
  const trace = await buildTaskTrace({ target, packageRoot, taskId }, projection);
  const events = trace.events;
  const omittedEvents = projection.omittedEvents;

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
      totalEventCount: trace.totalEventCount,
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
