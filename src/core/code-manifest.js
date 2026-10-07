import { withTaskTransaction } from "./transaction.js";
import { createHash } from "node:crypto";
import path from "node:path";

import { canonicalFingerprint, readJsonArtifact, writeJsonArtifact } from "./artifacts.js";
import { assertSchema, readSchema } from "./schema-validation.js";
import { assertSecretFree } from "./receipt.js";
import { getPackageRoot } from "./templates.js";
import { readContract } from "./contract.js";
import { readPersistedRoute } from "./route-artifact.js";
import { readWorkState } from "./work-state.js";
import { validateEventLedger } from "./events.js";
import {
  taskArtifactPath,
  taskCodeManifestPath,
  taskCodeManifestHistoryPath,
} from "./task-paths.js";
import { ensureWithin, fileExists } from "./filesystem.js";
import { operationalArtifactExists } from "../storage/operational-context.js";
import { resolveRevisionProvider } from "./revision/provider.js";
import { REVISION_PROVIDERS } from "./revision/registry.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const OPERATIONS = new Set(["ADDED", "MODIFIED", "DELETED", "RENAMED", "COPIED", "TYPE_CHANGED"]);
const KINDS = new Set(["FILE", "SYMLINK", "GITLINK", "DELETED"]);

function manifestError(code, message, artifacts = []) {
  const error = new Error(message);
  error.name = "CodeManifestError";
  error.code = code;
  error.artifacts = artifacts;
  return error;
}

function digestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizedPath(value, label = "path") {
  if (typeof value !== "string" || !value || value.startsWith("/") || value === "." || value === ".." || value.startsWith("../")) {
    throw manifestError("E_ATTESTATION_MANIFEST_INVALID", `${label} must be a safe relative path`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw manifestError("E_ATTESTATION_MANIFEST_INVALID", `${label} contains a control character`);
  }
  if (value.includes("\\")) {
    throw manifestError("E_ATTESTATION_MANIFEST_INVALID", `${label} must use forward slashes`);
  }
  const portable = value;
  const normalized = path.posix.normalize(portable).replace(/^\.\//u, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.startsWith(".forgeloop/")) {
    throw manifestError("E_ATTESTATION_MANIFEST_INVALID", `${label} is unsafe or reserved: ${value}`);
  }
  if (normalized !== portable) {
    throw manifestError("E_ATTESTATION_MANIFEST_INVALID", `${label} must use a normalized relative path: ${value}`);
  }
  return normalized;
}

export function codeManifestContentDigest(entries) {
  return canonicalFingerprint(entries.map((entry) => ({
    path: entry.path,
    sourcePath: entry.sourcePath ?? null,
    operation: entry.operation,
    kind: entry.kind,
    sha256: entry.sha256 ?? null,
    providerContentId: entry.providerContentId ?? null,
    providerMetadata: entry.providerMetadata ?? {},
  })));
}

function canonicalEntries(entries) {
  if (!Array.isArray(entries)) throw manifestError("E_ATTESTATION_MANIFEST_INVALID", "Manifest entries must be an array");
  const normalized = entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw manifestError("E_ATTESTATION_MANIFEST_INVALID", `Manifest entry ${index} must be an object`);
    const item = {
      path: normalizedPath(entry.path, `entries[${index}].path`),
      ...(entry.sourcePath !== undefined ? { sourcePath: normalizedPath(entry.sourcePath, `entries[${index}].sourcePath`) } : {}),
      operation: entry.operation,
      kind: entry.kind,
      ...(entry.sha256 !== undefined ? { sha256: entry.sha256 } : {}),
      ...(entry.providerContentId !== undefined ? { providerContentId: entry.providerContentId } : {}),
      ...(entry.providerMetadata !== undefined ? { providerMetadata: entry.providerMetadata } : {}),
    };
    if (!OPERATIONS.has(item.operation) || !KINDS.has(item.kind)) throw manifestError("E_ATTESTATION_MANIFEST_INVALID", `Manifest entry ${index} has an unsupported operation or kind`);
    if (item.operation === "DELETED" && item.kind !== "DELETED") throw manifestError("E_ATTESTATION_MANIFEST_INVALID", `Deleted entry ${item.path} must use kind DELETED`);
    if (item.kind === "DELETED" && item.operation !== "DELETED") throw manifestError("E_ATTESTATION_MANIFEST_INVALID", `Deleted entry ${item.path} must use operation DELETED`);
    if (item.kind === "DELETED" && item.sha256 !== undefined) throw manifestError("E_ATTESTATION_MANIFEST_INVALID", `Deleted entry ${item.path} cannot have sha256`);
    if (["FILE", "SYMLINK"].includes(item.kind) && !SHA256.test(item.sha256 ?? "")) throw manifestError("E_ATTESTATION_MANIFEST_INVALID", `Entry ${item.path} requires a lowercase SHA-256 content digest`);
    if (item.kind === "GITLINK" && (typeof item.providerContentId !== "string" || !item.providerContentId)) throw manifestError("E_ATTESTATION_MANIFEST_INVALID", `Gitlink entry ${item.path} requires providerContentId`);
    if (item.providerMetadata !== undefined && (!item.providerMetadata || typeof item.providerMetadata !== "object" || Array.isArray(item.providerMetadata))) throw manifestError("E_ATTESTATION_MANIFEST_INVALID", `Entry ${item.path} providerMetadata must be an object`);
    if (item.operation === "RENAMED" && !item.sourcePath) throw manifestError("E_ATTESTATION_MANIFEST_INVALID", `Renamed entry ${item.path} requires sourcePath`);
    return item;
  });
  const paths = normalized.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) throw manifestError("E_ATTESTATION_MANIFEST_INVALID", "Manifest entries must not contain duplicate paths");
  const sorted = [...normalized].sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(sorted) !== JSON.stringify(normalized)) throw manifestError("E_ATTESTATION_MANIFEST_INVALID", "Manifest entries must be sorted by normalized path");
  return normalized;
}

