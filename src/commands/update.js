import { rmdir, unlink } from "node:fs/promises";

import { assertSafePath, fileExists, ensureWithin, readBytes, writeFileAtomic } from "../core/filesystem.js";
import {
  createManifest,
  PACKAGE_NAME,
  readManifest,
  sha256,
  writeManifest,
} from "../core/manifest.js";
import { readTemplateEntries } from "../core/templates.js";
import { isNativeAdapterPath, LAYOUT_VERSION, LEGACY_PROFILE_PATH } from "../core/target-layout.js";
import { isRepositoryCandidate } from "../repository-index/lifecycle.js";
import { setupRepositoryIndex } from "../repository-index/server.js";

const LEGACY_CLEANUP_DIRECTORIES = Object.freeze(["ENG", "schemas"]);

function migrationConflict(code, path, message) {
  return { code, path, message };
}

function addAction(actions, dryRun, action, path, details = {}) {
  actions.push({ action: dryRun ? `would-${action}` : action, path, ...details });
}

async function verifyWrite(filePath, expectedBytes) {
  const actualBytes = await readBytes(filePath);
  if (!actualBytes.equals(expectedBytes)) {
    const error = new Error(`Migration write verification failed for ${filePath}`);
    error.code = "E_MIGRATION_WRITE_VERIFY";
    throw error;
  }
}

async function removeEmptyLegacyDirectory(target, relativePath, dryRun) {
  await assertSafePath(target, relativePath);
  if (dryRun) return;
  try {
    await rmdir(ensureWithin(target, relativePath));
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
  }
}

function addLegacyCleanup(cleanupFiles, cleanupDirectories, relativePath, expectedLegacySha256) {
  cleanupFiles.set(relativePath, expectedLegacySha256);
  addLegacyCleanupDirectory(cleanupDirectories, relativePath);
}

function addLegacyCleanupDirectory(cleanupDirectories, relativePath) {
  for (const directory of LEGACY_CLEANUP_DIRECTORIES) {
    if (relativePath === directory || relativePath.startsWith(`${directory}/`)) {
      cleanupDirectories.add(directory);
    }
  }
}

function manifestRecord(sha256Value, preserve, legacySha256Value = null) {
  return {
    sha256: sha256Value,
    preserve,
    ...(legacySha256Value ? { legacySha256: legacySha256Value } : {}),
  };
}

async function notifyStage(hooks, stage, context) {
  if (typeof hooks?.afterStage === "function") await hooks.afterStage(stage, context);
}

async function cleanupLegacyFiles({ target, dryRun, cleanupFiles, cleanupDirectories, hooks, actions, conflicts }) {
  for (const [relativePath, expectedLegacySha256] of cleanupFiles) {
    if (typeof hooks?.beforeCleanup === "function") {
      await hooks.beforeCleanup(relativePath);
    }
    await assertSafePath(target, relativePath);
    const legacyPath = ensureWithin(target, relativePath);
    if (dryRun || !(await fileExists(legacyPath))) continue;
    const currentLegacySha256 = sha256(await readBytes(legacyPath));
    if (currentLegacySha256 !== expectedLegacySha256) {
      conflicts.push(migrationConflict(
        "E_LEGACY_FILE_MIGRATION_CONFLICT",
        relativePath,
        "Legacy file changed before cleanup; it was preserved.",
      ));
      actions.push({ action: "preserve-conflict", path: relativePath, reason: "changed-before-cleanup" });
      continue;
    }
    await unlink(legacyPath);
  }

  for (const relativePath of cleanupDirectories) {
    if (typeof hooks?.beforeCleanupDirectory === "function") {
      await hooks.beforeCleanupDirectory(relativePath);
    }
    await removeEmptyLegacyDirectory(target, relativePath, dryRun);
  }
}

