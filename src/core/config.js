import { PROTOCOL_VERSION } from "./protocol.js";
import { ARTIFACT_PATHS, readJsonArtifact, writeJsonArtifact } from "./artifacts.js";
import { E_ATTESTATION_CONFIGURATION_INVALID } from "./error-codes.js";
import { normalizeVerificationConfiguration } from "./verification-scope-capability.js";
import { EXECUTION_PROFILE_REQUESTS } from "./execution-profile.js";
import { normalizeStructuralQualityConfig } from "./structural-quality/policy.js";
import { normalizeDecisionPolicy } from "./decision/policy.js";

export const CONFIG_SCHEMA_VERSION = 1;
export const COMPLIANCE_MODES = Object.freeze(["advisory", "standard", "strict"]);
export const ATTESTATION_MODES = Object.freeze(["off", "optional", "required"]);

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    const error = new Error(`${label} must be an array of non-empty strings`);
    error.code = E_ATTESTATION_CONFIGURATION_INVALID;
    throw error;
  }
  return [...new Set(value)];
}

function configurationError(message) {
  const error = new Error(message);
  error.code = E_ATTESTATION_CONFIGURATION_INVALID;
  return error;
}

export function createConfig(input = {}) {
  const complianceMode = input.complianceMode ?? "standard";
  if (!COMPLIANCE_MODES.includes(complianceMode)) {
    throw configurationError(`Unknown compliance mode: ${complianceMode}`);
  }
  let attestation;
  if (input.attestation !== undefined) {
    if (!input.attestation || typeof input.attestation !== "object" || Array.isArray(input.attestation)) {
      throw configurationError("attestation must be an object");
    }
    const mode = input.attestation.mode ?? "optional";
    if (!ATTESTATION_MODES.includes(mode)) throw configurationError(`Unknown attestation mode: ${mode}`);
    const revisionProvider = input.attestation.revisionProvider ?? "git";
    if (typeof revisionProvider !== "string" || !revisionProvider.trim()) throw configurationError("attestation.revisionProvider must be a non-empty string");
    const signing = input.attestation.signing ?? {};
    if (!signing || typeof signing !== "object" || Array.isArray(signing)) {
      throw configurationError("attestation.signing must be an object");
    }
    const provider = signing.provider ?? "none";
    if (!["none", "sigstore"].includes(provider)) throw configurationError(`Unknown attestation signing provider: ${provider}`);
    const policy = signing.policy ?? {};
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
      throw configurationError("attestation.signing.policy must be an object");
    }
    if (policy.issuer !== undefined && typeof policy.issuer !== "string") throw configurationError("attestation.signing.policy.issuer must be a string");
    if (policy.identities !== undefined) stringArray(policy.identities, "attestation.signing.policy.identities");
    attestation = {
      mode,
      revisionProvider,
      requireCompleteCoverage: input.attestation.requireCompleteCoverage === true,
      coverage: { exclude: stringArray(input.attestation.coverage?.exclude ?? [], "attestation.coverage.exclude") },
      signing: {
        provider,
        required: signing.required === true,
        policy: {
          ...(policy.issuer !== undefined ? { issuer: policy.issuer } : {}),
          identities: [...(policy.identities ?? [])],
          requireTransparencyLog: policy.requireTransparencyLog !== false,
        },
      },
    };
  }
  let verification;
  if (input.verification !== undefined) {
    try {
      verification = normalizeVerificationConfiguration(input.verification);
    } catch (error) {
      throw configurationError(error.message);
    }
  }
  let executionProfile;
  if (input.executionProfile !== undefined) {
    if (!EXECUTION_PROFILE_REQUESTS.includes(input.executionProfile)) {
      throw configurationError(`Unknown execution profile: ${input.executionProfile}`);
    }
    executionProfile = input.executionProfile;
  }
  const structuralQuality = normalizeStructuralQualityConfig(input.structuralQuality);
  const decisionEngine = normalizeDecisionPolicy(input.decisionEngine);
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    complianceMode,
    ...(input.policy !== undefined ? { policy: input.policy } : {}),
    ...(input.requiredGates !== undefined ? { requiredGates: stringArray(input.requiredGates, "requiredGates") } : {}),
    ...(input.requiredEvidence !== undefined ? { requiredEvidence: stringArray(input.requiredEvidence, "requiredEvidence") } : {}),
    ...(verification ? { verification } : {}),
    ...(attestation ? { attestation } : {}),
    ...(executionProfile ? { executionProfile } : {}),
    ...(structuralQuality !== undefined ? { structuralQuality } : {}),
    decisionEngine,
  };
}

export async function readConfig(target, packageRoot) {
  return (await readJsonArtifact(target, ARTIFACT_PATHS.config, "config", packageRoot)).value;
}

export async function writeConfig(target, config, packageRoot, options = {}) {
  return writeJsonArtifact(target, ARTIFACT_PATHS.config, config, "config", packageRoot, options);
}
