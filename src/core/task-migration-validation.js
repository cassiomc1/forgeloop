import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { ensureWithin, fileExists } from "./filesystem.js";
import { readPortableJsonArtifact } from "./artifacts.js";
import { validatePortableEventLedger } from "./events.js";
import {
  E_TASK_MIGRATION_IDENTITY_MISMATCH,
  E_TASK_MIGRATION_INVALID,
} from "./error-codes.js";

async function fingerprintFile(absolutePath) {
  const bytes = await readFile(absolutePath);
  return createHash("sha256").update(bytes).digest("hex");
}

export async function validateMigrationSnapshot(target, { taskId, packageRoot, paths }) {
  const artifactFingerprints = {};
  const directoryFingerprints = {};
  let eventCount = 0;

  const checkIdentity = (obj, relPath) => {
    if (obj && obj.taskId && obj.taskId !== taskId) {
      const error = new Error(`Task identity mismatch in ${relPath}: expected ${taskId}, got ${obj.taskId}`);
      error.code = E_TASK_MIGRATION_IDENTITY_MISMATCH;
      throw error;
    }
  };

  const jsonMap = {
    contract: "current-contract",
    route: "routing-result",
    preflight: "preflight",
    state: "work-state",
    continuity: "continuity",
    receipt: "execution-receipt",
  };

  for (const [key, schemaName] of Object.entries(jsonMap)) {
    const relPath = paths[key];
    if (relPath) {
      const absPath = ensureWithin(target, relPath);
      if (await fileExists(absPath)) {
        try {
          const { value } = await readPortableJsonArtifact(target, relPath, schemaName, packageRoot);
          checkIdentity(value, relPath);
          artifactFingerprints[key] = await fingerprintFile(absPath);
        } catch (err) {
          if (err.code === E_TASK_MIGRATION_IDENTITY_MISMATCH) throw err;
          const error = new Error(`Validation failed for ${relPath}: ${err.message}`);
          error.code = E_TASK_MIGRATION_INVALID;
          error.cause = err;
          throw error;
        }
      }
    }
  }

  if (paths.events) {
    const absPath = ensureWithin(target, paths.events);
    if (await fileExists(absPath)) {
      const ledger = await validatePortableEventLedger(target, packageRoot, { eventsPath: paths.events });
      if (!ledger.valid) {
        const error = new Error(`Event ledger validation failed for ${paths.events}: ${ledger.errors?.[0]?.message ?? "invalid ledger"}`);
        error.code = E_TASK_MIGRATION_INVALID;
        error.cause = ledger.errors?.[0];
        throw error;
      }
      for (const event of ledger.events) {
        checkIdentity(event, paths.events);
      }
      artifactFingerprints.events = await fingerprintFile(absPath);
      eventCount = ledger.events.length;
    }
  }

  const processDir = async (dirKey, dirRelPath, schemaName) => {
    if (!dirRelPath) return;
    const absPath = ensureWithin(target, dirRelPath);
    if (!(await fileExists(absPath))) return;

    const entries = await readdir(absPath, { withFileTypes: true });
    const fileHashes = [];

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        const error = new Error(`Symlinks not allowed in ${dirRelPath}: ${entry.name}`);
        error.code = E_TASK_MIGRATION_INVALID;
        throw error;
      }
      if (!entry.isFile()) {
        const error = new Error(`Unexpected non-file entry in ${dirRelPath}: ${entry.name}`);
        error.code = E_TASK_MIGRATION_INVALID;
        throw error;
      }
      if (!entry.name.endsWith(".json")) {
        const error = new Error(`Unexpected non-json file in ${dirRelPath}: ${entry.name}`);
        error.code = E_TASK_MIGRATION_INVALID;
        throw error;
      }

      const fileRelPath = path.posix.join(dirRelPath, entry.name);
      const fileAbsPath = path.join(absPath, entry.name);

      try {
        const { value } = await readPortableJsonArtifact(target, fileRelPath, schemaName, packageRoot);
        checkIdentity(value, fileRelPath);
        const hash = await fingerprintFile(fileAbsPath);
        fileHashes.push({ relPath: entry.name, hash });
      } catch (err) {
        if (err.code === E_TASK_MIGRATION_IDENTITY_MISMATCH) throw err;
        const error = new Error(`Validation failed for ${fileRelPath}: ${err.message}`);
        error.code = E_TASK_MIGRATION_INVALID;
        error.cause = err;
        throw error;
      }
    }

    if (fileHashes.length > 0) {
      fileHashes.sort((a, b) => a.relPath.localeCompare(b.relPath));
      let hashStr = "";
      for (const item of fileHashes) {
        hashStr += `${item.relPath}\0${item.hash}\n`;
      }
      directoryFingerprints[dirKey] = createHash("sha256").update(hashStr).digest("hex");
    } else {
      directoryFingerprints[dirKey] = createHash("sha256").update("").digest("hex");
    }
  };

  await processDir("gates", paths.gates, "gate");
  await processDir("executions", paths.executions, "execution");

  return {
    taskId,
    artifactFingerprints,
    directoryFingerprints,
    eventCount,
  };
}
