import {
  E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE,
  E_BROWSER_VERIFICATION_REQUEST_INVALID,
  E_BROWSER_VERIFICATION_RESULT_INVALID,
  E_BROWSER_VERIFICATION_OUTPUT_LIMIT,
  E_BROWSER_VERIFICATION_ORIGIN_DENIED,
  E_BROWSER_VERIFICATION_TIMEOUT,
} from "../error-codes.js";
import { normalizeBrowserVerificationRequestOptions } from "./constants.js";
import { normalizeBrowserVerificationRequest, resolveBrowserVerificationProvider } from "./provider.js";
import { normalizeBrowserVerificationResult } from "./normalize.js";

function error(code, message, details = null) {
  const output = new Error(message);
  output.code = code;
  output.details = details;
  return output;
}

function safeFailure(providerName) {
  return error(E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE, `Browser verification provider "${providerName}" failed.`, { provider: providerName });
}

async function bounded(promiseFactory, { controller, deadline, providerName, verificationId }) {
  const remaining = () => Math.max(0, deadline - Date.now());
  if (remaining() <= 0) throw error(E_BROWSER_VERIFICATION_TIMEOUT, `Browser verification provider "${providerName}" timed out.`, { provider: providerName, verificationId });
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(error(E_BROWSER_VERIFICATION_TIMEOUT, `Browser verification provider "${providerName}" timed out.`, { provider: providerName, verificationId })), remaining());
      Promise.resolve().then(() => promiseFactory(remaining())).then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
  }
}

function timeoutError(providerName, verificationId) {
  return error(E_BROWSER_VERIFICATION_TIMEOUT, `Browser verification provider "${providerName}" timed out.`, {
    provider: providerName,
    verificationId,
  });
}

export async function runBrowserVerification({
  target, projectPath, taskId, providerName, verificationId, requirement, startUrl, allowedOrigins,
  viewport, steps, assertions, capture, timeoutMs, runtimeContext,
} = {}) {
  const effectiveTimeoutMs = normalizeBrowserVerificationRequestOptions({ timeoutMs }).timeoutMs;
  const controller = new AbortController();
  const deadline = Date.now() + effectiveTimeoutMs;
  let normalizedRequest;
  try {
    normalizedRequest = normalizeBrowserVerificationRequest({
      target: target ?? projectPath, taskId, verificationId, requirement, startUrl, allowedOrigins,
      viewport, steps, assertions, capture, timeoutMs: effectiveTimeoutMs,
    });
  } catch (failure) {
    throw failure;
  }
  const providers = runtimeContext?.browserVerificationProviders;
  try {
    const provider = await bounded(
      (remaining) => resolveBrowserVerificationProvider(providers, providerName, {
        signal: controller.signal,
        timeoutMs: remaining,
        request: normalizedRequest,
      }),
      { controller, deadline, providerName, verificationId: normalizedRequest.verificationId },
    );
    const raw = await bounded(
      (remaining) => provider.verify({ ...normalizedRequest, signal: controller.signal, timeoutMs: remaining }),
      { controller, deadline, providerName, verificationId: normalizedRequest.verificationId },
    );
    if (controller.signal.aborted) throw error(E_BROWSER_VERIFICATION_TIMEOUT, `Browser verification provider "${providerName}" timed out.`, { provider: providerName });
    if (Date.now() >= deadline) {
      controller.abort();
      throw timeoutError(providerName, normalizedRequest.verificationId);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      controller.abort();
      throw timeoutError(providerName, normalizedRequest.verificationId);
    }
    const result = normalizeBrowserVerificationResult(raw, {
      provider, verificationId: normalizedRequest.verificationId, taskId: normalizedRequest.taskId,
      requirement: normalizedRequest.requirement, target: normalizedRequest.target,
      expectedAssertions: normalizedRequest.assertions, allowedOrigins: normalizedRequest.allowedOrigins,
    });
    if (Date.now() >= deadline) {
      controller.abort();
      throw timeoutError(providerName, normalizedRequest.verificationId);
    }
    return result;
  } catch (failure) {
    if (failure?.code === E_BROWSER_VERIFICATION_TIMEOUT) {
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 0));
      throw failure;
    }
    if ([E_BROWSER_VERIFICATION_REQUEST_INVALID, E_BROWSER_VERIFICATION_RESULT_INVALID,
      E_BROWSER_VERIFICATION_OUTPUT_LIMIT, E_BROWSER_VERIFICATION_ORIGIN_DENIED].includes(failure?.code)) throw failure;
    if (failure?.code === E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE) {
      if (failure.message.includes("not registered")) throw failure;
      throw safeFailure(providerName);
    }
    throw safeFailure(providerName);
  }
}
