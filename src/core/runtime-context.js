import {
  E_VERIFICATION_ISOLATION_UNAVAILABLE,
  isVerificationExecutionAdapter,
  normalizeVerificationExecutionPolicy,
} from "./verification-execution.js";
import { STRUCTURAL_QUALITY_PROVIDER_ID_PATTERN } from "./structural-quality/constants.js";
import {
  E_ADVISORY_CONTEXT_PROVIDER_INVALID,
  E_BROWSER_VERIFICATION_PROVIDER_INVALID,
  E_SECURITY_REVIEW_PROVIDER_INVALID,
} from "./error-codes.js";
import { assertAdvisoryContextProviderIdentity } from "./advisory-context/provider.js";
import {
  BROWSER_VERIFICATION_PROVIDER_ID_PATTERN,
  assertBrowserVerificationProvider,
  assertBrowserVerificationProviderIdentity,
} from "./browser-verification/provider.js";
import {
  SECURITY_REVIEW_PROVIDER_ID_PATTERN,
  assertSecurityReviewProvider,
  assertSecurityReviewProviderIdentity,
} from "./security-review/provider.js";

export const AUTHORITY_TRUST_MODES = Object.freeze(["NONE", "HOST_ATTESTED"]);

const AUTHORITY_CONTEXT_FIELDS = Object.freeze([
  "trustedAuthorityFile",
  "trustedAuthorityDir",
  "authorities",
  "authority",
]);

function configuredValue(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function providerValue(provider) {
  if (typeof provider === "function") return provider();
  return provider && typeof provider === "object" && !Array.isArray(provider) ? provider : {};
}

function contextInput(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const provider = providerValue(source.trustedAuthorityProvider);
  const explicit = source.authorityContext && typeof source.authorityContext === "object"
    ? source.authorityContext
    : {};
  const { authorityContext: _authorityContext, trustedAuthorityProvider: _trustedAuthorityProvider, ...direct } = source;
  return { ...direct, ...provider, ...explicit };
}

export function hasAuthorityContext(options = {}) {
  if (!options || typeof options !== "object") return false;
  return Boolean(
    options.authorityContext
    || options.runtimeContext?.authorityContext
    || (options.runtimeContext && typeof options.runtimeContext === "object" && options.runtimeContext.trustMode),
  );
}

export function createAuthorityContext(input = {}) {
  const values = contextInput(input);
  const trustMode = values.trustMode ?? values.authorityTrustMode ?? "NONE";
  if (!AUTHORITY_TRUST_MODES.includes(trustMode)) {
    const error = new Error(`Unsupported authority trust mode: ${trustMode}`);
    error.code = "E_AUTHORITY_INVALID";
    throw error;
  }

  const context = { trustMode };
  for (const field of AUTHORITY_CONTEXT_FIELDS) {
    if (field === "trustedAuthorityFile" || field === "trustedAuthorityDir") {
      const value = configuredValue(values[field]);
      if (value !== undefined) context[field] = value;
    } else if (values[field] !== undefined) {
      context[field] = values[field];
    }
  }
  return Object.freeze(context);
}

export function resolveAuthorityContext(options = {}) {
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  if (source.authorityContext !== undefined) {
    return createAuthorityContext(source.authorityContext);
  }
  if (source.runtimeContext?.authorityContext !== undefined) {
    return createAuthorityContext(source.runtimeContext.authorityContext);
  }
  if (source.runtimeContext && typeof source.runtimeContext === "object" && source.runtimeContext.trustMode) {
    return createAuthorityContext(source.runtimeContext);
  }

  const hasDirectAuthority = AUTHORITY_CONTEXT_FIELDS.some((field) => source[field] !== undefined);
  // Direct resolver options are legacy source selectors, not a host attestation
  // channel. They remain NONE unless wrapped in an explicit runtime context.
  return hasDirectAuthority ? createAuthorityContext({ ...source, trustMode: "NONE" }) : createAuthorityContext();
}

function isProviderObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function providerEntries(configured, label, code) {
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) {
    const error = new Error(`${label} must be an object or Map`);
    error.code = code;
    throw error;
  }
  return configured instanceof Map ? [...configured.entries()] : Object.entries(configured);
}

function registerProviders(configured, { label, code, idError, validateId, providerError, validateProvider }) {
  const providers = {};
  for (const [id, provider] of providerEntries(configured, label, code)) {
    if (!validateId(id)) {
      const error = new Error(idError(id));
      error.code = code;
      throw error;
    }
    if (typeof provider !== "function" && !isProviderObject(provider)) {
      const error = new Error(providerError(id));
      error.code = code;
      throw error;
    }
    if (typeof provider !== "function") validateProvider(provider, id);
    providers[id] = provider;
  }
  return Object.freeze(providers);
}

