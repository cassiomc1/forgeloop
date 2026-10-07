import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalFingerprint, writeJsonArtifact } from "./artifacts.js";
import { buildTaskTrace } from "./trace.js";
import { buildTrajectoryMetrics } from "./trajectory-metrics.js";
import { assertSchema, readSchema } from "./schema-validation.js";
import { taskEvaluationPath } from "./task-paths.js";
import { appendProtocolEvent } from "./events.js";
import { assertSafePath, ensureWithin } from "./filesystem.js";
import { withTaskTransaction } from "./transaction.js";
import { withProjectReadSnapshot } from "../storage/project-read-snapshot.js";
import { needsExistingProjectScope, withExistingProjectScope } from "../storage/existing-project-scope.js";

function evaluationError(code, message) { const error = new Error(message); error.code = code; return error; }

export async function evaluateTrajectory({ target, packageRoot, taskId, scenarioPath, evaluationId = `eval-${randomUUID()}`, runtimeContext = null }) {
  if (typeof scenarioPath !== "string" || !scenarioPath || path.isAbsolute(scenarioPath) || scenarioPath.includes("..")) {
    throw evaluationError("E_TRAJECTORY_SCENARIO_INVALID", "scenario path must be a relative project-local file");
  }
  let scenario;
  try {
    await assertSafePath(target, scenarioPath);
    scenario = JSON.parse(await readFile(ensureWithin(target, scenarioPath), "utf8"));
  } catch (error) {
    throw evaluationError("E_TRAJECTORY_SCENARIO_INVALID", `unable to read scenario safely: ${error.message}`);
  }
  assertSchema(scenario, await readSchema("trajectory-scenario", packageRoot), "trajectory scenario");
  if (!/^eval-[A-Za-z0-9_-]+$/.test(evaluationId)) throw evaluationError("E_TRAJECTORY_SCENARIO_INVALID", "evaluationId is invalid");
  const options = { target, packageRoot, taskId, scenarioPath, evaluationId, runtimeContext };
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => evaluateValidatedTrajectory(options, scenario));
  }
  return evaluateValidatedTrajectory(options, scenario);
}

async function evaluateValidatedTrajectory({ target, packageRoot, taskId, evaluationId, runtimeContext }, scenario) {
  const { trace, metrics } = await withProjectReadSnapshot(target, async () => ({
    trace: await buildTaskTrace({ target, packageRoot, taskId }),
    metrics: await buildTrajectoryMetrics({ target, packageRoot, taskId, runtimeContext }),
  }));
  const milestoneSet = new Set(trace.events.map((event) => event.type));
  const missingMilestones = (scenario.requiredMilestones ?? []).filter((milestone) => !milestoneSet.has(milestone));
  const completionEvent = trace.events.find((event) => event.type === "COMPLETION_VALIDATED");
  const verificationEvent = trace.events.find((event) => event.type === "VERIFICATION_STARTED" || event.type === "VERIFICATION_RECORDED");
  const completionBeforeVerification = Boolean(completionEvent && (!verificationEvent || completionEvent.sequence < verificationEvent.sequence));
  // Canonical truth: ambiguous actions or unresolved trusted-readiness items
  // block safety. A raw VERIFIED label alone never resolves a required action.
  const unresolvedRequiredAction = (trace.actions?.ambiguous ?? 0) > 0
    || ((metrics.actions.unresolvedRequired ?? null) !== null
      ? metrics.actions.unresolvedRequired > 0
      : (trace.actions?.required ?? 0) > (trace.actions?.verified ?? 0));
  const limit = (name, actual, max) => ({ actual, ...(max === undefined ? {} : { max, pass: actual <= max }) });
  const limits = {
    verificationCycles: limit("verificationCycles", metrics.trajectory.verificationCycles, scenario.limits?.maxVerificationCycles),
    nonInformativeInterventions: limit("nonInformativeInterventions", metrics.trajectory.interventions.nonInformative, scenario.limits?.maxNonInformativeInterventions),
    ambiguousActions: limit("ambiguousActions", metrics.actions.ambiguous, scenario.limits?.maxAmbiguousActions),
  };
  const safetyValid = !(scenario.forbidden?.completionBeforeVerification && completionBeforeVerification)
    && !(scenario.forbidden?.unresolvedRequiredAction && unresolvedRequiredAction);
  const completionValid = metrics.completion.validated && missingMilestones.length === 0;
  const limitsValid = Object.values(limits).every((item) => item.pass !== false);
  // Comparable steps have exactly one owner: buildTrajectoryMetrics.
  const efficiency = Number.isInteger(scenario.reference?.comparableSteps) && scenario.reference.comparableSteps > 0
    ? { referenceComparableSteps: scenario.reference.comparableSteps, actualComparableSteps: metrics.comparableSteps,
      ratio: scenario.reference.comparableSteps / Math.max(1, metrics.comparableSteps) }
    : null;
  const base = {
    schemaVersion: 1, evaluationId, scenarioId: scenario.scenarioId,
    scenarioFingerprint: canonicalFingerprint(scenario), taskId,
    result: completionValid && safetyValid && limitsValid ? "PASS" : "FAIL",
    completionValid, safetyValid, missingMilestones, limits, efficiency,
    computedAt: new Date().toISOString(), source: "PROJECT_LOCAL_REFERENCE",
  };
  const evaluation = { ...base, evaluationFingerprint: canonicalFingerprint(base) };
  assertSchema(evaluation, await readSchema("trajectory-evaluation", packageRoot), "trajectory evaluation");
  await withTaskTransaction({ target, packageRoot, taskId, operation: "trajectory-evaluated" }, async () => {
    await writeJsonArtifact(target, taskEvaluationPath(taskId, evaluationId), evaluation, "trajectory-evaluation", packageRoot);
    await appendProtocolEvent(target, { taskId, event: "TRAJECTORY_EVALUATED", fingerprint: evaluation.evaluationFingerprint,
      details: { evaluationId, scenarioId: scenario.scenarioId, evaluationFingerprint: evaluation.evaluationFingerprint } }, packageRoot, { taskId });
  });
  return evaluation;
}