async function migrateLegacyLayout({ target, dryRun, packageVersion, currentManifest, entries, hooks = {} }) {
  const nextManifest = createManifest(packageVersion);
  const actions = [];
  const conflicts = [];
  const writes = [];
  const cleanupFiles = new Map();
  const cleanupDirectories = new Set();

  // Validate every path before creating the migration plan or touching data.
  for (const entry of entries) {
    await assertSafePath(target, entry.relativePath);
    if (entry.legacyRelativePath !== entry.relativePath) {
      await assertSafePath(target, entry.legacyRelativePath);
    }
  }

  for (const entry of entries) {
    const destination = ensureWithin(target, entry.relativePath);
    const legacyDestination = ensureWithin(target, entry.legacyRelativePath);
    const sourceHash = sha256(entry.bytes);
    const destinationExists = await fileExists(destination);
    const legacyExists = entry.legacyRelativePath !== entry.relativePath
      && await fileExists(legacyDestination);
    const legacyRecord = currentManifest.files[entry.legacyRelativePath];
    const destinationRecord = currentManifest.files[entry.relativePath];

    if (isNativeAdapterPath(entry.relativePath)) {
      if (!destinationExists) {
        addAction(actions, dryRun, "create", entry.relativePath);
        writes.push({ destination, bytes: entry.bytes });
        nextManifest.files[entry.relativePath] = { sha256: sourceHash, preserve: false };
        continue;
      }

      const currentBytes = await readBytes(destination);
      const currentHash = sha256(currentBytes);
      if (legacyRecord && currentHash === sourceHash) {
        actions.push({ action: "skip", path: entry.relativePath, reason: "current-shim" });
        nextManifest.files[entry.relativePath] = manifestRecord(sourceHash, false);
        continue;
      }
      if (legacyRecord && currentHash === legacyRecord.sha256) {
        if (currentHash === sourceHash) {
          actions.push({ action: "skip", path: entry.relativePath, reason: "current-shim" });
        } else {
          addAction(actions, dryRun, "update-adapter", entry.relativePath);
          writes.push({ destination, bytes: entry.bytes });
        }
        nextManifest.files[entry.relativePath] = { sha256: sourceHash, preserve: false };
        continue;
      }

      conflicts.push(migrationConflict(
        "E_NATIVE_ADAPTER_MIGRATION_CONFLICT",
        entry.relativePath,
        legacyRecord
          ? "Managed native adapter was modified; it was preserved and was not silently overwritten."
          : "Native adapter is not owned by the legacy manifest; it was preserved and was not silently adopted.",
      ));
      addAction(actions, dryRun, "preserve-conflict", entry.relativePath, {
        reason: legacyRecord ? "managed-modified" : "unmanaged",
      });
      if (legacyRecord) nextManifest.files[entry.relativePath] = { ...legacyRecord };
      continue;
    }

    if (destinationExists) {
      const currentBytes = await readBytes(destination);
      const currentHash = sha256(currentBytes);
      const hiddenMatchesSource = currentHash === sourceHash;
      const legacyBytes = legacyExists ? await readBytes(legacyDestination) : null;
      const legacyHash = legacyBytes ? sha256(legacyBytes) : null;
      const unchangedManagedLegacy = Boolean(legacyRecord) && legacyHash === legacyRecord.sha256;

      if (entry.sourcePath === LEGACY_PROFILE_PATH
        && legacyExists
        && legacyRecord
        && currentHash === legacyHash) {
        actions.push({ action: "skip", path: entry.relativePath, reason: "profile-move-resumed" });
        addLegacyCleanup(cleanupFiles, cleanupDirectories, entry.legacyRelativePath, legacyHash);
        nextManifest.files[entry.relativePath] = manifestRecord(currentHash, true, legacyHash);
        continue;
      }

      if (!hiddenMatchesSource && !destinationRecord && entry.sourcePath !== LEGACY_PROFILE_PATH) {
        conflicts.push(migrationConflict(
          "E_HIDDEN_KIT_MIGRATION_CONFLICT",
          entry.relativePath,
          "Existing hidden kit file is unmanaged and was not overwritten.",
        ));
        addAction(actions, dryRun, "preserve-conflict", entry.relativePath, { reason: "hidden-unmanaged" });
      } else if (hiddenMatchesSource && legacyExists && unchangedManagedLegacy) {
        actions.push({ action: "skip", path: entry.relativePath, reason: "hidden-ready" });
        addLegacyCleanup(cleanupFiles, cleanupDirectories, entry.legacyRelativePath, legacyHash);
        nextManifest.files[entry.relativePath] = manifestRecord(
          sourceHash,
          entry.sourcePath === LEGACY_PROFILE_PATH,
          legacyHash,
        );
        continue;
      } else if (hiddenMatchesSource && legacyExists) {
        const conflict = entry.sourcePath === LEGACY_PROFILE_PATH
          ? migrationConflict(
            "E_PROFILE_MIGRATION_CONFLICT",
            entry.legacyRelativePath,
            "A legacy project profile remains beside the hidden kit without a matching managed hash; both copies were preserved.",
          )
          : migrationConflict(
            "E_LEGACY_FILE_MIGRATION_CONFLICT",
            entry.legacyRelativePath,
            "A legacy file remains beside the hidden kit without a matching managed hash; it was preserved.",
          );
        conflicts.push(conflict);
        addAction(actions, dryRun, "preserve-conflict", entry.legacyRelativePath, { reason: "legacy-residual" });
      } else {
        actions.push({ action: "skip", path: entry.relativePath, reason: "already-present" });
      }
      nextManifest.files[entry.relativePath] = manifestRecord(
        currentHash,
        entry.sourcePath === LEGACY_PROFILE_PATH
          || !destinationRecord
          || Boolean(destinationRecord.preserve),
      );
      continue;
    }

    if (!legacyExists) {
      addAction(actions, dryRun, "create", entry.relativePath);
      writes.push({ destination, bytes: entry.bytes });
      nextManifest.files[entry.relativePath] = manifestRecord(sourceHash, entry.sourcePath === LEGACY_PROFILE_PATH);
      continue;
    }

    const legacyBytes = await readBytes(legacyDestination);
    const legacyHash = sha256(legacyBytes);
    const unchangedManaged = Boolean(legacyRecord) && legacyHash === legacyRecord.sha256;

    if (entry.sourcePath === LEGACY_PROFILE_PATH && legacyRecord) {
      addAction(actions, dryRun, "move-profile", entry.legacyRelativePath, { to: entry.relativePath });
      writes.push({ destination, bytes: legacyBytes });
      addLegacyCleanup(cleanupFiles, cleanupDirectories, entry.legacyRelativePath, legacyHash);
      nextManifest.files[entry.relativePath] = manifestRecord(legacyHash, true, legacyHash);
      continue;
    }

    if (legacyRecord?.preserve && unchangedManaged) {
      addAction(actions, dryRun, "move-preserved", entry.legacyRelativePath, { to: entry.relativePath });
      writes.push({ destination, bytes: legacyBytes });
      addLegacyCleanup(cleanupFiles, cleanupDirectories, entry.legacyRelativePath, legacyHash);
      nextManifest.files[entry.relativePath] = manifestRecord(legacyHash, true, legacyHash);
      continue;
    }

    if (unchangedManaged) {
      addAction(actions, dryRun, "migrate", entry.legacyRelativePath, { to: entry.relativePath });
      writes.push({ destination, bytes: entry.bytes });
      addLegacyCleanup(cleanupFiles, cleanupDirectories, entry.legacyRelativePath, legacyHash);
      nextManifest.files[entry.relativePath] = manifestRecord(sourceHash, false, legacyHash);
      continue;
    }

    const conflict = entry.sourcePath === LEGACY_PROFILE_PATH
      ? migrationConflict(
        "E_PROFILE_MIGRATION_CONFLICT",
        entry.legacyRelativePath,
        "Project profile is not owned by the legacy manifest; it was preserved and was not overwritten or deleted.",
      )
      : migrationConflict(
        "E_LEGACY_FILE_MIGRATION_CONFLICT",
        entry.legacyRelativePath,
        legacyRecord
          ? "Managed legacy file was modified; it was preserved while the hidden canonical file was installed."
          : "Unmanaged legacy file was preserved while the hidden canonical file was installed.",
      );
    conflicts.push(conflict);
    addAction(actions, dryRun, "preserve-conflict", entry.legacyRelativePath, {
      to: entry.relativePath,
      reason: legacyRecord ? "managed-modified" : "unmanaged",
    });
    writes.push({ destination, bytes: entry.bytes });
    nextManifest.files[entry.relativePath] = manifestRecord(sourceHash, entry.sourcePath === LEGACY_PROFILE_PATH);
  }

  // Apply all hidden writes and verify their bytes before changing manifest authority.
  for (const plan of writes) {
    await writeFileAtomic(plan.destination, plan.bytes, { dryRun });
    if (!dryRun) await verifyWrite(plan.destination, plan.bytes);
  }
  await notifyStage(hooks, "HIDDEN_WRITTEN", { writes: writes.length });
  await notifyStage(hooks, "HIDDEN_VERIFIED", { writes: writes.length });

  // Atomic manifest replacement is the authority switch. Cleanup follows it and
  // remains recoverable because managed legacy hashes are retained in the record.
  await writeManifest(target, nextManifest, { dryRun });
  await notifyStage(hooks, "MANIFEST_SWITCHED", { cleanupFiles: [...cleanupFiles.keys()] });
  await cleanupLegacyFiles({ target, dryRun, cleanupFiles, cleanupDirectories, hooks, actions, conflicts });
  await notifyStage(hooks, "LEGACY_CLEANED", { cleanupFiles: [...cleanupFiles.keys()] });
  await notifyStage(hooks, "COMPLETE", { cleanupFiles: [...cleanupFiles.keys()] });
  return { actions, conflicts, manifest: nextManifest };
}

