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

function projectDecision(questionSet, answers, confidence, input) {
  const projections = {
    INTAKE: () => ({ dimensions: answers }),
    CONTRACT_APPLICABILITY: () => ({ applicable: answers.applicable }),
    ROUTE: () => ({ relevantGuides: unique([answers.relevant_guides]) }),
    CONTEXT_PLAN: () => ({ needs: answers }),
    MODEL_ROUTE: () => normalizeModelRouteDecision(answers, confidence),
    FAILURE_TRIAGE: () => ({ failureClass: answers.failure_class }),
    DIAGNOSIS_PRIORITY: () => ({ priority: answers.priority }),
    REVIEW_PLAN: () => ({ reviewFocus: answers }),
    TASK_OVERLAP: () => ({ relationship: answers.relationship }),
    TEST_UTILITY: () => ({ judgments: answers, candidateIds: unique(input.candidateIds ?? []) }),
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
