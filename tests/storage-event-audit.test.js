import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";
import { withEventLedgerAudit, validateEventLedger, buildProtocolEvent, appendProtocolEvent } from "../src/core/events.js";
import { openStorageDatabase, appendEvent, runInTransaction, upsertTask } from "../src/storage/index.js";
import { withOperationalStore, withOperationalTransaction } from "../src/storage/unit-of-work.js";
import { getOperationalStore } from "../src/storage/operational-context.js";
import { readDecisionArtifact } from "../src/core/decision/artifact.js";
import { validateSemanticDecisionArtifactBindings } from "../src/core/decision/events.js";
import { buildTaskSnapshot, withTaskSnapshot } from "../src/core/task-snapshot.js";
import { buildTaskTrace } from "../src/core/trace.js";
import { canonicalFingerprint } from "../src/core/artifacts.js";
import { reconcileContinuity } from "../src/core/continuity-reconciliation.js";
import { deriveDiagnosticContext } from "../src/core/reflection.js";
import { runTaskShow } from "../src/commands/task-show.js";
import { runProgress } from "../src/commands/progress.js";
import { evaluateProgress } from "../src/core/progress.js";
import { discoverTasks } from "../src/core/task-discovery.js";
import { inspectTaskConflictState } from "../src/core/task-conflict-inspection.js";
import { collectTaskClaimEvidence, classifyTaskClaimState, resolveTaskClaimState, withTaskClaimEvidence } from "../src/core/task-claim-state.js";

test("semantic artifact validation preserves a real competing writer revision conflict", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const filename = path.join(f.target, ".forgeloop/state.sqlite");
  const db = openStorageDatabase(filename);
  const writer = openStorageDatabase(filename);
  try {
    const ledger = await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId });
    const semantic = ledger.events.find(event => event.event === "SEMANTIC_DECISION_RECORDED");
    assert.ok(semantic);
    await withOperationalStore({ db, target: f.target }, async () => {
      await assert.rejects(withOperationalTransaction({ ...f, operation: "semantic-conflict-control", recordCommitEvent: false }, async () => {
        await readDecisionArtifact(f.target, f.taskId, semantic.details.decisionId, f.packageRoot);
        const row = writer.prepare("SELECT descriptor_json, state_json FROM tasks WHERE task_id = ?").get(f.taskId);
        const descriptor = { ...JSON.parse(row.descriptor_json), updatedAt: "2030-01-01T00:00:00.000Z" };
        runInTransaction(writer, () => upsertTask(writer, { taskId: f.taskId, descriptor, state: JSON.parse(row.state_json) }));
        await assert.rejects(readDecisionArtifact(f.target, f.taskId, semantic.details.decisionId, f.packageRoot), { code: "E_STATE_REVISION_CONFLICT" });
        // This second read must fail before commit; a corrupt-ledger result
        // would erase the competing writer's revision-conflict diagnosis.
        await assert.rejects(validateSemanticDecisionArtifactBindings(f.target, f.packageRoot, [semantic]), { code: "E_STATE_REVISION_CONFLICT" });
        throw Object.assign(new Error("rollback conflict control"), { code: "E_STATE_REVISION_CONFLICT" });
      }), { code: "E_STATE_REVISION_CONFLICT" });
    });
    assert.equal((await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId })).valid, true);
  } finally { writer.close(); db.close(); await f.cleanup(); }
});

