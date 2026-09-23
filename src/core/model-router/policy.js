import { MODEL_ROUTE_RANK, MODEL_ROUTE_TIERS } from "./constants.js";

const GENERATION_WORK_TYPES = new Set([
  "code", "bug", "refactor", "backend", "api", "infrastructure", "security-review", "release",
]);
const PRIMARY_WORK_TYPES = new Set(["infrastructure", "security-review", "release"]);
const PRIMARY_RISKS = new Set(["secrets", "personal-data", "publication", "critical-path", "destructive", "irreversible", "migration", "credentials", "payment"]);
const PRIMARY_SURFACES = new Set(["auth", "critical-path", "database"]);

function text(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function array(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function contractText(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) return "";
  const values = [contract.objective, contract.summary, ...(contract.deliverables ?? []), ...(contract.successCriteria ?? []), ...(contract.risks ?? []), ...(contract.constraints ?? [])];
  return values.map((value) => value && typeof value === "object" ? value.text : value).filter((value) => typeof value === "string").join(" ").toLowerCase();
}

function normalizedInput(input = {}) {
  return {
    workType: text(input.workType),
    surfaces: array(input.surfaces).map(text),
    risks: array(input.risks).map(text),
    platforms: array(input.platforms).map(text),
    behaviorChange: input.behaviorChange === true,
    executableChange: input.executableChange === true,
    generationRequired: input.generationRequired === true,
    architectureChange: input.architectureChange === true,
    ambiguity: input.ambiguity === true,
    contract: input.contract,
  };
}

function deterministicFloor(input) {
  const normalized = normalizedInput(input);
  const reasons = [];
  const combined = `${contractText(normalized.contract)} ${normalized.workType} ${normalized.surfaces.join(" ")} ${normalized.risks.join(" ")}`;
  const generationRequired = normalized.generationRequired
    || normalized.behaviorChange
    || normalized.executableChange
    || GENERATION_WORK_TYPES.has(normalized.workType)
    || /\b(implement|fix|refactor|change|build|generate|write|modify|code)\b/.test(combined);
  const primary = normalized.architectureChange
    || normalized.ambiguity
    || PRIMARY_WORK_TYPES.has(normalized.workType)
    || normalized.risks.some((risk) => PRIMARY_RISKS.has(risk))
    || normalized.surfaces.some((surface) => PRIMARY_SURFACES.has(surface))
    || /\b(architecture|architectural|security boundary|migration|ambiguous|unknown requirements)\b/.test(combined);

  if (!generationRequired) {
    reasons.push("NO_GENERATION_REQUIRED");
    return { floor: "NONE", reasons };
  }
  reasons.push("GENERATION_REQUIRED");
  if (primary) {
    reasons.push("PRIMARY_COMPLEXITY_OR_RISK");
    return { floor: "PRIMARY", reasons };
  }
  reasons.push("STANDARD_GENERATION_FLOOR");
  return { floor: "STANDARD", reasons };
}

function normalizeRecommendation(recommendation) {
  if (recommendation === null || recommendation === undefined) return null;
  if (typeof recommendation === "string") {
    return MODEL_ROUTE_TIERS.includes(recommendation) ? { tier: recommendation, confidence: null, requiresEscalation: false } : null;
  }
  if (!recommendation || typeof recommendation !== "object" || Array.isArray(recommendation)) return null;
  const tier = typeof recommendation.tier === "string" && MODEL_ROUTE_TIERS.includes(recommendation.tier) ? recommendation.tier : null;
  if (!tier) return null;
  return {
    tier,
    confidence: typeof recommendation.confidence === "number" && Number.isFinite(recommendation.confidence) ? recommendation.confidence : null,
    requiresEscalation: recommendation.requiresEscalation === true,
  };
}

export function resolveModelRoute({ input = {}, semanticRecommendation = null } = {}) {
  const deterministic = deterministicFloor(input);
  const recommendation = normalizeRecommendation(semanticRecommendation);
  let resolved = deterministic.floor;
  const reasons = [...deterministic.reasons];
  if (recommendation?.requiresEscalation) {
    if (MODEL_ROUTE_RANK[resolved] < MODEL_ROUTE_RANK.PRIMARY) resolved = "PRIMARY";
    reasons.push("JEV_LOW_CONFIDENCE_ESCALATION");
  } else if (recommendation && MODEL_ROUTE_RANK[recommendation.tier] > MODEL_ROUTE_RANK[resolved]) {
    resolved = recommendation.tier;
    reasons.push("JEV_ESCALATION_ONLY");
  }
  return {
    floor: deterministic.floor,
    resolved,
    reasons: [...new Set(reasons)],
    semanticRecommendation: recommendation,
    generationRequired: deterministic.floor !== "NONE",
  };
}

