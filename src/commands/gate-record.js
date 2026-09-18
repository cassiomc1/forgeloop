import { lstat, readFile as readBytesFromFile } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "../core/manifest.js";
import { ensureWithin, isPathWithin, realpathWithTransientWindowsRetry } from "../core/filesystem.js";
import { readPersistedRoute } from "../core/route-artifact.js";
import { requiredGatesForGuides } from "../core/guide-metadata.js";
import { optionalConfig } from "../core/preflight-loaders.js";
import { persistGate } from "../core/gate-artifact.js";
import { readWorkState } from "../core/work-state.js";
import { taskGatePath } from "../core/task-paths.js";
import { withTaskMutation } from "../core/task-command.js";
import { PROTOCOL_VERSION } from "../core/protocol.js";

const STATUSES = new Set(["satisfied", "unverified", "blocked"]);
const MAX_TEXT = 2000;

function bounded(values, name) {
  const result = Array.isArray(values) ? values : [];
  if (result.some((value) => typeof value !== "string" || value.trim().length === 0 || value.length > MAX_TEXT)) {
    const error = new Error(`${name} entries must be non-empty strings of at most ${MAX_TEXT} characters`);
    error.code = "E_GATE_INVALID";
    throw error;
  }
  return result.map((value) => value.trim());
}

async function hashArtifact(target, artifactPath) {
  if (typeof artifactPath !== "string" || !artifactPath || path.isAbsolute(artifactPath)) {
    const error = new Error(`Gate artifact must be a project-relative path: ${artifactPath}`);
    error.code = "E_GATE_INVALID";
    throw error;
  }
  let candidate;
  try {
    candidate = ensureWithin(target, artifactPath);
  } catch (error) {
    error.code = "E_GATE_INVALID";
    throw error;
  }
  let stat;
  try {
    stat = await lstat(candidate);
  } catch (error) {
    const wrapped = new Error(`Gate artifact is unavailable: ${artifactPath}`);
    wrapped.code = "E_GATE_INVALID";
    wrapped.cause = error;
    throw wrapped;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    const error = new Error(`Gate artifact must be a regular file: ${artifactPath}`);
    error.code = "E_GATE_INVALID";
    throw error;
  }
  const rootReal = await realpathWithTransientWindowsRetry(target);
  const candidateReal = await realpathWithTransientWindowsRetry(candidate).catch(() => null);
  if (!candidateReal || !isPathWithin(rootReal, candidateReal)) {
    const error = new Error(`Gate artifact escapes the project: ${artifactPath}`);
    error.code = "E_GATE_INVALID";
    throw error;
  }
  return { path: artifactPath, sha256: sha256(await readBytesFromFile(candidate)) };
}

async function readEvidenceFile(target, evidencePath) {
  if (typeof evidencePath !== "string" || !evidencePath || path.isAbsolute(evidencePath)) {
    const error = new Error(`Gate evidence must be a project-relative path: ${evidencePath}`);
    error.code = "E_GATE_INVALID";
    throw error;
  }
  let candidate;
  try {
    candidate = ensureWithin(target, evidencePath);
    const stat = await lstat(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not a regular file");
    const rootReal = await realpathWithTransientWindowsRetry(target);
    const candidateReal = await realpathWithTransientWindowsRetry(candidate);
    if (!isPathWithin(rootReal, candidateReal)) throw new Error("outside project");
    const bytes = await readBytesFromFile(candidate);
    if (bytes.length > 64 * 1024) throw new Error("file exceeds 64 KiB");
    const value = JSON.parse(bytes.toString("utf8"));
    return { path: evidencePath, value };
  } catch (cause) {
    const error = new Error(`Gate evidence file is invalid: ${evidencePath}`);
    error.code = "E_GATE_INVALID";
    error.cause = cause;
    throw error;
  }
}

export async function runGateRecord({ target, packageRoot, taskId, gate, status, artifacts = [], decisions = [], unknowns = [], assumptions = [], evidenceFile = null } = {}) {
  if (!STATUSES.has(status)) throw new Error(`Invalid gate status: ${status}`);
  return withTaskMutation(target, { taskId, packageRoot }, "gate-record", async (ctx) => {
    const state = await readWorkState(target, { packageRoot, taskId: ctx.taskId });
    if (!state || !["ROUTED", "DESIGNING", "PLANNED"].includes(state.phase)) {
      const error = new Error(`gate-record is only available before execution; found ${state?.phase ?? "no phase"}`);
      error.code = "E_PHASE_FREEZE";
      throw error;
    }
    const route = await readPersistedRoute(target, packageRoot, { taskId: ctx.taskId });
    const config = await optionalConfig(target, packageRoot, []);
    const required = [...new Set([...(await requiredGatesForGuides(route.value.guides, packageRoot)), ...(config.requiredGates ?? [])])];
    if (!required.includes(gate)) {
      const error = new Error(`Gate is not required by the active route: ${gate}`);
      error.code = "E_GATE_NOT_REQUIRED";
      throw error;
    }
    const normalizedDecisions = bounded(decisions, "decision");
    const normalizedUnknowns = bounded(unknowns, "unknown");
    const approvedAssumptions = bounded(assumptions, "assumption");
    const fileEvidence = evidenceFile ? await readEvidenceFile(target, evidenceFile) : null;
    if (status === "satisfied" && (normalizedUnknowns.length > 0 || (normalizedDecisions.length === 0 && !fileEvidence))) {
      const error = new Error("A satisfied gate requires no unknowns and at least one decision");
      error.code = "E_GATE_INVALID";
      throw error;
    }
    const hashedArtifacts = [];
    for (const artifact of artifacts) hashedArtifacts.push(await hashArtifact(target, artifact));
    const value = {
      schemaVersion: 1,
      protocolVersion: PROTOCOL_VERSION,
      taskId: ctx.taskId,
      gate,
      status,
      requiredBy: route.value.guides,
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
