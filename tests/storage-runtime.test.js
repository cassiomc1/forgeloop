import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { assertStorageNodeVersion, loadStorageDriver, STORAGE_MINIMUM_NODE } from "../src/storage/runtime.js";

test("storage runtime admission rejects pre-baseline Node versions", () => {
  assert.equal(STORAGE_MINIMUM_NODE, "24.19.0");
  for (const version of ["20.20.0", "22.22.0", "23.11.0", "24.0.0", "24.18.99", "24.19.0-pre", "invalid", null]) {
    assert.throws(() => assertStorageNodeVersion(version), { code: "E_STORAGE_UNSUPPORTED_RUNTIME" });
  }
  for (const version of ["24.19.0", "24.19.1", "24.20.0", "26.10.0"]) assertStorageNodeVersion(version);
  const driver = loadStorageDriver();
  assert.equal(driver, loadStorageDriver());
  assert.equal(typeof driver.backup, "function");
  const db = new driver.DatabaseSync(":memory:");
  try { assert.equal(typeof db.prepare("SELECT sqlite_version() AS version").get().version, "string"); }
  finally { db.close(); }
});

test("storage modules import without loading the SQLite driver", () => {
  const script = `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === 'node:sqlite') throw new Error('unexpected eager SQLite import');
      return next(specifier, context);
    }});
    await import('./src/storage/connection.js');
    await import('./src/storage/backup.js');
    await import('./src/storage/snapshot.js');
    const { openStorageDatabase } = await import('./src/storage/connection.js');
    try { openStorageDatabase(':memory:'); process.exitCode = 1; }
    catch (error) { if (error.code !== 'E_STORAGE_UNSUPPORTED_RUNTIME') throw error; }
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  const simulatedOlderRuntime = script.replace("await import('./src/storage/connection.js');", "Object.defineProperty(process.versions, 'node', { value: '22.22.0' }); await import('./src/storage/connection.js');")
    .replace("if (error.code !== 'E_STORAGE_UNSUPPORTED_RUNTIME')", "if (error.code !== 'E_STORAGE_UNSUPPORTED_RUNTIME' || !error.message.includes('Node >=24.19.0'))");
  execFileSync(process.execPath, ["--input-type=module", "-e", simulatedOlderRuntime], { encoding: "utf8" });
});
