import { removeTempTree } from "./helpers/rm-safe.js";
import { appendEvent, runInTransaction } from "../src/storage/index.js";
import { ensureFixtureTask, readRawFixtureText, overwriteFixtureText } from "./helpers/native-storage-fixture.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { appendProtocolEvent, readEventTail, readPortableEventTail, eventHash } from "../src/core/events.js";
import { canonicalFingerprint } from "../src/core/artifacts.js";
import { getPackageRoot } from "../src/core/templates.js";

test("ledger tail reads only the requested recent events", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-ledger-tail-"));
  try {
    await ensureFixtureTask(target, "tail-task", getPackageRoot());
    for (let index = 0; index < 12; index += 1) {
      await appendProtocolEvent(target, { taskId: "tail-task", event: `OBSERVATION_${index}` }, getPackageRoot(), { taskId: "tail-task" });
    }
    const tail = await readEventTail(target, getPackageRoot(), { limit: 3, taskId: "tail-task" });
    assert.deepEqual(tail.map((event) => event.seq), [10, 11, 12]);
  } finally {
    await removeTempTree(target);
  }
});

test("ledger tail remains bounded for a 100k-event NDJSON ledger", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-ledger-scale-"));
  try {
    const ledgerPath = path.join(target, ".forgeloop", "events.ndjson");
    await mkdir(path.dirname(ledgerPath), { recursive: true });
    const hash = "a".repeat(64);
    const lines = [];
    for (let index = 1; index <= 100_000; index += 1) {
      lines.push(JSON.stringify({
        seq: index,
        schemaVersion: 1,
        protocolVersion: 1,
        taskId: "scale-ledger",
        event: "OBSERVATION",
        at: "2026-01-01T00:00:00.000Z",
        previousHash: index === 1 ? null : hash,
        hash,
      }));
    }
    await writeFile(ledgerPath, `${lines.join("\n")}\n`);

    const tail = await readPortableEventTail(target, getPackageRoot(), { limit: 5 });
    assert.deepEqual(tail.map((event) => event.seq), [99_996, 99_997, 99_998, 99_999, 100_000]);
  } finally {
    await removeTempTree(target);
  }
});

test("native ledger tail returns only five recent events from a 100k-event valid chain", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-native-ledger-scale-"));
  const taskId = "native-scale-ledger";
  try {
    await ensureFixtureTask(target, taskId, getPackageRoot());
    await withProjectStorage(target, store => runInTransaction(store.db, () => {
      let previousHash = null;
      for (let seq = 1; seq <= 100_000; seq += 1) {
        const event = { seq, schemaVersion: 1, protocolVersion: 1, taskId,
          event: "OBSERVATION", at: "2026-01-01T00:00:00.000Z", previousHash };
        event.hash = eventHash(event);
        appendEvent(store.db, { taskId, event });
        previousHash = event.hash;
      }
    }));
    const tail = await readEventTail(target, getPackageRoot(), { taskId, limit: 5 });
    assert.deepEqual(tail.map(event => event.seq), [99_996, 99_997, 99_998, 99_999, 100_000]);
    assert.equal(tail[1].previousHash, tail[0].hash);
    await assert.rejects(readFile(path.join(target, ".forgeloop/events.ndjson")), { code: "ENOENT" });
  } finally { await removeTempTree(target); }
});

test("ledger checkpoint follows changed ledger without creating or rewriting an index sidecar", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-ledger-index-"));
  const packageRoot = getPackageRoot();
  try {
    await ensureFixtureTask(target, "index-task", packageRoot);
    const first = await appendProtocolEvent(target, { taskId: "index-task", event: "OBSERVATION_ONE" }, packageRoot, { taskId: "index-task" });
    const indexPath = path.join(target, ".forgeloop", "events.ndjson.index.json");
    await assert.rejects(readFile(indexPath), { code: "ENOENT" });
    const retainedIndex = "retained obsolete sidecar bytes\n";
    await writeFile(indexPath, retainedIndex);

    const external = {
      seq: 2,
      schemaVersion: 1,
      protocolVersion: 1,
      taskId: "index-task",
      event: "OBSERVATION_EXTERNAL",
      at: "2026-01-01T00:00:00.000Z",
      previousHash: first.hash,
    };
    external.hash = canonicalFingerprint(external);
    await overwriteFixtureText(target, taskArtifactPath("index-task", "events"), `${JSON.stringify(first)}\n${JSON.stringify(external)}\n`);

    const third = await appendProtocolEvent(target, { taskId: "index-task", event: "OBSERVATION_THREE" }, packageRoot, { taskId: "index-task" });
    assert.equal(third.seq, 3);
    assert.equal(third.previousHash, external.hash);
    assert.equal(await readFile(indexPath, "utf8"), retainedIndex);
    const ledgerPath = taskArtifactPath("index-task", "events");
    await withProjectStorage(target, store => {
      store.db.prepare("UPDATE events SET event_json = ? WHERE task_id = ? AND seq = 1").run("{broken", "index-task");
    });
    const corruptedLedger = await readRawFixtureText(target, ledgerPath);
    await assert.rejects(appendProtocolEvent(target, { taskId: "index-task", event: "REFUSED_APPEND" }, packageRoot, { taskId: "index-task" }), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
    assert.equal(await readRawFixtureText(target, ledgerPath), corruptedLedger);
    assert.equal(await readFile(indexPath, "utf8"), retainedIndex);
  } finally {
    await removeTempTree(target);
  }
});
