import { normalizeDecisionResult } from "../../core/decision/result.js";
import { safeDecisionError } from "../../core/decision/errors.js";

function finiteProbability(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function confidenceFromAnswer(answer) {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;
  if (finiteProbability(answer.confidence)) return answer.confidence;
  if (answer.type === "noul" && finiteProbability(answer.noul)) {
    return Math.max(answer.noul, 1 - answer.noul);
  }
  return null;
}

// The live TypeSafe SystemOne result carries per-answer confidence inside each
// answer (choice.confidence, or the noul judgment probability itself) and no
// top-level confidence map; translate that into the canonical
// answer-name -> confidence shape ForgeLoop's decision layer consumes. A
// provider-reported top-level map remains authoritative per key when present.
function deriveTypesafeConfidence(raw) {
  const answers = raw?.answers;
  const derived = answers && typeof answers === "object" && !Array.isArray(answers)
    ? Object.fromEntries(Object.entries(answers).map(([name, answer]) => [name, confidenceFromAnswer(answer)]))
    : {};
  const provided = raw?.confidence;
  if (!provided || typeof provided !== "object" || Array.isArray(provided)) return derived;
  for (const [name, value] of Object.entries(provided)) {
    if (finiteProbability(value)) derived[name] = value;
  }
  return derived;
}

export function normalizeTypesafeResult(raw, questionSet) {
  try {
    return normalizeDecisionResult({ ...raw, confidence: deriveTypesafeConfidence(raw) }, { questionSet });
  } catch (error) {
    throw safeDecisionError(error, "E_DECISION_RESULT_INVALID");
  }
}
