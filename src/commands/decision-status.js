import { readConfig } from "../core/config.js";
import { DECISION_DEFAULT_POLICY, DECISION_ENGINE_ID, PINNED_JEV_MODEL } from "../core/decision/constants.js";
import { normalizeDecisionPolicy } from "../core/decision/policy.js";
import { createTypesafeEngine } from "../adapters/typesafe/engine.js";
import { hasTypesafeCredentials } from "../adapters/typesafe/client.js";

export async function runDecisionStatus({ target, packageRoot, health = false } = {}) {
  let policy = DECISION_DEFAULT_POLICY;
  try { policy = normalizeDecisionPolicy((await readConfig(target, packageRoot)).decisionEngine); } catch { /* default policy is canonical for legacy projects */ }
  const result = { required: true, engine: DECISION_ENGINE_ID, model: PINNED_JEV_MODEL, credentials: hasTypesafeCredentials() ? "configured" : "missing", status: hasTypesafeCredentials() ? "configured" : "missing" };
  if (health) result.health = await createTypesafeEngine({ policy }).health();
  return result;
}

export function formatDecisionStatusResult(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}
