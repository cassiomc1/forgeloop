import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertSafePath, ensureWithin } from "./filesystem.js";
import { readContract } from "./contract.js";
import { currentRepositoryFingerprint } from "./repository.js";
import { buildTrajectoryMetrics } from "./trajectory-metrics.js";
import { withProjectReadSnapshot } from "../storage/project-read-snapshot.js";

function efficiencyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function environmentClass() {
  return `${process.platform}-node${process.versions.node.split(".")[0]}`;
}

function validNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateBaseline(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw efficiencyError("E_EFFICIENCY_BASELINE_INVALID", "efficiency baseline must be a JSON object");
  }
  if (!Number.isInteger(value.comparableSteps) || value.comparableSteps < 0) {
    throw efficiencyError("E_EFFICIENCY_BASELINE_INVALID", "efficiency baseline comparableSteps must be a non-negative integer");
  }
  if (value.metadata !== undefined && (!value.metadata || typeof value.metadata !== "object" || Array.isArray(value.metadata))) {
    throw efficiencyError("E_EFFICIENCY_BASELINE_INVALID", "efficiency baseline metadata must be an object");
  }
  if (value.usage !== undefined && (!value.usage || typeof value.usage !== "object" || Array.isArray(value.usage))) {
    throw efficiencyError("E_EFFICIENCY_BASELINE_INVALID", "efficiency baseline usage must be an object");
  }
  if (value.timing !== undefined && (!value.timing || typeof value.timing !== "object" || Array.isArray(value.timing))) {
    throw efficiencyError("E_EFFICIENCY_BASELINE_INVALID", "efficiency baseline timing must be an object");
  }
  if (value.usage?.totalTokens !== undefined && value.usage.totalTokens !== null && !validNumber(value.usage.totalTokens)) {
    throw efficiencyError("E_EFFICIENCY_BASELINE_INVALID", "efficiency baseline usage.totalTokens must be a non-negative number or null");
  }
  if (value.timing?.wallClockMs !== undefined && value.timing.wallClockMs !== null && !validNumber(value.timing.wallClockMs)) {
    throw efficiencyError("E_EFFICIENCY_BASELINE_INVALID", "efficiency baseline timing.wallClockMs must be a non-negative number or null");
  }
  return value;
}

function compareMetadata(actual, baseline) {
  const expected = baseline.metadata ?? {};
  const fields = [
    "taskId",
    "scenarioId",
    "model",
    "provider",
    "promptSpecFingerprint",
    "projectRevision",
    "benchmarkVersion",
    "environmentClass",
    "usageSource",
  ];
  const mismatches = [];
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(expected, field)) continue;
    if (actual[field] === undefined || actual[field] === null || actual[field] !== expected[field]) {
      mismatches.push({ field, expected: expected[field] ?? null, actual: actual[field] ?? null });
    }
  }
  const required = ["taskId", "model", "provider", "projectRevision", "environmentClass"];
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(expected, field)) {
      mismatches.push({ field, expected: "required", actual: actual[field] ?? null });
    }
  }
  return { comparable: mismatches.length === 0, mismatches };
}

function ratio(actual, baseline) {
  if (!validNumber(actual) || !validNumber(baseline) || baseline === 0) return null;
  return Number(((actual - baseline) / baseline * 100).toFixed(4));
}

export async function readEfficiencyBaseline(target, baselinePath) {
  if (typeof baselinePath !== "string" || !baselinePath.trim() || path.isAbsolute(baselinePath)) {
    throw efficiencyError("E_EFFICIENCY_BASELINE_INVALID", "baseline path must be a relative project-local file");
  }
  try {
    await assertSafePath(target, baselinePath);
    const parsed = JSON.parse(await readFile(ensureWithin(target, baselinePath), "utf8"));
    return validateBaseline(parsed);
  } catch (error) {
    if (error.code === "E_EFFICIENCY_BASELINE_INVALID") throw error;
    throw efficiencyError("E_EFFICIENCY_BASELINE_INVALID", `unable to read baseline safely: ${error.message}`);
  }
}

export async function buildEfficiencyReport(options = {}) {
  return withProjectReadSnapshot(options.target, () => projectEfficiencyReport(options));
}

