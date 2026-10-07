import { needsExistingProjectScope, withExistingProjectScope } from "../storage/existing-project-scope.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { readJsonArtifact, readPortableJsonArtifact, writeJsonArtifact } from "./artifacts.js";
import { assertSchema, readSchema } from "./schema-validation.js";
import { getPackageRoot } from "./templates.js";
import { assertTaskDescriptorIdentity, assertTaskId, taskStorageKey } from "./task-identity.js";
import { normalizeWriteClaims } from "./task-scope.js";
import { taskArtifactPath, TASK_STATE_ROOT } from "./task-paths.js";
import { assertSafePath, ensureWithin, fileExists } from "./filesystem.js";
import { E_TASK_DESCRIPTOR_INVALID, E_TASK_NOT_FOUND } from "./error-codes.js";
import { operationalArtifactExists } from "../storage/operational-context.js";

export const TASK_DESCRIPTOR_SCHEMA_VERSION = 1;

export function createTaskDescriptor({
  taskId,
  writeClaims = [],
  createdAt = new Date().toISOString(),
  updatedAt = createdAt,
} = {}) {
  assertTaskId(taskId);
  const taskKey = taskStorageKey(taskId);
  const normalizedClaims = normalizeWriteClaims(writeClaims);

  const descriptor = {
    schemaVersion: TASK_DESCRIPTOR_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    taskId,
    taskKey,
    createdAt,
    updatedAt,
    writeClaims: normalizedClaims,
  };

  assertTaskDescriptorIdentity(descriptor, taskId, taskKey);
  return descriptor;
}

export async function validateTaskDescriptor(descriptor, packageRoot = getPackageRoot()) {
  assertTaskDescriptorIdentity(descriptor);
  const schema = await readSchema("task-descriptor", packageRoot);
  assertSchema(descriptor, schema, "task descriptor");
  return descriptor;
}

export async function readTaskDescriptor(target, taskIdOrKey, packageRoot = getPackageRoot()) {
  if (await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => readTaskDescriptor(target, taskIdOrKey, packageRoot), { readOnly: true });
  }
  // If it's a 64-char key, use it directly; otherwise derive storage key
  const isKey = typeof taskIdOrKey === "string" && /^[a-f0-9]{64}$/.test(taskIdOrKey);
  const relativePath = isKey
    ? `${TASK_STATE_ROOT}/${taskIdOrKey}/task.json`
    : taskArtifactPath(taskIdOrKey, "descriptor");

  const operationalExists = operationalArtifactExists(target, relativePath);
  if (operationalExists === null) await assertSafePath(target, relativePath);
  const fullPath = ensureWithin(target, relativePath);
  if (operationalExists === false || (operationalExists === null && !(await fileExists(fullPath)))) {
    const error = new Error(`Task descriptor not found: ${relativePath}`);
    error.code = E_TASK_NOT_FOUND;
    error.artifacts = [relativePath];
    throw error;
  }

  // An unselected legacy descriptor is inspection input, never writable authority.
  const reader = operationalExists === null ? readPortableJsonArtifact : readJsonArtifact;
  const artifact = await reader(target, relativePath, "task-descriptor", packageRoot);
  try {
    await validateTaskDescriptor(artifact.value, packageRoot);
  } catch (error) {
    error.code = E_TASK_DESCRIPTOR_INVALID;
    throw error;
  }
  return { ...artifact, ...artifact.value, value: artifact.value };
}

export async function writeTaskDescriptor(target, descriptor, packageRoot = getPackageRoot(), options = {}) {
  await validateTaskDescriptor(descriptor, packageRoot);
  const relativePath = options.relativePathOverride ?? taskArtifactPath(descriptor.taskId, "descriptor");
  return writeJsonArtifact(
    target,
    relativePath,
    descriptor,
    "task-descriptor",
    packageRoot,
    options,
  );
}
