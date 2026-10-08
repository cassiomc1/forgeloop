import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, lstat } from "node:fs/promises";
import { renameSync, symlinkSync, unlinkSync, rmSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { runTaskCreate } from "../src/commands/task-create.js";
import { createForgeLoopContext, executeForgeLoopCommand } from "../src/integration.js";
import { loadStorageDriver } from "../src/storage/runtime.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { getPackageRoot } from "../src/core/templates.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();
async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), "forgeloop-db-admission-"));
  const target = path.join(base, "target"), outside = path.join(base, "outside");
  await mkdir(target); await mkdir(outside);
  try {
    await runTaskCreate({ target, packageRoot, taskId: "inside-sentinel", claims: [] });
    await runTaskCreate({ target: outside, packageRoot, taskId: "outside-sentinel", claims: [] });
    return { base, target, outside };
  } catch (error) { await removeTempTree(base); throw error; }
}
function redirect(target, outside) {
  const state = path.join(target, ".forgeloop");
  renameSync(state, path.join(target, "retained-state"));
  symlinkSync(path.join(outside, ".forgeloop"), state, process.platform === "win32" ? "junction" : "dir");
}

for (const scenario of ["readonly", "writable", "persistent", "restored-path"]) {
  test(`project database admission rejects ${scenario} parent redirection before configuration`, async () => {
    const { base, target, outside } = await fixture();
    const driver = loadStorageDriver(), Actual = driver.DatabaseSync;
    const runtimeContext = scenario === "persistent" ? createForgeLoopContext({ persistentStorage: true }) : undefined;
    let swapped = false, configured = 0;
    try {
      const before = await readFile(path.join(outside, ".forgeloop/state.sqlite"));
      driver.DatabaseSync = class RacingDatabase extends Actual {
        constructor(filename, options) {
          const selected = filename === path.join(target, ".forgeloop/state.sqlite");
          if (selected) { redirect(target, outside); swapped = true; }
          super(filename, options);
          this.selectedForRace = selected;
          if (selected && scenario === "restored-path") {
            if (process.platform === "win32") rmSync(path.join(target, ".forgeloop"), { recursive: true });
            else unlinkSync(path.join(target, ".forgeloop"));
            renameSync(path.join(target, "retained-state"), path.join(target, ".forgeloop"));
          }
        }
        exec(sql) { if (this.selectedForRace) configured++; return super.exec(sql); }
      };
      const result = await executeForgeLoopCommand({
        command: scenario === "writable" ? "task-create" : "task-list", projectPath: target,
        input: scenario === "writable" ? { taskId: "must-not-create-outside", claims: [] } : {}, runtimeContext,
      });
      assert.equal(swapped, true);
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error.code, "E_STORAGE_MIGRATION_REQUIRED");
      assert.equal(result.result, null);
      assert.equal(configured, 0, "SQLite configuration must not run against the redirected database");
      assert.deepEqual(await readFile(path.join(outside, ".forgeloop/state.sqlite")), before);
    } finally {
      driver.DatabaseSync = Actual;
      await runtimeContext?.close();
      await removeTempTree(base);
    }
  });
}

test("cached project admission rejects parent redirection before callback", async () => {
  const { base, target, outside } = await fixture();
  const runtimeContext = createForgeLoopContext({ persistentStorage: true });
  const fs = createRequire(import.meta.url)("node:fs/promises");
  const lstat = fs.lstat;
  try {
    await withProjectStorage(target, store => store.db, { readOnly: true, runtimeContext });
    let redirected = false, ran = false;
    fs.lstat = async (...args) => {
      const ownerObservation = new Error().stack.includes("openOwnedConnection");
      const observed = await lstat(...args);
      if (!redirected && ownerObservation && args[0] === path.join(target, ".forgeloop/state.sqlite")) {
        redirect(target, outside); redirected = true;
      }
      return observed;
    };
    syncBuiltinESMExports();
    const before = await readFile(path.join(outside, ".forgeloop/state.sqlite"));
    const failure = await withProjectStorage(target, () => { ran = true; }, { readOnly: true, runtimeContext }).then(() => null, error => error);
    assert.ok(failure);
    if (process.platform === "win32" && ["EBUSY", "EPERM"].includes(failure.code)) {
      assert.equal(redirected, false, "The host refused the open-directory move before redirection");
    } else {
      assert.equal(failure.code, "E_STORAGE_MIGRATION_REQUIRED");
      assert.equal(redirected, true);
    }
    assert.equal(ran, false);
    assert.deepEqual(await readFile(path.join(outside, ".forgeloop/state.sqlite")), before);
  } finally {
    fs.lstat = lstat; syncBuiltinESMExports();
    await runtimeContext.close(); await removeTempTree(base);
  }
});