test("native callback audit preserves canonical proofs, artifact snapshot, and later mutation observations", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const filename = path.join(f.target, ".forgeloop/state.sqlite");
  const db = openStorageDatabase(filename);
  const writer = openStorageDatabase(filename);
  let retained;
  try {
    const expected = await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId });
    assert.equal(expected.valid, true);
    await withOperationalStore({ db, target: f.target }, async source => {
      await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, async audit => {
        assert.equal(Array.isArray(audit.events), false);
        assert.deepEqual({ valid: audit.valid, errors: audit.errors }, { valid: expected.valid, errors: expected.errors });
        assert.deepEqual([...audit.events], expected.events);
        retained = audit.events;
        const semantic = audit.events.find(event => event.event === "SEMANTIC_DECISION_RECORDED");
        assert.ok(semantic, "canonical routed fixture must include actual decision artifact bindings");
        const id = semantic.details.decisionId;
        const before = await readDecisionArtifact(f.target, f.taskId, id, f.packageRoot);
        writer.prepare("UPDATE task_artifacts SET payload_json = ? WHERE task_id = ? AND kind = 'decision' AND artifact_id = ?").run("{}", f.taskId, id);
        const changed = writer.prepare("SELECT payload_json FROM task_artifacts WHERE task_id = ? AND kind = 'decision' AND artifact_id = ?").get(f.taskId, id);
        assert.equal(changed.payload_json, "{}");
        await setImmediate();
        assert.deepEqual(await readDecisionArtifact(f.target, f.taskId, id, f.packageRoot), before);
        assert.deepEqual(await validateSemanticDecisionArtifactBindings(f.target, f.packageRoot, audit.events), []);
      });
      assert.throws(() => [...retained], { code: "E_STORAGE_TRANSACTION_EXPIRED" });
      assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
    });
    const invalid = await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, audit => ({ valid: audit.valid, errors: audit.errors }));
    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.some(error => error.message.includes("semantic decision artifact")));
  } finally { writer.close(); db.close(); await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("audit ledger observations reject a concurrent append after snapshot validation", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const filename = path.join(f.target, ".forgeloop/state.sqlite");
  const db = openStorageDatabase(filename);
  const writer = openStorageDatabase(filename);
  try {
    await withOperationalStore({ db, target: f.target }, async source => {
      await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, audit => {
        assert.equal(audit.valid, true);
        const last = audit.events.at(-1);
        const event = buildProtocolEvent({ taskId: f.taskId, event: "OBSERVATION", details: { message: "concurrent audit append" } }, { checkpoint: { seq: last.seq, lastHash: last.hash } });
        appendEvent(writer, { taskId: f.taskId, event });
        assert.equal(audit.events.at(-1).hash, last.hash);
      });
      assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
    });
  } finally { writer.close(); db.close(); await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("audit callback failure removes its owned database and prepared overlays keep array/CAS semantics", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const db = openStorageDatabase(path.join(f.target, ".forgeloop/state.sqlite"));
  let snapshotFile;
  let retained;
  try {
    await assert.rejects(withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, audit => {
      retained = audit.events;
      snapshotFile = getOperationalStore(f.target).db.prepare("PRAGMA database_list").all().find(row => row.name === "main").file;
      assert.notEqual(snapshotFile, path.join(f.target, ".forgeloop/state.sqlite"));
      throw new Error("intentional callback failure");
    }), /intentional callback failure/);
    assert.throws(() => retained.at(0), { code: "E_STORAGE_TRANSACTION_EXPIRED" });
    await assert.rejects(stat(snapshotFile), { code: "ENOENT" });
    await withOperationalStore({ db, target: f.target }, async () => {
      await assert.rejects(withOperationalTransaction({ ...f, operation: "audit-overlay-test", recordCommitEvent: false }, async () => {
        const event = await appendProtocolEvent(f.target, { taskId: f.taskId, event: "OBSERVATION", details: { message: "staged overlay" } }, f.packageRoot, { taskId: f.taskId });
        await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, audit => {
          assert.equal(Array.isArray(audit.events), true);
          assert.equal(audit.valid, true);
          assert.equal(audit.events.at(-1).hash, event.hash);
        });
        throw new Error("rollback test overlay");
      }), /rollback test overlay/);
    });
  } finally { db.close(); await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("native audit preserves handoff relation proofs beyond the scratch spill threshold", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const db = openStorageDatabase(path.join(f.target, ".forgeloop/state.sqlite"));
  try {
    let last = (await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId })).events.at(-1);
    const append = (event, details) => {
      last = buildProtocolEvent({ taskId: f.taskId, event, details }, { checkpoint: { seq: last.seq, lastHash: last.hash } });
      appendEvent(db, { taskId: f.taskId, event: last });
    };
    runInTransaction(db, () => {
      for (let index = 0; index < 1000; index += 1) {
        append("HANDOFF_CREATED", { handoffId: `handoff-${index}`, artifact: `handoffs/${index}.json`, digest: "a".repeat(64) });
        append("HANDOFF_ACCEPTED", { handoffId: `handoff-${index}`, handoffDigest: "a".repeat(64), consumerId: "consumer" });
      }
    });
    const observe = async () => {
      const expected = await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId });
      await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, audit => {
        assert.equal(Array.isArray(audit.events), false);
        assert.deepEqual({ valid: audit.valid, errors: audit.errors }, { valid: expected.valid, errors: expected.errors });
        assert.equal(audit.events.length, expected.events.length);
        assert.equal(audit.events.at(-1).hash, expected.events.at(-1).hash);
      });
      return expected;
    };
    assert.equal((await observe()).valid, true);
    append("HANDOFF_ACCEPTED", { handoffId: "handoff-999", handoffDigest: "a".repeat(64), consumerId: "consumer" });
    const invalid = await observe();
    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.some(error => error.code === "E_HANDOFF_ALREADY_ACCEPTED"));
  } finally { db.close(); await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("failed schema scan preserves public errors and cannot complete parent CAS observation", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const db = openStorageDatabase(path.join(f.target, ".forgeloop/state.sqlite"));
  try {
    const row = db.prepare("SELECT event_json FROM events WHERE task_id = ? ORDER BY seq LIMIT 1").get(f.taskId);
    const event = JSON.parse(row.event_json);
    event.schemaVersion = 2;
    db.prepare("UPDATE events SET event_json = ? WHERE task_id = ? AND seq = ?").run(JSON.stringify(event), f.taskId, event.seq);
    const expected = await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId });
    assert.equal(expected.valid, false);
    await withOperationalStore({ db, target: f.target }, async source => {
      await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, actual => {
        assert.deepEqual(actual, expected);
      });
      assert.throws(() => source.commit(), { code: "E_STORAGE_OBSERVATION_INCOMPLETE" });
    });
  } finally { db.close(); await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("internal async ownership reuses its immutable audit source while public evidence keeps arrays", async () => {
  const f = await buildCanonicalDiagnosisProject();
  try {
    const evidence = await collectTaskClaimEvidence(f.target, f);
    assert.equal(Array.isArray(evidence.ledger.events), true);
    const expected = classifyTaskClaimState(evidence);
    await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, async outer => {
      const originalDb = getOperationalStore(f.target).db;
      await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, nested => {
        assert.equal(nested.events, outer.events);
        assert.equal(getOperationalStore(f.target).db, originalDb);
      });
      assert.deepEqual(await resolveTaskClaimState(f.target, f), expected);
      assert.equal(outer.events.at(-1).hash, evidence.ledger.events.at(-1).hash);
      assert.equal(Array.isArray((await collectTaskClaimEvidence(f.target, f)).ledger.events), true);
    });
  } finally { await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("nested ownership does not inherit a tolerant legacy recovery audit result", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const db = openStorageDatabase(path.join(f.target, ".forgeloop/state.sqlite"));
  try {
    const last = (await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId })).events.at(-1);
    const event = buildProtocolEvent({ taskId: f.taskId, event: "OPERATOR_RECOVERY_RECORDED", details: { classification: "RECOVERABLE", reasonCodes: ["LEGACY_RECOVERY"], authorization: "OPERATOR_AUTHORIZED", note: "known defect fixture" } }, { checkpoint: { seq: last.seq, lastHash: last.hash } });
    appendEvent(db, { taskId: f.taskId, event });
    await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId, allowUnmigratedLegacyRecoveryEvents: true }, async outer => {
      assert.equal(outer.valid, true, JSON.stringify(outer.errors));
      await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, strict => {
        assert.equal(strict.events, outer.events);
        assert.equal(strict.valid, false);
        assert.ok(strict.errors.some(error => error.message.includes("not officially migrated")));
      });
      await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId, allowUnmigratedLegacyRecoveryEvents: true }, tolerant => {
        assert.equal(tolerant.valid, true, JSON.stringify(tolerant.errors));
        assert.equal(tolerant.events, outer.events);
      });
      const claims = await resolveTaskClaimState(f.target, f);
      assert.equal(claims.mutationAllowed, false);
      assert.equal(claims.claimState, "INCONSISTENT");
    });
  } finally { db.close(); await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});


