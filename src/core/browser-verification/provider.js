import {
  E_BROWSER_VERIFICATION_PROVIDER_INVALID,
  E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE,
  E_BROWSER_VERIFICATION_REQUEST_INVALID,
} from "../error-codes.js";
import {
  assertPortableContextSafe,
  deepFreeze,
  normalizePortableText,
} from "../portable-context.js";
import {
  BROWSER_VERIFICATION_ASSERTION_KINDS,
  BROWSER_VERIFICATION_ASSERTION_STATUSES,
  BROWSER_VERIFICATION_CAPTURE_POLICIES,
  BROWSER_VERIFICATION_LIMITS,
  BROWSER_VERIFICATION_LOCATOR_KINDS,
  BROWSER_VERIFICATION_STEP_KINDS,
  BROWSER_VERIFICATION_WAIT_CONDITIONS,
  normalizeBrowserVerificationRequestOptions,
} from "./constants.js";

export const BROWSER_VERIFICATION_PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;

function requestError(message, details) {
  const error = new Error(message);
  error.code = E_BROWSER_VERIFICATION_REQUEST_INVALID;
  error.details = details ?? null;
  return error;
}

function providerError(message, details) {
  const error = new Error(message);
  error.code = E_BROWSER_VERIFICATION_PROVIDER_INVALID;
  error.details = details ?? null;
  return error;
}

function unavailableError(message, details) {
  const error = new Error(message);
  error.code = E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE;
  error.details = details ?? null;
  return error;
}

function toPortable(label, value, maxLength, { optional = false } = {}) {
  try {
    return normalizePortableText(value, { label, maxLength, optional });
  } catch (error) {
    throw requestError(`${label} is invalid: ${error.message}`, { [label]: value });
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw requestError(`${label} must be an object.`, { [label]: value });
  }
  return value;
}

function rejectUnknown(source, allowed, label) {
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      throw requestError(`${label}.${String(key)} is not supported.`, { field: String(key) });
    }
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor || descriptor.get || descriptor.set) {
      throw requestError(`${label}.${key} must not be an accessor.`, { field: key });
    }
  }
}

function assertBoundedUrl(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw requestError(`${label} must be a non-empty http(s) URL.`, { [label]: value });
  }
  if (value.length > BROWSER_VERIFICATION_LIMITS.maxUrlChars) {
    throw requestError(`${label} exceeds the ${BROWSER_VERIFICATION_LIMITS.maxUrlChars}-character limit.`, {
      [label]: value,
    });
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw requestError(`${label} must be a valid http(s) URL.`, { [label]: value });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw requestError(`${label} must use http or https.`, { [label]: value });
  }
  if (url.username !== "" || url.password !== "") {
    throw requestError(`${label} must not include credentials (userinfo).`, { [label]: value });
  }
  return value;
}

function assertHttpsOrigin(origin, index) {
  if (typeof origin !== "string" || origin.trim() === "") {
    throw requestError(`allowedOrigins[${index}] must be a non-empty http(s) origin.`, {
      origin,
    });
  }
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw requestError(`allowedOrigins[${index}] must be a valid http(s) origin.`, { origin });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw requestError(`allowedOrigins[${index}] must use http or https.`, { origin });
  }
  if (url.username !== "" || url.password !== "") {
    throw requestError(`allowedOrigins[${index}] must not include credentials (userinfo).`, { origin });
  }
  if (url.search !== "" || url.hash !== "") {
    throw requestError(`allowedOrigins[${index}] must not include query or fragment.`, { origin });
  }
  if (url.pathname !== "" && url.pathname !== "/") {
    throw requestError(`allowedOrigins[${index}] must not include a path.`, { origin });
  }
  const hostname = url.hostname;
  if (hostname.endsWith(".")) {
    throw requestError(`allowedOrigins[${index}] must not have a trailing dot.`, { origin });
  }
  if (hostname.length === 0 || hostname.length > 253) {
    throw requestError(`allowedOrigins[${index}] has an invalid hostname.`, { origin });
  }
  if (url.hostname.includes("[") || url.hostname.includes("]")) {
    throw requestError(`allowedOrigins[${index}] must be a hostname, not an IP-literal bracket form.`, { origin });
  }
  const labels = hostname.split(".");
  for (const label of labels) {
    if (label.length === 0 || label.length > 63 || !/^[a-z0-9-]+$/i.test(label)) {
      throw requestError(`allowedOrigins[${index}] has an invalid hostname label.`, { origin });
    }
    if (label.startsWith("-") || label.endsWith("-")) {
      throw requestError(`allowedOrigins[${index}] has an invalid hostname label.`, { origin });
    }
  }
  const scheme = url.protocol === "https:" ? "https" : "http";
  return `${scheme}://${hostname.toLowerCase()}${url.port === "" ? "" : `:${url.port}`}`;
}

