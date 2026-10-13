import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertStorageTopology, assertStorageTopologyName } from "../src/storage/topology.js";
import { openStorageDatabase } from "../src/storage/connection.js";

test("known network topology refuses UNC variants and signed Linux identifiers", () => {
  for (const filename of ["\\\\server\\share\\state.sqlite", "//server/share/state.sqlite", "\\\\?\\UNC\\server\\share\\state.sqlite", "\\\\.\\UNC\\server\\share\\state.sqlite"]) {
    assert.throws(() => assertStorageTopologyName(filename, "win32"), { code: "E_STORAGE_TOPOLOGY_UNSUPPORTED" });
  }
  for (const type of [0x6969n, 0x517bn, 0xff534d42n, BigInt.asIntN(32, 0xff534d42n), 0xfe534d42n, 0x5346414fn, 0x6b414653n, 0x73757245n, 0x00c36400n, 0x01021997n]) {
    assert.throws(() => assertStorageTopologyName("/mnt/project/state.sqlite", "linux", type), { code: "E_STORAGE_TOPOLOGY_UNSUPPORTED" });
  }
  // Linux values cannot classify Darwin's dynamically assigned filesystem IDs.
  assertStorageTopologyName("/Volumes/project/state.sqlite", "darwin", 0x6969n);
  assertStorageTopologyName("C:\\project\\state.sqlite", "win32");
  assertStorageTopologyName("\\\\?\\C:\\project\\state.sqlite", "win32");
  assertStorageTopologyName("/project/state.sqlite", "linux", 0xef53n);
  assertStorageTopologyName("/project/state.sqlite", "linux", 0x794c7630n);
});

test("topology inspection of a missing database does not allocate directories or files", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-topology-"));
  try {
    const filename = path.join(target, "missing", "nested", "state.sqlite");
    assertStorageTopology(filename);
    await assert.rejects(access(path.join(target, "missing")), { code: "ENOENT" });
    const existing = path.join(target, "state.sqlite");
    const db = openStorageDatabase(existing);
    try { assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal"); }
    finally { db.close(); }
  } finally { await removeTempTree(target); }
});
