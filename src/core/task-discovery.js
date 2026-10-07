import { readdir } from "node:fs/promises";
import { ensureWithin, fileExists } from "./filesystem.js";
import { getPackageRoot } from "./templates.js";
import { TASK_STATE_ROOT, TASK_ARTIFACT_FILES, taskArtifactPath } from "./task-paths.js";
import { readTaskDescriptor } from "./task-descriptor.js";
import { readJsonArtifact, readPortableJsonArtifact } from "./artifacts.js";
import { readLockInfo } from "./task-lock.js";
import { taskStorageKey } from "./task-identity.js";
import { withEventLedgerAudit } from "./events.js";
import { resolveTaskClaimState } from "./task-claim-state.js";
import { getOperationalStore, operationalArtifactExists } from "../storage/operational-context.js";
import { needsExistingProjectScope, withExistingProjectScope } from "../storage/existing-project-scope.js";

/**
 * Explicitly recognized legacy-incidental artifacts that may legitimately
 * exist inside a 64-hex task-state directory WITHOUT a task.json descriptor.
 * A legacy preflight writes a task-scoped policy snapshot for a task that has
 * no modern namespace; that directory is not a task namespace. Any other
 * content makes the directory a corrupt modern task namespace that must fail
 * closed.
 */
const LEGACY_INCIDENTAL_ARTIFACTS = new Set([
  TASK_ARTIFACT_FILES.policySnapshot,
]);

/**
 * Classifies a 64-hex task-state directory whose task.json is missing.
 *
 *   - directory contains only explicitly recognized legacy-incidental
 *     artifacts (policy-snapshot.json) -> LEGACY_INCIDENTAL (ignored)
 *   - anything else, including an empty directory -> CORRUPT_TASK_NAMESPACE
 *     (no positive evidence of legitimate legacy spillover)
 */
async function classifyDescriptorlessTaskDirectory(target, taskKey) {
  const directory = ensureWithin(target, `${TASK_STATE_ROOT}/${taskKey}`);
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return {
      kind: "CORRUPT_TASK_NAMESPACE",
      error: {
        code: "E_TASK_DESCRIPTOR_INVALID",
        message: `Task namespace ${taskKey} is missing task.json`,
      },
    };
  }
  const names = new Set(entries.map((entry) => entry.name));
  if (names.size > 0 && [...names].every((name) => LEGACY_INCIDENTAL_ARTIFACTS.has(name))) {
    return { kind: "LEGACY_INCIDENTAL" };
  }
  return {
    kind: "CORRUPT_TASK_NAMESPACE",
    error: {
      code: "E_TASK_DESCRIPTOR_INVALID",
      message: `Task namespace ${taskKey} contains task artifacts but task.json is missing`,
    },
  };
}

async function readDiscoveryState(target, taskId, descriptor, packageRoot) {
  // Check work-state if available
  let state = null;
  let phase = null;
  let lastUpdated = descriptor.updatedAt ?? descriptor.createdAt;
  try {
    const reader = getOperationalStore(target) ? readJsonArtifact : readPortableJsonArtifact;
    const stateArtifact = await reader(
      target,
      taskArtifactPath(taskId, "state"),
      "work-state",
      packageRoot,
    );
    state = stateArtifact.value;
    phase = state.phase ?? null;
    if (state.lastUpdated) {
      lastUpdated = state.lastUpdated;
    }
  } catch {
    // State might not exist yet
  }
  return { state, phase, lastUpdated };
}

async function discoveryArtifactExists(target, taskId, kind, filename) {
  return operationalArtifactExists(target, taskArtifactPath(taskId, kind)) ?? await fileExists(filename);
}

export async function discoverTasks(target, packageRoot = getPackageRoot(), { taskKeys = null } = {}) {
  const read = () => discoverSelectedTasks(target, packageRoot, taskKeys);
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => discoverTasks(target, packageRoot, { taskKeys }), { readOnly: true });
  }
  const store = getOperationalStore(target);
  if (!store || store.transaction || store.writes.size || store.events.size || store.attachments.size) return read();
  const { withStorageSnapshot } = await import("../storage/snapshot.js");
  const { withOperationalReadSnapshot } = await import("../storage/unit-of-work.js");
  return withStorageSnapshot(store.db, db => withOperationalReadSnapshot({ db, target }, read));
}

