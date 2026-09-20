import {
  E_SECURITY_REVIEW_PROVIDER_INVALID,
  E_SECURITY_REVIEW_PROVIDER_UNAVAILABLE,
} from "../error-codes.js";
import { assertPortableContextSafe, deepFreeze, normalizePortableText } from "../portable-context.js";
import {
  SECURITY_REVIEW_CATEGORIES,
  SECURITY_REVIEW_LIMITS,
  SECURITY_REVIEW_SCOPES,
  securityReviewRequestError,
} from "./constants.js";

export const SECURITY_REVIEW_PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;

function providerError(message, details = null) {
  const error = new Error(message);
  error.code = E_SECURITY_REVIEW_PROVIDER_INVALID;
  error.details = details;
  return error;
}

function unavailableError(message, details = null) {
  const error = new Error(message);
  error.code = E_SECURITY_REVIEW_PROVIDER_UNAVAILABLE;
  error.details = details;
  return error;
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw securityReviewRequestError(`${label} must be a plain object.`);
  }
  return value;
}

function rejectUnknown(source, allowed, label) {
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      throw securityReviewRequestError(`${label}.${String(key)} is not supported.`, { field: String(key) });
    }
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor || descriptor.get || descriptor.set) {
      throw securityReviewRequestError(`${label}.${key} must not be an accessor.`, { field: key });
    }
  }
}

function text(label, value, maxLength, { optional = false } = {}) {
  try {
    return normalizePortableText(value, { label, maxLength, optional });
  } catch (error) {
    throw securityReviewRequestError(`${label} is invalid: ${error.message}`);
  }
}

function normalizeRelativePath(value, index) {
  const path = text(`paths[${index}]`, value, SECURITY_REVIEW_LIMITS.maxPathChars);
  if (path.startsWith("/") || /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\")
    || /^file:/i.test(path) || path.split(/[\\/]+/).includes("..")) {
    throw securityReviewRequestError(`paths[${index}] must be a project-relative non-escaping path.`);
  }
  const normalized = path.replaceAll("\\", "/");
  if (normalized === "." || normalized.endsWith("/") || normalized.includes("//")) {
    throw securityReviewRequestError(`paths[${index}] must identify a normalized project-relative path.`);
  }
  return normalized;
}

function normalizeStringList(value, { label, maxItems, maxChars, allowed = null } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw securityReviewRequestError(`${label} must be an array with at most ${maxItems} items.`);
  }
  const result = value.map((entry, index) => {
    const normalized = text(`${label}[${index}]`, entry, maxChars);
    if (allowed && !allowed.includes(normalized)) {
      throw securityReviewRequestError(`${label}[${index}] is unsupported.`);
    }
    return normalized;
  });
  if (new Set(result).size !== result.length) throw securityReviewRequestError(`${label} must not contain duplicates.`);
  return result;
}

function normalizeTimeout(value) {
  if (value === undefined || value === null) return SECURITY_REVIEW_LIMITS.defaultTimeoutMs;
  if (!Number.isInteger(value) || value < 1) throw securityReviewRequestError("timeoutMs must be a positive integer.");
  return Math.min(value, SECURITY_REVIEW_LIMITS.maxTimeoutMs);
}

function normalizeRevision(value) {
  if (value === undefined || value === null) return undefined;
  const source = assertPlainObject(value, "revision");
  rejectUnknown(source, ["base", "head"], "revision");
  const base = text("revision.base", source.base, SECURITY_REVIEW_LIMITS.maxRevisionChars, { optional: true });
  const head = text("revision.head", source.head, SECURITY_REVIEW_LIMITS.maxRevisionChars, { optional: true });
  if (base === undefined && head === undefined) throw securityReviewRequestError("revision must contain base or head.");
  return deepFreeze({ ...(base === undefined ? {} : { base }), ...(head === undefined ? {} : { head }) });
}

