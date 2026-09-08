import path from "node:path";
import { runProtocolInfo } from "../commands/protocol-info.js";
import { readContract } from "./contract.js";
import { discoverTasks } from "./task-discovery.js";
import { resolveTaskClaimState } from "./task-claim-state.js";
import { runStatus } from "../commands/status.js";
import { runContinuity } from "../commands/continuity.js";
import { listActions, readAction } from "./actions.js";
import { listApprovals } from "./approvals.js";
import { buildTrajectoryMetrics } from "./trajectory-metrics.js";
import { loadCapabilityPolicy } from "./capability-policy.js";
import { readdir } from "node:fs/promises";
import { readJsonArtifact } from "./artifacts.js";
import { taskDirectory } from "./task-paths.js";
import { resolveWorkspaceBindingStatus } from "./workspace-binding.js";
import { listCanonicalHandoffs } from "./handoff.js";
import { readHandoffAcceptanceLedger, resolveHandoffAcceptance } from "./handoff-acceptance.js";
import { resolveResponsibilityStatus } from "./responsibility.js";
import { readVerificationScope } from "./verification-scope.js";
import { resolveAttestationStatus } from "./attestation.js";
import { buildExecutionProfileContext } from "./execution-profile-context.js";
import { projectStructuralQualityStatus } from "./structural-quality/service.js";
import { getRepositoryIndexStatus } from "../repository-index/status.js";

/**
 * Canonical integration resource allowlist.
 *
 * This is NOT a replacement for ARTIFACT_REGISTRY: the artifact registry
 * describes persisted protocol artifacts; this registry describes what is
 * safe to expose through structured integrations. Anything not listed here
 * must never be readable through an integration transport.
 *
 * task/ownership is derived exclusively from resolveTaskClaimState() — the
 * canonical claim resolver. Integrations must present these values; they
 * must never derive them from raw artifacts such as task.json or
 * recovery.json.
 */
export const INTEGRATION_RESOURCE_DEFINITIONS = Object.freeze({
  "protocol/info": Object.freeze({
    scope: "PROJECT",
    description: "ForgeLoop protocol version, schema compatibility, features, and command metadata.",
  }),
  "project/tasks": Object.freeze({
    scope: "PROJECT",
    description: "All discovered tasks with canonical ownership projection fields.",
  }),
  "task/status": Object.freeze({
    scope: "TASK",
    description: "Canonical status projection for one task, including ownership fields.",
  }),
  "task/ownership": Object.freeze({
    scope: "TASK",
    description: "Canonical validated claim ownership for one task.",
  }),
  "task/contract": Object.freeze({
    scope: "TASK",
    description: "The task's current contract.",
  }),
  "task/continuity": Object.freeze({
    scope: "TASK",
    description: "Cross-harness continuity state for one task.",
  }),
  "task/workspace-binding": Object.freeze({
    scope: "TASK",
    description: "Optional task workspace binding status for the current Git worktree.",
  }),
  "task/handoffs": Object.freeze({
    scope: "TASK",
    description: "Immutable protocol-derived handoff snapshots for one task.",
  }),
  "task/responsibility": Object.freeze({
    scope: "TASK",
    description: "Current responsibility constraints and their validation status.",
  }),
  "task/verification-scope": Object.freeze({
    scope: "TASK",
    description: "The current deterministic verification-scope artifact.",
  }),
  "task/attestation": Object.freeze({
    scope: "TASK",
    description: "Local code-attestation status and trust level for one task.",
  }),
  "task/structural-quality": Object.freeze({ scope: "TASK", description: "Read-only structural-quality baseline, evaluation, comparison, and next-action projection." }),
  "task/actions": Object.freeze({ scope: "TASK", description: "Canonical durable action summaries for one task." }),
  "task/action": Object.freeze({ scope: "TASK", description: "One canonical durable action artifact." }),
  "task/approvals": Object.freeze({ scope: "TASK", description: "Durable approval artifacts for one task." }),
  "task/metrics": Object.freeze({ scope: "TASK", description: "Read-only trajectory metrics for one task." }),
  "task/context": Object.freeze({ scope: "TASK", description: "Read-only profile-aware task context with bounded presentation policy." }),
  "task/evaluations": Object.freeze({ scope: "TASK", description: "Persisted trajectory evaluations for one task." }),
  "project/capability-policy": Object.freeze({ scope: "PROJECT", description: "Project capability policy, never host authority." }),
  "repository/index-status": Object.freeze({ scope: "PROJECT", description: "Provider-neutral repository-index health and owned-server status." }),
});