test("conflict inspection consumes immutable claim evidence and preserves public classification", async () => {
  const f = await buildCanonicalDiagnosisProject();
  let retained;
  try {
    const options = { ...f, now: Date.parse("2030-01-01T00:00:00Z") };
    const expected = await inspectTaskConflictState(f.target, options);
    await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, async audit => {
      await withTaskClaimEvidence(f.target, f, evidence => {
        assert.equal(evidence.ledger.events, audit.events);
        assert.equal(Array.isArray(evidence.ledger.events), false);
        retained = evidence.ledger.events;
      });
      assert.deepEqual(await inspectTaskConflictState(f.target, options), expected);
    });
    assert.throws(() => retained.at(0), { code: "E_STORAGE_TRANSACTION_EXPIRED" });
  } finally { await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});


test("discovery reads its projected artifacts from the ledger snapshot during a concurrent task update", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const filename = path.join(f.target, ".forgeloop/state.sqlite");
  const db = openStorageDatabase(filename);
  const writer = openStorageDatabase(filename);
  try {
    const expected = await discoverTasks(f.target, f.packageRoot);
    await withOperationalStore({ db, target: f.target }, async source => {
      const prototype = Object.getPrototypeOf(source);
      const originalRead = prototype.readText;
      let changed = false;
      let observed = 0;
      prototype.readText = function(relativePath) {
        if (this.target === f.target && /\/(task|work-state)\.json$/.test(relativePath)) {
          observed++;
          assert.notEqual(this.db, db, "Discovery artifact projection must use the detached ledger owner");
          if (!changed) {
            changed = true;
            const row = writer.prepare("SELECT descriptor_json, state_json FROM tasks WHERE task_id = ?").get(f.taskId);
            const descriptor = { ...JSON.parse(row.descriptor_json), writeClaims: ["concurrent-new-claim"] };
            const state = { ...JSON.parse(row.state_json), lastUpdated: "2030-01-01T00:00:00.000Z" };
            runInTransaction(writer, () => upsertTask(writer, { taskId: f.taskId, descriptor, state }));
          }
        }
        return originalRead.call(this, relativePath);
      };
      try {
        assert.deepEqual(await discoverTasks(f.target, f.packageRoot), expected);
        assert.equal(changed, true);
        assert.ok(observed >= 2);
        assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
      } finally { prototype.readText = originalRead; }
    });
    const current = await discoverTasks(f.target, f.packageRoot);
    assert.deepEqual(current[0].descriptor.writeClaims, ["concurrent-new-claim"]);
    assert.equal(current[0].lastUpdated, "2030-01-01T00:00:00.000Z");
  } finally { writer.close(); db.close(); await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});


