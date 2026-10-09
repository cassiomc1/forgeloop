import { readdir } from "node:fs/promises";
import { setImmediate as nextTurn } from "node:timers/promises";
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
import { withNativeReadScope } from "./native-storage.js";
import { withProjectReadSnapshot } from "../storage/project-read-snapshot.js";

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
  return discoverTasksInScope(target, packageRoot, taskKeys, false);
}

/**
 * Internal integration projection. Discovery still validates every task and
 * records every snapshot observation, but releases the full task graph after
 * retaining only the public project/tasks fields and its canonical sort key.
 */
export async function discoverTaskSummaries(target, packageRoot = getPackageRoot(), { taskKeys = null } = {}) {
  return discoverTasksInScope(target, packageRoot, taskKeys, true);
}

async function discoverTasksInScope(target, packageRoot, taskKeys, summaryOnly) {
  return withProjectReadSnapshot(target,
    () => discoverSelectedTasks(target, packageRoot, taskKeys, summaryOnly));
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

function projectTaskSummary(task) {
  return {
    taskId: task.taskId,
    healthy: task.healthy !== false,
    phase: task.phase ?? null,
    mutationAllowed: task.mutationAllowed !== false,
  };
}

function compareDiscoveredTasks(a, b) {
  return (a.taskId ?? a.taskKey).localeCompare(b.taskId ?? b.taskKey);
}

function appendDiscoveredTask(tasks, task, summaryOnly) {
  if (!summaryOnly) {
    tasks.push(task);
    return;
  }
  tasks.push({ sortKey: task.taskId ?? task.taskKey, value: projectTaskSummary(task) });
}

function finishDiscoveredTasks(tasks, summaryOnly) {
  if (summaryOnly) return tasks.sort((a, b) => a.sortKey.localeCompare(b.sortKey)).map(({ value }) => value);
  return tasks.sort(compareDiscoveredTasks);
}

async function discoverSelectedTasks(target, packageRoot, taskKeys, summaryOnly = false) {
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
    // Native reads resolve synchronously. Let other requests run between
    // bounded groups without releasing the owned immutable snapshot.
    if (store && !store.transaction && !store.db.isTransaction && tasks.length > 0 && tasks.length % 16 === 0) await nextTurn();
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!/^[a-f0-9]{64}$/.test(entry.name)) continue;

    try {
      const readEntry = () => discoverTaskEntry(target, packageRoot, entry);
      const taskId = store?.taskId({ taskKey: entry.name });
      const task = taskId
        ? await withEventLedgerAudit(target, packageRoot, { taskId }, readEntry)
        : await readEntry();
      appendDiscoveredTask(tasks, task, summaryOnly);
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
        appendDiscoveredTask(tasks, {
          taskId: null,
          taskKey: entry.name,
          directory: `${TASK_STATE_ROOT}/${entry.name}`,
          healthy: false,
          error: classification.error,
        }, summaryOnly);
        continue;
      }
      // P1-2: Surface corrupt task namespaces instead of silently hiding them
      appendDiscoveredTask(tasks, {
        taskId: null,
        taskKey: entry.name,
        directory: `${TASK_STATE_ROOT}/${entry.name}`,
        healthy: false,
        error: {
          code: err.code ?? "E_TASK_DESCRIPTOR_INVALID",
          message: err.message ?? String(err),
        },
      }, summaryOnly);
    }
  }

  return finishDiscoveredTasks(tasks, summaryOnly);
}

export async function findTaskById(target, taskId, packageRoot = getPackageRoot()) {
  return withNativeReadScope(target, async () => {
    const taskKey = taskStorageKey(taskId);
    const store = getOperationalStore(target);
    if (store && !store.taskRow(taskKey)) return null;
    const tasks = await discoverTasks(target, packageRoot, store ? { taskKeys: [taskKey] } : {});
    return tasks.find((t) => t.healthy !== false && (t.taskId === taskId || t.taskKey === taskKey)) ?? null;
  });
}
