import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openStorageDatabase, upsertTask, exportDatabase, exportTask, checkStorageIntegrity } from "../src/storage/index.js";

test("portable exports cannot recreate operational aliases in a native project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-export-destination-"));
  const target = path.join(root, "native");
  await mkdir(path.join(target, ".forgeloop"), { recursive: true });
  const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
  const taskId = "export-boundary";
  try {
    upsertTask(db, { taskId, descriptor: { schemaVersion: 1, taskId, writeClaims: [] } });
    const alias = path.join(root, "native-alias");
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    const before = await readdir(path.join(target, ".forgeloop"));
    for (const operation of [
      () => exportDatabase(db, target),
      () => exportTask(db, taskId, path.join(target, ".forgeloop/task-state")),
      () => exportDatabase(db, path.join(target, ".forgeloop/task-state/nested")),
      () => exportDatabase(db, alias),
      () => exportTask(db, taskId, path.join(alias, ".forgeloop/task-state")),
    ]) {
      await assert.rejects(operation(), { code: "E_STORAGE_EXPORT_DESTINATION" });
      assert.deepEqual(await readdir(path.join(target, ".forgeloop")), before);
      assert.equal(checkStorageIntegrity(db).ok, true);
    }
    const portable = path.join(target, "portable");
    assert.equal((await exportDatabase(db, portable)).tasks, 1);
    assert.equal(JSON.parse(await readFile(path.join(portable, "export-index.json"), "utf8")).tasks[0].taskId, taskId);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

for (const evidence of ["state.sqlite", "state.sqlite-wal", "state.sqlite-shm", "storage-version.json"]) {
  test(`export preserves separate destination with retained ${evidence} evidence`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-export-retained-"));
    const db = openStorageDatabase(path.join(root, "source.sqlite"));
    const destination = path.join(root, "destination");
    const bytes = Buffer.from("retained authority evidence");
    try {
      upsertTask(db, { taskId: "retained", descriptor: { schemaVersion: 1, taskId: "retained", writeClaims: [] } });
      await mkdir(path.join(destination, ".forgeloop"), { recursive: true });
      const filename = path.join(destination, ".forgeloop", evidence);
      await writeFile(filename, bytes);
      await assert.rejects(exportDatabase(db, destination), { code: "E_STORAGE_EXPORT_DESTINATION" });
      await assert.rejects(exportTask(db, "retained", path.join(destination, ".forgeloop/task-state")), { code: "E_STORAGE_EXPORT_DESTINATION" });
      assert.deepEqual(await readFile(filename), bytes);
      assert.deepEqual(await readdir(path.join(destination, ".forgeloop")), [evidence]);
      assert.equal(checkStorageIntegrity(db).ok, true);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
