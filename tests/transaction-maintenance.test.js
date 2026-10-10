import { findIncompleteTransactions, withTaskTransaction } from "../src/core/transaction.js";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink, open, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { removeTempTree } from "./helpers/rm-safe.js";

test("legacy SQLite admission signals reject transaction mutation without touching retained payloads", async t => {
  const target = await mkdtemp(path.join(os.tmpdir(), "txn-compact-sqlite-"));
  t.after(() => removeTempTree(target));
  const root = path.join(target, ".forgeloop");
  await mkdir(path.join(root, ".txn/old/stage"), { recursive: true });
  const payload = path.join(root, ".txn/old/stage/payload");
  await writeFile(payload, "retained evidence");
  for (const name of ["state.sqlite", "storage-version.json", "state.sqlite-wal", "state.sqlite-shm"]) {
    const filename = path.join(root, name);
    await writeFile(filename, "admission signal");
    let invoked = false;
    const transactionCode = name === "storage-version.json" ? "E_STORAGE_VERSION_MARKER_INVALID" : "E_STORAGE_MIGRATION_REQUIRED";
    await assert.rejects(withTaskTransaction({ target, taskId: "must-refuse" }, () => { invoked = true; }), { code: transactionCode });
    assert.equal(invoked, false);
    assert.equal(await readFile(payload, "utf8"), "retained evidence");
    const { unlink } = await import("node:fs/promises");
    await unlink(filename);
  }
});


test("legacy transaction discovery refuses symlinked roots and manifests", async t => {
  for (const alias of ["root", "manifest"]) {
    const target = await mkdtemp(path.join(os.tmpdir(), "txn-discovery-alias-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "txn-discovery-outside-"));
    t.after(() => removeTempTree(target));
    t.after(() => removeTempTree(outside));
    const external = path.join(outside, "manifest.json");
    const bytes = JSON.stringify({ transactionId: "external", status: "STAGING" });
    await writeFile(external, bytes);
    if (alias === "root") {
      await mkdir(path.join(target, ".forgeloop"));
      await symlink(outside, path.join(target, ".forgeloop/.txn"), process.platform === "win32" ? "junction" : "dir");
    } else {
      await mkdir(path.join(target, ".forgeloop/.txn/alias"), { recursive: true });
      await symlink(external, path.join(target, ".forgeloop/.txn/alias/manifest.json"), "file");
    }
    await assert.rejects(findIncompleteTransactions(target), /symlink/iu);
    assert.equal(await readFile(external, "utf8"), bytes);
  }
});


test("oversized terminal legacy manifest remains visible without modifying retained evidence", async t => {
  const target = await mkdtemp(path.join(os.tmpdir(), "txn-manifest-budget-"));
  t.after(() => removeTempTree(target));
  const directory = path.join(target, ".forgeloop/.txn/oversized");
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, "manifest.json");
  const file = await open(filename, "wx");
  try {
    await file.writeFile(JSON.stringify({ transactionId: "oversized", status: "COMMITTED" }));
    const padding = Buffer.alloc(1024 * 1024, " ");
    for (let index = 0; index < 64; index += 1) await file.write(padding);
  } finally { await file.close(); }
  const before = await stat(filename);
  assert.deepEqual(await findIncompleteTransactions(target), [{ transactionId: "oversized", status: "ABANDONED", malformed: true }]);
  const after = await stat(filename);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
});
