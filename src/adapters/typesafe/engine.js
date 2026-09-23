import { choice, noul } from "@typesafe-ai/sdk";
import { createTypesafeClient, hasTypesafeCredentials } from "./client.js";
import { normalizeTypesafeResult } from "./normalize.js";
import { DECISION_ENGINE_ID, PINNED_JEV_MODEL } from "../../core/decision/constants.js";
import { DECISION_ERROR_CODES, decisionError, safeDecisionError } from "../../core/decision/errors.js";

function safeFailureFields(error) {
  const diagnostics = error?.diagnostics;
  if (!diagnostics) return {};
  return {
    httpStatus: diagnostics.httpStatus ?? null,
    providerErrorType: diagnostics.providerErrorType ?? null,
    requestId: diagnostics.requestId ?? null,
    networkClass: diagnostics.networkClass ?? null,
  };
}

function sdkQuestions(questionSet) {
  return Object.fromEntries(Object.entries(questionSet.questions).map(([name, question]) => {
    if (question.type === "choice") return [name, choice(`Answer the bounded ${name} question.`, question.criteria)];
    return [name, noul(`Answer the bounded ${name} question.`, question.criteria)];
  }));
}

export function createTypesafeEngine({ policy }) {
  const engine = {
    id: DECISION_ENGINE_ID,
    model: PINNED_JEV_MODEL,
    async evaluate(request) {
      if (!hasTypesafeCredentials()) throw decisionError(DECISION_ERROR_CODES.AUTH_REQUIRED, "TYPESAFE_API_KEY is required for a semantic decision.");
      const started = Date.now();
      try {
        const client = createTypesafeClient(policy);
        const raw = await client.systemOne({ state: request.state, questions: sdkQuestions(request.questionSet), model: PINNED_JEV_MODEL }, { timeout: policy.requestTimeoutMs, retry: { maxRetries: policy.maxRetries } });
        return { ...normalizeTypesafeResult(raw, request.questionSet), latencyMs: Date.now() - started };
      } catch (error) {
        throw safeDecisionError(error);
      }
    },
    async health() {
      if (!hasTypesafeCredentials()) return { status: "missing", engine: DECISION_ENGINE_ID, model: PINNED_JEV_MODEL };
      const started = Date.now();
      try {
        const client = createTypesafeClient(policy);
        const raw = await client.systemOne({ state: { healthCheck: true }, questions: { healthy: noul("Is this bounded health-check request well-formed?", { yes: "The request is well-formed", no: "The request is not well-formed" }) }, model: PINNED_JEV_MODEL }, { timeout: policy.requestTimeoutMs, retry: { maxRetries: 0 } });
        if (raw.model !== PINNED_JEV_MODEL) throw decisionError(DECISION_ERROR_CODES.MODEL_UNSUPPORTED, "The semantic decision service returned an unsupported model.");
        return { status: "healthy", engine: DECISION_ENGINE_ID, model: PINNED_JEV_MODEL, latencyMs: Date.now() - started, usage: raw.usage ?? null };
      } catch (error) {
        const normalized = safeDecisionError(error);
        return {
          status: normalized.code === DECISION_ERROR_CODES.RATE_LIMITED ? "rate-limited"
            : normalized.code === DECISION_ERROR_CODES.AUTH_INVALID ? "invalid"
              : "unreachable",
          engine: DECISION_ENGINE_ID,
          model: PINNED_JEV_MODEL,
          errorCode: normalized.code,
          ...safeFailureFields(normalized),
        };
      }
    },
  };
  return Object.freeze(engine);
}
