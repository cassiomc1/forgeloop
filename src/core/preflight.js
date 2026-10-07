import { ARTIFACT_PATHS, writeJsonArtifact } from "./artifacts.js";
import { readContract } from "./contract.js";
import { assertRouteInvariants } from "./router.js";
import { validateProfileSources } from "./profile.js";
import { readWorkState } from "./work-state.js";
import { ensureResumableState, synchronizePreflightState } from "./preflight-consistency.js";
import {
  issue,
  preflightError,
  sortIssues,
} from "./preflight-model.js";
import {
  loadContract,
  loadRoute,
  loadSources,
  inspectGates,
  optionalConfig,
  readProfile,
} from "./preflight-loaders.js";
import {
  appendActivationEvents,
  assertExistingReadyLifecycleCompatibility,
  assertPreflightPersistenceSafety,
  assertPreflightResultPersistenceSafety,
  validateReadyProtocolConsistency as validateReadyProtocolConsistencyCore,
} from "./preflight-consistency.js";
import { PROFILE_PATH } from "./target-layout.js";
import { readPersistedRoute } from "./route-artifact.js";
import { validateEventLedger } from "./events.js";
import { PROJECT_ARTIFACT_PATHS, taskArtifactPath } from "./task-paths.js";
import { normalizeStructuralQualityConfig } from "./structural-quality/policy.js";

const PREVIEW_DECISION_LIMIT = 10;
const PREVIEW_DECISION_MAX_LENGTH = 240;

export { validatePersistedPreflight } from "./preflight-model.js";

function preflightArtifactPath(explicitPath, taskId, kind) {
  return explicitPath ?? (taskId ? taskArtifactPath(taskId, kind) : ARTIFACT_PATHS[kind]);
}

