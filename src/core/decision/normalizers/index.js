import { DECISION_ERROR_CODES, decisionError } from "../errors.js";

function answerValue(answer) {
  if (answer && typeof answer === "object" && !Array.isArray(answer)) {
    for (const key of ["choice", "noul", "value", "answer"]) {
      if (Object.prototype.hasOwnProperty.call(answer, key)) return answer[key];
    }
  }
  return answer;
}

function boolAnswer(value) {
  if (value === true || value === "yes" || value === "YES") return true;
  if (value === false || value === "no" || value === "NO") return false;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) return value >= 0.5;
  return null;
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function normalizeQuestionSetAnswers(questionSet, answers) {
  const normalized = {};
  for (const [name, question] of Object.entries(questionSet.questions)) {
    const value = answerValue(answers[name]);
    if (question.type === "choice") {
      if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(question.criteria, value)) {
        throw decisionError(DECISION_ERROR_CODES.RESULT_INVALID, `Semantic answer ${name} is outside the canonical vocabulary.`);
      }
      normalized[name] = value;
    } else {
      const bool = boolAnswer(value);
      if (bool === null) throw decisionError(DECISION_ERROR_CODES.RESULT_INVALID, `Semantic answer ${name} must be yes or no.`);
      normalized[name] = bool;
    }
  }
  return normalized;
}

function normalizeConfidence(questionSet, confidence) {
  return Object.fromEntries(Object.keys(questionSet.questions).map((name) => {
    const value = confidence?.[name];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) {
      throw decisionError(DECISION_ERROR_CODES.RESULT_INVALID, `Semantic confidence ${name} must be finite and between 0 and 1.`);
    }
    return [name, value ?? null];
  }));
}

function normalizeModelRouteDecision(answers, confidence) {
  const reasoning = answers.reasoning_depth;
  return {
    tier: reasoning,
    generationRequired: answers.generation_required,
    confidence: confidence.reasoning_depth,
    requiresEscalation: reasoning === "PRIMARY" || confidence.reasoning_depth === null || confidence.reasoning_depth < 0.75,
  };
}

function normalizeExecutionProfileDecision(answers, confidence) {
  return {
    recommendedProfile: answers.recommended_depth,
    confidence: confidence.recommended_depth,
    needsBroadContext: answers.needs_broad_context,
    needsDeepReview: answers.needs_deep_review,
    highAmbiguity: answers.high_ambiguity,
    crossComponentReasoning: answers.cross_component_reasoning,
  };
}

function candidateProjection(questionSet, answers, confidence, ids, prefix) {
  const rankedIds = [];
  const excludedIds = [];
  const confidenceById = {};
  for (const [index, id] of ids.entries()) {
    const key = `${prefix}${index}_relevant`;
    confidenceById[id] = confidence[key];
    if (answers[key] === true) rankedIds.push(id);
    else if (answers[key] === false) excludedIds.push(id);
  }
  rankedIds.sort((a, b) => (confidence[`${prefix}${ids.indexOf(a)}_relevant`] ?? 0) - (confidence[`${prefix}${ids.indexOf(b)}_relevant`] ?? 0));
  return { rankedIds: rankedIds.reverse(), excludedIds, confidenceById };
}

function projectDecision(questionSet, answers, confidence, input) {
  const projections = {
    INTAKE: () => ({ dimensions: answers }),
    CONTRACT_APPLICABILITY: () => ({ applicable: answers.applicable }),
    ROUTE: () => (questionSet.metadata?.candidateQuestionPrefix
      ? candidateProjection(questionSet, answers, confidence, questionSet.candidateIds ?? [], questionSet.metadata.candidateQuestionPrefix)
      : { relevantGuides: unique([answers.relevant_guides]) }),
    EXECUTION_PROFILE: () => normalizeExecutionProfileDecision(answers, confidence),
    CONTEXT_PLAN: () => (questionSet.metadata?.candidateQuestionPrefix
      ? { needs: answers, ...candidateProjection(questionSet, answers, confidence, questionSet.candidateIds ?? [], questionSet.metadata.candidateQuestionPrefix) }
      : { needs: answers }),
    MODEL_ROUTE: () => normalizeModelRouteDecision(answers, confidence),
    FAILURE_TRIAGE: () => ({ failureClass: answers.failure_class }),
    DIAGNOSIS_PRIORITY: () => ({ priority: answers.priority }),
    REVIEW_PLAN: () => ({ reviewFocus: answers }),
    TASK_OVERLAP: () => ({ relationship: answers.relationship }),
    TEST_UTILITY: () => (questionSet.metadata?.testCount
      ? { judgments: answers, candidateIds: unique(questionSet.candidateIds ?? input.candidateIds ?? []), tests: Object.fromEntries((questionSet.candidateIds ?? []).map((id, index) => [id, Object.fromEntries((questionSet.metadata.dimensions ?? []).map((dimension) => [dimension, answers[`test_${index}_${dimension}`]]))])) }
      : { judgments: answers, candidateIds: unique(input.candidateIds ?? []) }),
    TEST_PRUNE: () => ({ redundancy: answers.redundancy }),
  };
  const project = projections[questionSet.decisionKind];
  if (!project) throw decisionError(DECISION_ERROR_CODES.RESULT_INVALID, `No canonical normalizer exists for ${questionSet.decisionKind}.`);
  return project();
}

export function normalizeCanonicalDecision({ questionSet, answers = {}, input = {}, confidence = {} } = {}) {
  const normalizedAnswers = normalizeQuestionSetAnswers(questionSet, answers);
  return projectDecision(questionSet, normalizedAnswers, normalizeConfidence(questionSet, confidence), input);
}