function normalizeAllowedOrigins(allowedOrigins) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    throw requestError("allowedOrigins must be a non-empty array.", { allowedOrigins });
  }
  if (allowedOrigins.length > BROWSER_VERIFICATION_LIMITS.maxAllowedOrigins) {
    throw requestError(
      `allowedOrigins exceeds the ${BROWSER_VERIFICATION_LIMITS.maxAllowedOrigins}-origin limit.`,
      { count: allowedOrigins.length },
    );
  }
  const normalized = allowedOrigins.map((origin, index) => assertHttpsOrigin(origin, index));
  const unique = [...new Set(normalized)];
  if (unique.length !== normalized.length) {
    throw requestError("allowedOrigins must not contain duplicates.", { allowedOrigins });
  }
  return unique;
}

function assertHttpOrHttpsUrl(value, label, { allowedOrigins = null } = {}) {
  const result = assertBoundedUrl(value, label);
  if (allowedOrigins !== null) {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const origin = `${url.protocol}//${hostname}${url.port === "" ? "" : `:${url.port}`}`;
    if (!allowedOrigins.includes(origin)) {
      throw requestError(`${label} origin is not in allowedOrigins.`, { [label]: value });
    }
  }
  return result;
}

function normalizeLocator(locator, label) {
  const source = assertPlainObject(locator, label);
  rejectUnknown(source, ["kind", "value"], label);
  if (!BROWSER_VERIFICATION_LOCATOR_KINDS.includes(source.kind)) {
    throw requestError(`${label}.kind must be a supported locator kind.`, { kind: source.kind });
  }
  const value = toPortable(`${label}.value`, source.value, BROWSER_VERIFICATION_LIMITS.maxLocatorChars);
  return deepFreeze({ kind: source.kind, value });
}

function normalizeStep(step, index, allowedOrigins) {
  const source = assertPlainObject(step, `steps[${index}]`);
  rejectUnknown(source, ["id", "kind", "url", "locator", "text", "key", "condition", "expected"], `steps[${index}]`);
  const id = toPortable(`steps[${index}].id`, source.id, BROWSER_VERIFICATION_LIMITS.maxStepIdChars);
  if (!BROWSER_VERIFICATION_STEP_KINDS.includes(source.kind)) {
    throw requestError(`steps[${index}].kind must be a supported step kind.`, { kind: source.kind });
  }
  const normalized = { id, kind: source.kind };
  if (source.kind === "NAVIGATE") {
    if (source.url === undefined || source.url === null) {
      throw requestError(`steps[${index}].url is required for NAVIGATE.`, { step: source });
    }
    normalized.url = assertHttpOrHttpsUrl(source.url, `steps[${index}].url`, { allowedOrigins });
  } else if (source.kind === "CLICK") {
    if (source.locator === undefined || source.locator === null) {
      throw requestError(`steps[${index}].locator is required for CLICK.`, { step: source });
    }
    normalized.locator = normalizeLocator(source.locator, `steps[${index}].locator`);
  } else if (source.kind === "FILL") {
    if (source.locator === undefined || source.locator === null) {
      throw requestError(`steps[${index}].locator is required for FILL.`, { step: source });
    }
    normalized.locator = normalizeLocator(source.locator, `steps[${index}].locator`);
    normalized.text = toPortable(`steps[${index}].text`, source.text, BROWSER_VERIFICATION_LIMITS.maxInputChars);
  } else if (source.kind === "PRESS") {
    if (source.locator === undefined || source.locator === null) {
      throw requestError(`steps[${index}].locator is required for PRESS.`, { step: source });
    }
    normalized.locator = normalizeLocator(source.locator, `steps[${index}].locator`);
    normalized.key = toPortable(`steps[${index}].key`, source.key, BROWSER_VERIFICATION_LIMITS.maxInputChars);
  } else if (source.kind === "WAIT_FOR") {
    if (source.condition === undefined || source.condition === null) {
      throw requestError(`steps[${index}].condition is required for WAIT_FOR.`, { step: source });
    }
    if (!BROWSER_VERIFICATION_WAIT_CONDITIONS.includes(source.condition)) {
      throw requestError(`steps[${index}].condition must be a supported wait condition.`, {
        condition: source.condition,
      });
    }
    normalized.condition = source.condition;
    if (source.locator !== undefined && source.locator !== null) {
      normalized.locator = normalizeLocator(source.locator, `steps[${index}].locator`);
    }
    if (source.expected !== undefined && source.expected !== null) {
      normalized.expected = toPortable(
        `steps[${index}].expected`,
        source.expected,
        BROWSER_VERIFICATION_LIMITS.maxExpectedChars,
      );
    }
  }
  return deepFreeze(normalized);
}

