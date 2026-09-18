import { lstat, readFile as readBytesFromFile } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "../core/manifest.js";
import { ensureWithin, isPathWithin, realpathWithTransientWindowsRetry } from "../core/filesystem.js";
import { readPersistedRoute } from "../core/route-artifact.js";
import { readContract } from "../core/contract.js";
import { readGuideMetadata, requiredGatesForGuides } from "../core/guide-metadata.js";
import { optionalConfig } from "../core/preflight-loaders.js";
import { persistGate } from "../core/gate-artifact.js";
import { readWorkState } from "../core/work-state.js";
import { taskArtifactPath, taskGatePath } from "../core/task-paths.js";
import { withTaskMutation } from "../core/task-command.js";
import { PROTOCOL_VERSION } from "../core/protocol.js";
import { staleReasons } from "../core/next-action-artifacts.js";
import { ARTIFACT_PATHS } from "../core/artifacts.js";

const STATUSES = new Set(["satisfied", "unverified", "blocked"]);
const PRE_EXECUTION_PHASES = new Set(["ROUTED", "DESIGNING", "PLANNED"]);
const MAX_TEXT = 2000;
const MAX_REPEATABLE_ITEMS = 32;
const MAX_GATE_ARTIFACT_BYTES = 4 * 1024 * 1024;
const MAX_GATE_EVIDENCE_BYTES = 64 * 1024;
const CONFIG_REQUIRED_GATES_MARKER = "config.requiredGates";

const TASK_ARTIFACT_KEYS_BY_PATH = Object.freeze({
  [ARTIFACT_PATHS.state]: "state",
  [ARTIFACT_PATHS.contract]: "contract",
  [ARTIFACT_PATHS.route]: "route",
});

function gateError(message, options = {}) {
  const error = new Error(message);
  error.code = options.code ?? "E_GATE_INVALID";
  if (options.cause !== undefined) error.cause = options.cause;
  if (options.artifacts !== undefined) error.artifacts = options.artifacts;
  return error;
}

function taskScopedFreshnessPath(taskId, artifactPath) {
  const key = TASK_ARTIFACT_KEYS_BY_PATH[artifactPath];
  return key ? taskArtifactPath(taskId, key) : artifactPath;
}

function bounded(values, name, options = {}) {
  const maximum = options.maximum ?? MAX_REPEATABLE_ITEMS;
  if (!Array.isArray(values)) {
    throw gateError(`${name} must be an array`);
  }
  if (values.length > maximum) {
    throw gateError(`${name} entries must not exceed ${maximum}`);
  }
  if (values.some((value) => typeof value !== "string" || value.trim().length === 0 || value.length > MAX_TEXT)) {
    throw gateError(`${name} entries must be non-empty strings of at most ${MAX_TEXT} characters`);
  }
  return values.map((value) => value.trim());
}

async function hashArtifact(target, artifactPath) {
  if (typeof artifactPath !== "string" || !artifactPath || path.isAbsolute(artifactPath)) {
    throw gateError(`Gate artifact must be a project-relative path: ${artifactPath}`);
  }
  let candidate;
  try {
    candidate = ensureWithin(target, artifactPath);
  } catch (cause) {
    throw gateError(`Gate artifact escapes the project: ${artifactPath}`, { cause });
  }
  let stat;
  try {
    stat = await lstat(candidate);
  } catch (cause) {
    throw gateError(`Gate artifact is unavailable: ${artifactPath}`, { cause });
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw gateError(`Gate artifact must be a regular file: ${artifactPath}`);
  }
  if (stat.size > MAX_GATE_ARTIFACT_BYTES) {
    throw gateError(`Gate artifact exceeds the maximum size of ${MAX_GATE_ARTIFACT_BYTES} bytes: ${artifactPath}`);
  }
  const rootReal = await realpathWithTransientWindowsRetry(target);
  const candidateReal = await realpathWithTransientWindowsRetry(candidate).catch(() => null);
  if (!candidateReal || !isPathWithin(rootReal, candidateReal)) {
    throw gateError(`Gate artifact escapes the project: ${artifactPath}`);
  }
  return { path: artifactPath, sha256: sha256(await readBytesFromFile(candidateReal)) };
}