async function projectEfficiencyReport({ target, packageRoot, taskId, baselinePath = null, runtimeContext = null } = {}) {
  const metrics = await buildTrajectoryMetrics({ target, packageRoot, taskId, runtimeContext });
  const repository = await currentRepositoryFingerprint(target);
  let promptSpecFingerprint = null;
  try {
    promptSpecFingerprint = (await readContract(target, packageRoot, { taskId })).fingerprint;
  } catch {
    // A task without a contract is not comparable to a contract-bound baseline.
  }
  const actualMetadata = {
    taskId,
    scenarioId: taskId,
    model: metrics.usage.model,
    provider: metrics.usage.provider,
    promptSpecFingerprint,
    projectRevision: repository.head ?? null,
    benchmarkVersion: null,
    environmentClass: environmentClass(),
    usageSource: metrics.usage.source,
  };
  const base = {
    taskId,
    executionProfile: metrics.executionProfile,
    usage: metrics.usage,
    usageSource: metrics.usage.source,
    timing: metrics.timing,
    tokensPerComparableStep: validNumber(metrics.usage.totalTokens) && metrics.comparableSteps > 0
      ? metrics.usage.totalTokens / metrics.comparableSteps
      : null,
  };
  if (!baselinePath) {
    return {
      ...base,
      comparison: {
        status: "NOT_COMPARABLE",
        comparable: false,
        usageSource: metrics.usage.source,
        reason: "No baseline was supplied.",
        metadata: actualMetadata,
        baseline: null,
        ratios: { comparableStepsPercent: null, totalTokensPercent: null, wallClockMsPercent: null },
        tokenOverheadRatio: null,
        timeOverheadRatio: null,
        tokenOverheadPercent: null,
        timeOverheadPercent: null,
      },
    };
  }

  const baseline = await readEfficiencyBaseline(target, baselinePath);
  const metadata = compareMetadata(actualMetadata, baseline);
  if (!metadata.comparable) {
    return {
      ...base,
      comparison: {
        status: "NOT_COMPARABLE",
        comparable: false,
        usageSource: metrics.usage.source,
        reason: "Baseline metadata does not match the current task execution.",
        metadata: actualMetadata,
        mismatches: metadata.mismatches,
        baseline: { path: baselinePath, comparableSteps: baseline.comparableSteps },
        ratios: { comparableStepsPercent: null, totalTokensPercent: null, wallClockMsPercent: null },
        tokenOverheadRatio: null,
        timeOverheadRatio: null,
        tokenOverheadPercent: null,
        timeOverheadPercent: null,
      },
    };
  }

  return {
    ...base,
    comparison: {
      status: "COMPARABLE",
      comparable: true,
      usageSource: metrics.usage.source,
      reason: "Baseline metadata matches the current task execution.",
      metadata: actualMetadata,
      baseline: {
        path: baselinePath,
        comparableSteps: baseline.comparableSteps,
        usage: baseline.usage ?? null,
        timing: baseline.timing ?? null,
      },
      ratios: {
        comparableStepsPercent: ratio(metrics.comparableSteps, baseline.comparableSteps),
        totalTokensPercent: ratio(metrics.usage.totalTokens, baseline.usage?.totalTokens),
        wallClockMsPercent: ratio(metrics.timing.wallClockMs, baseline.timing?.wallClockMs),
      },
      tokenOverheadRatio: validNumber(metrics.usage.totalTokens) && validNumber(baseline.usage?.totalTokens)
        && baseline.usage.totalTokens !== 0
        ? Number((metrics.usage.totalTokens / baseline.usage.totalTokens).toFixed(4))
        : null,
      timeOverheadRatio: validNumber(metrics.timing.wallClockMs) && validNumber(baseline.timing?.wallClockMs)
        && baseline.timing.wallClockMs !== 0
        ? Number((metrics.timing.wallClockMs / baseline.timing.wallClockMs).toFixed(4))
        : null,
      tokenOverheadPercent: ratio(metrics.usage.totalTokens, baseline.usage?.totalTokens),
      timeOverheadPercent: ratio(metrics.timing.wallClockMs, baseline.timing?.wallClockMs),
    },
  };
}
