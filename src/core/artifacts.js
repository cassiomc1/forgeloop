import { ARTIFACT_REGISTRY } from "./artifact-registry.js";
import { needsExistingProjectScope, withExistingProjectScope, assertNativeWritePath, isOperationalArtifactPath } from "../storage/existing-project-scope.js";
import { createHash } from "node:crypto";

import { assertSafePath, ensureWithin, fileExists, readBytes, writeFileAtomic } from "./filesystem.js";
import { assertSecretFree } from "./receipt.js";
import { assertJsonBytes, assertJsonLimits } from "./json-safety.js";
import { assertSchema, readSchema } from "./schema-validation.js";
import { getPackageRoot } from "./templates.js";
import { getTaskTransaction, withTaskTransaction } from "./transaction.js";
import { getOperationalStore, readOperationalText } from "../storage/operational-context.js";
import { withNativeReadScope } from "./native-storage.js";

const OPERATIONAL_SCHEMAS = new Set(Object.values(ARTIFACT_REGISTRY)
  .filter(artifact => artifact.scope !== "PROJECT" && artifact.schema)
  .map(artifact => artifact.schema));

export const ARTIFACT_PATHS = Object.freeze({
  contract: ".forgeloop/current-contract.json",
  route: ".forgeloop/routing-result.json",
  preflight: ".forgeloop/preflight.json",
  sources: ".forgeloop/sources.json",
  events: ".forgeloop/events.ndjson",
  session: ".forgeloop/session.json",
  config: ".forgeloop/config.json",
  gates: ".forgeloop/gates",
  state: ".forgeloop/work-state.json",
  continuity: ".forgeloop/continuity.json",
  receipt: ".forgeloop/execution-receipt.json",
  executionDirectory: ".forgeloop/executions",
});

export function executionArtifactPath(executionId) {
  if (typeof executionId !== "string" || !/^exec-[A-Za-z0-9_-]+$/.test(executionId)) {
    throw new ArtifactError("E_EXECUTION_REF_INVALID", "Execution reference must be a simple execution ID");
  }
  return `${ARTIFACT_PATHS.executionDirectory}/${executionId}.json`;
}

