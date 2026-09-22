import { readdir } from "node:fs/promises";

import { canonicalFingerprint, readJsonArtifact } from "../artifacts.js";
import { fileExists, ensureWithin } from "../filesystem.js";
import { readEvents, validateEventLedger } from "../events.js";
import { taskDecisionDirectory } from "../task-paths.js";
import { getQuestionSet } from "./question-registry.js";
import { DECISION_ERROR_CODES, decisionError } from "./errors.js";
import { DECISION_ENGINE_ID, DECISION_POLICY_VERSION, PINNED_JEV_MODEL, SEMANTIC_DECISION_RECORDED_EVENT, SEMANTIC_DECISION_SUPERSEDED_EVENT } from "./constants.js";
import { assertDecisionFresh } from "./freshness.js";

function invalid(message, code = DECISION_ERROR_CODES.BINDING_INVALID) {
  return decisionError(code, message);
}

function assertArtifactIdentity(artifact, { expectedDecisionKind, expectedTaskId, expectedQuestionSetId } = {}) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) throw invalid("Semantic decision artifact is not an object.");
  if (artifact.taskId !== expectedTaskId) throw invalid("Semantic decision task binding is invalid.");
  if (expectedDecisionKind && artifact.decisionKind !== expectedDecisionKind) throw invalid("Semantic decision kind binding is invalid.");
  if (expectedQuestionSetId && artifact.questionSetId !== expectedQuestionSetId) throw invalid("Semantic decision question-set binding is invalid.");
  if (artifact.engine !== DECISION_ENGINE_ID || artifact.model !== PINNED_JEV_MODEL) throw decisionError(DECISION_ERROR_CODES.MODEL_UNSUPPORTED, "Semantic decision is not bound to the pinned Jev engine and model.");
  if (artifact.policyVersion !== DECISION_POLICY_VERSION) throw invalid("Semantic decision policy version is invalid.");
}

function assertArtifactShape(artifact) {
  if (artifact.schemaVersion !== 1 || artifact.protocolVersion !== 1
    || !artifact.answers || typeof artifact.answers !== "object" || Array.isArray(artifact.answers)
    || !artifact.confidence || typeof artifact.confidence !== "object" || Array.isArray(artifact.confidence)
    || !artifact.decision || typeof artifact.decision !== "object" || Array.isArray(artifact.decision)
    || !artifact.usage || typeof artifact.usage !== "object" || Array.isArray(artifact.usage)) {
    throw invalid("Semantic decision artifact schema is invalid.");
  }
}

function assertArtifactAuthority(artifact) {
  if (artifact.authority !== "SEMANTIC_DECISION" || artifact.evidenceAuthority !== "NONE"
    || artifact.lifecycleAuthority !== false || artifact.completionAuthority !== false
    || artifact.ownershipAuthority !== false || artifact.installationAuthority !== false) {
    throw invalid("Semantic decision authority boundary is invalid.");
  }
}

function assertArtifactQuestionSet(artifact) {
  const questionSet = artifact.questionSet ?? getQuestionSet(artifact.questionSetId);
  if (questionSet.id !== artifact.questionSetId || questionSet.decisionKind === undefined) throw invalid("Semantic decision question-set identity is invalid.");
  if (artifact.questionSetVersion !== questionSet.version || artifact.questionSetFingerprint !== questionSet.fingerprint) {
    throw invalid("Semantic decision question-set fingerprint is stale.");
  }
  if (typeof artifact.decisionId !== "string" || artifact.decisionId.length === 0) {
    throw invalid("Semantic decision ID is invalid.");
  }
}

function assertCanonicalArtifact(artifact, options = {}) {
  assertArtifactIdentity(artifact, options);
  assertArtifactShape(artifact);
  assertArtifactAuthority(artifact);
  assertArtifactQuestionSet(artifact);
  return artifact;
}