function ownershipProjection(projection) {
  return {
    taskId: projection.taskId,
    phase: projection.phase,
    claimState: projection.claimState,
    mutationAllowed: projection.mutationAllowed,
    ownershipValid: projection.ownershipValid,
    recoveryStatus: projection.recoveryStatus,
    historicalWriteClaims: [...projection.historicalWriteClaims],
    effectiveWriteClaims: [...projection.effectiveWriteClaims],
    reasonCodes: [...projection.reasonCodes],
  };
}

async function readForgeLoopIntegrationResourceCore(uri, {
  projectPath = ".",
  packageRoot = undefined,
  packageVersion = null,
  taskId = null,
  actionId = null,
  runtimeContext = null,
} = {}) {
  const resource = INTEGRATION_RESOURCE_DEFINITIONS[uri];
  if (!resource) {
    const error = new Error(`Unknown ForgeLoop integration resource: ${uri}`);
    error.code = "E_INTEGRATION_RESOURCE_UNKNOWN";
    throw error;
  }

  switch (uri) {
    case "protocol/info": {
      return { uri, data: await runProtocolInfo({ packageVersion }) };
    }
    case "project/tasks": {
      const tasks = await discoverTasks(projectPath, packageRoot);
      return {
        uri,
        data: {
          count: tasks.length,
          tasks: tasks.map((task) => ({
            taskId: task.taskId,
            healthy: task.healthy !== false,
            phase: task.phase ?? null,
            mutationAllowed: task.mutationAllowed !== false,
          })),
        },
      };
    }
    case "task/status":
    case "task/ownership":
    case "task/contract":
    case "task/continuity": {
      if (typeof taskId !== "string" || !taskId) {
        const error = new Error(`Resource ${uri} requires a taskId`);
        error.code = "E_TASK_REQUIRED";
        throw error;
      }
      break;
    }
    case "task/workspace-binding":
    case "task/handoffs":
    case "task/responsibility":
    case "task/verification-scope":
    case "task/attestation": {
      if (typeof taskId !== "string" || !taskId) {
        const error = new Error(`Resource ${uri} requires a taskId`);
        error.code = "E_TASK_REQUIRED";
        throw error;
      }
      break;
    }
    case "task/structural-quality": {
      if (typeof taskId !== "string" || !taskId) {
        const error = new Error(`Resource ${uri} requires a taskId`);
        error.code = "E_TASK_REQUIRED";
        throw error;
      }
      break;
    }
    case "task/actions":
    case "task/action":
    case "task/approvals":
    case "task/metrics":
    case "task/context":
    case "task/evaluations": {
      if (typeof taskId !== "string" || !taskId) {
        const error = new Error(`Resource ${uri} requires a taskId`); error.code = "E_TASK_REQUIRED"; throw error;
      }
      break;
    }
  }

  if (uri === "task/ownership") {
    const projection = await resolveTaskClaimState(projectPath, { taskId, packageRoot });
    return { uri, taskId, data: ownershipProjection(projection) };
  }
  if (uri === "task/structural-quality") {
    return {
      uri,
      taskId,
      data: await projectStructuralQualityStatus({ projectRoot: projectPath, target: projectPath, packageRoot, taskId }),
    };
  }
  if (uri === "task/workspace-binding") {
    return { uri, taskId, data: await resolveWorkspaceBindingStatus(projectPath, { packageRoot, taskId }) };
  }
  if (uri === "task/handoffs") {
    const handoffs = await listCanonicalHandoffs(projectPath, { packageRoot, taskId });
    const ledger = await readHandoffAcceptanceLedger(projectPath, packageRoot, { taskId });
    const projectedHandoffs = handoffs.map((handoff) => {
      const resolved = resolveHandoffAcceptance({
        events: ledger.events,
        handoff,
        ledgerValid: ledger.valid,
        ledgerErrors: ledger.errors,
      });
      return {
        ...handoff,
        acceptance: {
          status: resolved.status,
          consumerId: resolved.consumerId ?? null,
          harness: resolved.harness ?? null,
          acceptedAt: resolved.acceptedAt ?? null,
          ...(resolved.reasonCodes ? { reasonCodes: [...resolved.reasonCodes] } : {}),
        },
      };
    });
    return { uri, taskId, data: { taskId, count: projectedHandoffs.length, handoffs: projectedHandoffs } };
  }
  if (uri === "task/responsibility") {
    return { uri, taskId, data: await resolveResponsibilityStatus(projectPath, { packageRoot, taskId }) };
  }
  if (uri === "task/verification-scope") {
    const scope = await readVerificationScope(projectPath, { packageRoot, taskId });
    return { uri, taskId, data: { taskId, path: scope.path, fingerprint: scope.fingerprint, scope: scope.value } };
  }
  if (uri === "task/attestation") {
    return { uri, taskId, data: await resolveAttestationStatus({ target: projectPath, packageRoot, taskId }) };
  }
  if (uri === "task/actions") {
    const actions = await listActions(projectPath, { packageRoot, taskId });
    return { uri, taskId, data: { actions } };
  }
  if (uri === "task/action") {
    if (!actionId) { const error = new Error("Resource task/action requires actionId"); error.code = "E_ACTION_INVALID"; throw error; }
    return { uri, taskId, data: await readAction(projectPath, { packageRoot, taskId, actionId }) };
  }
  if (uri === "task/approvals") {
    return { uri, taskId, data: { approvals: await listApprovals(projectPath, { packageRoot, taskId }) } };
  }
  if (uri === "task/metrics") {
    return {
      uri,
      taskId,
      data: await buildTrajectoryMetrics({ target: projectPath, packageRoot, taskId, runtimeContext }),
    };
  }
  if (uri === "task/context") {
    return {
      uri,
      taskId,
      data: await buildExecutionProfileContext({
        target: projectPath,
        packageRoot,
        taskId,
        authorityContext: runtimeContext?.authorityContext,
        runtimeContext,
      }),
    };
  }
  if (uri === "task/evaluations") {
    const dir = path.join(projectPath, taskDirectory(taskId), "evaluations");
    let names = []; try { names = await readdir(dir); } catch { /* absent is an empty projection */ }
    const evaluations = [];
    for (const name of names.filter((entry) => /^eval-[A-Za-z0-9_-]+\.json$/.test(entry)).sort()) {
      evaluations.push((await readJsonArtifact(projectPath, `${taskDirectory(taskId)}/evaluations/${name}`, "trajectory-evaluation", packageRoot)).value);
    }
    return { uri, taskId, data: { evaluations } };
  }
  if (uri === "project/capability-policy") {
    return { uri, data: await loadCapabilityPolicy(projectPath, packageRoot) };
  }
  if (uri === "task/status") {
    const result = await runStatus({ target: projectPath, packageRoot, taskId });
    return { uri, taskId, data: result };
  }
  if (uri === "task/contract") {
    try {
      const contract = await readContract(projectPath, packageRoot, { taskId });
      return { uri, taskId, data: contract.value };
    } catch (error) {
      error.message = `Resource task/contract unavailable: ${error.message}`;
      throw error;
    }
  }
  // task/continuity
  const continuity = await runContinuity({ target: projectPath, packageRoot, taskId });
  return { uri, taskId, data: continuity };
}

export async function readForgeLoopIntegrationResource(uri, options = {}) {
  if (uri === "repository/index-status") {
    return {
      uri,
      data: await getRepositoryIndexStatus(options.projectPath ?? ".", {
        packageRoot: options.packageRoot,
        ...(options.repositoryIndexOptions ?? {}),
      }),
    };
  }
  return readForgeLoopIntegrationResourceCore(uri, options);
}
