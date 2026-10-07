import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openStorageDatabase, runInTransaction, isInTransaction } from "../src/storage/index.js";

async function fixture(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-storage-faults-"));
  try { await callback(path.join(directory, "state.sqlite")); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("a real page-budget exhaustion rolls back and exposes the recoverable full error", async () => {
  await fixture(async file => {
    const db = openStorageDatabase(file);
    try {
      db.exec("CREATE TABLE fault_probe (payload BLOB NOT NULL)");
      const pages = db.prepare("PRAGMA page_count").get().page_count;
      db.exec(`PRAGMA max_page_count = ${pages}`);
      assert.throws(() => runInTransaction(db, () => db.prepare("INSERT INTO fault_probe VALUES (zeroblob(1048576))").run()), { code: "E_STORAGE_FULL" });
      assert.equal(isInTransaction(db), false);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM fault_probe").get().count, 0);
      db.exec("PRAGMA max_page_count = 2147483646");
      runInTransaction(db, () => db.prepare("INSERT INTO fault_probe VALUES (?)").run(Buffer.from("recovered")));
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM fault_probe").get().count, 1);
    } finally { db.close(); }
  });
});

test("a read-only connection refuses a mutation without changing committed data", async () => {
  await fixture(async file => {
    const writer = openStorageDatabase(file);
    writer.exec("CREATE TABLE fault_probe (payload TEXT NOT NULL)");
    writer.close();
    const reader = openStorageDatabase(file, { readOnly: true });
    try {
      assert.throws(() => runInTransaction(reader, () => reader.prepare("INSERT INTO fault_probe VALUES (?)").run("forbidden"), { immediate: false }), { code: "E_STORAGE_READ_ONLY" });
      assert.equal(isInTransaction(reader), false);
      assert.equal(reader.prepare("SELECT COUNT(*) AS count FROM fault_probe").get().count, 0);
    } finally { reader.close(); }
  });
});

test("writer contention exposes busy and permits retry after the owner releases", async () => {
  await fixture(async file => {
    const owner = openStorageDatabase(file);
    const contender = openStorageDatabase(file, { busyTimeoutMs: 0 });
    try {
      owner.exec("BEGIN IMMEDIATE");
      assert.throws(() => runInTransaction(contender, () => assert.fail("busy callback must not run")), { code: "E_STORAGE_BUSY" });
      assert.equal(isInTransaction(contender), false);
      owner.exec("ROLLBACK");
      assert.equal(runInTransaction(contender, () => "recovered"), "recovered");
    } finally { contender.close(); owner.close(); }
  });
});

test("a damaged database header exposes corrupt and preserves its bytes", async () => {
  await fixture(async file => {
    const damaged = Buffer.alloc(4096, 0x78);
    await writeFile(file, damaged);
    assert.throws(() => openStorageDatabase(file), { code: "E_STORAGE_CORRUPT" });
    assert.deepEqual(await readFile(file), damaged);
  });
});
