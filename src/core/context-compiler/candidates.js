import { canonicalFingerprint } from "../artifacts.js";
import { buildDecisionState } from "../decision/state-builder.js";

const INJECTION_PATTERN = /(ignore|disregard|override)\s+(?:all|previous|forge|system|developer)|exfiltrat|reveal\s+(?:the|all)\s+(?:secret|token|key)|execute\s+(?:this|the)\s+command/i;

export function normalizeContextCandidate(input = {}) {
  const safe = buildDecisionState({
    id: input.id ?? null,
    sourceRef: input.sourceRef ?? null,
    kind: input.kind ?? "UNKNOWN",
    summary: input.summary ?? "",
    required: input.required === true,
    mandatory: input.mandatory === true,
    risk: input.risk ?? "NORMAL",
    trust: input.trust ?? "UNTRUSTED",
  });
  const summary = typeof safe.summary === "string" ? safe.summary : "";
  const id = typeof safe.id === "string" && safe.id ? safe.id : `candidate-${canonicalFingerprint(safe).slice(0, 16)}`;
  return {
    ...safe,
    id,
    summary,
    chars: summary.length,
    promptInjection: INJECTION_PATTERN.test(summary),
  };
}

export function normalizeContextCandidates(candidates = []) {
  const seen = new Set();
  const normalized = [];
  for (const candidate of candidates) {
    const value = normalizeContextCandidate(candidate);
    const identity = `${value.id}:${value.sourceRef ?? ""}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    normalized.push(value);
  }
  return normalized;
}