async function discoverTaskEntry(target, packageRoot, entry) {
  const descriptorArtifact = await readTaskDescriptor(target, entry.name, packageRoot);
  const descriptor = descriptorArtifact.value;
  const taskId = descriptor.taskId;

  // P1-1: Verify descriptor taskKey matches the actual directory name
  if (descriptor.taskKey !== entry.name) {
    return {
      taskId: descriptor.taskId ?? null,
      taskKey: entry.name,
      directory: `${TASK_STATE_ROOT}/${entry.name}`,
      healthy: false,
      error: {
        code: "E_TASK_KEY_MISMATCH",
        message: `Task directory key "${entry.name}" does not match descriptor taskKey "${descriptor.taskKey}"`,
      },
    };
  }

  const { state, phase, lastUpdated } = await readDiscoveryState(target, taskId, descriptor, packageRoot);

  // Check lock status
  const lockInfo = await readLockInfo(target, taskId);

  // Check continuity & receipt presence
  const continuityPath = ensureWithin(target, taskArtifactPath(taskId, "continuity"));
  const hasContinuity = await discoveryArtifactExists(target, taskId, "continuity", continuityPath);

  const receiptPath = ensureWithin(target, taskArtifactPath(taskId, "receipt"));
  const hasReceipt = await discoveryArtifactExists(target, taskId, "receipt", receiptPath);

  const claimProjection = await resolveTaskClaimState(target, {
    taskId,
    packageRoot,
    descriptor,
    state,
  });
  const recovery = claimProjection.recovery;

  return {
    taskId,
    taskKey: descriptor.taskKey,
    healthy: true,
    phase,
    locked: lockInfo !== null,
    lockInfo,
    ...claimProjection,
    ownershipValid: claimProjection.valid,
    recovery,
    operatorRecoveredAt: recovery?.recoveredAt ?? null,
    createdAt: descriptor.createdAt,
    updatedAt: descriptor.updatedAt,
    lastUpdated,
    hasContinuity,
    hasReceipt,
    ...(claimProjection.errors.length > 0 ? { errors: claimProjection.errors } : {}),
    descriptor,
    directory: `${TASK_STATE_ROOT}/${descriptor.taskKey}`,
  };
}

async function discoverSelectedTasks(target, packageRoot, taskKeys) {
  const store = getOperationalStore(target);
  const rootPath = ensureWithin(target, TASK_STATE_ROOT);
  if (!store && !(await fileExists(rootPath))) {
    return [];
  }

  let entries = [];
  try {
    entries = store
      ? (taskKeys ?? store.listTaskKeys()).map(name => ({ name, isDirectory: () => true, isSymbolicLink: () => false }))
      : await readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const tasks = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!/^[a-f0-9]{64}$/.test(entry.name)) continue;

    try {
      const readEntry = () => discoverTaskEntry(target, packageRoot, entry);
      const taskId = store?.taskId({ taskKey: entry.name });
      const task = taskId
        ? await withEventLedgerAudit(target, packageRoot, { taskId }, readEntry)
        : await readEntry();
      tasks.push(task);
    } catch (err) {
      // A directory without a task.json descriptor is not automatically a
      // task namespace: classify by contents so explicitly recognized legacy
      // spillover (policy-snapshot.json) stays compatible while any modern
      // task artifact without a descriptor fails closed instead of silently
      // reopening the legacy singleton fallback.
      if (!store && (err.code === "E_TASK_NOT_FOUND" || err.code === "ARTIFACT_MISSING")) {
        const classification = await classifyDescriptorlessTaskDirectory(target, entry.name);
        if (classification.kind === "LEGACY_INCIDENTAL") {
          continue;
        }
        tasks.push({
          taskId: null,
          taskKey: entry.name,
          directory: `${TASK_STATE_ROOT}/${entry.name}`,
          healthy: false,
          error: classification.error,
        });
        continue;
      }
      // P1-2: Surface corrupt task namespaces instead of silently hiding them
      tasks.push({
        taskId: null,
        taskKey: entry.name,
        directory: `${TASK_STATE_ROOT}/${entry.name}`,
        healthy: false,
        error: {
          code: err.code ?? "E_TASK_DESCRIPTOR_INVALID",
          message: err.message ?? String(err),
        },
      });
    }
  }

  return tasks.sort((a, b) => (a.taskId ?? a.taskKey).localeCompare(b.taskId ?? b.taskKey));
}

export async function findTaskById(target, taskId, packageRoot = getPackageRoot()) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => findTaskById(target, taskId, packageRoot), { readOnly: true });
  }
  const taskKey = taskStorageKey(taskId);
  const store = getOperationalStore(target);
  if (store && !store.taskRow(taskKey)) return null;
  const tasks = await discoverTasks(target, packageRoot, store ? { taskKeys: [taskKey] } : {});
  return tasks.find((t) => t.healthy !== false && (t.taskId === taskId || t.taskKey === taskKey)) ?? null;
}
