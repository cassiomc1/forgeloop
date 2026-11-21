import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readMaintenanceOwner } from "../src/storage/maintenance-owner.js";
import { removeTempTree } from "./helpers/rm-safe.js";

// A concurrent resumer publishes the new owner with an atomic rename. A reader
// that observed the old file and then opens the new one must re-read it, not
// report a malformed owner; a swap to a symlink or an outside file still fails.

const RELATIVE = ".forgeloop/.storage-maintenance/owner.json";
const owner = () => `${JSON.stringify({ schemaVersion: 1, ownerId: randomUUID(), pid: process.pid, acquiredAt: new Date().toISOString() })}\n`;

async function fixture(callback) {
  const target = await mkdtemp(path.join(tmpdir(), "forgeloop-owner-replace-"));
  try {
    await mkdir(path.join(target, ".forgeloop/.storage-maintenance"), { recursive: true });
    const filename = path.join(target, RELATIVE);
    await writeFile(filename, owner());
    await callback(target, filename);
  } finally { await removeTempTree(target); }
}

test("an owner replaced by rename between lstat and open is re-read, not reported as malformed", async () => {
  await fixture(async (target, filename) => {
    const replacement = owner();
    let swaps = 0;
    const afterObserve = async () => {
      if (swaps++ > 0) return;
      await writeFile(`${filename}.next`, replacement);
      await rename(`${filename}.next`, filename);
    };
    const result = await readMaintenanceOwner(target, RELATIVE, { afterObserve });
    assert.equal(result.text, replacement);
    assert.equal(swaps, 2, "the reader observed the file again after the swap");
  });
});

test("an owner that keeps changing fails closed after bounded attempts", async () => {
  await fixture(async (target, filename) => {
    const afterObserve = async () => {
      await writeFile(`${filename}.next`, owner());
      await rename(`${filename}.next`, filename);
    };
    await assert.rejects(() => readMaintenanceOwner(target, RELATIVE, { afterObserve }), (error) => error.code === "E_STORAGE_MAINTENANCE_OWNER_INVALID");
  });
});

test("an owner swapped for a symlink is still rejected without a retry", { skip: process.platform === "win32" }, async () => {
  await fixture(async (target, filename) => {
    const outside = path.join(target, "outside.json");
    await writeFile(outside, owner());
    let swaps = 0;
    const afterObserve = async () => {
      swaps += 1;
      await symlink(outside, `${filename}.link`);
      await rename(`${filename}.link`, filename);
    };
    await assert.rejects(() => readMaintenanceOwner(target, RELATIVE, { afterObserve }), (error) => error.code === "E_STORAGE_MAINTENANCE_OWNER_INVALID");
    assert.equal(swaps, 1);
  });
});
