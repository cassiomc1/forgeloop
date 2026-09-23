export const DECISION_RISK_TIERS = Object.freeze(["LOW_RISK", "NORMAL", "HIGH_RISK", "CRITICAL"]);
export const DECISION_THRESHOLDS = Object.freeze({
  LOW_RISK: 0.65,
  NORMAL: 0.75,
  HIGH_RISK: 0.9,
  CRITICAL: 0.97,
});

export function decisionConfidenceThreshold(risk = "NORMAL") {
  return DECISION_THRESHOLDS[risk] ?? DECISION_THRESHOLDS.NORMAL;
}

export function requiresEscalation(confidence, risk = "NORMAL") {
  return typeof confidence !== "number" || confidence < decisionConfidenceThreshold(risk);
}
