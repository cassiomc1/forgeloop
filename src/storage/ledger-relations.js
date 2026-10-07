import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadStorageDriver } from "./runtime.js";
import { withLedgerRelationOwner } from "../core/ledger-relations.js";

function relationError(message) {
  return Object.assign(new Error(message), { code: "E_LEDGER_RELATION_INVALID" });
}

function keyText(key) {
  if (typeof key !== "string" && !(typeof key === "number" && Number.isFinite(key))) {
    throw relationError("Ledger relation keys must be strings or finite numbers");
  }
  return JSON.stringify(key);
}

/** Relation values are primitive metadata/source positions, never detached proof payloads. */
function valueText(value) {
  if (value !== undefined && value !== null && !["string", "number", "boolean"].includes(typeof value)) {
    throw relationError("Ledger relations store primitive metadata only");
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw relationError("Ledger relation numbers must be finite");
  return JSON.stringify({ value });
}

class RelationMap {
  #owner;
  #id;
  #resident = new Map();
  #bytes = 0;
  #position = 0;
  #spilled = false;

  constructor(owner, id) { this.#owner = owner; this.#id = id; }
  get spilled() { return this.#spilled; }

  #database() { this.#owner.assertActive(); return this.#owner.database(); }

  #spill() {
    for (const [key, value] of this.#resident) this.#write(key, value);
    this.#resident.clear();
    this.#bytes = 0;
    this.#spilled = true;
  }

  #write(key, value) {
    this.#database().prepare("INSERT INTO relations (relation_id, key_json, value_json, position) VALUES (?, ?, ?, ?) ON CONFLICT (relation_id, key_json) DO UPDATE SET value_json = excluded.value_json")
      .run(this.#id, keyText(key), valueText(value), this.#position++);
  }

  get size() {
    this.#owner.assertActive();
    return this.#spilled ? this.#database().prepare("SELECT COUNT(*) AS count FROM relations WHERE relation_id = ?").get(this.#id).count : this.#resident.size;
  }

  has(key) {
    this.#owner.assertActive();
    return this.#spilled ? Boolean(this.#database().prepare("SELECT 1 FROM relations WHERE relation_id = ? AND key_json = ?").get(this.#id, keyText(key))) : this.#resident.has(key);
  }

  get(key) {
    this.#owner.assertActive();
    if (!this.#spilled) return this.#resident.get(key);
    const row = this.#database().prepare("SELECT value_json FROM relations WHERE relation_id = ? AND key_json = ?").get(this.#id, keyText(key));
    return row ? JSON.parse(row.value_json).value : undefined;
  }

  set(key, value) {
    this.#owner.assertActive();
    const bytes = Buffer.byteLength(keyText(key)) + Buffer.byteLength(valueText(value));
    if (this.#spilled) { this.#write(key, value); return this; }
    const prior = this.#resident.has(key) ? Buffer.byteLength(keyText(key)) + Buffer.byteLength(valueText(this.#resident.get(key))) : 0;
    if (this.#resident.size >= 128 || this.#bytes - prior + bytes > 65_536) {
      this.#spill();
      this.#write(key, value);
    } else {
      this.#bytes += bytes - prior;
      this.#resident.set(key, value);
    }
    return this;
  }

  delete(key) {
    this.#owner.assertActive();
    if (this.#spilled) return this.#database().prepare("DELETE FROM relations WHERE relation_id = ? AND key_json = ?").run(this.#id, keyText(key)).changes !== 0;
    if (!this.#resident.has(key)) return false;
    this.#bytes -= Buffer.byteLength(keyText(key)) + Buffer.byteLength(valueText(this.#resident.get(key)));
    return this.#resident.delete(key);
  }

  *entries() {
    this.#owner.assertActive();
    if (!this.#spilled) {
      for (const pair of this.#resident) {
        this.#owner.assertActive();
        yield pair;
        this.#owner.assertActive();
      }
      return;
    }
    const rows = this.#database().prepare("SELECT key_json, value_json FROM relations WHERE relation_id = ? ORDER BY position").iterate(this.#id);
    for (const row of rows) {
      this.#owner.assertActive();
      yield [JSON.parse(row.key_json), JSON.parse(row.value_json).value];
      this.#owner.assertActive();
    }
    this.#owner.assertActive();
  }

  [Symbol.iterator]() { return this.entries(); }
}

class GroupedRelationSet {
  #owner;
  #id;
  #resident = new Map();
  #bytes = 0;
  #spilled = false;
  constructor(owner, id) { this.#owner = owner; this.#id = id; }
  #write(group, value) {
    this.#owner.database().prepare("INSERT OR IGNORE INTO grouped_relations (relation_id, group_json, member_json) VALUES (?, ?, ?)")
      .run(this.#id, keyText(group), keyText(value));
  }
  add(group, value) {
    this.#owner.assertActive();
    const groupJson = keyText(group);
    const memberJson = keyText(value);
    const key = JSON.stringify([groupJson, memberJson]);
    if (this.#spilled) { this.#write(group, value); return; }
    if (this.#resident.has(key)) return;
    const bytes = Buffer.byteLength(key);
    if (this.#resident.size >= 128 || this.#bytes + bytes > 65_536) {
      for (const [residentGroup, member] of this.#resident.values()) this.#write(residentGroup, member);
      this.#resident.clear();
      this.#bytes = 0;
      this.#spilled = true;
      this.#write(group, value);
    } else {
      this.#resident.set(key, [group, value]);
      this.#bytes += bytes;
    }
  }
  *values(group) {
    this.#owner.assertActive();
    const groupJson = keyText(group);
    if (!this.#spilled) {
      for (const [residentGroup, member] of this.#resident.values()) {
        this.#owner.assertActive();
        if (keyText(residentGroup) === groupJson) yield member;
        this.#owner.assertActive();
      }
    } else {
      const rows = this.#owner.database().prepare("SELECT member_json FROM grouped_relations WHERE relation_id = ? AND group_json = ? ORDER BY rowid").iterate(this.#id, groupJson);
      for (const row of rows) {
        this.#owner.assertActive();
        yield JSON.parse(row.member_json);
        this.#owner.assertActive();
      }
    }
    this.#owner.assertActive();
  }
}

class RelationSet {
  #map;
  constructor(map) { this.#map = map; }
  get size() { return this.#map.size; }
  get spilled() { return this.#map.spilled; }
  has(value) { return this.#map.has(value); }
  add(value) { this.#map.set(value, true); return this; }
  delete(value) { return this.#map.delete(value); }
  *values() { for (const [key] of this.#map) yield key; }
  [Symbol.iterator]() { return this.values(); }
}

/** Only scratch state may remain transactional across awaits; the live operational DB is untouched. */
function createRelationOwner() {
  let directory;
  let db;
  let active = true;
  let nextId = 0;
  const owner = {
    assertActive() { if (!active) throw relationError("Ledger relation owner has expired"); },
    database() {
      owner.assertActive();
      if (!db) {
        const { DatabaseSync } = loadStorageDriver();
        directory = mkdtempSync(path.join(os.tmpdir(), "forgeloop-ledger-relations-"));
        db = new DatabaseSync(path.join(directory, "relations.sqlite"));
        db.exec("PRAGMA cache_size = -1024; PRAGMA temp_store = FILE; CREATE TABLE relations (relation_id INTEGER NOT NULL, key_json TEXT NOT NULL, value_json TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (relation_id, key_json)); CREATE INDEX relation_order ON relations (relation_id, position); CREATE TABLE grouped_relations (relation_id INTEGER NOT NULL, group_json TEXT NOT NULL, member_json TEXT NOT NULL, UNIQUE (relation_id, group_json, member_json)); BEGIN");
      }
      return db;
    },
    map() { owner.assertActive(); return new RelationMap(owner, nextId++); },
    set() { return new RelationSet(owner.map()); },
    groupedSet() { owner.assertActive(); return new GroupedRelationSet(owner, nextId++); },
  };
  return { owner, close() {
    active = false;
    try { db?.close(); }
    finally { if (directory) rmSync(directory, { recursive: true, force: true }); }
  } };
}

export async function withSpilledLedgerRelations(callback) {
  const scope = createRelationOwner();
  try { return await withLedgerRelationOwner(scope.owner, () => callback(scope.owner)); }
  finally { scope.close(); }
}

export function withSpilledLedgerRelationsSync(callback) {
  if (callback.constructor?.name === "AsyncFunction") throw Object.assign(new TypeError("Synchronous relation owner cannot await a callback"), { code: "E_STORAGE_ASYNC_TRANSACTION" });
  const scope = createRelationOwner();
  try {
    const result = withLedgerRelationOwner(scope.owner, () => callback(scope.owner));
    if (result && typeof result.then === "function") throw Object.assign(new TypeError("Synchronous relation owner cannot await a callback"), { code: "E_STORAGE_ASYNC_TRANSACTION" });
    return result;
  } finally { scope.close(); }
}