function configureUsageProvider(context, provider) {
  if (!provider
    || typeof provider !== "object"
    || Array.isArray(provider)
    || typeof provider.getTaskUsage !== "function") {
    const error = new Error("Usage provider must expose getTaskUsage({ projectPath, taskId })");
    error.code = "E_USAGE_INVALID";
    throw error;
  }
  context.usageProvider = provider;
}

function configureStructuralQualityProviders(context, configured) {
  context.structuralQualityProviders = registerProviders(configured, {
    label: "structuralQualityProviders",
    code: "E_STRUCTURAL_QUALITY_PROVIDER_INVALID",
    idError: id => `Invalid or reserved structural-quality provider ID: ${id}`,
    validateId: id => STRUCTURAL_QUALITY_PROVIDER_ID_PATTERN.test(id) && id !== "sentrux",
    providerError: id => `Structural-quality provider ${id} must be an object or factory`,
    validateProvider: (provider, id) => {},
  });
}

function configureAdvisoryContextProviders(context, configured) {
  context.advisoryContextProviders = registerProviders(configured, {
    label: "advisoryContextProviders",
    code: E_ADVISORY_CONTEXT_PROVIDER_INVALID,
    idError: id => `Invalid advisory-context provider ID: ${id}`,
    validateId: id => /^[a-z0-9][a-z0-9_-]*$/.test(id),
    providerError: id => `Advisory-context provider ${id} must be an object or factory`,
    validateProvider: assertAdvisoryContextProviderIdentity,
  });
}

function configureBrowserVerificationProviders(context, configured) {
  context.browserVerificationProviders = registerProviders(configured, {
    label: "browserVerificationProviders",
    code: E_BROWSER_VERIFICATION_PROVIDER_INVALID,
    idError: id => `Invalid browser-verification provider ID: ${id}`,
    validateId: id => BROWSER_VERIFICATION_PROVIDER_ID_PATTERN.test(id),
    providerError: id => `Browser-verification provider ${id} must be an object with verify() or a factory`,
    validateProvider: (provider, id) => {
      assertBrowserVerificationProviderIdentity(provider, { expectedId: id });
      assertBrowserVerificationProvider(provider, { label: `browser-verification provider "${id}"` });
    },
  });
}

function configureSecurityReviewProviders(context, configured) {
  context.securityReviewProviders = registerProviders(configured, {
    label: "securityReviewProviders",
    code: E_SECURITY_REVIEW_PROVIDER_INVALID,
    idError: id => `Invalid security-review provider ID: ${id}`,
    validateId: id => SECURITY_REVIEW_PROVIDER_ID_PATTERN.test(id),
    providerError: id => `Security-review provider ${id} must be an object with review() or a factory`,
    validateProvider: (provider, id) => {
      assertSecurityReviewProviderIdentity(provider, { expectedId: id });
      assertSecurityReviewProvider(provider, { label: `security-review provider "${id}"` });
    },
  });
}

export function createForgeLoopContext(options = {}) {
  const authorityContext = createAuthorityContext(options);
  const context = { authorityContext };
  if (options?.verificationExecutionAdapter !== undefined) {
    if (!isVerificationExecutionAdapter(options.verificationExecutionAdapter)) {
      const error = new Error("Verification execution adapter is unavailable or invalid");
      error.code = E_VERIFICATION_ISOLATION_UNAVAILABLE;
      throw error;
    }
    context.verificationExecutionAdapter = options.verificationExecutionAdapter;
  }
  if (options?.verificationExecutionPolicy !== undefined) {
    context.verificationExecutionPolicy = normalizeVerificationExecutionPolicy(options.verificationExecutionPolicy);
  }
  if (options?.usageProvider !== undefined) {
    configureUsageProvider(context, options.usageProvider);
  }
  if (options?.structuralQualityProviders !== undefined) {
    configureStructuralQualityProviders(context, options.structuralQualityProviders);
  }
  if (options?.advisoryContextProviders !== undefined) {
    configureAdvisoryContextProviders(context, options.advisoryContextProviders);
  }
  if (options?.browserVerificationProviders !== undefined) {
    configureBrowserVerificationProviders(context, options.browserVerificationProviders);
  }
  if (options?.securityReviewProviders !== undefined) {
    configureSecurityReviewProviders(context, options.securityReviewProviders);
  }
  return Object.freeze(context);
}
