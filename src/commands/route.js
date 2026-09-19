import { evaluateRoute } from "../core/router.js";
import { persistRoute, readPersistedRoute } from "../core/route-artifact.js";
import { readContract } from "../core/contract.js";
import { readConfig } from "../core/config.js";
import { appendProtocolEvent, readEvents } from "../core/events.js";
import { detectProjectEvidence } from "../core/project-detection.js";
import { withTaskMutation } from "../core/task-command.js";
import { advanceWorkState } from "../core/phase.js";
import { mutateWorkState, readWorkState } from "../core/work-state.js";
import {
  CONTRACT_BOOTSTRAP_REPAIR_EVENT,
  isContractBootstrapRepairMarkerValid,
} from "../core/contract-bootstrap-recovery.js";

function canAppendRepairedRouteWitness({ stateBefore, marker, previousPersistedRouteFingerprint, persistedRoute }) {
  if (previousPersistedRouteFingerprint === null) {
    return stateBefore.phase === "CONTRACT_READY"
      && marker.details.reconstructedPhase === "CONTRACT_READY"
      && marker.details.routeFingerprint === null;
  }
  return persistedRoute.fingerprint !== previousPersistedRouteFingerprint
    && persistedRoute.value.contractFingerprint === marker.details.contractFingerprint;
}

async function appendRepairedRouteWitness({ target, packageRoot, taskId, stateBefore, previousPersistedRouteFingerprint, persistedRoute }) {
  if (!stateBefore) return;
  const events = await readEvents(target, packageRoot, { taskId });
  const marker = events.find((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT);
  if (!marker || !isContractBootstrapRepairMarkerValid(events, marker)) return;
  if (!canAppendRepairedRouteWitness({ stateBefore, marker, previousPersistedRouteFingerprint, persistedRoute })) return;
  await appendProtocolEvent(target, {
    taskId,
    event: "ROUTE_REBOUND",
    details: {
      routeFingerprint: persistedRoute.fingerprint,
      contractFingerprint: persistedRoute.value.contractFingerprint,
      previousRouteFingerprint: previousPersistedRouteFingerprint,
    },
  }, packageRoot, { taskId });
}

async function persistRoutedState({ target, packageRoot, taskId, route, transaction }) {
  const stateBefore = await readWorkState(target, { packageRoot, taskId });
  let previousPersistedRouteFingerprint = null;
  try {
    previousPersistedRouteFingerprint = (await readPersistedRoute(target, packageRoot, { taskId })).fingerprint;
  } catch (error) {
    if (error.code !== "ARTIFACT_MISSING") throw error;
  }
  let contractFingerprint;
  try {
    contractFingerprint = (await readContract(target, packageRoot, { taskId })).fingerprint;
  } catch {
    contractFingerprint = undefined;
  }
  const persistedRoute = await persistRoute(target, route, packageRoot, { contractFingerprint, taskId });
  const state = await readWorkState(target, { packageRoot, taskId });
  if (state?.phase === "CONTRACT_READY") {
    await mutateWorkState(target, {
      packageRoot,
      taskId,
      expectedRevision: state.revision ?? 0,
    }, () => ({
      ...state,
      routeFingerprint: persistedRoute.fingerprint,
      selectedGuides: [...persistedRoute.value.guides],
    }));
    await advanceWorkState(target, "ROUTED", { packageRoot, taskId });
  }
  if (transaction?.operation === "route") {
    await appendRepairedRouteWitness({
      target,
      packageRoot,
      taskId,
      stateBefore,
      previousPersistedRouteFingerprint,
      persistedRoute,
    });
  }
}

export async function runRoute({ target, packageRoot, workType, surfaces, risks, platforms, behaviorChange, executableChange, executionProfile = null, taskId, task }) {
  return withTaskMutation(target, { taskId: taskId ?? task, packageRoot }, "route", async (ctx) => {
    const effectiveTaskId = ctx?.taskId ?? null;
    let contract = null;
    try {
      contract = (await readContract(target, packageRoot, { taskId: effectiveTaskId })).value;
    } catch (error) {
      if (error.code !== "ARTIFACT_MISSING") throw error;
    }
    let configuredProfile = "auto";
    try {
      configuredProfile = (await readConfig(target, packageRoot)).executionProfile ?? "auto";
    } catch (error) {
      if (error.code !== "ARTIFACT_MISSING") throw error;
    }
    const projectEvidence = target
      ? await detectProjectEvidence(target, { claims: ctx?.descriptor?.writeClaims ?? [] })
      : null;
    const route = evaluateRoute({
      workType,
      surfaces,
      risks,
      platforms,
      behaviorChange,
      executableChange,
      ...(projectEvidence ? { projectEvidence } : {}),
    }, {
      contract,
      taskDescriptor: ctx?.descriptor ?? null,
      configuredProfile,
      requestedProfile: executionProfile,
    });
    if (target && packageRoot) {
      await persistRoutedState({
        target,
        packageRoot,
        taskId: effectiveTaskId,
        route,
        transaction: ctx?.transaction,
      });
    }
    return route;
  });
}

export function formatRouteResult(result) {
  const lines = [`Execution profile: ${result.executionProfile?.resolved ?? "legacy"}`, "Selected:"];
  if (result.guides.length === 0) {
    lines.push("- none (use the relevant domain guide for this documentation task)");
  } else {
    for (const guide of result.guides) {
      lines.push(`- ${guide}: ${result.reasons[guide].join(", ")}`);
    }
  }

  const excludedEntries = Object.entries(result.excluded);
  if (excludedEntries.length > 0) {
    lines.push("Excluded:");
    for (const [guide, reasons] of excludedEntries) {
      lines.push(`- ${guide}: ${reasons.join(", ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