export async function evaluatePreflight({ target, packageRoot, strict = false, taskId = null, contractPath = null, routePath = null, statePath = null, readers = null } = {}) {
  const errors = [];
  const profile = await readProfile(target);
  const profileProvenance = await validateProfileSources(target, packageRoot);
  errors.push(...(profileProvenance.errors ?? []));
  const contract = await loadContract(target, packageRoot, errors, { taskId, contractPath, readers });
  const route = await loadRoute(target, packageRoot, errors, { taskId, routePath, readers });
  const config = await optionalConfig(target, packageRoot, errors);
  if (config.structuralQuality !== undefined) {
    try {
      normalizeStructuralQualityConfig(config.structuralQuality);
    } catch (error) {
      errors.push(issue(
        error.code ?? "E_STRUCTURAL_QUALITY_CONFIGURATION_INVALID",
        error.message,
        [PROJECT_ARTIFACT_PATHS.config],
      ));
    }
  }
  const effectiveStrict = strict || config.complianceMode === "strict";
  if (effectiveStrict && profile.status !== "verified") {
    errors.push(issue("E_PROFILE_UNVERIFIED", "Strict preflight requires a verified project profile", [PROFILE_PATH]));
  }

  const contractRelPath = preflightArtifactPath(contractPath, taskId, "contract");
  const routeRelPath = preflightArtifactPath(routePath, taskId, "route");
  const stateRelPath = preflightArtifactPath(statePath, taskId, "state");

  const unresolvedDecisions = contract?.value?.unresolvedDecisions ?? [];
  if (unresolvedDecisions.length > 0) {
    errors.push(issue(
      "E_CONTRACT_UNRESOLVED_DECISION",
      "The current contract contains unresolved blocking decisions.",
      [contractRelPath],
      {
        decisions: unresolvedDecisions
          .slice(0, PREVIEW_DECISION_LIMIT)
          .map((decision) => decision.slice(0, PREVIEW_DECISION_MAX_LENGTH)),
        decisionCount: unresolvedDecisions.length,
        ...(unresolvedDecisions.length > PREVIEW_DECISION_LIMIT ? { decisionsTruncated: true } : {}),
        next: "Resolve the blocking decision with the user or applicable authority, update current-contract.json, then rerun preflight.",
      },
    ));
  }

  if (route && contract) {
    assertRouteInvariants(route.value);
    if (route.value.contractFingerprint !== undefined && route.value.contractFingerprint !== contract.fingerprint) {
      errors.push(issue("E_ROUTE_STALE", "Routing result was created for a different contract", [routeRelPath, contractRelPath]));
    }
  }

  const sources = await loadSources(target, contract, packageRoot, errors);
  const gates = await inspectGates(target, contract, route, packageRoot, errors, config, { taskId, readers });

  let state = null;
  try {
    state = await (readers?.readState ?? readWorkState)(target, { packageRoot, taskId, statePath });
  } catch (error) {
    errors.push(issue("E_STATE_INVALID", error.message, [stateRelPath]));
  }
  if (state && route && JSON.stringify(state.selectedGuides) !== JSON.stringify(route.value.guides)) {
    errors.push(issue("E_ROUTE_GUIDE_MISMATCH", "work-state.selectedGuides must equal routing-result.guides", [routeRelPath, stateRelPath]));
  }
  if (state && contract && state.contractFingerprint !== contract.fingerprint) {
    errors.push(issue("E_CONTRACT_STALE", "work-state references a different contract", [contractRelPath, stateRelPath]));
  }

  const { detectPolicyCapability } = await import("./policy-engine.js");
  const policyCapability = await detectPolicyCapability(target, packageRoot);
  if (policyCapability === "INVALID") {
    errors.push(issue(
      "E_POLICY_INVALID",
      "Executable policy artifacts are present but invalid.",
      [
        PROJECT_ARTIFACT_PATHS.policyRules,
        PROJECT_ARTIFACT_PATHS.policyBaseline,
        PROJECT_ARTIFACT_PATHS.policyDiscovery,
        PROJECT_ARTIFACT_PATHS.policyLock,
      ],
      {
        next: "Repair the invalid policy artifact and rerun forgeloop preflight.",
      },
    ));
  }

  const sortedErrors = sortIssues(errors);
  const effectiveTaskId = taskId ?? contract?.value?.taskId ?? state?.taskId ?? "unknown";
  let structuralQuality = {
    mode: config.structuralQuality?.mode ?? "off",
    provider: config.structuralQuality?.mode && config.structuralQuality.mode !== "off"
      ? config.structuralQuality.provider ?? "sentrux"
      : null,
    baseline: { status: config.structuralQuality?.mode && config.structuralQuality.mode !== "off" ? "MISSING" : "NOT_REQUESTED" },
    current: { status: "NOT_OBSERVED" },
    comparable: null,
    completionRequired: config.structuralQuality?.mode === "gate",
    reasonCodes: [],
    next: config.structuralQuality?.mode === "gate" ? "CAPTURE_STRUCTURAL_QUALITY_BASELINE" : null,
  };
  if (effectiveTaskId !== "unknown" && (!readers || structuralQuality.mode !== "off")) {
    try {
      const { projectStructuralQualityStatus } = await import("./structural-quality/service.js");
      structuralQuality = await projectStructuralQualityStatus({ target, packageRoot, taskId: effectiveTaskId });
    } catch (error) {
      structuralQuality.reasonCodes = [error.code ?? "E_STRUCTURAL_QUALITY_EVIDENCE_STALE"];
    }
  }
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId: effectiveTaskId,
    status: sortedErrors.length === 0 ? "READY" : "BLOCKED",
    profile: { ...profile, provenance: profileProvenance.status },
    contract: contract
      ? { status: "valid", fingerprint: contract.fingerprint }
      : { status: "missing", fingerprint: null },
    routing: route
      ? { status: "valid", fingerprint: route.fingerprint, guides: [...route.value.guides] }
      : { status: "missing", fingerprint: null, guides: [] },
    requiredGates: gates.required,
    satisfiedGates: gates.satisfied,
    errors: sortedErrors,
    fingerprints: {
      contract: contract?.fingerprint ?? null,
      routing: route?.fingerprint ?? null,
      profile: profile.fingerprint,
    },
    ...(config.policy ? {
      policy: {
        name: config.policy,
        complianceMode: config.complianceMode,
        requiredGates: [...(config.requiredGates ?? [])],
        requiredEvidence: [...(config.requiredEvidence ?? [])],
      },
    } : {}),
    ...(sources ? { sources: { status: "valid", fingerprint: null } } : {}),
    structuralQuality,
  };
}

export async function validateReadyProtocolConsistency(options = {}) {
  return validateReadyProtocolConsistencyCore({
    ...options,
    evaluateCurrentPreflight: evaluatePreflight,
  });
}

