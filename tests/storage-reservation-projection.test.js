import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createTaskDescriptor } from "../src/core/task-descriptor.js";
import { createWorkState } from "../src/core/work-state.js";
import { buildProtocolEvent } from "../src/core/events.js";
import { openStorageDatabase, runInTransaction, upsertTask, appendEvent, putArtifact } from "../src/storage/index.js";
import { EVENT_RESERVATION_PROOF_PREDICATE } from "../src/storage/schema.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { resolveStoreClaimState, resolveStoreReservationState } from "../src/storage/task-guards.js";

function originalProjection(db, taskId) {
  const result = resolveStoreClaimState(db, taskId);
  return result.valid && result.effectiveWriteClaims.length === 0 && result.claimState !== "ACTIVE" ? "RELEASED" : "ACTIVE";
}

function outcome(operation) {
  try { return { value: operation() }; }
  catch (error) { return { name: error.name, code: error.code, message: error.message }; }
}

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "forgeloop-reservation-"));
  return { db: openStorageDatabase(path.join(directory, "state.sqlite")), directory };
}

test("marker-bound schema five installs the optional index only through writable public admission", async () => {
  const target = mkdtempSync(path.join(os.tmpdir(), "forgeloop-index-admission-"));
  mkdirSync(path.join(target, ".forgeloop"));
  const filename = path.join(target, ".forgeloop/state.sqlite");
  const markerPath = path.join(target, ".forgeloop/storage-version.json");
  const markerBytes = JSON.stringify({ schemaVersion: 1, storageFormat: "sqlite", storageVersion: 1, phase: "ACTIVE",
    databaseSchemaVersion: 5, operationId: randomUUID(), sourceInventoryFingerprint: "a".repeat(64) });
  const db = openStorageDatabase(filename);
  try {
    db.exec("DROP INDEX events_reservation_proof_idx");
    writeFileSync(markerPath, markerBytes);
    const present = source => source.db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'events_reservation_proof_idx'").get();
    assert.equal(await withProjectStorage(target, present, { readOnly: true }), undefined);
    assert.ok(await withProjectStorage(target, present));
    assert.equal(readFileSync(markerPath, "utf8"), markerBytes);
    assert.equal(db.prepare("SELECT schema_version FROM storage_meta").get().schema_version, 5);
  } finally { db.close(); rmSync(target, { recursive: true, force: true }); }
});