async function readEvidenceFile(target, evidencePath) {
  if (typeof evidencePath !== "string" || !evidencePath || path.isAbsolute(evidencePath)) {
    throw gateError(`Gate evidence must be a project-relative path: ${evidencePath}`);
  }
  try {
    const candidate = ensureWithin(target, evidencePath);
    const stat = await lstat(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not a regular file");
    if (stat.size > MAX_GATE_EVIDENCE_BYTES) throw new Error(`file exceeds ${MAX_GATE_EVIDENCE_BYTES} bytes`);
    const rootReal = await realpathWithTransientWindowsRetry(target);
    const candidateReal = await realpathWithTransientWindowsRetry(candidate);
    if (!isPathWithin(rootReal, candidateReal)) throw new Error("outside project");
    const bytes = await readBytesFromFile(candidateReal);
    if (bytes.length > MAX_GATE_EVIDENCE_BYTES) throw new Error(`file exceeds ${MAX_GATE_EVIDENCE_BYTES} bytes`);
    const value = JSON.parse(bytes.toString("utf8"));
    return { path: evidencePath, value };
  } catch (cause) {
    throw gateError(`Gate evidence file is invalid: ${evidencePath}`, { cause });
  }
}

async function assertCurrentRoute(target, packageRoot, taskId, state, route) {
  let contract;
  try {
    contract = await readContract(target, packageRoot, { taskId });
  } catch (cause) {
    throw gateError(`Cannot verify the active route against the current contract: ${cause.message}`, {
      code: "E_ROUTE_STALE",
      cause,
    });
  }
  const freshness = staleReasons(state, contract, route);
  if (freshness.length === 0) return;
  const reason = freshness.find((entry) => entry.code === "E_ROUTE_STALE") ?? freshness[0];
  throw gateError(reason.message, {
    code: reason.code,
    artifacts: reason.artifacts.map((artifactPath) => taskScopedFreshnessPath(taskId, artifactPath)),
  });
}

export async function runGateRecord({ target, packageRoot, taskId, gate, status, artifacts = [], decisions = [], unknowns = [], assumptions = [], evidenceFile = null } = {}) {
  if (!STATUSES.has(status)) {
    throw gateError(`Invalid gate status: ${status}`);
  }
  return withTaskMutation(target, { taskId, packageRoot }, "gate-record", async (ctx) => {
    const state = await readWorkState(target, { packageRoot, taskId: ctx.taskId });
    if (!state || !PRE_EXECUTION_PHASES.has(state.phase)) {
      throw gateError(`gate-record is only available before execution; found ${state?.phase ?? "no phase"}`, { code: "E_PHASE_FREEZE" });
    }
    const route = await readPersistedRoute(target, packageRoot, { taskId: ctx.taskId });
    await assertCurrentRoute(target, packageRoot, ctx.taskId, state, route);
    const config = await optionalConfig(target, packageRoot, []);
    const required = [...new Set([...(await requiredGatesForGuides(route.value.guides, packageRoot)), ...(config.requiredGates ?? [])])];
    if (!required.includes(gate)) {
      throw gateError(`Gate is not required by the active route: ${gate}`, { code: "E_GATE_NOT_REQUIRED" });
    }
    const artifactPaths = bounded(artifacts, "artifact");
    const normalizedDecisions = bounded(decisions, "decision");
    const normalizedUnknowns = bounded(unknowns, "unknown");
    const approvedAssumptions = bounded(assumptions, "assumption");
    const fileEvidence = evidenceFile ? await readEvidenceFile(target, evidenceFile) : null;
    if (status === "satisfied" && (normalizedUnknowns.length > 0 || (normalizedDecisions.length === 0 && !fileEvidence))) {
      throw gateError("A satisfied gate requires no unknowns and at least one decision");
    }
    const hashedArtifacts = [];
    for (const artifactPath of artifactPaths) hashedArtifacts.push(await hashArtifact(target, artifactPath));
    const guideMetadata = await readGuideMetadata(packageRoot);
    const requiredBy = [
      ...route.value.guides.filter((guide) => (guideMetadata[guide]?.requiresGates ?? []).includes(gate)),
      ...((config.requiredGates ?? []).includes(gate) ? [CONFIG_REQUIRED_GATES_MARKER] : []),
    ];
    const value = {
      schemaVersion: 1,
      protocolVersion: PROTOCOL_VERSION,
      taskId: ctx.taskId,
      gate,
      status,
      requiredBy,
      artifacts: hashedArtifacts,
      decisions: normalizedDecisions,
      unknowns: normalizedUnknowns,
      approvedAssumptions,
      evidence: [
        ...normalizedDecisions.map((decision) => ({ kind: "CALLER_RECORDED", authority: "CALLER", text: decision })),
        ...(fileEvidence ? [{ kind: "CALLER_RECORDED", authority: "CALLER", path: fileEvidence.path, details: fileEvidence.value }] : []),
      ],
    };
    const persisted = await persistGate(target, value, packageRoot, { taskId: ctx.taskId });
    return { taskId: ctx.taskId, gate, status, path: persisted.path ?? persisted.relativePath ?? taskGatePath(ctx.taskId, gate), artifacts: hashedArtifacts };
  });
}

export function formatGateRecordResult(result) {
  return `gate: ${result.gate}\nstatus: ${result.status}\n`;
}
