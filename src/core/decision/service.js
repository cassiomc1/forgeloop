import { canonicalFingerprint } from "../artifacts.js";
import { readConfig } from "../config.js";
import { appendProtocolEvent, iterateEvents } from "../events.js";
import { withTaskMutation } from "../task-command.js";
import { DECISION_DEFAULT_POLICY, PINNED_JEV_MODEL, SEMANTIC_DECISION_RECORDED_EVENT } from "./constants.js";
import { buildDecisionArtifact, decisionArtifactFingerprint, readDecisionArtifact, writeDecisionArtifact } from "./artifact.js";
import { decisionEventDetails, decisionSupersededEventDetails } from "./events.js";
import { createTypesafeEngine } from "../../adapters/typesafe/engine.js";
import { normalizeDecisionPolicy, decisionPolicyFingerprint } from "./policy.js";
import { validateDecisionRequest } from "./request.js";
import { normalizeDecisionResult } from "./result.js";
import { randomUUID } from "node:crypto";
import { readCurrentDecisionBindings } from "./task-bindings.js";
import { resolveRequiredSemanticDecision } from "./resolver.js";
import { DECISION_ERROR_CODES, decisionError } from "./errors.js";
import { getTaskTransaction } from "../transaction.js";
import { getTestSemanticProvider } from "./test-provider.js";
import { needsExistingProjectScope, withExistingProjectScope } from "../../storage/existing-project-scope.js";
import { withProjectReadSnapshot } from "../../storage/project-read-snapshot.js";

async function withDecisionScope(options, run) {
  if (options.target && options.taskId && await needsExistingProjectScope(options.target)) {
    return withExistingProjectScope(options.target, () => run(options));
  }
  return run(options);
}

function resolveProvider(provider) {
  return provider ?? getTestSemanticProvider();
}

async function loadPolicy(target, packageRoot) {
  try {
    const config = await readConfig(target, packageRoot);
    return normalizeDecisionPolicy(config.decisionEngine ?? DECISION_DEFAULT_POLICY);
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING") return normalizeDecisionPolicy(DECISION_DEFAULT_POLICY);
    throw error;
  }
}

async function readCachedDecision({ target, packageRoot, taskId, decisionKind, currentBindings }) {
  try {
    return await resolveRequiredSemanticDecision({ target, packageRoot, taskId, decisionKind, currentBindings });
  } catch (error) {
    if (["E_DECISION_REQUIRED", "E_DECISION_STALE", "E_DECISION_BINDING_INVALID"].includes(error.code)) return null;
    throw error;
  }
}

function buildArtifact({ taskId, decisionId, policy, validated, result, request, taskBindings }) {
  return buildDecisionArtifact({
    taskId,
    decisionId,
    decisionKind: validated.decisionKind,
    model: result.model ?? PINNED_JEV_MODEL,
    questionSetId: validated.questionSet.id,
    questionSetVersion: validated.questionSet.version,
    questionSetFingerprint: validated.questionSet.fingerprint,
    questionSet: validated.questionSet,
    stateFingerprint: canonicalFingerprint(validated.state),
    taskStateFingerprint: taskBindings.taskStateFingerprint ?? canonicalFingerprint(validated.state.lifecycle),
    semanticStateFingerprint: canonicalFingerprint(validated.state.semantic),
    policyVersion: policy.policyVersion,
    policyFingerprint: decisionPolicyFingerprint(policy),
    repositoryFingerprint: request.repositoryFingerprint ?? taskBindings.repositoryFingerprint,
    contractFingerprint: request.contractFingerprint ?? taskBindings.contractFingerprint,
    routeFingerprint: request.routeFingerprint ?? taskBindings.routeFingerprint,
    verificationCycle: request.verificationCycle ?? taskBindings.verificationCycle,
    candidateSetFingerprint: request.candidateSetFingerprint,
    answers: result.answers,
    confidence: result.confidence ?? {},
    decision: result.decision,
    usage: result.usage,
    latencyMs: result.latencyMs ?? null,
  });
}

async function readCachedSemanticDecision({ policy, decisionId, target, taskId, packageRoot, validated, taskBindings, request }) {
  if (!policy.cache || decisionId || !target || !taskId || await getTaskTransaction(target)) return null;
  return readCachedDecision({
    target,
    packageRoot,
    taskId,
    decisionKind: validated.decisionKind,
    currentBindings: {
      ...taskBindings,
      stateFingerprint: canonicalFingerprint(validated.state),
      taskStateFingerprint: taskBindings.taskStateFingerprint ?? canonicalFingerprint(validated.state.lifecycle),
      semanticStateFingerprint: canonicalFingerprint(validated.state.semantic),
      questionSetFingerprint: validated.questionSet.fingerprint,
      policyFingerprint: decisionPolicyFingerprint(policy),
      model: PINNED_JEV_MODEL,
      ...(request?.candidateSetFingerprint !== undefined ? { candidateSetFingerprint: request.candidateSetFingerprint } : {}),
      ...(request?.policyFingerprint !== undefined ? { policyFingerprint: request.policyFingerprint } : {}),
    },
  });
}