function normalizeAssertion(assertion, index, allowedOrigins) {
  const source = assertPlainObject(assertion, `assertions[${index}]`);
  rejectUnknown(source, ["id", "kind", "locator", "attribute", "expected"], `assertions[${index}]`);
  const id = toPortable(
    `assertions[${index}].id`,
    source.id,
    BROWSER_VERIFICATION_LIMITS.maxAssertionIdChars,
  );
  if (!BROWSER_VERIFICATION_ASSERTION_KINDS.includes(source.kind)) {
    throw requestError(`assertions[${index}].kind must be a supported assertion kind.`, {
      kind: source.kind,
    });
  }
  if (
    source.status !== undefined &&
    source.status !== null &&
    !BROWSER_VERIFICATION_ASSERTION_STATUSES.includes(source.status)
  ) {
    throw requestError(`assertions[${index}].status must be a supported assertion status.`, {
      status: source.status,
    });
  }
  const normalized = { id, kind: source.kind };
  if (["VISIBLE", "HIDDEN", "TEXT_CONTAINS", "TEXT_EQUALS", "VALUE_EQUALS", "ATTRIBUTE_EQUALS"].includes(source.kind)) {
    if (source.locator === undefined || source.locator === null) {
      throw requestError(`assertions[${index}].locator is required for ${source.kind}.`, {
        assertion: source,
      });
    }
    normalized.locator = normalizeLocator(source.locator, `assertions[${index}].locator`);
  }
  if (["TEXT_CONTAINS", "TEXT_EQUALS", "VALUE_EQUALS", "TITLE_EQUALS"].includes(source.kind)) {
    if (source.expected === undefined || source.expected === null) {
      throw requestError(`assertions[${index}].expected is required for ${source.kind}.`, {
        assertion: source,
      });
    }
    normalized.expected = toPortable(
      `assertions[${index}].expected`,
      source.expected,
      BROWSER_VERIFICATION_LIMITS.maxExpectedChars,
    );
  }
  if (source.kind === "ATTRIBUTE_EQUALS") {
    normalized.attribute = toPortable(
      `assertions[${index}].attribute`,
      source.attribute,
      BROWSER_VERIFICATION_LIMITS.maxAttributeChars,
    );
    if (source.expected === undefined || source.expected === null) {
      throw requestError(`assertions[${index}].expected is required for ATTRIBUTE_EQUALS.`, {
        assertion: source,
      });
    }
    normalized.expected = toPortable(
      `assertions[${index}].expected`,
      source.expected,
      BROWSER_VERIFICATION_LIMITS.maxExpectedChars,
    );
  }
  if (source.kind === "URL_IS" || source.kind === "URL_PREFIX") {
    if (source.expected === undefined || source.expected === null) {
      throw requestError(`assertions[${index}].expected is required for ${source.kind}.`, {
        assertion: source,
      });
    }
    const expected = toPortable(
      `assertions[${index}].expected`,
      source.expected,
      BROWSER_VERIFICATION_LIMITS.maxUrlChars,
    );
    assertHttpOrHttpsUrl(expected, `assertions[${index}].expected`, { allowedOrigins });
    normalized.expected = expected;
  }
  return deepFreeze(normalized);
}

