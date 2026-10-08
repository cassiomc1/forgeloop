import assert from "node:assert/strict";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readMaintenanceOwner } from "../src/storage/maintenance-owner.js";
import { removeTempTree } from "./helpers/rm-safe.js";

for (const portable of [false, true]) {
  test(`maintenance owner refuses a symlink replacement before open (${portable ? "descriptor fallback" : "native no-follow"})`, { skip: process.platform === "win32" }, async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "forgeloop-owner-contained-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "forgeloop-owner-outside-"));
    const filename = path.join(target, ".forgeloop/.storage-maintenance/owner.json");
    const external = path.join(outside, "owner.json");
    const owner = () => ({ schemaVersion: 1, ownerId: randomUUID(), pid: process.pid, hostname: os.hostname(), acquiredAt: new Date().toISOString() });
    const insideText = `${JSON.stringify(owner())}\n`;
    const outsideText = `${JSON.stringify(owner())}\n`;
    const original = fs.open;
    let swapped = false;
    try {
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(filename, insideText);
      await fs.writeFile(external, outsideText);
      assert.equal((await readMaintenanceOwner(target)).text, insideText);
      fs.open = async function (file, ...args) {
        if (String(file) === filename) {
          if (!swapped) {
            swapped = true;
            await fs.unlink(filename);
            await fs.symlink(external, filename);
          }
          if (portable && typeof args[0] === "number") args[0] &= ~(constants.O_NOFOLLOW ?? 0);
        }
        return original.call(this, file, ...args);
      };
      syncBuiltinESMExports();
      await assert.rejects(readMaintenanceOwner(target), error => error.code === "E_STORAGE_MAINTENANCE_OWNER_INVALID");
      assert.equal(swapped, true, "replace the admitted file at the actual open boundary");
      assert.equal(await fs.readFile(external, "utf8"), outsideText, "the reader must preserve outside evidence");
      assert.equal((await fs.lstat(filename)).isSymbolicLink(), true, "refusal must not repair or delete the retained pathname");
    } finally {
      fs.open = original;
      syncBuiltinESMExports();
      await removeTempTree(target);
      await removeTempTree(outside);
    }
  });
}

const ownerRecord = () => ({ schemaVersion: 1, ownerId: randomUUID(), pid: process.pid, hostname: os.hostname(), acquiredAt: new Date().toISOString() });

test("maintenance owner refuses a parent link after path validation", async () => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "forgeloop-marker-parent-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "forgeloop-marker-parent-outside-"));
  const parent = path.join(target, ".forgeloop/.storage-maintenance"), filename = path.join(parent, "owner.json");
  const external = path.join(outside, "owner.json"), text = JSON.stringify(ownerRecord());
  const original = fs.lstat;
  let admissions = 0, swapped = false;
  try {
    await fs.mkdir(parent, { recursive: true }); await fs.writeFile(filename, JSON.stringify(ownerRecord())); await fs.writeFile(external, text);
    fs.lstat = async function (name, ...args) {
      if (String(name) === filename && ++admissions === 3) {
        swapped = true; await fs.rename(parent, path.join(target, ".forgeloop-retained")); await fs.symlink(outside, parent, process.platform === "win32" ? "junction" : "dir");
      }
      return original.call(this, name, ...args);
    };
    syncBuiltinESMExports();
    await assert.rejects(readMaintenanceOwner(target), { code: "E_STORAGE_MAINTENANCE_OWNER_INVALID" });
    assert.equal(swapped, true); assert.equal(await fs.readFile(external, "utf8"), text);
  } finally {
    fs.lstat = original; syncBuiltinESMExports(); await removeTempTree(target); await removeTempTree(outside);
  }
});
