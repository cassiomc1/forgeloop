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
  return discoverTasksInScope(target, packageRoot, taskKeys, DISCOVERY_PROJECTIONS.FULL);
}

/**
 * Internal integration projection. Discovery still validates every task and
 * records every snapshot observation, but releases the full task graph after
 * retaining only the public project/tasks fields and its canonical sort key.
 */
export async function discoverTaskSummaries(target, packageRoot = getPackageRoot(), { taskKeys = null } = {}) {
  return discoverTasksInScope(target, packageRoot, taskKeys, DISCOVERY_PROJECTIONS.SUMMARY);
}

/**
 * Internal task-list projection. It runs the same per-task validation and
 * snapshot/CAS observation as full discovery while retaining only the fields
 * consumed by the task-list command.
 */
export async function discoverTaskListEntries(target, packageRoot = getPackageRoot(), { taskKeys = null } = {}) {
  return discoverTasksInScope(target, packageRoot, taskKeys, DISCOVERY_PROJECTIONS.TASK_LIST);
}

const DISCOVERY_PROJECTIONS = Object.freeze({
  FULL: "full",
  SUMMARY: "summary",
  TASK_LIST: "task-list",
});

async function discoverTasksInScope(target, packageRoot, taskKeys, projection) {
  return withProjectReadSnapshot(target,
    () => discoverSelectedTasks(target, packageRoot, taskKeys, projection));
}

function projectTaskList(task) {
  if (task.healthy === false) {
    return {
      taskId: task.taskId ?? null,
      taskKey: task.taskKey,
      directory: task.directory,
      healthy: false,
      error: task.error,
    };
  }
  return {
    taskId: task.taskId,
    taskKey: task.taskKey,
    directory: task.directory,
    healthy: true,
    phase: task.phase,
    writeClaims: task.writeClaims ?? [],
    historicalWriteClaims: task.historicalWriteClaims ?? [],
    effectiveWriteClaims: task.effectiveWriteClaims ?? [],
    claimState: task.claimState,
    recovery: task.recovery,
    mutationAllowed: task.mutationAllowed,
    ownershipValid: task.ownershipValid,
    ownershipErrors: task.ownershipErrors ?? task.errors ?? [],
    reasonCodes: task.reasonCodes ?? [],
    locked: task.locked,
    hasContinuity: task.hasContinuity,
    hasReceipt: task.hasReceipt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function projectTask(task, projection) {
  if (projection === DISCOVERY_PROJECTIONS.FULL) return task;
  if (projection === DISCOVERY_PROJECTIONS.SUMMARY) return projectTaskSummary(task);
  return projectTaskList(task);
}

async function discoverTaskEntry(target, packageRoot, entry, projection) {
  const descriptorArtifact = await readTaskDescriptor(target, entry.name, packageRoot);
  const descriptor = descriptorArtifact.value;
  const taskId = descriptor.taskId;

  // P1-1: Verify descriptor taskKey matches the actual directory name
  if (descriptor.taskKey !== entry.name) {
    return projectTask({
      taskId: descriptor.taskId ?? null,
      taskKey: entry.name,
      directory: `${TASK_STATE_ROOT}/${entry.name}`,
      healthy: false,
      error: {
        code: "E_TASK_KEY_MISMATCH",
        message: `Task directory key "${entry.name}" does not match descriptor taskKey "${descriptor.taskKey}"`,
      },
    }, projection);
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
  const directory = `${TASK_STATE_ROOT}/${descriptor.taskKey}`;
  const locked = lockInfo !== null;

  if (projection === DISCOVERY_PROJECTIONS.SUMMARY) {
    return {
      taskId,
      healthy: true,
      phase,
      mutationAllowed: claimProjection.mutationAllowed !== false,
    };
  }

  if (projection === DISCOVERY_PROJECTIONS.TASK_LIST) {
    return projectTaskList({
      taskId,
      taskKey: descriptor.taskKey,
      directory,
      healthy: true,
      phase,
      writeClaims: claimProjection.writeClaims,
      historicalWriteClaims: claimProjection.historicalWriteClaims,
      effectiveWriteClaims: claimProjection.effectiveWriteClaims,
      claimState: claimProjection.claimState,
      recovery,
      mutationAllowed: claimProjection.mutationAllowed,
      ownershipValid: claimProjection.valid,
      ownershipErrors: claimProjection.ownershipErrors,
      reasonCodes: claimProjection.reasonCodes,
      locked,
      hasContinuity,
      hasReceipt,
      createdAt: descriptor.createdAt,
      updatedAt: descriptor.updatedAt,
    });
  }

  return {
    taskId,
    taskKey: descriptor.taskKey,
    healthy: true,
    phase,
    locked,
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
    directory,
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

function appendDiscoveredTask(tasks, task, projection, fallbackSortKey = null) {
  if (projection === DISCOVERY_PROJECTIONS.FULL) {
    tasks.push(task);
    return;
  }
  tasks.push({ sortKey: task.taskId ?? task.taskKey ?? fallbackSortKey, value: task });
}

function finishDiscoveredTasks(tasks, projection) {
  if (projection !== DISCOVERY_PROJECTIONS.FULL) {
    return tasks.sort((a, b) => a.sortKey.localeCompare(b.sortKey)).map(({ value }) => value);
  }
  return tasks.sort(compareDiscoveredTasks);
}

async function discoverSelectedTasks(target, packageRoot, taskKeys, projection = DISCOVERY_PROJECTIONS.FULL) {
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
      const readEntry = () => discoverTaskEntry(target, packageRoot, entry, projection);
      const taskId = store?.taskId({ taskKey: entry.name });
      const task = taskId
        ? await withEventLedgerAudit(target, packageRoot, { taskId }, readEntry)
        : await readEntry();
      appendDiscoveredTask(tasks, task, projection, entry.name);
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
        appendDiscoveredTask(tasks, projectTask({
          taskId: null,
          taskKey: entry.name,
          directory: `${TASK_STATE_ROOT}/${entry.name}`,
          healthy: false,
          error: classification.error,
        }, projection), projection, entry.name);
        continue;
      }
      // P1-2: Surface corrupt task namespaces instead of silently hiding them
      appendDiscoveredTask(tasks, projectTask({
        taskId: null,
        taskKey: entry.name,
        directory: `${TASK_STATE_ROOT}/${entry.name}`,
        healthy: false,
        error: {
          code: err.code ?? "E_TASK_DESCRIPTOR_INVALID",
          message: err.message ?? String(err),
        },
      }, projection), projection, entry.name);
    }
  }

  return finishDiscoveredTasks(tasks, projection);
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