function decisionRecordForArtifact(events, artifact) {
  return events.find((event) => event.event === SEMANTIC_DECISION_RECORDED_EVENT
    && event.taskId === artifact.taskId
    && event.details?.decisionId === artifact.decisionId) ?? null;
}

function isSuperseded(events, artifact) {
  return events.some((event) => event.event === SEMANTIC_DECISION_SUPERSEDED_EVENT
    && event.taskId === artifact.taskId
    && event.details?.decisionId === artifact.decisionId);
}

export function assertRequiredFreshDecision({ artifact, currentBindings = {}, expectedDecisionKind, expectedTaskId, expectedQuestionSetId, ledger = [] } = {}) {
  assertCanonicalArtifact(artifact, { expectedDecisionKind, expectedTaskId, expectedQuestionSetId });
  if (!Array.isArray(ledger)) throw invalid("Semantic decision ledger is unavailable.", DECISION_ERROR_CODES.LEDGER_INVALID);
  const record = decisionRecordForArtifact(ledger, artifact);
  if (!record || record.details.artifactFingerprint !== canonicalFingerprint(artifact)) {
    throw invalid("Semantic decision has no matching canonical ledger record.", DECISION_ERROR_CODES.LEDGER_INVALID);
  }
  if (isSuperseded(ledger, artifact)) throw decisionError(DECISION_ERROR_CODES.STALE, "Semantic decision has been superseded.");
  assertDecisionFresh(artifact, {
    ...currentBindings,
    model: PINNED_JEV_MODEL,
    policyFingerprint: currentBindings.policyFingerprint ?? artifact.policyFingerprint,
  });
  return artifact;
}

async function decisionArtifacts(target, taskId, packageRoot) {
  const directory = taskDecisionDirectory(taskId);
  const absolute = ensureWithin(target, directory);
  if (!(await fileExists(absolute))) return [];
  const names = (await readdir(absolute, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -5))
    .sort();
  const artifacts = [];
  for (const decisionId of names) {
    try {
      artifacts.push((await readJsonArtifact(target, `${directory}/${decisionId}.json`, "semantic-decision", packageRoot)).value);
    } catch {
      // The canonical resolver reports a missing/invalid candidate below.
    }
  }
  return artifacts;
}

export async function resolveRequiredSemanticDecision({ target, packageRoot, taskId, decisionKind, decisionId = null, currentBindings = {} } = {}) {
  if (typeof taskId !== "string" || !taskId) throw decisionError(DECISION_ERROR_CODES.REQUIRED, "A task-bound semantic decision is required.");
  const ledgerResult = await validateEventLedger(target, packageRoot, { taskId });
  if (!ledgerResult.valid) throw decisionError(DECISION_ERROR_CODES.LEDGER_INVALID, "The task ledger is invalid for semantic decision resolution.", ledgerResult.errors);
  const events = await readEvents(target, packageRoot, { taskId });
  const candidates = decisionId
    ? [(await readJsonArtifact(target, `${taskDecisionDirectory(taskId)}/${decisionId}.json`, "semantic-decision", packageRoot)).value]
    : await decisionArtifacts(target, taskId, packageRoot);
  const records = events
    .filter((event) => event.event === SEMANTIC_DECISION_RECORDED_EVENT && event.taskId === taskId && (!decisionKind || event.details?.decisionKind === decisionKind))
    .sort((left, right) => right.seq - left.seq);
  for (const record of records) {
    const artifact = candidates.find((candidate) => candidate.decisionId === record.details?.decisionId);
    if (!artifact || isSuperseded(events, artifact)) continue;
    try {
      return assertRequiredFreshDecision({ artifact, currentBindings, expectedDecisionKind: decisionKind, expectedTaskId: taskId, ledger: events });
    } catch (error) {
      if (decisionId) throw error;
    }
  }
  throw decisionError(DECISION_ERROR_CODES.REQUIRED, `No fresh canonical Jev decision is available for ${decisionKind ?? "the requested operation"}.`);
}