export async function validateCodeManifest(manifest, packageRoot = getPackageRoot()) {
  try {
    assertSchema(manifest, await readSchema("code-manifest", packageRoot), "code manifest");
    const entries = canonicalEntries(manifest.entries);
    if (manifest.contentDigest !== codeManifestContentDigest(entries)) throw manifestError("E_ATTESTATION_MANIFEST_INVALID", "Manifest contentDigest does not match its entries");
    assertSecretFree(manifest);
    return { ...manifest, entries };
  } catch (error) {
    if (error.code === "E_ATTESTATION_MANIFEST_INVALID") throw error;
    throw manifestError("E_ATTESTATION_MANIFEST_INVALID", error.message);
  }
}

async function completionCheckpoint(target, packageRoot, taskId, override = null) {
  if (override) {
    if (!Number.isInteger(override.seq) || override.seq < 1 || !SHA256.test(override.hash)) {
      throw manifestError("E_ATTESTATION_LEDGER_MISMATCH", "The candidate completion checkpoint is invalid");
    }
    return { seq: override.seq, hash: override.hash, ledger: null };
  }
  const ledger = await validateEventLedger(target, packageRoot, { taskId });
  const completion = ledger.events.findLast((event) => event.taskId === taskId && event.event === "COMPLETION_VALIDATED");
  if (!ledger.valid || !completion) throw manifestError("E_ATTESTATION_LEDGER_MISMATCH", "A valid COMPLETION_VALIDATED ledger checkpoint is required for a code manifest");
  return { seq: completion.seq, hash: completion.hash, ledger };
}