async function persistDecision(target, packageRoot, resolvedDecisionId, artifact, ctx) {
  await writeDecisionArtifact(target, ctx.taskId, resolvedDecisionId, artifact, packageRoot, { taskId: ctx.taskId, operation: "semantic-decision" });
  const priorRecords = [];
  const supersededIds = new Set();
  for await (const candidate of iterateEvents(target, packageRoot, { taskId: ctx.taskId })) {
    if (candidate.event === SEMANTIC_DECISION_RECORDED_EVENT && candidate.taskId === ctx.taskId
      && candidate.details?.decisionKind === artifact.decisionKind) priorRecords.push(candidate);
    if (candidate.event === "SEMANTIC_DECISION_SUPERSEDED") supersededIds.add(candidate.details?.decisionId);
  }
  const event = await appendProtocolEvent(target, { taskId: ctx.taskId, event: SEMANTIC_DECISION_RECORDED_EVENT, details: decisionEventDetails(artifact) }, packageRoot, { taskId: ctx.taskId });
  const previous = priorRecords.findLast(candidate => !supersededIds.has(candidate.details?.decisionId));
  if (!previous) return { artifact, artifactFingerprint: decisionArtifactFingerprint(artifact), event, supersededEvent: null };
  const previousArtifact = await readDecisionArtifact(target, ctx.taskId, previous.details.decisionId, packageRoot);
  const supersededEvent = await appendProtocolEvent(target, {
    taskId: ctx.taskId,
    event: "SEMANTIC_DECISION_SUPERSEDED",
    details: decisionSupersededEventDetails(previousArtifact.value, resolvedDecisionId),
  }, packageRoot, { taskId: ctx.taskId });
  return { artifact, artifactFingerprint: decisionArtifactFingerprint(artifact), event, supersededEvent };
}

export async function recordSemanticDecision(options = {}) {
  return withDecisionScope(options, recordSelectedSemanticDecision);
}

async function recordSelectedSemanticDecision({ target, packageRoot, taskId, decisionId, request, provider = null }) {
  const resolvedDecisionId = decisionId ?? `${String(request?.decisionKind ?? "decision").toLowerCase()}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const { policy, taskBindings, validated, cached } = await withProjectReadSnapshot(target, async () => {
    const policy = await loadPolicy(target, packageRoot);
    const taskBindings = target && taskId ? await readCurrentDecisionBindings(target, packageRoot, taskId) : {};
    const validated = validateDecisionRequest({
      ...request,
      taskId,
      state: { lifecycle: taskBindings.state ?? {}, semantic: request?.state ?? {} },
    });
    const cached = await readCachedSemanticDecision({ policy, decisionId, target, taskId, packageRoot, validated, taskBindings, request });
    return { policy, taskBindings, validated, cached };
  });
  if (cached) return { artifact: cached, artifactFingerprint: decisionArtifactFingerprint(cached), event: null, supersededEvent: null, cached: true, policy };
  const engine = resolveProvider(provider) ?? createTypesafeEngine({ policy });
  if (provider && (provider.id !== "typesafe-jev" || provider.model !== PINNED_JEV_MODEL || typeof provider.evaluate !== "function")) {
    throw decisionError(DECISION_ERROR_CODES.MODEL_UNSUPPORTED, "Semantic decision provider must be the pinned ForgeLoop Jev engine.");
  }
  const result = normalizeDecisionResult(await engine.evaluate(validated), { questionSet: validated.questionSet, input: validated });
  const artifact = buildArtifact({ taskId, decisionId: resolvedDecisionId, policy, validated, result, request, taskBindings });
  const persisted = await withTaskMutation(target, { taskId, packageRoot }, "semantic-decision", (ctx) => persistDecision(target, packageRoot, resolvedDecisionId, artifact, ctx), { explicitRequired: true });
  return { ...persisted, policy };
}

export async function ensureSemanticDecision(options = {}) {
  return withDecisionScope(options, ensureSelectedSemanticDecision);
}

async function ensureSelectedSemanticDecision({ target, packageRoot, taskId, decisionId, request, provider = null, allowNetwork = true }) {
  const { policy, validated, cached } = await withProjectReadSnapshot(target, async () => {
    const policy = await loadPolicy(target, packageRoot);
    const taskBindings = await readCurrentDecisionBindings(target, packageRoot, taskId);
    const validated = validateDecisionRequest({
      ...request,
      taskId,
      state: { lifecycle: taskBindings.state ?? {}, semantic: request?.state ?? {} },
    });
    const currentBindings = {
      ...taskBindings,
      stateFingerprint: canonicalFingerprint(validated.state),
      taskStateFingerprint: taskBindings.taskStateFingerprint ?? canonicalFingerprint(validated.state.lifecycle),
      semanticStateFingerprint: canonicalFingerprint(validated.state.semantic),
      questionSetFingerprint: validated.questionSet.fingerprint,
      policyFingerprint: decisionPolicyFingerprint(policy),
      model: PINNED_JEV_MODEL,
      ...(request?.candidateSetFingerprint !== undefined ? { candidateSetFingerprint: request.candidateSetFingerprint } : {}),
    };
    const cached = await getTaskTransaction(target) ? null : await readCachedDecision({
      target, packageRoot, taskId, decisionKind: validated.decisionKind,
      currentBindings,
    });
    return { policy, validated, cached };
  });
  if (cached) return { artifact: cached, artifactFingerprint: decisionArtifactFingerprint(cached), cached: true, policy };
  if (!allowNetwork && !provider) throw decisionError(DECISION_ERROR_CODES.REQUIRED, `A current ${validated.decisionKind} decision is required.`);
  return recordSemanticDecision({ target, packageRoot, taskId, decisionId, request: { ...request, questionSet: validated.questionSet }, provider });
}
