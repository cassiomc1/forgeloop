import { findIncompleteTransactions, recoverIncompleteTransactions, withTaskTransaction } from "../src/core/transaction.js";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { compactTransactions } from "../src/core/transaction-maintenance.js";
import { removeTempTree } from "./helpers/rm-safe.js";

test("legacy compaction refuses every SQLite admission signal before touching retained payloads", async t => {
  const target = await mkdtemp(path.join(os.tmpdir(), "txn-compact-sqlite-"));
  t.after(() => removeTempTree(target));
  const root = path.join(target, ".forgeloop");
  await mkdir(path.join(root, ".txn/old/stage"), { recursive: true });
  const payload = path.join(root, ".txn/old/stage/payload");
  await writeFile(payload, "retained evidence");
  for (const name of ["state.sqlite", "storage-version.json", "state.sqlite-wal", "state.sqlite-shm"]) {
    const filename = path.join(root, name);
    await writeFile(filename, "admission signal");
    for (const apply of [false, true]) {
      await assert.rejects(compactTransactions({ target, apply }), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
      assert.equal(await readFile(payload, "utf8"), "retained evidence");
    }
    await assert.rejects(recoverIncompleteTransactions(target), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
    let invoked = false;
    const transactionCode = name === "storage-version.json" ? "E_STORAGE_VERSION_MARKER_INVALID" : "E_STORAGE_MIGRATION_REQUIRED";
    await assert.rejects(withTaskTransaction({ target, taskId: "must-refuse" }, () => { invoked = true; }), { code: transactionCode });
    assert.equal(invoked, false);
    assert.equal(await readFile(payload, "utf8"), "retained evidence");
    const { unlink } = await import("node:fs/promises");
    await unlink(filename);
  }
});

test("retired compaction and recovery preserve terminal and incomplete legacy evidence", async t => {
  const target = await mkdtemp(path.join(os.tmpdir(), "txn-retired-"));
  t.after(() => removeTempTree(target));
  const retained = [];
  for (const status of ["COMMITTED", "ROLLED_BACK", "ABORTED", "COMMITTING", "STAGING"]) {
    const root = path.join(target, ".forgeloop/.txn", status);
    await mkdir(path.join(root, "stage"), { recursive: true });
    for (const [name, bytes] of [["stage/payload", "retained payload"], ["manifest.json", JSON.stringify({ transactionId: status, taskId: status, status })]]) {
      const filename = path.join(root, name);
      await writeFile(filename, bytes);
      retained.push({ filename, bytes });
    }
  }
  for (const apply of [false, true]) {
    await assert.rejects(compactTransactions({ target, apply }), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
  }
  await assert.rejects(recoverIncompleteTransactions(target), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
  for (const { filename, bytes } of retained) assert.equal(await readFile(filename, "utf8"), bytes);
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
