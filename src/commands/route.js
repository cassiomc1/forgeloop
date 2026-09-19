import { evaluateRoute } from "../core/router.js";
import { persistRoute } from "../core/route-artifact.js";
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

async function appendRepairedRouteWitness({ target, packageRoot, taskId, stateBefore, stateAfter, persistedRoute }) {
  if (!stateBefore || !stateAfter || stateAfter.phase !== "ROUTED") return;
  const events = await readEvents(target, packageRoot, { taskId });
  const marker = events.find((event) => event.event === CONTRACT_BOOTSTRAP_REPAIR_EVENT);
  if (!marker || !isContractBootstrapRepairMarkerValid(events, marker)) return;
  const previousRouteFingerprint = stateBefore.phase === "ROUTED"
    ? stateBefore.routeFingerprint ?? null
    : marker.details.routeFingerprint;
  const isFirstRepairedRoute = stateBefore.phase === "CONTRACT_READY"
    && marker.details.reconstructedPhase === "CONTRACT_READY"
    && marker.details.routeFingerprint === null;
  const isReroute = stateBefore.phase === "ROUTED";
  if ((!isFirstRepairedRoute && !isReroute)
    || persistedRoute.fingerprint === previousRouteFingerprint
    || stateAfter.routeFingerprint !== persistedRoute.fingerprint) return;
  await appendProtocolEvent(target, {
    taskId,
    event: "ROUTE_REBOUND",
    details: {
      routeFingerprint: persistedRoute.fingerprint,
      contractFingerprint: persistedRoute.value.contractFingerprint,
      previousRouteFingerprint,
    },
  }, packageRoot, { taskId });
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
      const stateBefore = await readWorkState(target, { packageRoot, taskId: effectiveTaskId });
      let contractFingerprint;
      try {
        contractFingerprint = (await readContract(target, packageRoot, { taskId: effectiveTaskId })).fingerprint;
      } catch {
        contractFingerprint = undefined;
      }
      const persistedRoute = await persistRoute(target, route, packageRoot, { contractFingerprint, taskId: effectiveTaskId });
      const state = await readWorkState(target, { packageRoot, taskId: effectiveTaskId });
      if (state?.phase === "CONTRACT_READY") {
        await mutateWorkState(target, {
          packageRoot,
          taskId: effectiveTaskId,
          expectedRevision: state.revision ?? 0,
        }, () => ({
          ...state,
          routeFingerprint: persistedRoute.fingerprint,
          selectedGuides: [...persistedRoute.value.guides],
        }));
        await advanceWorkState(target, "ROUTED", { packageRoot, taskId: effectiveTaskId });
      }
      if (ctx?.transaction?.operation === "route") {
        const stateAfter = await readWorkState(target, { packageRoot, taskId: effectiveTaskId });
        await appendRepairedRouteWitness({
          target,
          packageRoot,
          taskId: effectiveTaskId,
          stateBefore,
          stateAfter,
          persistedRoute,
        });
      }
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
