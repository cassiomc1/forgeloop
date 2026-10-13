import { needsExistingProjectScope, withExistingProjectScope } from "../storage/existing-project-scope.js";
import { getOperationalStore } from "../storage/operational-context.js";

export async function withNativeReadScope(target, callback) {
  return (await needsExistingProjectScope(target)) ? withExistingProjectScope(target, callback, { readOnly: true }) : callback();
}

export function requireNativeStore(target, errorFactory, refusalMessage) {
  const store = getOperationalStore(target);
  if (!store) throw errorFactory("E_STORAGE_MIGRATION_REQUIRED", refusalMessage);
  return store;
}
