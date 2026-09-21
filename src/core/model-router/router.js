import {
  MODEL_ROUTE_JEV_MODEL,
  MODEL_ROUTE_POLICY_VERSION,
  MODEL_ROUTE_PROJECTION_AUTHORITY,
  MODEL_ROUTE_PROJECTION_EVIDENCE_AUTHORITY,
  MODEL_ROUTE_RANK,
  MODEL_ROUTE_TIERS,
} from "./constants.js";
import { resolveModelRoute } from "./policy.js";

export function projectModelRoute({ input = {}, semanticRecommendation = null } = {}) {
  const route = resolveModelRoute({ input, semanticRecommendation });
  if (!MODEL_ROUTE_TIERS.includes(route.floor) || !MODEL_ROUTE_TIERS.includes(route.resolved)
    || MODEL_ROUTE_RANK[route.resolved] < MODEL_ROUTE_RANK[route.floor]) {
    const error = new Error("Model route violates its deterministic safety floor.");
    error.code = "E_MODEL_ROUTE_SAFETY_FLOOR_INVALID";
    throw error;
  }
  return {
    schemaVersion: 1,
    policyVersion: MODEL_ROUTE_POLICY_VERSION,
    engine: "typesafe-jev",
    model: MODEL_ROUTE_JEV_MODEL,
    floor: route.floor,
    resolved: route.resolved,
    reasons: route.reasons,
    generationRequired: route.generationRequired,
    semanticRecommendation: route.semanticRecommendation,
    authority: MODEL_ROUTE_PROJECTION_AUTHORITY,
    evidenceAuthority: MODEL_ROUTE_PROJECTION_EVIDENCE_AUTHORITY,
    lifecycleAuthority: false,
    completionAuthority: false,
    ownershipAuthority: false,
    installationAuthority: false,
  };
}