test("native progress preserves array decisions inside its snapshot and refuses invalid ledger authority", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const db = openStorageDatabase(path.join(f.target, ".forgeloop/state.sqlite"));
  try {
    const ledger = await validateEventLedger(f.target, f.packageRoot, f);
    const expected = { taskId: f.taskId, phase: f.state.phase, verificationCycle: f.state.verificationCycle,
      ...evaluateProgress({ state: f.state, events: ledger.events }) };
    assert.deepEqual(await runProgress(f), expected);
    await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, async () => {
      assert.deepEqual(await runProgress(f), expected);
    });
    const row = db.prepare("SELECT event_json FROM events WHERE task_id = ? ORDER BY seq LIMIT 1").get(f.taskId);
    const corrupt = { ...JSON.parse(row.event_json), hash: "0".repeat(64) };
    db.prepare("UPDATE events SET event_json = ?, hash = ? WHERE task_id = ? AND seq = ?").run(JSON.stringify(corrupt), corrupt.hash, f.taskId, corrupt.seq);
    const invalid = await validateEventLedger(f.target, f.packageRoot, f);
    assert.equal(invalid.valid, false);
    await assert.rejects(runProgress(f), { code: invalid.errors[0].code });
  } finally { db.close(); await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});


test("native continuity projects diagnostic context from its shared immutable audit owner", async () => {
  const f = await buildCanonicalDiagnosisProject();
  try {
    const ledger = await validateEventLedger(f.target, f.packageRoot, f);
    const expected = { present: true, ...deriveDiagnosticContext(ledger.events, f.state) };
    const outside = await reconcileContinuity(f);
    assert.deepEqual(outside.diagnosticContext, expected);
    await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, async audit => {
      const owner = getOperationalStore(f.target);
      const result = await reconcileContinuity(f);
      assert.equal(getOperationalStore(f.target).db, owner.db);
      assert.deepEqual(result.diagnosticContext, expected);
      assert.equal(audit.events.at(-1).hash, ledger.events.at(-1).hash);
    });
  } finally { await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});


