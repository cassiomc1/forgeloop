import {
  FORGELOOP_INTEGRATION_RUNTIME_VERSION,
  executeForgeLoopCommand,
} from "./core/command-runtime.js";
import { validateForgeLoopCommandInput, defaultCommandInputValues } from "./core/command-input.js";
import { CLI_COMMAND_DEFINITIONS } from "./core/cli-command-definitions.js";
import {
  INTEGRATION_RISK_CLASSES,
  classifyForgeLoopInvocation,
  getForgeLoopCapabilities,
} from "./core/integration-invocation-policy.js";
import { readForgeLoopIntegrationResource, INTEGRATION_RESOURCE_DEFINITIONS } from "./core/integration-resources.js";
import { resolveForgeLoopProjectRoot } from "./core/project-root.js";
import { INTEGRATION_LIMITS } from "./core/integration-limits.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Version of the installed @cassiomc1/forgeloop package providing this
 * integration API (closing plan §14-16): lets external adapters report the
 * real core version without hardcoding or deep-importing package internals.
 */
export function getForgeLoopPackageVersion() {
  const packageJsonPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "package.json",
  );
  return JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
}

export {
  FORGELOOP_INTEGRATION_RUNTIME_VERSION,
  executeForgeLoopCommand,
  validateForgeLoopCommandInput,
  defaultCommandInputValues,
  getForgeLoopCapabilities,
  classifyForgeLoopInvocation,
  readForgeLoopIntegrationResource,
  resolveForgeLoopProjectRoot,
  INTEGRATION_LIMITS,
  INTEGRATION_RISK_CLASSES,
  INTEGRATION_RESOURCE_DEFINITIONS,
  CLI_COMMAND_DEFINITIONS,
};

export { createForgeLoopContext } from "./core/runtime-context.js";
export {
  assertStructuralQualityProvider,
  createStructuralQualityProviderRegistry,
  normalizeStructuralQualityDetection,
  normalizeStructuralQualitySnapshot,
  resolveStructuralQualityProvider,
} from "./core/structural-quality/provider.js";
export {
  STRUCTURAL_QUALITY_CHECK_ID,
  STRUCTURAL_QUALITY_MODES,
  STRUCTURAL_QUALITY_REQUIREMENT,
  STRUCTURAL_QUALITY_ROOT_CAUSES,
  STRUCTURAL_QUALITY_STATUSES,
} from "./core/structural-quality/constants.js";
export {
  PROFILE_CONTEXT_POLICIES,
  buildExecutionProfileContext,
  getExecutionProfileContextPolicy,
  legacyExecutionProfile,
  projectExecutionProfileContext,
} from "./core/execution-profile-context.js";
export {
  EXECUTION_PROFILES,
  EXECUTION_PROFILE_REQUESTS,
  LEGACY_EXECUTION_PROFILE,
  projectExecutionProfile,
  resolveExecutionProfile,
} from "./core/execution-profile.js";
export {
  E_VERIFICATION_EXECUTION_INVALID,
  E_VERIFICATION_ISOLATION_UNAVAILABLE,
  VERIFICATION_EXECUTION_POLICY_MODES,
  VERIFICATION_ISOLATION_MODES,
} from "./core/verification-execution.js";
export { recallAdvisoryContext } from "./core/advisory-context/service.js";
export { createRipwireAdvisoryContextProvider } from "./adapters/ripwire/provider.js";
export {
  ADVISORY_CONTEXT_LIMITS,
  ADVISORY_CONTEXT_TRUST,
  normalizeAdvisoryRecallOptions,
} from "./core/advisory-context/constants.js";
export {
  assertAdvisoryContextProvider,
  assertAdvisoryContextProviderIdentity,
  createAdvisoryContextProviderRegistry,
  normalizeAdvisoryContextResult,
  resolveAdvisoryContextProvider,
} from "./core/advisory-context/provider.js";
export {
  normalizePortableText,
  assertPortableContextSafe,
  PortableContextError,
} from "./core/portable-context.js";
export {
  acceptCanonicalHandoff,
  resolveHandoffAcceptance,
} from "./core/handoff-acceptance.js";

export const FORGELOOP_INTEGRATION_API_VERSION = FORGELOOP_INTEGRATION_RUNTIME_VERSION;
