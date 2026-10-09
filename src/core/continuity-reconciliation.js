import { getOperationalStore } from "../storage/operational-context.js";
import { withEventLedgerAudit } from "./events.js";
import { canonicalFingerprint } from "./artifacts.js";
import { assertContinuitySemantics, readContinuity } from "./continuity.js";
import { WORK_TRANSITIONS } from "./protocol.js";
import { lintContinuity } from "./continuity-lint.js";
import { withNativeReadScope } from "./native-storage.js";

const RECONCILIATION_CODE = "E_CONTINUITY_RECONCILIATION_REQUIRED";

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function pathCoveredByHint(changedPath, hint) {
  const normalizedPath = String(changedPath).replaceAll("\\", "/").replace(/^\.\//, "");
  const normalizedHint = String(hint).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  return normalizedPath === normalizedHint || normalizedPath.startsWith(`${normalizedHint}/`);
}

function compareChangedPaths(changedPaths, hints) {
  if (!Array.isArray(changedPaths)) return "NOT_VERIFIED";
  if (!Array.isArray(hints) || hints.length === 0) return changedPaths.length === 0 ? "MATCH" : "MISMATCH";
  const matched = hints.filter((hint) => changedPaths.some((changedPath) => pathCoveredByHint(changedPath, hint))).length;
  if (matched === hints.length) return "MATCH";
  if (matched > 0) return "PARTIAL";
  return "MISMATCH";
}

function compareRepository(saved, current) {
  const savedUnavailable = !saved || (saved.branch === null && saved.head === null);
  const currentUnavailable = !current || (current.branch === null && current.head === null);
  if (savedUnavailable && currentUnavailable) return "NOT_VERIFIED";
  if (!saved || !current) return "NOT_VERIFIED";
  return saved.branch === current.branch && saved.head === current.head ? "MATCH" : "MISMATCH";
}

function phaseReachable(from, to) {
  if (from === to) return true;
  if (to === "BLOCKED" && from !== "COMPLETE") return true;
  if (from === "BLOCKED") return false;
  const queue = [from];
  const visited = new Set(queue);
  while (queue.length > 0) {
    const phase = queue.shift();
    for (const next of WORK_TRANSITIONS[phase] ?? []) {
      if (next === to) return true;
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

function baseResult(classification, overrides = {}) {
  return {
    classification,
    taskMatches: overrides.taskMatches ?? null,
    workStateMatches: overrides.workStateMatches ?? null,
    contractMatches: overrides.contractMatches ?? null,
    phaseMatches: overrides.phaseMatches ?? null,
    repositoryComparison: overrides.repositoryComparison ?? "NOT_VERIFIED",
    changedPathComparison: overrides.changedPathComparison ?? "NOT_VERIFIED",
    reasonCodes: uniqueSorted(overrides.reasonCodes ?? []),
    reasons: uniqueSorted(overrides.reasons ?? []),
    authority: "OPERATIONAL_CONTEXT_ONLY",
    evidenceAuthority: "NONE",
  };
}

export function classifyContinuity({
  continuity,
  state,
  contractFingerprint,
  repositoryFingerprint,
  changedPaths,
} = {}) {
  if (!continuity) {
    return baseResult("ABSENT", { reasons: ["CONTINUITY_ABSENT"] });
  }

  let value;
  try {
    value = assertContinuitySemantics(continuity);
  } catch (error) {
    return baseResult("INVALID", {
      reasonCodes: [error.code ?? "E_CONTINUITY_INVALID"],
      reasons: [error.message],
    });
  }

  if (!state || typeof state !== "object") {
    return baseResult("INCONSISTENT", {
      reasonCodes: ["E_CONTINUITY_STATE_MISSING"],
      reasons: ["CONTINUITY_STATE_MISSING"],
    });
  }

  if (state.phase === "COMPLETE") {
    return baseResult("NOT_APPLICABLE", {
      taskMatches: value.taskId === state.taskId,
      phaseMatches: value.phase === state.phase,
      reasons: ["CONTINUITY_NOT_APPLICABLE_AFTER_COMPLETE"],
    });
  }

  const taskMatches = value.taskId === state.taskId;
  const workStateMatches = value.workStateFingerprint === canonicalFingerprint(state);
  const expectedContract = contractFingerprint ?? state.contractFingerprint ?? null;
  const contractMatches = value.contractFingerprint === state.contractFingerprint
    && (expectedContract === null || value.contractFingerprint === expectedContract);
  const phaseMatches = value.phase === state.phase;
  const repositoryComparison = compareRepository(value.repositoryFingerprint, repositoryFingerprint);
  const changedPathComparison = compareChangedPaths(changedPaths, value.changedAreas);

  const inconsistentCodes = [];
  const inconsistentReasons = [];
  if (!taskMatches) {
    inconsistentCodes.push("E_CONTINUITY_TASK_MISMATCH");
    inconsistentReasons.push("CONTINUITY_TASK_MISMATCH");
  }
  if (!contractMatches) {
    inconsistentCodes.push("E_CONTINUITY_CONTRACT_MISMATCH");
    inconsistentReasons.push("CONTINUITY_CONTRACT_MISMATCH");
  }
  if (!phaseMatches && !phaseReachable(value.phase, state.phase)) {
    inconsistentCodes.push("E_CONTINUITY_PHASE_MISMATCH");
    inconsistentReasons.push("CONTINUITY_PHASE_MISMATCH");
  }
  if (inconsistentCodes.length > 0) {
    return baseResult("INCONSISTENT", {
      taskMatches,
      workStateMatches,
      contractMatches,
      phaseMatches,
      repositoryComparison,
      changedPathComparison,
      reasonCodes: inconsistentCodes,
      reasons: inconsistentReasons,
    });
  }

  const reconciliationReasons = [];
  if (!workStateMatches) reconciliationReasons.push("CONTINUITY_WORK_STATE_CHANGED");
  if (!phaseMatches) reconciliationReasons.push("CONTINUITY_PHASE_CHANGED");
  if (repositoryComparison === "MISMATCH") reconciliationReasons.push("CONTINUITY_REPOSITORY_CHANGED");
  if (["PARTIAL", "MISMATCH"].includes(changedPathComparison)) {
    reconciliationReasons.push("CONTINUITY_CHANGED_PATHS_DIFFER");
  }

  if (reconciliationReasons.length > 0) {
    return baseResult("RECONCILIATION_REQUIRED", {
      taskMatches,
      workStateMatches,
      contractMatches,
      phaseMatches,
      repositoryComparison,
      changedPathComparison,
      reasonCodes: [RECONCILIATION_CODE],
      reasons: reconciliationReasons,
    });
  }

  return baseResult("FRESH", {
    taskMatches,
    workStateMatches,
    contractMatches,
    phaseMatches,
    repositoryComparison,
    changedPathComparison,
  });
}

export async function reconcileContinuity({ target, packageRoot, taskId = null } = {}) {
  const read = () => reconcileLoadedContinuity({ target, packageRoot, taskId });
  return withNativeReadScope(target, () => {
    if (getOperationalStore(target) && taskId) return withEventLedgerAudit(target, packageRoot, { taskId }, read);
    return read();
  });
}

async function reconcileLoadedContinuity({ target, packageRoot, taskId }) {
  const [{ readWorkState }, { readContract }, repository] = await Promise.all([
    import("./work-state.js"),
    import("./contract.js"),
    import("./repository.js"),
  ]);

  const state = await readWorkState(target, { packageRoot, taskId });
  const latestHandoff = await resolveLatestHandoffSafe(target, { packageRoot, taskId: state?.taskId ?? taskId });
  let continuityArtifact;
  try {
    continuityArtifact = await readContinuity(target, { packageRoot, taskId });
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING") {
      return {
        ...classifyContinuity({ continuity: null, state }),
        path: ".forgeloop/continuity.json",
        present: false,
        latestHandoff,
        lint: { status: "PASS", findings: [] },
        diagnosticContext: await deriveDiagnosticContextSafe({ target, packageRoot, state }),
      };
    }
    return {
      ...baseResult("INVALID", {
        reasonCodes: [error.code ?? "E_CONTINUITY_INVALID"],
        reasons: [error.message],
      }),
      path: ".forgeloop/continuity.json",
      present: true,
      error: error.message,
      latestHandoff,
      lint: {
        status: "WARN",
        findings: [{
          code: error.code ?? "CONTINUITY_INVALID",
          severity: "WARN",
          field: "continuity",
          itemId: null,
        }],
      },
    };
  }

  let contractFingerprint = null;
  try {
    const contract = await readContract(target, packageRoot, { taskId });
    contractFingerprint = contract.fingerprint;
  } catch {
    contractFingerprint = null;
  }

  const [repositoryFingerprint, changedPaths] = await Promise.all([
    repository.currentRepositoryFingerprint(target),
    repository.currentChangedPaths(target),
  ]);

  return {
    ...classifyContinuity({
      continuity: continuityArtifact.value,
      state,
      contractFingerprint,
      repositoryFingerprint,
      changedPaths,
    }),
    path: continuityArtifact.path,
    present: true,
    fingerprint: continuityArtifact.fingerprint,
    continuity: continuityArtifact.value,
    latestHandoff,
    lint: await lintContinuity({
      target,
      continuity: continuityArtifact.value,
      state,
    }),
    diagnosticContext: await deriveDiagnosticContextSafe({ target, packageRoot, state }),
  };
}

async function resolveLatestHandoffSafe(target, { packageRoot, taskId } = {}) {
  if (!taskId) return null;
  try {
    const { resolveLatestHandoff } = await import("./handoff.js");
    return await resolveLatestHandoff(target, { packageRoot, taskId });
  } catch (error) {
    return {
      status: "INVALID",
      error: {
        code: error.code ?? "E_HANDOFF_INVALID",
        message: error.message,
      },
    };
  }
}

async function deriveDiagnosticContextSafe({ target, packageRoot, state }) {
  try {
    const [{ withEventLedgerAudit }, { deriveDiagnosticContext }] = await Promise.all([
      import("./events.js"),
      import("./reflection.js"),
    ]);
    return await withEventLedgerAudit(target, packageRoot, { taskId: state?.taskId ?? null }, audit => {
      if (!audit.valid) return { present: false };
      return { present: true, ...deriveDiagnosticContext(audit.events, state) };
    });
  } catch {
    return { present: false };
  }
}