/**
 * Validate and freeze a browser verification request.
 */
export function normalizeBrowserVerificationRequest(input) {
  const source = assertPlainObject(input, "browser verification request");
  rejectUnknown(source, [
    "verificationId", "taskId", "target", "projectPath", "requirement", "startUrl", "allowedOrigins",
    "viewport", "steps", "assertions", "capture", "timeoutMs",
  ], "browser verification request");
  const verificationId = toPortable(
    "verificationId",
    source.verificationId,
    BROWSER_VERIFICATION_LIMITS.maxVerificationIdChars,
  );
  const taskId = toPortable("taskId", source.taskId, BROWSER_VERIFICATION_LIMITS.maxVerificationIdChars);
  const target = toPortable("target", source.target ?? source.projectPath, BROWSER_VERIFICATION_LIMITS.maxUrlChars);
  const requirement = toPortable(
    "requirement",
    source.requirement,
    BROWSER_VERIFICATION_LIMITS.maxRequirementChars,
  );
  const allowedOrigins = normalizeAllowedOrigins(source.allowedOrigins);
  const startUrl = assertHttpOrHttpsUrl(source.startUrl, "startUrl", { allowedOrigins });

  let viewport;
  if (source.viewport !== undefined && source.viewport !== null) {
    const candidate = assertPlainObject(source.viewport, "viewport");
    rejectUnknown(candidate, ["width", "height"], "viewport");
    if (!Number.isInteger(candidate.width) || candidate.width <= 0 || candidate.width > BROWSER_VERIFICATION_LIMITS.maxViewportWidth
      || !Number.isInteger(candidate.height) || candidate.height <= 0 || candidate.height > BROWSER_VERIFICATION_LIMITS.maxViewportHeight) {
      throw requestError("viewport width and height must be positive integers within the viewport limits.", { viewport: candidate });
    }
    viewport = deepFreeze({ width: candidate.width, height: candidate.height });
  }

  let capture;
  if (source.capture !== undefined && source.capture !== null) {
    const candidate = assertPlainObject(source.capture, "capture");
    rejectUnknown(candidate, ["screenshot"], "capture");
    if (!BROWSER_VERIFICATION_CAPTURE_POLICIES.includes(candidate.screenshot)) {
      throw requestError("capture.screenshot must be a supported capture policy.", { screenshot: candidate.screenshot });
    }
    capture = deepFreeze({ screenshot: candidate.screenshot });
  }

  if (!Array.isArray(source.steps) || source.steps.length === 0) {
    throw requestError("steps must be a non-empty array.", { steps: source.steps });
  }
  if (source.steps.length > BROWSER_VERIFICATION_LIMITS.maxSteps) {
    throw requestError(
      `steps exceeds the ${BROWSER_VERIFICATION_LIMITS.maxSteps}-step limit.`,
      { count: source.steps.length },
    );
  }
  const steps = source.steps.map((step, index) => normalizeStep(step, index, allowedOrigins));
  const stepIds = steps.map((step) => step.id);
  if (new Set(stepIds).size !== stepIds.length) {
    throw requestError("steps must not contain duplicate ids.", { steps: source.steps });
  }

  if (!Array.isArray(source.assertions) || source.assertions.length === 0) {
    throw requestError("assertions must be a non-empty array.", { assertions: source.assertions });
  }
  if (source.assertions.length > BROWSER_VERIFICATION_LIMITS.maxAssertions) {
    throw requestError(
      `assertions exceeds the ${BROWSER_VERIFICATION_LIMITS.maxAssertions}-assertion limit.`,
      { count: source.assertions.length },
    );
  }
  const assertions = source.assertions.map((assertion, index) =>
    normalizeAssertion(assertion, index, allowedOrigins),
  );
  const assertionIds = assertions.map((assertion) => assertion.id);
  if (new Set(assertionIds).size !== assertionIds.length) {
    throw requestError("assertions must not contain duplicate ids.", { assertions: source.assertions });
  }

  const { timeoutMs } = normalizeBrowserVerificationRequestOptions({ timeoutMs: source.timeoutMs });

  const normalized = {
    verificationId,
    taskId,
    target,
    requirement,
    startUrl,
    allowedOrigins: Object.freeze([...allowedOrigins]),
    steps: Object.freeze([...steps]),
    assertions: Object.freeze([...assertions]),
    timeoutMs,
    ...(viewport ? { viewport } : {}),
    ...(capture ? { capture } : {}),
  };
  try {
    assertPortableContextSafe(normalized, { label: "browser verification request" });
  } catch (error) {
    throw requestError(`browser verification request failed safety verification: ${error.message}`, {
      cause: error.message,
    });
  }
  return deepFreeze(normalized);
}