export async function createCodeManifest({
  target,
  packageRoot = getPackageRoot(),
  taskId,
  revisionProvider = null,
  baseRevision = null,
  headRevision = "WORKTREE",
  captureMode = "WORKTREE",
  candidateState = null,
  candidateReceipt = null,
  candidateCompletionCheckpoint = null,
} = {}) {
  let provider = revisionProvider;
  if (!provider || typeof provider === "string") {
    provider = await resolveRevisionProvider({ target, providerName: provider || "git", registry: REVISION_PROVIDERS });
  }
  const [contract, route, state, receipt, checkpoint] = await Promise.all([
    readContract(target, packageRoot, { taskId }),
    readPersistedRoute(target, packageRoot, { taskId }),
    candidateState ?? readWorkState(target, { packageRoot, taskId }),
    candidateReceipt
      ? { value: candidateReceipt, fingerprint: canonicalFingerprint(candidateReceipt) }
      : readJsonArtifact(target, taskArtifactPath(taskId, "receipt"), "execution-receipt", packageRoot),
    completionCheckpoint(target, packageRoot, taskId, candidateCompletionCheckpoint),
  ]);
  if (!state || state.phase !== "COMPLETE") throw manifestError("E_ATTESTATION_MANIFEST_STALE", "Code manifests can only be captured for a COMPLETE task");
  const observedRevision = headRevision === "WORKTREE"
    ? (await provider.getCurrentRevision(target)) ?? "WORKTREE"
    : headRevision;
  let entries;
  try {
    entries = await provider.getChangedEntries({ target, baseRevision, headRevision, paths: null });
  } catch (error) {
    throw manifestError(error.code ?? "E_REVISION_PROVIDER_INVALID", error.message);
  }
  const manifestEntries = [];
  for (const entry of entries) {
    const pathValue = normalizedPath(entry.path);
    if (pathValue.startsWith(".forgeloop/")) throw manifestError("E_ATTESTATION_MANIFEST_INVALID", `Protocol metadata cannot enter a code manifest: ${pathValue}`);
    const kind = entry.kind ?? (entry.operation === "DELETED" ? "DELETED" : "FILE");
    const bytes = entry.bytes ?? (kind === "DELETED" || kind === "GITLINK" ? null : await provider.readContent({ target, revision: headRevision, path: pathValue }));
    manifestEntries.push({
      path: pathValue,
      ...(entry.sourcePath ? { sourcePath: normalizedPath(entry.sourcePath, "sourcePath") } : {}),
      operation: entry.operation,
      kind,
      ...(bytes !== null && ["FILE", "SYMLINK"].includes(kind) ? { sha256: digestBytes(bytes) } : {}),
      ...(entry.providerContentId ? { providerContentId: entry.providerContentId } : {}),
      providerMetadata: entry.providerMetadata ?? {},
    });
  }
  manifestEntries.sort((left, right) => left.path.localeCompare(right.path));
  const providerMetadata = typeof provider.getProviderMetadata === "function"
    ? await provider.getProviderMetadata(target)
    : {};
  const manifest = await validateCodeManifest({
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    verificationCycle: state.verificationCycle ?? 1,
    capture: {
      mode: captureMode,
      revisionProvider: provider.name ?? "unknown",
      baseRevision,
      observedRevision,
      providerMetadata,
    },
    bindings: {
      contractFingerprint: contract.fingerprint,
      routeFingerprint: route.fingerprint ?? null,
      stateFingerprint: canonicalFingerprint(state),
      receiptFingerprint: receipt.fingerprint,
      ledgerSeq: checkpoint.seq,
      ledgerHash: checkpoint.hash,
    },
    entries: manifestEntries,
    contentDigest: codeManifestContentDigest(manifestEntries),
  }, packageRoot);
  return { manifest, fingerprint: canonicalFingerprint(manifest), provider, checkpoint };
}

export async function readCodeManifest({ target, packageRoot = getPackageRoot(), taskId } = {}) {
  const relativePath = taskCodeManifestPath(taskId);
  try {
    const artifact = await readJsonArtifact(target, relativePath, "code-manifest", packageRoot);
    const value = await validateCodeManifest(artifact.value, packageRoot);
    return { ...artifact, value };
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING") throw manifestError("E_ATTESTATION_MANIFEST_MISSING", `Code manifest is missing: ${relativePath}`, [relativePath]);
    if (error.code?.startsWith("E_ATTESTATION_")) throw error;
    throw manifestError("E_ATTESTATION_MANIFEST_INVALID", error.message, [relativePath]);
  }
}

export async function writeCodeManifest(options = {}) {
  return withTaskTransaction({ target: options.target, taskId: options.taskId, packageRoot: options.packageRoot, operation: "code-manifest-capture" }, () => writeCodeManifestInTransaction(options));
}

async function writeCodeManifestInTransaction({ target, packageRoot = getPackageRoot(), taskId, manifest } = {}) {
  const value = await validateCodeManifest(manifest, packageRoot);
  const relativePath = taskCodeManifestPath(taskId);
  if (operationalArtifactExists(target, relativePath) ?? await fileExists(ensureWithin(target, relativePath))) {
    let previous;
    try {
      previous = await readCodeManifest({ target, packageRoot, taskId });
    } catch (error) {
      throw manifestError("E_ATTESTATION_MANIFEST_INVALID", `Existing code manifest cannot be versioned safely: ${error.message}`, [relativePath]);
    }
    const previousCycle = previous.value.verificationCycle;
    if (value.verificationCycle <= previousCycle) {
      throw manifestError("E_ATTESTATION_MANIFEST_INVALID", "Code manifest is immutable within a verification cycle", [relativePath]);
    }
    const historyPath = taskCodeManifestHistoryPath(taskId, previousCycle);
    if (!(operationalArtifactExists(target, historyPath) ?? await fileExists(ensureWithin(target, historyPath)))) {
      await writeJsonArtifact(target, historyPath, previous.value, "code-manifest", packageRoot, { taskId, operation: "code-manifest-history" });
    }
  }
  return writeJsonArtifact(target, relativePath, value, "code-manifest", packageRoot, { taskId, operation: "code-manifest-capture" });
}