test("native task snapshot preserves public fingerprint and arrays while internal source expires", async () => {
  const f = await buildCanonicalDiagnosisProject();
  let retained;
  try {
    const ledger = await validateEventLedger(f.target, f.packageRoot, f);
    const publicSnapshot = await buildTaskSnapshot(f);
    assert.equal(Array.isArray(publicSnapshot.events), true);
    assert.deepEqual(publicSnapshot.events, ledger.events);
    assert.equal(publicSnapshot.integrity.fingerprint, canonicalFingerprint(ledger.events.map(({ seq, event, at }) => ({ seq, event, at }))));
    assert.equal(publicSnapshot.consistent, true);
    await withTaskSnapshot(f, snapshot => {
      retained = snapshot.events;
      assert.equal(Array.isArray(snapshot.events), false);
      assert.deepEqual(snapshot.state, f.state);
      assert.deepEqual(snapshot.anchors, publicSnapshot.anchors);
      assert.deepEqual(snapshot.integrity, publicSnapshot.integrity);
    });
    assert.throws(() => retained.at(0), { code: "E_STORAGE_TRANSACTION_EXPIRED" });
  } finally { await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});


test("native trace preserves diagnostics and returns usable history after its audit owner closes", async () => {
  const f = await buildCanonicalDiagnosisProject();
  try {
    const ledger = await validateEventLedger(f.target, f.packageRoot, f);
    const trace = await buildTaskTrace(f);
    assert.equal(trace.integrity.valid, true);
    assert.equal(trace.events.length, ledger.events.length);
    assert.equal(trace.diagnostics.legacyDiagnoses.length,
      ledger.events.filter(event => event.event === "DIAGNOSIS_RECORDED" && event.taskId === f.taskId).length);
    await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, async () => {
      const nested = await buildTaskTrace(f);
      const omitCapture = value => ({ ...value, snapshot: { ...value.snapshot, capturedAt: null } });
      assert.deepEqual(omitCapture(nested), omitCapture(trace));
    });
    assert.doesNotThrow(() => JSON.stringify(trace));
    assert.equal(Array.isArray(trace.events), true);
  } finally { await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});


test("native trace streams ordered phase chronology across a large unrelated tail", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const db = openStorageDatabase(path.join(f.target, ".forgeloop/state.sqlite"));
  try {
    const before = await buildTaskTrace(f);
    let last = (await validateEventLedger(f.target, f.packageRoot, f)).events.at(-1);
    runInTransaction(db, () => {
      for (let index = 0; index < 1000; index += 1) {
        last = buildProtocolEvent({ taskId: f.taskId, event: "OBSERVATION", details: { index, payload: "x".repeat(1024) } },
          { checkpoint: { seq: last.seq, lastHash: last.hash } });
        appendEvent(db, { taskId: f.taskId, event: last });
      }
    });
    const after = await buildTaskTrace(f);
    assert.equal(after.integrity.valid, true);
    assert.equal(after.events.length, before.events.length + 1000);
    assert.deepEqual(after.events.slice(0, before.events.length), before.events);
    assert.ok(after.events.slice(before.events.length).every(event =>
      event.phase === before.events.at(-1).phase && event.phaseQuality === "derived"));
    assert.deepEqual(after.transitions, before.transitions);
    assert.deepEqual(after.diagnostics, before.diagnostics);
  } finally { db.close(); await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("portable trace retains last-write phase semantics for duplicate sequence keys", async () => {
  const f = await buildCanonicalDiagnosisProject();
  try {
    const first = buildProtocolEvent({ taskId: f.taskId, event: "TASK_RECEIVED", details: {} }, { checkpoint: { seq: 0, lastHash: null } });
    const second = buildProtocolEvent({ taskId: f.taskId, event: "VERIFICATION_STARTED", details: {} }, { checkpoint: { seq: 0, lastHash: first.hash } });
    const third = buildProtocolEvent({ taskId: f.taskId, event: "OBSERVATION", details: {} },
      { checkpoint: { seq: 1, lastHash: second.hash } });
    const eventsPath = "duplicate-trace.ndjson";
    await writeFile(path.join(f.target, eventsPath), [first, second, third].map(event => JSON.stringify(event)).join("\n") + "\n");
    const trace = await buildTaskTrace({ ...f, eventsPath });
    assert.equal(trace.integrity.valid, false);
    assert.deepEqual(trace.events.map(event => event.sequence), [1, 1, 2]);
    assert.deepEqual(trace.events.map(event => event.phase), ["VERIFYING", "VERIFYING", "VERIFYING"]);
    assert.deepEqual(trace.events.map(event => event.phaseQuality), ["authoritative", "authoritative", "derived"]);
  } finally { await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});


test("task-show projects one immutable artifact and claim snapshot during a concurrent update", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const filename = path.join(f.target, ".forgeloop/state.sqlite");
  const db = openStorageDatabase(filename);
  const writer = openStorageDatabase(filename);
  try {
    const expected = await runTaskShow(f);
    await withOperationalStore({ db, target: f.target }, async source => {
      const prototype = Object.getPrototypeOf(source);
      const originalRead = prototype.readText;
      let changed = false;
      prototype.readText = function(relativePath) {
        if (!changed && this.target === f.target && this.db !== db && /\/(task|work-state)\.json$/.test(relativePath)) {
          changed = true;
          const row = writer.prepare("SELECT descriptor_json, state_json FROM tasks WHERE task_id = ?").get(f.taskId);
          const descriptor = { ...JSON.parse(row.descriptor_json), writeClaims: ["concurrent-show-claim"], updatedAt: "2030-01-01T00:00:00.000Z" };
          runInTransaction(writer, () => upsertTask(writer, { taskId: f.taskId, descriptor, state: JSON.parse(row.state_json) }));
        }
        return originalRead.call(this, relativePath);
      };
      try {
        assert.deepEqual(await runTaskShow(f), expected);
        assert.equal(changed, true);
        assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
      } finally { prototype.readText = originalRead; }
    });
    const current = await runTaskShow(f);
    assert.equal(current.updatedAt, "2030-01-01T00:00:00.000Z");
    assert.deepEqual(current.writeClaims, ["concurrent-show-claim"]);
  } finally { writer.close(); db.close(); await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("nested audit proofs do not inherit mutated results or forged event sources", async () => {
  const f = await buildCanonicalDiagnosisProject();
  let expired;
  try {
    await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, async outer => {
      assert.equal(outer.valid, true);
      expired = outer.events;
      const store = getOperationalStore(f.target);
      const original = store.auditSource;
      outer.valid = false;
      outer.errors.push({ code: "FORGED", message: "caller mutation" });
      await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, nested => {
        assert.equal(nested.valid, true);
        assert.deepEqual(nested.errors, []);
      });
      const forged = JSON.parse(JSON.stringify([...outer.events]));
      forged[0].details = { ...forged[0].details, forged: true };
      store.auditSource = { ...original, events: forged };
      await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, nested => {
        assert.equal(nested.valid, false);
        assert.ok(nested.errors.some(error => error.code === "E_LEDGER_HASH_INVALID"));
      });
      store.auditSource = original;
      await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, nested => assert.equal(nested.valid, true));
    });
    await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, async () => {
      const store = getOperationalStore(f.target);
      store.auditSource = { ...store.auditSource, events: expired };
      await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, nested => {
        assert.equal(nested.valid, false);
        assert.ok(nested.errors.some(error => error.code === "E_STORAGE_TRANSACTION_EXPIRED"));
      });
    });
  } finally { await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("an external write invalidates the owned audit even when original event bytes are restored", async () => {
  const f = await buildCanonicalDiagnosisProject();
  try {
    await assert.rejects(withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, async outer => {
      assert.equal(outer.valid, true);
      const snapshot = getOperationalStore(f.target).db;
      const filename = snapshot.prepare("PRAGMA database_list").all().find(row => row.name === "main").file;
      const writer = openStorageDatabase(filename);
      try {
        const row = writer.prepare("SELECT event_json FROM events WHERE task_id = ? AND seq = 1").get(f.taskId);
        writer.prepare("UPDATE events SET event_json = ? WHERE task_id = ? AND seq = 1").run("{}", f.taskId);
        writer.prepare("UPDATE events SET event_json = ? WHERE task_id = ? AND seq = 1").run(row.event_json, f.taskId);
      } finally { writer.close(); }
      await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, nested => {
        assert.equal(nested.valid, false);
        assert.ok(nested.errors.some(error => error.code === "E_STATE_REVISION_CONFLICT"));
      });
    }), { code: "E_STATE_REVISION_CONFLICT" });
    assert.equal((await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId })).valid, true,
      "the live project and the next owned snapshot remain valid");
  } finally { await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});