export async function runPreflight({
  target,
  packageRoot,
  strict = false,
  persist = true,
  taskId = null,
  contractPath = null,
  routePath = null,
  statePath = null,
  preflightPath = null,
  eventsPath = null,
} = {}) {
  let result = await evaluatePreflight({ target, packageRoot, strict, taskId, contractPath, routePath, statePath });
  if (!persist) return result;

  let ledger = await assertPreflightPersistenceSafety(target, packageRoot, { taskId, eventsPath });
  assertPreflightResultPersistenceSafety(result);
  assertExistingReadyLifecycleCompatibility(ledger, result);

  let contract = null;
  let route = null;
  if (result.contract.status === "valid" && result.routing.status === "valid") {
    contract = await readContract(target, packageRoot, { taskId, contractPath });
    route = await readPersistedRoute(target, packageRoot, { taskId, routePath });
    const state = await ensureResumableState({ target, packageRoot, contract, route, taskId, statePath });
    if (state) {
      await synchronizePreflightState({
        target,
        packageRoot,
        state,
        contract,
        route,
        requiredGates: result.requiredGates,
        satisfiedGates: result.satisfiedGates,
        complianceMode: result.policy?.complianceMode,
        statePath,
        taskId,
      });
      result = await evaluatePreflight({ target, packageRoot, strict, taskId, contractPath, routePath, statePath });
      assertPreflightResultPersistenceSafety(result);
      assertExistingReadyLifecycleCompatibility(ledger, result);
      ledger = await assertPreflightPersistenceSafety(target, packageRoot, { taskId, eventsPath });
    }
  }

  if (result.taskId !== "unknown") {
    const {
      detectPolicyCapability,
      loadEffectiveRules,
      readBaseline,
      computePersistedPolicyLockData,
      readTaskPolicySnapshot,
      writeTaskPolicySnapshot,
    } = await import("./policy-engine.js");

    const policyCapability = await detectPolicyCapability(target, packageRoot);
    if (policyCapability === "INVALID") {
      throw preflightError(
        "E_POLICY_INVALID",
        "Executable policy artifacts are present but invalid.",
        [
          PROJECT_ARTIFACT_PATHS.policyRules,
          PROJECT_ARTIFACT_PATHS.policyBaseline,
          PROJECT_ARTIFACT_PATHS.policyDiscovery,
          PROJECT_ARTIFACT_PATHS.policyLock,
        ],
      );
    }

    if (policyCapability === "AVAILABLE") {
      try {
        const existingSnapshot = await readTaskPolicySnapshot(target, result.taskId, packageRoot);
        if (!existingSnapshot) {
          const rules = await loadEffectiveRules(target, packageRoot);
          const baseline = await readBaseline(target, packageRoot);
          const lock = await computePersistedPolicyLockData(target, packageRoot, rules, baseline);
          // Bind the current capability policy into the snapshot so policy
          // drift is detectable before any side-effecting action launch.
          const { readCapabilityPolicyIdentity } = await import("./capability-policy.js");
          const capabilityIdentity = await readCapabilityPolicyIdentity(target, packageRoot);
          if (capabilityIdentity.policy && !lock.capabilityPolicyDigest) {
            throw preflightError(
              "E_POLICY_SNAPSHOT_WRITE_FAILED",
              "Capability policy identity could not be bound to the task policy snapshot",
              [taskArtifactPath(result.taskId, "policySnapshot")],
            );
          }
          const snapshot = {
            schemaVersion: 1,
            policyDigest: lock.digest,
            rules,
            baseline: baseline ?? { schemaVersion: 1, entries: [] },
            baselineDigest: lock.baselineDigest,
            ...(capabilityIdentity.digest
              ? {
                  capabilityPolicyDigest: capabilityIdentity.digest,
                  capabilityPolicyFingerprint: capabilityIdentity.fingerprint,
                }
              : {}),
            capturedAt: new Date().toISOString(),
          };
          await writeTaskPolicySnapshot(target, result.taskId, snapshot, packageRoot);
        }
      } catch (error) {
        const snapRel = taskArtifactPath(result.taskId, "policySnapshot");
        throw preflightError("E_POLICY_SNAPSHOT_WRITE_FAILED", `Failed to persist task policy snapshot: ${error.message}`, [snapRel]);
      }
    }

    await appendActivationEvents(target, packageRoot, ledger, result, { eventsPath, taskId });
    const afterEvents = await validateEventLedger(target, packageRoot, { eventsPath, taskId });
    if (!afterEvents.valid) {
      const first = afterEvents.errors[0];
      const evRel = eventsPath ?? (taskId ? taskArtifactPath(taskId, "events") : ARTIFACT_PATHS.events);
      throw preflightError(first.code, first.message, [evRel]);
    }
  }
  const relPath = preflightPath ?? (taskId ? taskArtifactPath(taskId, "preflight") : ARTIFACT_PATHS.preflight);
  await writeJsonArtifact(target, relPath, result, "preflight", packageRoot);
  return result;
}
