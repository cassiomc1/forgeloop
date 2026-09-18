import {
  E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE,
  E_BROWSER_VERIFICATION_REQUEST_INVALID,
  E_BROWSER_VERIFICATION_TIMEOUT,
} from "../error-codes.js";
import {
  BROWSER_VERIFICATION_LIMITS,
  normalizeBrowserVerificationRequestOptions,
} from "./constants.js";
import {
  normalizeBrowserVerificationRequest,
  resolveBrowserVerificationProvider,
} from "./provider.js";
import { normalizeBrowserVerificationResult } from "./normalize.js";

function requestError(message, details) {
  const error = new Error(message);
  error.code = E_BROWSER_VERIFICATION_REQUEST_INVALID;
  error.details = details ?? null;
  return error;
}

function timeoutError(message, details) {
  const error = new Error(message);
  error.code = E_BROWSER_VERIFICATION_TIMEOUT;
  error.details = details ?? null;
  return error;
}

function resolveTimeoutMs(candidate) {
  if (candidate === undefined || candidate === null) {
    return BROWSER_VERIFICATION_LIMITS.defaultTimeoutMs;
  }
  return normalizeBrowserVerificationRequestOptions({ timeoutMs: candidate }).timeoutMs;
}

async function withTimeout(promise, timeoutMs, { providerName, verificationId }) {
  let timer = null;
  let cleanupTimer = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(
          timeoutError(`Browser verification provider "${providerName}" timed out.`, {
            provider: providerName,
            verificationId,
            timeoutMs,
          }),
        );
      }, timeoutMs);
      if (typeof timer.unref === "function") {
        timer.unref();
      }
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
      await new Promise((resolve) => {
        cleanupTimer = setTimeout(resolve, 1);
        if (typeof cleanupTimer.unref === "function") {
          cleanupTimer.unref();
        }
      });
      clearTimeout(cleanupTimer);
    }
  }
}

/**
 * Explicit browser verification invocation.
 *
 * Resolves a host-injected provider from runtime context, validates the
 * bounded request, guards provider execution with a timeout, then
 * normalizes untrusted provider output.  Never reads the clock for
 * verification semantics, never performs browser I/O in core, and never
 * mutates protocol state.
 */
export async function verifyBrowserContext({
  providerName,
  verificationId,
  requirement,
  startUrl,
  allowedOrigins,
  viewport,
  steps,
  assertions,
  capture,
  timeoutMs,
  runtimeContext,
} = {}) {
  if (typeof providerName !== "string" || providerName.trim() === "") {
    throw requestError("providerName must be a non-empty string.", { providerName });
  }
  const providers = runtimeContext?.browserVerificationProviders ?? null;
  if (!providers || typeof providers !== "object") {
    const error = new Error(
      `Browser verification provider "${providerName}" is not registered.`,
    );
    error.code = E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE;
    error.details = { provider: providerName };
    throw error;
  }

  const provider = await resolveBrowserVerificationProvider(providers, providerName);
  const normalizedRequest = normalizeBrowserVerificationRequest({
    verificationId,
    requirement,
    startUrl,
    allowedOrigins,
    viewport,
    steps,
    assertions,
    capture,
    timeoutMs,
  });
  const effectiveTimeoutMs = resolveTimeoutMs(timeoutMs);

  let raw;
  try {
    raw = await withTimeout(provider.verify(normalizedRequest), effectiveTimeoutMs, {
      providerName,
      verificationId: normalizedRequest.verificationId,
    });
  } catch (error) {
    if (error?.code === E_BROWSER_VERIFICATION_TIMEOUT) {
      throw error;
    }
    if (error?.code) {
      throw error;
    }
    const wrapped = new Error(`Browser verification provider "${providerName}" failed: ${error.message}`);
    wrapped.code = E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE;
    wrapped.details = { provider: providerName, cause: error.message };
    wrapped.cause = error;
    throw wrapped;
  }

  return normalizeBrowserVerificationResult(raw, {
    provider,
    verificationId: normalizedRequest.verificationId,
    expectedAssertions: normalizedRequest.assertions,
  });
}
