import { realpathSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

// Per-command storage scope selected at the project boundary. Actor command
// input cannot select a different backend or connection.
export const operationalContext = new AsyncLocalStorage();

export function assertCanonicalPersistence(persistence) {
  if (persistence !== null && persistence !== undefined) {
    throw Object.assign(new Error("Temporary command persistence capabilities are retired; use canonical project storage"), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
  }
}

export function getOperationalStore(target) {
  const store = operationalContext.getStore() ?? null;
  if (store?.active === false) {
    const error = new Error("Operational preparation scope has already closed");
    error.code = "E_STORAGE_TRANSACTION_EXPIRED";
    throw error;
  }
  let sameProject = !store || store.target === path.resolve(target);
  if (!sameProject) {
    try { sameProject = realpathSync(store.target) === realpathSync(target); }
    catch { sameProject = false; }
  }
  if (!sameProject) {
    const error = new Error("Operational store belongs to a different project");
    error.code = "E_TASK_CONTEXT_MISMATCH";
    throw error;
  }
  return store;
}

export function readOperationalText(target, relativePath) {
  const store = getOperationalStore(target);
  if (!store || !store.recognizes(relativePath)) return { selected: false, text: null };
  return { selected: true, text: store.readText(relativePath) };
}

export function operationalArtifactExists(target, relativePath) {
  const store = getOperationalStore(target);
  if (!store || !store.recognizes(relativePath)) return null;
  return typeof store.artifactExists === "function" ? store.artifactExists(relativePath) : store.readText(relativePath) !== null;
}

export function listOperationalArtifactNames(target, taskId, collection) {
  const store = getOperationalStore(target);
  return store ? store.listArtifactNames(taskId, collection) : null;
}
