import assert from "node:assert/strict";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readStorageVersionMarker } from "../src/storage/storage-marker.js";
import { removeTempTree } from "./helpers/rm-safe.js";

for (const portable of [false, true]) {
  test(`storage marker refuses a symlink replacement before open (${portable ? "descriptor fallback" : "native no-follow"})`, { skip: process.platform === "win32" }, async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "forgeloop-owner-contained-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "forgeloop-owner-outside-"));
    const filename = path.join(target, ".forgeloop/storage-version.json");
    const external = path.join(outside, "owner.json");
    const owner = () => ({ schemaVersion: 1, storageFormat: "sqlite", storageVersion: 1, databaseSchemaVersion: 5, phase: "ACTIVE", operationId: randomUUID(), sourceInventoryFingerprint: "a".repeat(64) });
    const insideText = `${JSON.stringify(owner())}\n`;
    const outsideText = `${JSON.stringify(owner())}\n`;
    const original = fs.open;
    let swapped = false;
    try {
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(filename, insideText);
      await fs.writeFile(external, outsideText);
      assert.deepEqual(await readStorageVersionMarker(target), JSON.parse(insideText));
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
      await assert.rejects(readStorageVersionMarker(target), error => error.code === "E_STORAGE_VERSION_MARKER_INVALID");
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

const markerRecord = () => ({ schemaVersion: 1, storageFormat: "sqlite", storageVersion: 1,
  databaseSchemaVersion: 5, phase: "ACTIVE", operationId: randomUUID(), sourceInventoryFingerprint: "b".repeat(64) });

test("storage marker refuses a parent symlink after path validation", { skip: process.platform === "win32" }, async () => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "forgeloop-marker-parent-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "forgeloop-marker-parent-outside-"));
  const parent = path.join(target, ".forgeloop"), filename = path.join(parent, "storage-version.json");
  const external = path.join(outside, "storage-version.json"), text = JSON.stringify(markerRecord());
  const original = fs.lstat;
  let admissions = 0, swapped = false;
  try {
    await fs.mkdir(parent); await fs.writeFile(filename, JSON.stringify(markerRecord())); await fs.writeFile(external, text);
    fs.lstat = async function (name, ...args) {
      if (String(name) === filename && ++admissions === 3) {
        swapped = true; await fs.rename(parent, path.join(target, ".forgeloop-retained")); await fs.symlink(outside, parent);
      }
      return original.call(this, name, ...args);
    };
    syncBuiltinESMExports();
    await assert.rejects(readStorageVersionMarker(target), { code: "E_STORAGE_VERSION_MARKER_INVALID" });
    assert.equal(swapped, true); assert.equal(await fs.readFile(external, "utf8"), text);
  } finally {
    fs.lstat = original; syncBuiltinESMExports(); await removeTempTree(target); await removeTempTree(outside);
  }
});

for (const growing of [false, true]) {
  test(`storage marker bounds reads after admission (${growing ? "file growth" : "short reads"})`, async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "forgeloop-marker-read-"));
    const filename = path.join(target, ".forgeloop/storage-version.json"), value = markerRecord();
    const original = fs.open;
    let reads = 0, total = 0;
    try {
      await fs.mkdir(path.dirname(filename)); await fs.writeFile(filename, JSON.stringify(value));
      fs.open = async function (name, ...args) {
        const handle = await original.call(this, name, ...args);
        if (String(name) !== filename) return handle;
        const stat = handle.stat.bind(handle), read = handle.read.bind(handle);
        handle.stat = async (...statArgs) => {
          const info = await stat(...statArgs);
          if (growing) await fs.appendFile(filename, " ".repeat(70000));
          return info;
        };
        handle.readFile = async () => { throw new Error("Unbounded marker read must not be used"); };
        handle.read = async (buffer, offset, length, position) => {
          assert.ok(length <= 65537);
          const result = await read(buffer, offset, growing ? length : Math.min(length, 7), position);
          reads += 1; total += result.bytesRead; return result;
        };
        return handle;
      };
      syncBuiltinESMExports();
      if (growing) await assert.rejects(readStorageVersionMarker(target), { code: "E_STORAGE_VERSION_MARKER_INVALID" });
      else assert.deepEqual(await readStorageVersionMarker(target), value);
      assert.ok(reads > 0); assert.ok(total <= 65537);
      if (!growing) assert.ok(reads > 2, "complete valid marker survives short reads");
    } finally { fs.open = original; syncBuiltinESMExports(); await removeTempTree(target); }
  });
}