test("raw filesystem writes invalidate an owned proof without a SQLite data-version change", async () => {
  const f = await buildCanonicalDiagnosisProject();
  try {
    await assert.rejects(withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, async outer => {
      assert.equal(outer.valid, true);
      const snapshot = getOperationalStore(f.target).db;
      const filename = snapshot.prepare("PRAGMA database_list").all().find(row => row.name === "main").file;
      const version = snapshot.prepare("PRAGMA data_version").get().data_version;
      const row = snapshot.prepare("SELECT event_json FROM events WHERE task_id = ? AND seq = 1").get(f.taskId);
      const hash = JSON.parse(row.event_json).hash;
      const bytes = await readFile(filename);
      const recordOffset = bytes.indexOf(Buffer.from(row.event_json));
      const hashOffset = Buffer.from(row.event_json).indexOf(Buffer.from(`"hash":"${hash}"`));
      assert.ok(recordOffset >= 0 && hashOffset >= 0, "the small fixture record is stored contiguously");
      const raw = await open(filename, "r+");
      try {
        await raw.write(Buffer.from([hash[0] === "a" ? 98 : 97]), 0, 1,
          recordOffset + hashOffset + Buffer.byteLength('"hash":"'));
      } finally { await raw.close(); }
      const observer = openStorageDatabase(filename, { readOnly: true });
      try {
        assert.notEqual(JSON.parse(observer.prepare("SELECT event_json FROM events WHERE task_id = ? AND seq = 1").get(f.taskId).event_json).hash, hash,
          "an independent connection observes the actual raw payload tamper");
      } finally { observer.close(); }
      assert.equal(snapshot.prepare("PRAGMA data_version").get().data_version, version,
        "raw filesystem writes do not invalidate SQLite's connection-local counter");
      await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, nested => {
        assert.equal(nested.valid, false);
        assert.ok(nested.errors.some(error => error.code === "E_STATE_REVISION_CONFLICT"));
      });
    }), { code: "E_STATE_REVISION_CONFLICT" });
    assert.equal((await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId })).valid, true);
  } finally { await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});