for (const suffix of ["-wal", "-shm"]) {
  test(`project database admission refuses redirected ${suffix} before configuration`, async t => {
    const { base, target, outside } = await fixture();
    const driver = loadStorageDriver(), Actual = driver.DatabaseSync;
    let configured = 0, linkFailure = null;
    try {
      const before = await readFile(path.join(outside, ".forgeloop/state.sqlite"));
      driver.DatabaseSync = class RacingSidecar extends Actual {
        constructor(filename, options) {
          super(filename, options);
          this.selectedForRace = filename === path.join(target, ".forgeloop/state.sqlite");
          if (this.selectedForRace) {
            try { symlinkSync(path.join(outside, ".forgeloop/state.sqlite"), `${filename}${suffix}`, "file"); }
            catch (error) { linkFailure = error; this.close(); throw error; }
          }
        }
        exec(sql) { if (this.selectedForRace) configured++; return super.exec(sql); }
      };
      const result = await executeForgeLoopCommand({ command: "task-list", projectPath: target, input: {} });
      if (process.platform === "win32" && linkFailure?.code === "EPERM") {
        t.skip("Host refused file-symlink creation; parent-junction controls remain enabled");
      } else {
        assert.equal(result.ok, false, JSON.stringify(result));
        assert.equal(result.error.code, "E_STORAGE_MIGRATION_REQUIRED");
        assert.equal(configured, 0);
      }
      assert.deepEqual(await readFile(path.join(outside, ".forgeloop/state.sqlite")), before);
    } finally { driver.DatabaseSync = Actual; await removeTempTree(base); }
  });
}

import { lstatSync, realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { openStorageDatabase, assertProjectDatabaseAdmission } from "../src/storage/connection.js";
import { isPathWithin } from "../src/core/filesystem.js";

test("unchanged project admission retains native filename and file identity", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "forgeloop-db-identity-"));
  const target = path.join(base, "target");
  await mkdir(path.join(target, ".forgeloop"), { recursive: true });
  const filename = path.join(target, ".forgeloop/state.sqlite");
  let db;
  try {
    db = openStorageDatabase(filename); db.close(); db = null;
    const root = await realpath(target);
    const asyncIdentity = await lstat(filename, { bigint: true });
    const rootIdentity = await lstat(target, { bigint: true });
    const syncIdentity = lstatSync(filename, { bigint: true });
    db = new (loadStorageDriver().DatabaseSync)(filename, { readOnly: true });
    const opened = realpathSync.native(db.location());
    const expected = path.join(root, ".forgeloop/state.sqlite");
    const observation = JSON.stringify({ platform: process.platform, root, expected, location: db.location(), opened,
      forward: isPathWithin(expected, opened), reverse: isPathWithin(opened, expected),
      asyncIdentity: { dev: String(asyncIdentity.dev), ino: String(asyncIdentity.ino) },
      syncIdentity: { dev: String(syncIdentity.dev), ino: String(syncIdentity.ino) } });
    assert.doesNotThrow(() => assertProjectDatabaseAdmission(db, { root, target, dev: asyncIdentity.dev, ino: asyncIdentity.ino, rootIdentity }), observation);
  } finally { db?.close(); await removeTempTree(base); }
});
