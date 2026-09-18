import {
  E_VERIFICATION_ISOLATION_UNAVAILABLE,
  isVerificationExecutionAdapter,
  normalizeVerificationExecutionPolicy,
} from "./verification-execution.js";
import { STRUCTURAL_QUALITY_PROVIDER_ID_PATTERN } from "./structural-quality/constants.js";
import { E_ADVISORY_CONTEXT_PROVIDER_INVALID, E_BROWSER_VERIFICATION_PROVIDER_INVALID } from "./error-codes.js";
import { assertAdvisoryContextProviderIdentity } from "./advisory-context/provider.js";
import {
  BROWSER_VERIFICATION_PROVIDER_ID_PATTERN,
  assertBrowserVerificationProvider,
  assertBrowserVerificationProviderIdentity,
} from "./browser-verification/provider.js";

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
    if (!options.usageProvider
      || typeof options.usageProvider !== "object"
      || Array.isArray(options.usageProvider)
      || typeof options.usageProvider.getTaskUsage !== "function") {
      const error = new Error("Usage provider must expose getTaskUsage({ projectPath, taskId })");
      error.code = "E_USAGE_INVALID";
      throw error;
    }
    context.usageProvider = options.usageProvider;
  }
  if (options?.structuralQualityProviders !== undefined) {
    const configured = options.structuralQualityProviders instanceof Map
      ? Object.fromEntries(options.structuralQualityProviders.entries())
      : options.structuralQualityProviders;
    if (!configured || typeof configured !== "object" || Array.isArray(configured)) {
      const error = new Error("structuralQualityProviders must be an object or Map");
      error.code = "E_STRUCTURAL_QUALITY_PROVIDER_INVALID";
      throw error;
    }
    const providers = {};
    for (const [id, provider] of Object.entries(configured)) {
      if (!STRUCTURAL_QUALITY_PROVIDER_ID_PATTERN.test(id) || id === "sentrux") {
        const error = new Error(`Invalid or reserved structural-quality provider ID: ${id}`);
        error.code = "E_STRUCTURAL_QUALITY_PROVIDER_INVALID";
        throw error;
      }
      if (typeof provider !== "function"
        && (!provider || typeof provider !== "object" || Array.isArray(provider))) {
        const error = new Error(`Structural-quality provider ${id} must be an object or factory`);
        error.code = "E_STRUCTURAL_QUALITY_PROVIDER_INVALID";
        throw error;
      }
      providers[id] = provider;
    }
    context.structuralQualityProviders = Object.freeze(providers);
  }
  if (options?.advisoryContextProviders !== undefined) {
    const configured = options.advisoryContextProviders instanceof Map
      ? Object.fromEntries(options.advisoryContextProviders.entries())
      : options.advisoryContextProviders;
    if (!configured || typeof configured !== "object" || Array.isArray(configured)) {
      const error = new Error("advisoryContextProviders must be an object or Map");
      error.code = E_ADVISORY_CONTEXT_PROVIDER_INVALID;
      throw error;
    }
    const providers = {};
    for (const [id, provider] of Object.entries(configured)) {
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
        const error = new Error(`Invalid advisory-context provider ID: ${id}`);
        error.code = E_ADVISORY_CONTEXT_PROVIDER_INVALID;
        throw error;
      }
      if (typeof provider !== "function"
        && (!provider || typeof provider !== "object" || Array.isArray(provider))) {
        const error = new Error(`Advisory-context provider ${id} must be an object or factory`);
        error.code = E_ADVISORY_CONTEXT_PROVIDER_INVALID;
        throw error;
      }
      if (typeof provider !== "function") {
        assertAdvisoryContextProviderIdentity(provider, id);
      }
      providers[id] = provider;
    }
    context.advisoryContextProviders = Object.freeze(providers);
  }
  if (options?.browserVerificationProviders !== undefined) {
    const configured = options.browserVerificationProviders instanceof Map
      ? Object.fromEntries(options.browserVerificationProviders.entries())
      : options.browserVerificationProviders;
    if (!configured || typeof configured !== "object" || Array.isArray(configured)) {
      const error = new Error("browserVerificationProviders must be an object or Map");
      error.code = E_BROWSER_VERIFICATION_PROVIDER_INVALID;
      throw error;
    }
    const providers = {};
    for (const [id, provider] of Object.entries(configured)) {
      if (!BROWSER_VERIFICATION_PROVIDER_ID_PATTERN.test(id)) {
        const error = new Error(`Invalid browser-verification provider ID: ${id}`);
        error.code = E_BROWSER_VERIFICATION_PROVIDER_INVALID;
        throw error;
      }
       if (typeof provider !== "function"
         && (!provider || typeof provider !== "object" || Array.isArray(provider))) {
        const error = new Error(`Browser-verification provider ${id} must be an object with verify() or a factory`);
        error.code = E_BROWSER_VERIFICATION_PROVIDER_INVALID;
        throw error;
      }
      if (typeof provider !== "function") {
        assertBrowserVerificationProviderIdentity(provider, { expectedId: id });
        assertBrowserVerificationProvider(provider, { label: `browser-verification provider "${id}"` });
      }
      providers[id] = provider;
    }
    context.browserVerificationProviders = Object.freeze(providers);
  }
  return Object.freeze(context);
}