test("owned audit rejects private snapshot changes during callback without a nested audit", async () => {
  const f = await buildCanonicalDiagnosisProject();
  try {
    await assert.rejects(withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, async audit => {
      assert.equal(audit.valid, true);
      const snapshot = getOperationalStore(f.target).db;
      const filename = snapshot.prepare("PRAGMA database_list").all().find(row => row.name === "main").file;
      const writer = openStorageDatabase(filename);
      try {
        const row = writer.prepare("SELECT event_json FROM events WHERE task_id = ? AND seq = 1").get(f.taskId);
        const event = JSON.parse(row.event_json);
        event.hash = "f".repeat(64);
        writer.prepare("UPDATE events SET hash = ?, event_json = ? WHERE task_id = ? AND seq = 1")
          .run(event.hash, JSON.stringify(event), f.taskId);
      } finally { writer.close(); }
      await Promise.resolve();
      assert.equal(audit.events.at(0).hash, "f".repeat(64));
      audit.valid = false;
      return "must not escape";
    }), { code: "E_STATE_REVISION_CONFLICT" });
    assert.equal((await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId })).valid, true);
  } finally { await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

function installDecisionArtifactReadCounter(target) {
  const store = getOperationalStore(target);
  const prototype = Object.getPrototypeOf(store);
  const original = prototype.readText;
  let count = 0;
  prototype.readText = function countedRead(relativePath) {
    if (typeof relativePath === "string"
      && relativePath.includes("/decisions/")
      && relativePath.endsWith(".json")) count += 1;
    return original.call(this, relativePath);
  };
  return {
    count: () => count,
    restore: () => { prototype.readText = original; },
  };
}

test("owned semantic binding reuse reads each validated decision once in the exact audit scope", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const expected = await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId });
  const decisionCount = [...expected.events]
    .filter(event => event.event === "SEMANTIC_DECISION_RECORDED").length;
  assert.ok(decisionCount > 0, "canonical fixture must contain semantic decision records");
  const db = openStorageDatabase(path.join(f.target, ".forgeloop/state.sqlite"));
  try {
    await withOperationalStore({ db, target: f.target }, async () => {
      const counter = installDecisionArtifactReadCounter(f.target);
      try {
        await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, async outer => {
          assert.equal(outer.valid, true);
          const nestedClaims = await resolveTaskClaimState(f.target, f);
          assert.equal(nestedClaims.taskId, f.taskId);
          assert.equal(nestedClaims.valid, true);
          await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, nested => {
            assert.equal(nested.valid, true);
            assert.equal(nested.events, outer.events);
          });
        });
        assert.equal(counter.count(), decisionCount,
          "nested claim/audit paths must reuse successful semantic bindings without rereading artifacts");
      } finally { counter.restore(); }
    });
  } finally { db.close(); await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("owned semantic cache rejects a private snapshot decision-artifact tamper", async () => {
  const f = await buildCanonicalDiagnosisProject();
  try {
    await assert.rejects(withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, async outer => {
      assert.equal(outer.valid, true);
      const semantic = [...outer.events].find(event => event.event === "SEMANTIC_DECISION_RECORDED");
      assert.ok(semantic);
      const snapshot = getOperationalStore(f.target).db;
      const filename = snapshot.prepare("PRAGMA database_list").all().find(row => row.name === "main").file;
      const writer = openStorageDatabase(filename);
      try {
        const row = writer.prepare(
          "SELECT payload_json FROM task_artifacts WHERE task_id = ? AND kind = 'decision' AND artifact_id = ?",
        ).get(semantic.taskId, semantic.details.decisionId);
        assert.ok(row);
        const payload = JSON.parse(row.payload_json);
        payload.answers = { ...(payload.answers ?? {}), privateSnapshotTamper: true };
        const changed = writer.prepare(
          "UPDATE task_artifacts SET payload_json = ? WHERE task_id = ? AND kind = 'decision' AND artifact_id = ?",
        ).run(JSON.stringify(payload), semantic.taskId, semantic.details.decisionId);
        assert.equal(changed.changes, 1);
        await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, nested => {
          assert.equal(nested.valid, false);
          assert.ok(nested.errors.some(error => error.code === "E_STATE_REVISION_CONFLICT"));
        });
      } finally { writer.close(); }
    }), { code: "E_STATE_REVISION_CONFLICT" });
  } finally { await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("nested claim resolution retains live decision observations for parent CAS", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const expected = await resolveTaskClaimState(f.target, f);
  const filename = path.join(f.target, ".forgeloop/state.sqlite");
  const db = openStorageDatabase(filename);
  const writer = openStorageDatabase(filename);
  try {
    await withOperationalStore({ db, target: f.target }, async source => {
      await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, async outer => {
        assert.equal(outer.valid, true);
        const semantic = [...outer.events].find(event => event.event === "SEMANTIC_DECISION_RECORDED");
        assert.ok(semantic);
        const row = writer.prepare(
          "SELECT payload_json FROM task_artifacts WHERE task_id = ? AND kind = 'decision' AND artifact_id = ?",
        ).get(semantic.taskId, semantic.details.decisionId);
        const payload = JSON.parse(row.payload_json);
        payload.recordedAt = "2030-01-01T00:00:00.000Z";
        writer.prepare(
          "UPDATE task_artifacts SET payload_json = ? WHERE task_id = ? AND kind = 'decision' AND artifact_id = ?",
        ).run(JSON.stringify(payload), semantic.taskId, semantic.details.decisionId);
        const nestedClaims = await resolveTaskClaimState(f.target, f);
        assert.equal(nestedClaims.valid, expected.valid);
        assert.equal(nestedClaims.claimState, expected.claimState);
      });
      assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" },
        "the first semantic read must remain in the writable parent's CAS set");
    });
  } finally {
    writer.close();
    db.close();
    await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("invalid semantic artifacts are reread instead of being cached as successful bindings", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const expected = await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId });
  const decisionCount = [...expected.events]
    .filter(event => event.event === "SEMANTIC_DECISION_RECORDED").length;
  const filename = path.join(f.target, ".forgeloop/state.sqlite");
  const db = openStorageDatabase(filename);
  try {
    const semantic = [...expected.events].find(event => event.event === "SEMANTIC_DECISION_RECORDED");
    assert.ok(semantic);
    const changed = db.prepare(
      "UPDATE task_artifacts SET payload_json = ? WHERE task_id = ? AND kind = 'decision' AND artifact_id = ?",
    ).run("{}", semantic.taskId, semantic.details.decisionId);
    assert.equal(changed.changes, 1);
    await withOperationalStore({ db, target: f.target }, async () => {
      const counter = installDecisionArtifactReadCounter(f.target);
      try {
        await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, async first => {
          assert.equal(first.valid, false);
          assert.ok(first.errors.some(error => error.message.includes("semantic decision artifact")));
          await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, second => {
            assert.equal(second.valid, false);
            assert.ok(second.errors.some(error => error.message.includes("semantic decision artifact")));
          });
        });
        assert.equal(counter.count(), decisionCount * 2,
          "semantic binding failures must not become reusable successes");
      } finally { counter.restore(); }
    });
  } finally { db.close(); await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("prepared overlays use the uncached array audit fallback", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const expected = await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId });
  const decisionCount = [...expected.events]
    .filter(event => event.event === "SEMANTIC_DECISION_RECORDED").length;
  const db = openStorageDatabase(path.join(f.target, ".forgeloop/state.sqlite"));
  try {
    await assert.rejects(withOperationalStore({ db, target: f.target }, () => withOperationalTransaction({
      target: f.target,
      taskId: f.taskId,
      packageRoot: f.packageRoot,
      operation: "semantic-audit-cache-overlay-control",
      recordCommitEvent: false,
    }, async () => {
      const counter = installDecisionArtifactReadCounter(f.target);
      try {
        await appendProtocolEvent(
          f.target,
          { taskId: f.taskId, event: "OBSERVATION", details: { message: "prepared overlay" } },
          f.packageRoot,
          { taskId: f.taskId },
        );
        await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, first => {
          assert.equal(first.valid, true);
          assert.equal(Array.isArray(first.events), true);
        });
        await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, second => {
          assert.equal(second.valid, true);
          assert.equal(Array.isArray(second.events), true);
        });
        assert.equal(counter.count(), decisionCount * 2,
          "a prepared source must not consult an owned detached semantic cache");
      } finally { counter.restore(); }
      throw Object.assign(new Error("rollback prepared semantic audit"), { code: "E_TEST_ROLLBACK" });
    })), { code: "E_TEST_ROLLBACK" });
  } finally { db.close(); await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("strict and tolerant ledger modes stay independent while semantic bindings reuse", async () => {
  const f = await buildCanonicalDiagnosisProject();
  const expected = await validateEventLedger(f.target, f.packageRoot, { taskId: f.taskId });
  const decisionCount = [...expected.events]
    .filter(event => event.event === "SEMANTIC_DECISION_RECORDED").length;
  const filename = path.join(f.target, ".forgeloop/state.sqlite");
  const db = openStorageDatabase(filename);
  try {
    const last = expected.events.at(-1);
    const legacy = buildProtocolEvent({
      taskId: f.taskId,
      event: "OPERATOR_RECOVERY_RECORDED",
      details: {
        classification: "RECOVERABLE",
        reasonCodes: ["LEGACY_RECOVERY"],
        authorization: "OPERATOR_AUTHORIZED",
        note: "known defect fixture",
      },
    }, { checkpoint: { seq: last.seq, lastHash: last.hash } });
    appendEvent(db, { taskId: f.taskId, event: legacy });
    await withOperationalStore({ db, target: f.target }, async () => {
      const counter = installDecisionArtifactReadCounter(f.target);
      try {
        await withEventLedgerAudit(f.target, f.packageRoot, {
          taskId: f.taskId,
          allowUnmigratedLegacyRecoveryEvents: true,
        }, async tolerantOuter => {
          assert.equal(tolerantOuter.valid, true);
          await withEventLedgerAudit(f.target, f.packageRoot, { taskId: f.taskId }, strict => {
            assert.equal(strict.valid, false);
            assert.ok(strict.errors.some(error => error.message.includes("not officially migrated")));
          });
          await withEventLedgerAudit(f.target, f.packageRoot, {
            taskId: f.taskId,
            allowUnmigratedLegacyRecoveryEvents: true,
          }, tolerant => assert.equal(tolerant.valid, true));
        });
        assert.equal(counter.count(), decisionCount,
          "legacy tolerance must vary only core validation, not semantic artifact reuse");
      } finally { counter.restore(); }
    });
  } finally { db.close(); await rm(f.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