export function assertBrowserVerificationProvider(provider, { label = "browser verification provider" } = {}) {
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    throw providerError(`${label} must be an object.`, { provider });
  }
  if (typeof provider.id !== "string" || !BROWSER_VERIFICATION_PROVIDER_ID_PATTERN.test(provider.id)) {
    throw providerError(`${label}.id must match [a-z0-9-], start/end alphanumeric, max 64 chars.`, {
      id: provider?.id,
    });
  }
  if (typeof provider.verify !== "function") {
    throw providerError(`${label}.verify must be a function.`, { id: provider.id });
  }
  if (provider.version !== undefined && typeof provider.version !== "string") {
    throw providerError(`${label}.version must be a string when present.`, {
      version: provider.version,
    });
  }
  return provider;
}

export function assertBrowserVerificationProviderIdentity(providerIdentity, { label = "browser verification provider identity", expectedId } = {}) {
  if (!providerIdentity || typeof providerIdentity !== "object") {
    throw providerError(`${label} must be an object.`, { providerIdentity });
  }
  if (
    typeof providerIdentity.id !== "string" ||
    !BROWSER_VERIFICATION_PROVIDER_ID_PATTERN.test(providerIdentity.id)
  ) {
    throw providerError(`${label}.id must match [a-z0-9-], start/end alphanumeric, max 64 chars.`, {
      id: providerIdentity?.id,
    });
  }
  if (expectedId !== undefined && providerIdentity.id !== expectedId) {
    throw providerError(`${label}.id must match registry key "${expectedId}".`, {
      id: providerIdentity.id,
      expectedId,
    });
  }
  return deepFreeze({ id: providerIdentity.id });
}

export function assertBrowserVerificationProviderRegistration(provider, expectedId, options = {}) {
  const validated = assertBrowserVerificationProvider(provider, options);
  if (validated.id !== expectedId) {
    throw providerError(`Provider id "${validated.id}" does not match requested registry key "${expectedId}".`, {
      id: validated.id,
      expectedId,
    });
  }
  return validated;
}

export function createBrowserVerificationProviderRegistry(providers = {}) {
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    throw providerError("Browser verification provider registry source must be an object.", {
      providers,
    });
  }
  const registry = {};
  const entries = providers instanceof Map ? [...providers.entries()] : Object.entries(providers);
  for (const [name, provider] of entries) {
    if (typeof name !== "string" || !BROWSER_VERIFICATION_PROVIDER_ID_PATTERN.test(name)) {
      throw providerError(`Invalid browser verification provider ID: ${name}.`, { name });
    }
    if (typeof provider === "function") {
      registry[name] = provider;
      continue;
    }
    assertBrowserVerificationProviderRegistration(provider, name, { label: `browser verification provider "${name}"` });
    registry[name] = provider;
  }
  return deepFreeze({ ...registry });
}

export async function resolveBrowserVerificationProvider(providers, name, input = {}) {
  if (typeof name !== "string" || name.trim() === "") {
    throw unavailableError("Browser verification provider name must be a non-empty string.", { name });
  }
  const registry = providers ?? {};
  const entry = registry instanceof Map ? registry.get(name) : registry[name];
  if (!entry) {
    throw unavailableError(`Browser verification provider "${name}" is not registered.`, { name });
  }
  const provider = typeof entry === "function" ? await entry(input) : entry;
  return assertBrowserVerificationProviderRegistration(provider, name, {
    label: `browser verification provider "${name}"`,
  });
}