async function attachRepositoryIndexResult(result, { target, dryRun, packageRoot, repositoryIndex, repositoryIndexOptions = {} }) {
  if (!repositoryIndex) return result;
  if (!(await isRepositoryCandidate(target))) {
    return { ...result, repositoryIndex: { status: "DEFERRED", required: true, reason: "target is not a Git repository" } };
  }
  if (dryRun) {
    return { ...result, repositoryIndex: { status: "WOULD_SETUP", required: true, reason: "dry-run does not provision or execute the native index engine" } };
  }
  if (result.conflicts?.length > 0) {
    return { ...result, repositoryIndex: { status: "BLOCKED", required: true, reason: "update conflicts must be resolved before index maintenance" } };
  }
  const setup = await setupRepositoryIndex(target, { ...repositoryIndexOptions, packageRoot });
  return {
    ...result,
    repositoryIndex: {
      status: "READY",
      required: true,
      health: setup.status?.health ?? "READY",
      engine: setup.status?.engine ?? "tgrep",
      engineVersion: setup.status?.engineVersion ?? null,
      indexPath: setup.status?.indexPath ?? null,
      server: setup.status?.server ?? null,
    },
  };
}

export async function runUpdate({ target, dryRun, packageRoot, packageVersion, hooks = {}, repositoryIndex, repositoryIndexOptions }) {
  const currentManifest = await readManifest(target);
  if (!currentManifest) {
    throw new Error("No .forgeloop/manifest.json found; run forgeloop init first.");
  }

  const entries = await readTemplateEntries(packageRoot);
  if ((currentManifest.layoutVersion ?? 1) < LAYOUT_VERSION) {
    const result = await migrateLegacyLayout({ target, dryRun, packageVersion, currentManifest, entries, hooks });
    return attachRepositoryIndexResult(result, { target, dryRun, packageRoot, repositoryIndex, repositoryIndexOptions });
  }

  const nextManifest = structuredClone(currentManifest);
  const actions = [];
  const conflicts = [];
  const plans = [];
  const cleanupFiles = new Map();
  const cleanupDirectories = new Set();
  const pruneActions = [];
  const shippedPaths = new Set(entries.map((entry) => entry.relativePath));

  for (const relativePath of Object.keys(nextManifest.files)) {
    if (!shippedPaths.has(relativePath)) {
      pruneActions.push({
        action: dryRun ? "would-prune" : "pruned",
        path: relativePath,
        reason: "template-removed",
      });
    }
  }

  for (const entry of entries) {
    const destination = ensureWithin(target, entry.relativePath);
    await assertSafePath(target, entry.relativePath);
    const hasLegacyAlternative = entry.legacyRelativePath !== entry.relativePath;
    const legacyDestination = hasLegacyAlternative
      ? ensureWithin(target, entry.legacyRelativePath)
      : null;
    if (hasLegacyAlternative) await assertSafePath(target, entry.legacyRelativePath);
    const sourceHash = sha256(entry.bytes);
    const record = currentManifest.files[entry.relativePath];
    const exists = await fileExists(destination);

    if (hasLegacyAlternative && record?.legacySha256) {
      addLegacyCleanupDirectory(cleanupDirectories, entry.legacyRelativePath);
    }
    if (hasLegacyAlternative && await fileExists(legacyDestination)) {
      const legacyHash = sha256(await readBytes(legacyDestination));
      if (record?.legacySha256 && legacyHash === record.legacySha256) {
        addLegacyCleanup(cleanupFiles, cleanupDirectories, entry.legacyRelativePath, record.legacySha256);
      } else {
        conflicts.push({
          code: "E_LEGACY_FILE_MIGRATION_CONFLICT",
          path: entry.legacyRelativePath,
          message: record?.legacySha256
            ? "Legacy file changed after the migration authority switch; it was preserved."
            : "Legacy root file remains without ownership proof; it was preserved.",
        });
        actions.push({ action: "preserve-conflict", path: entry.legacyRelativePath, reason: "legacy-residual" });
      }
    }

    if (!exists) {
      plans.push({
        action: dryRun ? "would-create" : "created",
        destination,
        entry,
        record: {
          sha256: sourceHash,
          preserve: entry.sourcePath === LEGACY_PROFILE_PATH,
          ...(record?.legacySha256 ? { legacySha256: record.legacySha256 } : {}),
        },
      });
      continue;
    }

    if (!record) {
      actions.push({ action: "skip", path: entry.relativePath, reason: "unmanaged" });
      continue;
    }

    if (record.preserve || entry.sourcePath === LEGACY_PROFILE_PATH) {
      actions.push({ action: "skip", path: entry.relativePath, reason: "preserved" });
      continue;
    }

    const currentBytes = await readBytes(destination);
    const currentHash = sha256(currentBytes);
    if (currentHash !== record.sha256) {
      conflicts.push({
        path: entry.relativePath,
        message: "Local changes detected; file was not overwritten.",
      });
      actions.push({ action: "conflict", path: entry.relativePath });
      continue;
    }

    if (currentHash === sourceHash) {
      actions.push({ action: "skip", path: entry.relativePath, reason: "current" });
      continue;
    }

    plans.push({
      action: dryRun ? "would-update" : "updated",
      destination,
      entry,
      record: { ...record, sha256: sourceHash },
    });
  }

  if (conflicts.length > 0) {
    return attachRepositoryIndexResult({ actions, conflicts, manifest: currentManifest }, { target, dryRun, packageRoot, repositoryIndex, repositoryIndexOptions });
  }

  for (const relativePath of Object.keys(nextManifest.files)) {
    if (!shippedPaths.has(relativePath)) delete nextManifest.files[relativePath];
  }
  actions.push(...pruneActions);

  for (const plan of plans) {
    actions.push({ action: plan.action, path: plan.entry.relativePath });
    await writeFileAtomic(plan.destination, plan.entry.bytes, { dryRun });
    nextManifest.files[plan.entry.relativePath] = plan.record;
  }

  nextManifest.packageName = PACKAGE_NAME;
  nextManifest.packageVersion = packageVersion;
  await writeManifest(target, nextManifest, { dryRun });
  await cleanupLegacyFiles({ target, dryRun, cleanupFiles, cleanupDirectories, hooks, actions, conflicts });
  return attachRepositoryIndexResult({ actions, conflicts, manifest: nextManifest }, { target, dryRun, packageRoot, repositoryIndex, repositoryIndexOptions });
}