export class ArtifactError extends Error {
  constructor(code, message, artifacts = []) {
    super(message);
    this.name = "ArtifactError";
    this.code = code;
    this.artifacts = artifacts;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalFingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function artifactError(code, relativePath, error) {
  if (error instanceof ArtifactError) return error;
  return new ArtifactError(
    code,
    `${relativePath}: ${error.message}`,
    [relativePath],
  );
}

/** Validate already captured canonical bytes after their native read scope closes. */
export async function parseCapturedJsonArtifact(text, relativePath, schemaName, packageRoot = getPackageRoot()) {
  if (text === null) throw new ArtifactError("ARTIFACT_MISSING", `Artifact is missing: ${relativePath}`, [relativePath]);
  try {
    assertJsonBytes(text, relativePath);
    const value = JSON.parse(text);
    assertJsonLimits(value, relativePath);
    assertSchema(value, await readSchema(schemaName, packageRoot), relativePath);
    return { value, path: relativePath, fingerprint: canonicalFingerprint(value) };
  } catch (error) { throw artifactError(error.code === "JSON_LIMIT_EXCEEDED" ? error.code : "ARTIFACT_INVALID", relativePath, error); }
}

export async function readJsonArtifact(
  target,
  relativePath,
  schemaName,
  packageRoot = getPackageRoot(),
) {
  return withNativeReadScope(target, async () => {
    const operational = readOperationalText(target, relativePath);
    if (operational.selected) {
      return parseCapturedJsonArtifact(operational.text, relativePath, schemaName, packageRoot);
    }
    if (isOperationalArtifactPath(relativePath)) {
      try { await assertSafePath(target, relativePath); }
      catch (error) { throw artifactError("ARTIFACT_PATH_INVALID", relativePath, error); }
      if (!(await fileExists(ensureWithin(target, relativePath)))) {
        throw new ArtifactError("ARTIFACT_MISSING", `Artifact is missing: ${relativePath}`, [relativePath]);
      }
      throw new ArtifactError("E_STORAGE_MIGRATION_REQUIRED", "Operational JSON reads require canonical SQLite storage; migrate legacy state explicitly", [relativePath]);
    }
    return readPortableJsonArtifact(target, relativePath, schemaName, packageRoot);
  });
}

/** Explicit file inspection for migration inputs, portable exports and configuration. */
export async function readPortableJsonArtifact(target, relativePath, schemaName, packageRoot = getPackageRoot()) {
  try {
    await assertSafePath(target, relativePath);
  } catch (error) {
    throw artifactError("ARTIFACT_PATH_INVALID", relativePath, error);
  }

  const artifactPath = ensureWithin(target, relativePath);
  if (!(await fileExists(artifactPath))) {
    throw new ArtifactError(
      "ARTIFACT_MISSING",
      `Artifact is missing: ${relativePath}`,
      [relativePath],
    );
  }

  try {
    const bytes = await readBytes(artifactPath);
    return await parseCapturedJsonArtifact(bytes, relativePath, schemaName, packageRoot);
  } catch (error) {
    throw artifactError(
      ["JSON_LIMIT_EXCEEDED", "ARTIFACT_PATH_INVALID"].includes(error.code)
        ? error.code
        : "ARTIFACT_INVALID",
      relativePath,
      error,
    );
  }
}

export async function writeJsonArtifact(
  target,
  relativePath,
  value,
  schemaName,
  packageRoot = getPackageRoot(),
  { dryRun = false, taskId = null, operation = "write-artifact" } = {},
) {
  if (OPERATIONAL_SCHEMAS.has(schemaName) && !isOperationalArtifactPath(relativePath)) {
    throw new ArtifactError("E_STORAGE_OPERATION_UNSUPPORTED", "Operational artifacts require canonical SQLite identities; use explicit portable export", [relativePath]);
  }
  if (!getOperationalStore(target) && isOperationalArtifactPath(relativePath)) {
    await assertSafePath(target, relativePath);
    assertSecretFree(value);
    assertSchema(value, await readSchema(schemaName, packageRoot), relativePath);
    assertJsonLimits(value, relativePath);
    assertJsonBytes(`${JSON.stringify(value, null, 2)}\n`, relativePath);
    const { withProjectStorage } = await import("../storage/project-boundary.js");
    return withProjectStorage(target, () => writeJsonArtifact(target, relativePath, value, schemaName, packageRoot, { dryRun, taskId, operation }), { readOnly: dryRun });
  }
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => writeJsonArtifact(target, relativePath, value, schemaName, packageRoot, { dryRun, taskId, operation }), { readOnly: dryRun });
  }
  assertNativeWritePath(target, relativePath);
  const store = getOperationalStore(target);
  if (store?.recognizes(relativePath)) {
    assertSecretFree(value);
    assertSchema(value, await readSchema(schemaName, packageRoot), relativePath);
    assertJsonLimits(value, relativePath);
    const text = `${JSON.stringify(value, null, 2)}\n`;
    assertJsonBytes(text, relativePath);
    if (!dryRun) {
      const scopedTaskId = taskId ?? value.taskId ?? store.transaction?.taskId;
      if (!scopedTaskId) throw new ArtifactError("E_TASK_REQUIRED", "Operational artifact requires a task identity", [relativePath]);
      await withTaskTransaction({ target, taskId: scopedTaskId, operation, packageRoot }, tx => tx.stageJsonRecord(relativePath, text, schemaName));
    }
    return { path: relativePath, fingerprint: canonicalFingerprint(value), value };
  }
  return writePortableJsonArtifact(target, relativePath, value, schemaName, packageRoot, { dryRun });
}

/** Explicit interchange/configuration output; never canonical operational persistence. */
export async function writePortableJsonArtifact(target, relativePath, value, schemaName, packageRoot = getPackageRoot(), { dryRun = false } = {}) {
  if (isOperationalArtifactPath(relativePath)) throw new ArtifactError("E_STORAGE_OPERATION_UNSUPPORTED", "Portable output cannot replace a canonical operational namespace", [relativePath]);
  assertNativeWritePath(target, relativePath);
  if (!dryRun && await getTaskTransaction(target)) throw new ArtifactError("E_STORAGE_TRANSACTION_INVALID", "Portable output requires no active operational transaction", [relativePath]);
  try {
    await assertSafePath(target, relativePath);
  } catch (error) {
    throw artifactError("ARTIFACT_PATH_INVALID", relativePath, error);
  }
  try {
    const artifactPath = ensureWithin(target, relativePath);
    assertSecretFree(value);
    const schema = await readSchema(schemaName, packageRoot);
    assertSchema(value, schema, relativePath);
    assertJsonLimits(value, relativePath);
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    assertJsonBytes(serialized, relativePath);
    await writeFileAtomic(artifactPath, serialized, { dryRun });
    return { path: relativePath, fingerprint: canonicalFingerprint(value), value };
  } catch (error) {
    throw artifactError(
      error.code === "JSON_LIMIT_EXCEEDED" ? error.code : "ARTIFACT_INVALID",
      relativePath,
      error,
    );
  }
}
