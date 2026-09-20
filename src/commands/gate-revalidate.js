import { lstat } from "node:fs/promises";

import { optionalConfig } from "../core/preflight-loaders.js";
import { readContract } from "../core/contract.js";
import { appendProtocolEvent, validateEventLedger, validateStateLedgerCoherence } from "../core/events.js";
import { ensureWithin, isPathWithin, readBytes, realpathWithTransientWindowsRetry } from "../core/filesystem.js";
import { sha256 } from "../core/manifest.js";
import { requiredGatesForGuides } from "../core/guide-metadata.js";
import { readPersistedRoute } from "../core/route-artifact.js";
import { staleReasons } from "../core/next-action-artifacts.js";
import { resolveTaskClaimState } from "../core/task-claim-state.js";
import { taskGatePath, taskArtifactPath } from "../core/task-paths.js";
import { withTaskMutation } from "../core/task-command.js";
import { readWorkState } from "../core/work-state.js";
import { stateIdentityErrors } from "../core/completion-relationships.js";
import { persistGate, readGateIfPresent, validateGateArtifacts } from "../core/gate-artifact.js";
import {
  GATE_REVALIDATED_EVENT,
  assertGateRevalidatedDetails,
} from "../core/gate-provenance.js";

const POST_EXECUTION_PHASES = new Set([
  "EXECUTING", "VERIFYING", "DIAGNOSING", "CORRECTING", "REVIEWING",
]);

function revalidationError(message, code = "E_GATE_REVALIDATION_UNSAFE", artifacts = []) {
  const error = new Error(message);
  error.code = code;
  error.artifacts = artifacts;
  return error;
}

async function hashGateArtifact(target, relativePath) {
  let artifactPath;
  try {
    artifactPath = ensureWithin(target, relativePath);
    const stat = await lstat(artifactPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("artifact must be a regular file");
    const rootReal = await realpathWithTransientWindowsRetry(target);
    const artifactReal = await realpathWithTransientWindowsRetry(artifactPath);
    if (!isPathWithin(rootReal, artifactReal)) throw new Error("artifact resolves outside the project");
    return { path: relativePath, sha256: sha256(await readBytes(artifactReal)) };
  } catch (cause) {
    throw revalidationError(`Cannot refresh gate artifact ${relativePath}: ${cause.message}`, "E_GATE_REVALIDATION_UNSAFE", [relativePath]);
  }
}

async function assertCurrentGateBinding(target, packageRoot, taskId, state, gate) {
  const contract = await readContract(target, packageRoot, { taskId });
  const route = await readPersistedRoute(target, packageRoot, { taskId });
  const identityErrors = stateIdentityErrors({ contract, route, state });
  if (identityErrors.length > 0) {
    throw revalidationError(
      "Gate revalidation requires coherent current contract, route, state, and selected guides",
      "E_GATE_REVALIDATION_UNSAFE",
      [taskArtifactPath(taskId, "contract"), taskArtifactPath(taskId, "route"), taskArtifactPath(taskId, "state")],
    );
  }
  const routeStale = staleReasons(state, contract, route);
  if (routeStale.length > 0) {
    throw revalidationError("Gate revalidation cannot repair stale contract or route identity", "E_GATE_REVALIDATION_UNSAFE", routeStale.flatMap((reason) => reason.artifacts));
  }
  const config = await optionalConfig(target, packageRoot, []);
  const required = [...new Set([
    ...(await requiredGatesForGuides(route.value.guides, packageRoot)),
    ...(config.requiredGates ?? []),
  ])];
  if (!required.includes(gate)) {
    throw revalidationError(`Gate is not required by the active route: ${gate}`, "E_GATE_NOT_REQUIRED", [taskArtifactPath(taskId, "route")]);
  }
  return { contract, route };
}

export async function runGateRevalidate({ target, packageRoot, taskId, gate, acknowledgeStale = false } = {}) {
  if (!acknowledgeStale) {
    throw revalidationError("gate-revalidate requires --acknowledge-stale", "E_GATE_REVALIDATION_ACK_REQUIRED");
  }
  if (typeof gate !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(gate)) {
    throw revalidationError(`Invalid gate name: ${gate}`, "E_GATE_INVALID");
  }
  return withTaskMutation(target, { taskId, packageRoot }, "gate-revalidate", async (ctx) => {
    const state = await readWorkState(target, { packageRoot, taskId: ctx.taskId });
    if (!state || !POST_EXECUTION_PHASES.has(state.phase)) {
      throw revalidationError(
        `gate-revalidate is only available for post-execution repair phases; found ${state?.phase ?? "no phase"}`,
        "E_GATE_REVALIDATION_PHASE_INVALID",
        [taskArtifactPath(ctx.taskId, "state")],
      );
    }
    const ledger = await validateEventLedger(target, packageRoot, { taskId: ctx.taskId });
    if (!ledger.valid) throw revalidationError("Gate revalidation requires a valid append-only event ledger", "E_EVENT_INVALID", ledger.errors);
    const coherenceErrors = validateStateLedgerCoherence(state, ledger.events);
    if (coherenceErrors.length > 0) throw revalidationError("Gate revalidation requires coherent state and ledger", "E_PHASE_CHRONOLOGY_INVALID", coherenceErrors);
    const ownership = await resolveTaskClaimState(target, { taskId: ctx.taskId, packageRoot });
    if (!ownership.ownershipValid || !ownership.mutationAllowed || ownership.claimState !== "ACTIVE") {
      throw revalidationError("Gate revalidation cannot bypass active task claim ownership", "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT", ownership.ownershipErrors);
    }
    await assertCurrentGateBinding(target, packageRoot, ctx.taskId, state, gate);
    const existing = await readGateIfPresent(target, gate, packageRoot, { taskId: ctx.taskId });
    if (!existing || existing.value.status !== "satisfied") {
      throw revalidationError("Only an existing satisfied gate can be revalidated", "E_GATE_UNVERIFIED", [taskGatePath(ctx.taskId, gate)]);
    }
    const stale = await validateGateArtifacts(target, existing.value, packageRoot);
    if (stale.length === 0) {
      throw revalidationError("Gate artifacts are already fresh; no revalidation event is required", "E_GATE_REVALIDATION_NOT_STALE", [existing.path]);
    }
    const refreshedArtifacts = [];
    for (const artifact of existing.value.artifacts ?? []) refreshedArtifacts.push(await hashGateArtifact(target, artifact.path));
    const refreshedGate = { ...existing.value, artifacts: refreshedArtifacts };
    const persisted = await persistGate(target, refreshedGate, packageRoot, { taskId: ctx.taskId });
    const details = {
      gate,
      previousGateFingerprint: existing.fingerprint,
      gateFingerprint: persisted.fingerprint,
      stalePaths: stale.map((entry) => entry.path).sort(),
    };
    assertGateRevalidatedDetails(details);
    const event = await appendProtocolEvent(target, {
      taskId: ctx.taskId,
      event: GATE_REVALIDATED_EVENT,
      details,
    }, packageRoot, { taskId: ctx.taskId });
    return {
      taskId: ctx.taskId,
      gate,
      stalePaths: details.stalePaths,
      gateFingerprint: persisted.fingerprint,
      eventSeq: event.seq,
      transactionCommitSeq: event.seq + 1,
      path: persisted.path ?? persisted.relativePath ?? taskGatePath(ctx.taskId, gate),
    };
  });
}

export function formatGateRevalidateResult(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}
