import { TypeSafeClient } from "@typesafe-ai/sdk";
import { DECISION_ERROR_CODES, decisionError } from "../../core/decision/errors.js";
import { PINNED_JEV_MODEL } from "../../core/decision/constants.js";

export function hasTypesafeCredentials(env = process.env) {
  return typeof env?.TYPESAFE_API_KEY === "string" && env.TYPESAFE_API_KEY.trim().length > 0;
}

export function createTypesafeClient(policy, { env = process.env } = {}) {
  if (!hasTypesafeCredentials(env)) throw decisionError(DECISION_ERROR_CODES.AUTH_REQUIRED, "TYPESAFE_API_KEY is required for a semantic decision.");
  if (policy?.model !== PINNED_JEV_MODEL) throw decisionError(DECISION_ERROR_CODES.MODEL_UNSUPPORTED, "ForgeLoop requires the pinned Jev model.");
  return new TypeSafeClient({
    defaultModel: PINNED_JEV_MODEL,
    timeout: policy.requestTimeoutMs,
    retry: { maxRetries: policy.maxRetries },
    logLevel: "warn",
  });
}