export async function validateCodeManifestBindings({ target, packageRoot = getPackageRoot(), taskId, manifest, revisionProvider = null } = {}) {
  const value = await validateCodeManifest(manifest, packageRoot);
  const [contract, route, state, receipt, checkpoint] = await Promise.all([
    readContract(target, packageRoot, { taskId }),
    readPersistedRoute(target, packageRoot, { taskId }),
    readWorkState(target, { packageRoot, taskId }),
    readJsonArtifact(target, taskArtifactPath(taskId, "receipt"), "execution-receipt", packageRoot),
    completionCheckpoint(target, packageRoot, taskId),
  ]);
  const mismatches = [];
  if (value.taskId !== taskId) mismatches.push(["taskId", "E_ATTESTATION_SUBJECT_MISMATCH"]);
  if (value.verificationCycle !== (state.verificationCycle ?? 1)) mismatches.push(["verificationCycle", "E_ATTESTATION_SCOPE_MISMATCH"]);
  if (value.bindings.contractFingerprint !== contract.fingerprint) mismatches.push(["contractFingerprint", "E_ATTESTATION_CONTRACT_MISMATCH"]);
  if (value.bindings.routeFingerprint !== (route.fingerprint ?? null)) mismatches.push(["routeFingerprint", "E_ATTESTATION_ROUTE_MISMATCH"]);
  if (value.bindings.stateFingerprint !== canonicalFingerprint(state)) mismatches.push(["stateFingerprint", "E_ATTESTATION_STATE_MISMATCH"]);
  if (value.bindings.receiptFingerprint !== receipt.fingerprint) mismatches.push(["receiptFingerprint", "E_ATTESTATION_RECEIPT_MISMATCH"]);
  if (value.bindings.ledgerSeq !== checkpoint.seq || value.bindings.ledgerHash !== checkpoint.hash) mismatches.push(["ledger", "E_ATTESTATION_LEDGER_MISMATCH"]);
  if (mismatches.length > 0) {
    const names = mismatches.map(([name]) => name).join(", ");
    throw manifestError(mismatches[0][1], `Code manifest bindings are stale: ${names}`);
  }
  if (revisionProvider) {
    const provider = typeof revisionProvider === "string"
      ? await resolveRevisionProvider({ target, providerName: revisionProvider, registry: REVISION_PROVIDERS })
      : revisionProvider;
    const manifestPaths = new Set(value.entries.flatMap((entry) => [entry.path, entry.sourcePath].filter(Boolean)));
    const currentEntries = await provider.getChangedEntries({
      target,
      baseRevision: value.capture.baseRevision,
      headRevision: value.capture.mode === "WORKTREE" ? "WORKTREE" : value.capture.observedRevision,
    });
    const sourcePaths = (entries) => entries
      .flatMap((entry) => [entry.path, entry.sourcePath].filter(Boolean))
      .map((item) => normalizedPath(item))
      .filter((item) => item !== ".forgeloop" && !item.startsWith(".forgeloop/"));
    let currentPaths = new Set(sourcePaths(currentEntries));
    const manifestPathsPresent = [...manifestPaths].every((item) => currentPaths.has(item));
    if (!manifestPathsPresent && value.capture.mode === "WORKTREE" && value.capture.baseRevision) {
      const observedRevision = typeof provider.getCurrentRevision === "function"
        ? await provider.getCurrentRevision(target).catch(() => null)
        : null;
      if (observedRevision) {
        const committedEntries = await provider.getChangedEntries({ target, baseRevision: value.capture.baseRevision, headRevision: observedRevision });
        currentPaths = new Set(sourcePaths(committedEntries));
      }
    }
    if (![...manifestPaths].every((item) => currentPaths.has(item))) {
      throw manifestError("E_ATTESTATION_CONTENT_MISMATCH", "Current changed source paths differ from the code manifest");
    }
  }
  return { valid: true, manifest: value, fingerprint: canonicalFingerprint(value), checkpoint };
}