export function normalizeSecurityReviewRequest(input) {
  const source = assertPlainObject(input, "security review request");
  rejectUnknown(source, ["projectPath", "taskId", "reviewId", "scope", "paths", "categories", "requirements", "revision", "timeoutMs"], "security review request");
  const projectPath = text("projectPath", source.projectPath, SECURITY_REVIEW_LIMITS.maxProjectPathChars);
  const taskId = text("taskId", source.taskId, SECURITY_REVIEW_LIMITS.maxTaskIdChars);
  const reviewId = text("reviewId", source.reviewId, SECURITY_REVIEW_LIMITS.maxReviewIdChars);
  const scope = text("scope", source.scope, 32);
  if (!SECURITY_REVIEW_SCOPES.includes(scope)) throw securityReviewRequestError("scope is unsupported.");
  const paths = normalizeStringList(source.paths, {
    label: "paths", maxItems: SECURITY_REVIEW_LIMITS.maxPaths, maxChars: SECURITY_REVIEW_LIMITS.maxPathChars,
  }).map((value, index) => normalizeRelativePath(value, index));
  if (scope === "SELECTED" && paths.length === 0) throw securityReviewRequestError("SELECTED scope requires at least one path.");
  const categories = normalizeStringList(source.categories, {
    label: "categories", maxItems: SECURITY_REVIEW_LIMITS.maxCategories,
    maxChars: SECURITY_REVIEW_LIMITS.maxCategoryChars, allowed: SECURITY_REVIEW_CATEGORIES,
  });
  const requirements = normalizeStringList(source.requirements, {
    label: "requirements", maxItems: SECURITY_REVIEW_LIMITS.maxRequirements,
    maxChars: SECURITY_REVIEW_LIMITS.maxRequirementChars,
  });
  const normalized = {
    projectPath, taskId, reviewId, scope,
    paths: Object.freeze(paths),
    categories: Object.freeze(categories),
    requirements: Object.freeze(requirements),
    timeoutMs: normalizeTimeout(source.timeoutMs),
    ...(source.revision === undefined || source.revision === null ? {} : { revision: normalizeRevision(source.revision) }),
  };
  try {
    assertPortableContextSafe(normalized, { label: "security review request" });
  } catch (error) {
    throw securityReviewRequestError(`security review request failed safety verification: ${error.message}`);
  }
  return deepFreeze(normalized);
}

function assertProviderDataProperties(provider, label) {
  for (const key of ["id", "version", "review"]) {
    const descriptor = Object.getOwnPropertyDescriptor(provider, key);
    if (descriptor?.get || descriptor?.set) throw providerError(`${label}.${key} must not be an accessor.`);
  }
}

export function assertSecurityReviewProvider(provider, { label = "security-review provider" } = {}) {
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    throw providerError(`${label} must be an object.`);
  }
  assertProviderDataProperties(provider, label);
  if (typeof provider.id !== "string" || !SECURITY_REVIEW_PROVIDER_ID_PATTERN.test(provider.id)) {
    throw providerError(`${label}.id is invalid.`, { id: provider.id });
  }
  if (typeof provider.review !== "function") throw providerError(`${label}.review must be a function.`);
  if (provider.version !== undefined && typeof provider.version !== "string") {
    throw providerError(`${label}.version must be a string when present.`);
  }
  return provider;
}

export function assertSecurityReviewProviderIdentity(providerIdentity, { label = "security-review provider identity", expectedId } = {}) {
  if (!providerIdentity || typeof providerIdentity !== "object" || Array.isArray(providerIdentity)) {
    throw providerError(`${label} must be an object.`);
  }
  if (typeof providerIdentity.id !== "string" || !SECURITY_REVIEW_PROVIDER_ID_PATTERN.test(providerIdentity.id)) {
    throw providerError(`${label}.id is invalid.`);
  }
  if (expectedId !== undefined && providerIdentity.id !== expectedId) {
    throw providerError(`${label}.id must match registry key "${expectedId}".`);
  }
  return deepFreeze({ id: providerIdentity.id, ...(providerIdentity.version === undefined ? {} : { version: providerIdentity.version }) });
}

export function assertSecurityReviewProviderRegistration(provider, expectedId, options = {}) {
  const validated = assertSecurityReviewProvider(provider, options);
  if (validated.id !== expectedId) throw providerError(`Provider id "${validated.id}" does not match registry key "${expectedId}".`);
  return validated;
}

export function createSecurityReviewProviderRegistry(providers = {}) {
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    throw providerError("Security-review provider registry source must be an object or Map.");
  }
  const entries = providers instanceof Map ? [...providers.entries()] : Object.entries(providers);
  const registry = {};
  for (const [name, provider] of entries) {
    if (typeof name !== "string" || !SECURITY_REVIEW_PROVIDER_ID_PATTERN.test(name)) {
      throw providerError(`Invalid security-review provider ID: ${name}.`);
    }
    if (typeof provider === "function") registry[name] = provider;
    else registry[name] = assertSecurityReviewProviderRegistration(provider, name, { label: `security-review provider "${name}"` });
  }
  return deepFreeze({ ...registry });
}

export async function resolveSecurityReviewProvider(providers, name, input = {}) {
  if (typeof name !== "string" || !SECURITY_REVIEW_PROVIDER_ID_PATTERN.test(name)) {
    throw unavailableError("Security-review provider name is invalid.", { name });
  }
  const registry = providers ?? {};
  const entry = registry instanceof Map ? registry.get(name) : registry[name];
  if (!entry) throw unavailableError(`Security-review provider "${name}" is not registered.`, { name });
  const provider = typeof entry === "function" ? await entry(input) : entry;
  return assertSecurityReviewProviderRegistration(provider, name, { label: `security-review provider "${name}"` });
}
