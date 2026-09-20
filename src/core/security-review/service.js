import {
  E_SECURITY_REVIEW_CANCELLED,
  E_SECURITY_REVIEW_EXECUTION_FAILED,
  E_SECURITY_REVIEW_OUTPUT_LIMIT,
  E_SECURITY_REVIEW_PROVIDER_INVALID,
  E_SECURITY_REVIEW_PROVIDER_UNAVAILABLE,
  E_SECURITY_REVIEW_REQUEST_INVALID,
  E_SECURITY_REVIEW_RESULT_INVALID,
  E_SECURITY_REVIEW_TIMEOUT,
} from "../error-codes.js";
import { normalizeSecurityReviewRequest, resolveSecurityReviewProvider } from "./provider.js";
import { SECURITY_REVIEW_LIMITS } from "./constants.js";
import { normalizeSecurityReviewResult } from "./normalize.js";

function error(code, message, details = null) {
  const output = new Error(message);
  output.code = code;
  output.details = details;
  return output;
}

function timeoutError(providerName, reviewId) {
  return error(E_SECURITY_REVIEW_TIMEOUT, `Security review provider "${providerName}" timed out.`, { provider: providerName, reviewId });
}

function cancelledError(providerName, reviewId) {
  return error(E_SECURITY_REVIEW_CANCELLED, `Security review provider "${providerName}" was cancelled.`, { provider: providerName, reviewId });
}

function safeFailure(providerName) {
  return error(E_SECURITY_REVIEW_EXECUTION_FAILED, `Security review provider "${providerName}" failed.`, { provider: providerName });
}

async function bounded(factory, { controller, callerSignal, deadline, providerName, reviewId }) {
  const remaining = () => Math.max(0, deadline - Date.now());
  if (callerSignal?.aborted) {
    controller.abort();
    throw cancelledError(providerName, reviewId);
  }
  if (remaining() <= 0) {
    controller.abort();
    throw timeoutError(providerName, reviewId);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onAbort);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => {
      controller.abort();
      finish(reject, cancelledError(providerName, reviewId));
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish(reject, timeoutError(providerName, reviewId));
    }, remaining());
    callerSignal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(() => factory(remaining()))
      .then((value) => finish(resolve, value), (failure) => finish(reject, failure));
  });
}

export async function runSecurityReview({
  projectPath, taskId, providerName, reviewId, scope, paths, categories, requirements, revision,
  timeoutMs, runtimeContext, signal,
} = {}) {
  const normalized = normalizeSecurityReviewRequest({
    projectPath, taskId, reviewId, scope, paths, categories, requirements, revision, timeoutMs,
  });
  const controller = new AbortController();
  const deadline = Date.now() + normalized.timeoutMs;
  const providers = runtimeContext?.securityReviewProviders;
  try {
    const provider = await bounded(
      (remaining) => resolveSecurityReviewProvider(providers, providerName, {
        signal: controller.signal,
        timeoutMs: remaining,
        request: normalized,
      }),
      { controller, callerSignal: signal, deadline, providerName, reviewId: normalized.reviewId },
    );
    const raw = await bounded(
      (remaining) => provider.review(Object.freeze({ ...normalized, signal: controller.signal, timeoutMs: remaining })),
      { controller, callerSignal: signal, deadline, providerName, reviewId: normalized.reviewId },
    );
    if (controller.signal.aborted) {
      if (signal?.aborted) throw cancelledError(providerName, normalized.reviewId);
      throw timeoutError(providerName, normalized.reviewId);
    }
    if (Date.now() >= deadline) {
      controller.abort();
      throw timeoutError(providerName, normalized.reviewId);
    }
    const result = normalizeSecurityReviewResult(raw, {
      provider,
      taskId: normalized.taskId,
      reviewId: normalized.reviewId,
      scope: normalized.scope,
      requestedPaths: normalized.paths,
    });
    if (Date.now() >= deadline) {
      controller.abort();
      throw timeoutError(providerName, normalized.reviewId);
    }
    return result;
  } catch (failure) {
    if ([
      E_SECURITY_REVIEW_REQUEST_INVALID,
      E_SECURITY_REVIEW_RESULT_INVALID,
      E_SECURITY_REVIEW_OUTPUT_LIMIT,
      E_SECURITY_REVIEW_TIMEOUT,
      E_SECURITY_REVIEW_CANCELLED,
      E_SECURITY_REVIEW_PROVIDER_INVALID,
    ].includes(failure?.code)) {
      if ([E_SECURITY_REVIEW_TIMEOUT, E_SECURITY_REVIEW_CANCELLED].includes(failure.code)) controller.abort();
      throw failure;
    }
    if (failure?.code === E_SECURITY_REVIEW_PROVIDER_UNAVAILABLE
      && failure.message.includes("not registered")) throw failure;
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    throw safeFailure(providerName);
  }
}

export { SECURITY_REVIEW_LIMITS };