test("reservation index follows independent canonical writes and falls back when absent or ineligible", () => {
  const { db, directory } = fixture();
  let writer;
  try {
    upsertTask(db, { taskId: "retention", descriptor: createTaskDescriptor({ taskId: "retention", writeClaims: ["src"] }),
      state: createWorkState({ taskId: "retention", phase: "RECEIVED", contractFingerprint: "0".repeat(64) }) });
    const event = buildProtocolEvent({ taskId: "retention", event: "TASK_RECEIVED" }, { checkpoint: { seq: 0, lastHash: null } });
    appendEvent(db, { taskId: "retention", event });
    const query = `SELECT 1 FROM events WHERE task_id = ? AND ${EVENT_RESERVATION_PROOF_PREDICATE} LIMIT 1`;
    assert.ok(db.prepare(`EXPLAIN QUERY PLAN ${query}`).all("retention").some(row => row.detail.includes("events_reservation_proof_idx")));
    writer = openStorageDatabase(path.join(directory, "state.sqlite"));
    writer.prepare("UPDATE events SET event_json = ? WHERE task_id = ?").run("null", "retention");
    assert.deepEqual(db.prepare(query).get("retention"), db.prepare(query.replace("FROM events WHERE", "FROM events NOT INDEXED WHERE")).get("retention"));
    const expected = outcome(() => originalProjection(db, "retention"));
    assert.deepEqual(outcome(() => resolveStoreReservationState(db, "retention")), expected);
    writer.exec("DROP INDEX events_reservation_proof_idx");
    assert.deepEqual(outcome(() => resolveStoreReservationState(db, "retention")), expected);
    // An independently changed index definition cannot substitute its predicate
    // for the canonical query. The planner must fall back to the original scan.
    writer.exec("CREATE INDEX events_reservation_proof_idx ON events(task_id) WHERE 0");
    assert.deepEqual(outcome(() => resolveStoreReservationState(db, "retention")), expected);
  } finally { writer?.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("optional index installation preserves schema five and every historical event byte", () => {
  const { db, directory } = fixture();
  let upgraded;
  try {
    upsertTask(db, { taskId: "retention", descriptor: createTaskDescriptor({ taskId: "retention", writeClaims: ["src"] }),
      state: createWorkState({ taskId: "retention", phase: "RECEIVED", contractFingerprint: "0".repeat(64) }) });
    appendEvent(db, { taskId: "retention", event: buildProtocolEvent({ taskId: "retention", event: "TASK_RECEIVED" }, { checkpoint: { seq: 0, lastHash: null } }) });
    db.prepare("UPDATE events SET event_json = ? WHERE task_id = ?").run("{malformed historical bytes", "retention");
    const before = db.prepare("SELECT * FROM events ORDER BY task_id, seq").all();
    db.exec("DROP INDEX events_reservation_proof_idx; UPDATE storage_meta SET schema_version = 5");
    const filename = path.join(directory, "state.sqlite");
    const readonly = openStorageDatabase(filename, { readOnly: true });
    try { assert.equal(readonly.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'events_reservation_proof_idx'").get(), undefined); }
    finally { readonly.close(); }
    const retained = openStorageDatabase(filename, { allowSchemaUpgrade: false });
    try { assert.equal(retained.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'events_reservation_proof_idx'").get(), undefined); }
    finally { retained.close(); }
    assert.equal(db.prepare("SELECT schema_version FROM storage_meta").get().schema_version, 5);
    upgraded = openStorageDatabase(filename);
    assert.equal(upgraded.prepare("SELECT schema_version FROM storage_meta").get().schema_version, 5);
    assert.deepEqual(upgraded.prepare("SELECT * FROM events ORDER BY task_id, seq").all(), before);
    assert.deepEqual(outcome(() => resolveStoreReservationState(upgraded, "retention")), outcome(() => originalProjection(upgraded, "retention")));
  } finally { upgraded?.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("reservation projection retains claims with identical corrupt-history error outcomes", () => {
  for (const claims of [[], ["src"]]) {
    for (const payload of [null, "{not-json", "null", "[]", "3", '{"event":"UNKNOWN","seq":1,"hash":"tampered"}']) {
      const { db, directory } = fixture();
      try {
        runInTransaction(db, () => {
          upsertTask(db, { taskId: "retention", descriptor: createTaskDescriptor({ taskId: "retention", writeClaims: claims }),
            state: createWorkState({ taskId: "retention", phase: "RECEIVED", contractFingerprint: "0".repeat(64) }) });
          if (payload !== null) {
            appendEvent(db, { taskId: "retention", event: buildProtocolEvent({ taskId: "retention", event: "TASK_RECEIVED" }, { checkpoint: { seq: 0, lastHash: null } }) });
            db.prepare("UPDATE events SET event_json = ? WHERE task_id = ?").run(payload, "retention");
          }
          assert.deepEqual(outcome(() => resolveStoreReservationState(db, "retention")), outcome(() => originalProjection(db, "retention")));
        });
      } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
    }
  }
});

test("completion and recovery candidates still use full ownership proof and retain unproven claims", () => {
  for (const phase of ["RECEIVED", "COMPLETE"]) {
    const { db, directory } = fixture();
    try {
      runInTransaction(db, () => {
        upsertTask(db, { taskId: "release-candidate", descriptor: createTaskDescriptor({ taskId: "release-candidate", writeClaims: ["src"] }),
          state: { ...createWorkState({ taskId: "release-candidate", phase: "RECEIVED", contractFingerprint: "0".repeat(64) }), phase } });
        if (phase !== "COMPLETE") putArtifact(db, { taskId: "release-candidate", kind: "recovery", artifactId: "current", payload: { taskId: "release-candidate", recoveryId: "unproven" }, fingerprint: "0".repeat(64) });
        assert.deepEqual(outcome(() => resolveStoreReservationState(db, "release-candidate")), outcome(() => originalProjection(db, "release-candidate")));
        assert.equal(resolveStoreReservationState(db, "release-candidate"), "ACTIVE");
        assert.equal(resolveStoreClaimState(db, "release-candidate").mutationAllowed, false);
      });
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  }
});

test("reservation binding scan preserves scalar SQL semantics and exact historical error outcomes", () => {
  const { db, directory } = fixture();
  try {
    upsertTask(db, { taskId: "retention", descriptor: createTaskDescriptor({ taskId: "retention", writeClaims: ["src"] }),
      state: createWorkState({ taskId: "retention", phase: "RECEIVED", contractFingerprint: "0".repeat(64) }) });
    const event = buildProtocolEvent({ taskId: "retention", event: "TASK_RECEIVED" }, { checkpoint: { seq: 0, lastHash: null } });
    appendEvent(db, { taskId: "retention", event });
    // Independent pre-optimization predicate: notably SQLite IS treats true
    // and integer 1 alike, whereas JSON array text does not. Reservation is
    // conservative retention only; the full mutation guard still validates.
    const previousScan = db.prepare(`SELECT 1 FROM events NOT INDEXED WHERE task_id = ?
      AND CASE WHEN json_valid(event_json) = 0 THEN 1
        ELSE json_type(event_json) <> 'object'
          OR json_extract(event_json, '$.taskId') IS NOT task_id
          OR json_extract(event_json, '$.seq') IS NOT seq
          OR json_extract(event_json, '$.hash') IS NOT hash
          OR json_extract(event_json, '$.previousHash') IS NOT previous_hash
          OR json_extract(event_json, '$.at') IS NOT at
          OR json_extract(event_json, '$.event') IS NOT event_type
          OR json_extract(event_json, '$.event') IN
            ('CONTRACT_BOOTSTRAP_REPAIR_RECORDED', 'CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_RECORDED')
        END LIMIT 1`);
    const original = JSON.stringify(event);
    const payloads = [original, "{broken", "null", "true", "1", "[]", "{}",
      original.replace('"retention"', '"\\u0072etention"'),
      original.replace('"seq":1', '"seq":1.0'),
      original.replace('"seq":1', '"seq":1e0'),
      original.replace('"seq":1', '"seq":true'),
      original.replace('"seq":1', '"seq":false'),
      original.replace('"seq":1', '"seq":1,"seq":2'),
      original.replace('"seq":1', '"seq":2,"seq":1'),
      original.replace('"seq":1', '"seq":-0'),
      original.replace('"seq":1', '"seq":1.0000000000000001'),
      JSON.stringify({ ...event, event: "CONTRACT_BOOTSTRAP_REPAIR_RECORDED" }),
      JSON.stringify({ ...event, event: "CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_RECORDED" }),
    ];
    for (const field of ["taskId", "seq", "hash", "previousHash", "at", "event"]) {
      for (const value of [null, false, true, 0, 1, "1", [], {}, "substituted"]) payloads.push(JSON.stringify({ ...event, [field]: value }));
      const missing = { ...event }; delete missing[field]; payloads.push(JSON.stringify(missing));
    }
    for (const payload of payloads) {
      db.prepare("UPDATE events SET event_json = ? WHERE task_id = ?").run(payload, "retention");
      const expected = outcome(() => previousScan.get("retention") ? originalProjection(db, "retention") : "ACTIVE");
      assert.deepEqual(outcome(() => resolveStoreReservationState(db, "retention")), expected, payload);
      assert.equal(db.prepare("SELECT event_json FROM events WHERE task_id = ?").get("retention").event_json, payload);
    }
    const restore = db.prepare("UPDATE events SET seq = ?, hash = ?, previous_hash = ?, at = ?, event_type = ?, event_json = ? WHERE task_id = ?");
    for (const column of ["seq", "hash", "previous_hash", "at", "event_type"]) {
      restore.run(event.seq, event.hash, event.previousHash, event.at, event.event, original, "retention");
      // SQLite's non-STRICT columns accept BLOB tampering. Error behavior must
      // still come from the canonical decoder, rather than JSON serialization
      // of the extracted columns failing with a different native error.
      db.prepare(`UPDATE events SET ${column} = ? WHERE task_id = ?`).run(Buffer.from("tampered"), "retention");
      const expected = outcome(() => previousScan.get("retention") ? originalProjection(db, "retention") : "ACTIVE");
      assert.deepEqual(outcome(() => resolveStoreReservationState(db, "retention")), expected, column);
    }
    for (const payload of [Buffer.from(original), Buffer.from("{}"), Buffer.from("{broken"), db.prepare("SELECT jsonb(?) AS value").get(original).value]) {
      restore.run(event.seq, event.hash, event.previousHash, event.at, event.event, payload, "retention");
      const expected = outcome(() => previousScan.get("retention") ? originalProjection(db, "retention") : "ACTIVE");
      assert.deepEqual(outcome(() => resolveStoreReservationState(db, "retention")), expected, "BLOB payload must preserve historical predicate and decoder outcomes");
      assert.deepEqual(Array.from(db.prepare("SELECT event_json FROM events WHERE task_id = ?").get("retention").event_json), Array.from(payload));
    }

  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
