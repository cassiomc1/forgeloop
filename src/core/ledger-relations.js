import { AsyncLocalStorage } from "node:async_hooks";

const owners = new AsyncLocalStorage();

/** Storage supplies an owned scratch backing; pure/array callers retain native collections. */
export function withLedgerRelationOwner(owner, callback) { return owners.run(owner, callback); }
export function ledgerRelationMap() { return owners.getStore()?.map() ?? new Map(); }
export function ledgerRelationSet() { return owners.getStore()?.set() ?? new Set(); }


/** Primitive grouped membership; storage may index groups without nested resident Sets. */
export function ledgerGroupedSet() {
  const owner = owners.getStore();
  if (owner?.groupedSet) return owner.groupedSet();
  const groups = new Map();
  return {
    add(group, value) {
      if (!groups.has(group)) groups.set(group, new Set());
      groups.get(group).add(value);
    },
    *values(group) { yield* groups.get(group) ?? []; },
  };
}
