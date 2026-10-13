import { ensureWithin, fileExists } from "./filesystem.js";
import { getPackageRoot } from "./templates.js";
import {
  LEGACY_TASK_ARTIFACT_PATHS,
  taskDirectory,
} from "./task-paths.js";
import { assertTaskId, taskStorageKey } from "./task-identity.js";
import { readPortableJsonArtifact } from "./artifacts.js";
import { validateMigrationSnapshot } from "./task-migration-validation.js";
import {
  E_TASK_MIGRATION_IDENTITY_MISMATCH,
  E_TASK_MIGRATION_INVALID,
} from "./error-codes.js";

export async function detectLegacySingletonLayout(target) {
  const legacyFiles = [];
  for (const [key, relPath] of Object.entries(LEGACY_TASK_ARTIFACT_PATHS)) {
    const fullPath = ensureWithin(target, relPath);
    if (await fileExists(fullPath)) {
      legacyFiles.push({ key, path: relPath });
    }
  }
  return {
    hasLegacy: legacyFiles.length > 0,
    legacyFiles,
  };
}

export async function migrateLegacyLayout(
  target,
  {
    dryRun = false,
    packageRoot = getPackageRoot(),
  } = {},
) {
  const detection = await detectLegacySingletonLayout(target);
  if (!detection.hasLegacy) {
    return {
      migrated: false,
      reason: "NO_LEGACY_STATE",
      message: "No legacy ForgeLoop 1.0 singleton artifacts found.",
    };
  }

  let canonicalTaskId = null;
  const artifactIdentities = [];

  const identitySchemas = { contract: "current-contract", state: "work-state", continuity: "continuity", receipt: "execution-receipt" };
  for (const item of detection.legacyFiles) {
    const schema = identitySchemas[item.key];
    if (!schema) continue;
    try {
      const artifact = await readPortableJsonArtifact(target, item.path, schema, packageRoot);
      if (artifact.value?.taskId) {
        canonicalTaskId ??= artifact.value.taskId;
        artifactIdentities.push({ artifact: item.key, taskId: artifact.value.taskId });
      }
    } catch (err) {
      const error = new Error(`Legacy ${item.key} artifact is invalid: ${err.message}`);
      error.code = E_TASK_MIGRATION_INVALID;
      error.cause = err;
      throw error;
    }
  }

  if (!canonicalTaskId) {
    const error = new Error("Unable to determine task ID from legacy singleton artifacts");
    error.code = E_TASK_MIGRATION_INVALID;
    throw error;
  }

  assertTaskId(canonicalTaskId);

  // Check for identity mismatches across legacy artifacts
  const mismatches = artifactIdentities.filter((a) => a.taskId !== canonicalTaskId);
  if (mismatches.length > 0) {
    const error = new Error(
      `Task identity mismatch during legacy migration: primary task is "${canonicalTaskId}", but ${mismatches.map((m) => `${m.artifact} has "${m.taskId}"`).join(", ")}`,
    );
    error.code = E_TASK_MIGRATION_IDENTITY_MISMATCH;
    error.mismatches = mismatches;
    throw error;
  }

  // 1. Validate complete legacy source snapshot fail-closed before creating any directories
  await validateMigrationSnapshot(target, {
    taskId: canonicalTaskId,
    packageRoot,
    paths: LEGACY_TASK_ARTIFACT_PATHS,
  });

  const taskKey = taskStorageKey(canonicalTaskId);
  const finalDirRel = taskDirectory(canonicalTaskId);
  const finalDirAbs = ensureWithin(target, finalDirRel);

  if (await fileExists(finalDirAbs)) {
    const error = new Error(`Target task directory already exists: ${finalDirRel}`);
    error.code = E_TASK_MIGRATION_INVALID;
    throw error;
  }

  if (dryRun) {
    return {
      migrated: false,
      dryRun: true,
      taskId: canonicalTaskId,
      taskKey,
      targetDirectory: finalDirRel,
      legacyFiles: detection.legacyFiles.map((f) => f.path),
    };
  }

  throw Object.assign(new Error("Filesystem task migration apply is retired; use explicit SQLite task migration with destination and excluded writers"), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
}
