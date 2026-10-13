import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readdir, readFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { withStorageMaintenance } from "../src/storage/maintenance.js";

const maintenanceModule = new URL("../src/storage/maintenance.js", import.meta.url).href;

test("a crash before atomic maintenance publication leaves no ownerless exclusion", async t => {
  const target = await mkdtemp(path.join(tmpdir(), "forgeloop-admission-crash-"));
  t.after(() => removeTempTree(target));
  const metadata = path.join(target, ".forgeloop");
  await mkdir(metadata);
  const worker = `
    import { publishMaintenanceExclusion } from ${JSON.stringify(maintenanceModule)};
    await publishMaintenanceExclusion(process.argv[1], {
      schemaVersion: 1, ownerId: "${"d77cf014-c905-4d98-8f53-66db8027cf93"}",
      pid: process.pid, hostname: "test", acquiredAt: new Date().toISOString()
    }, { beforePublish: () => process.exit(86) });
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", worker, target], { stdio: "ignore" });
  const [code] = await once(child, "exit");
  assert.equal(code, 86);

  const entries = await readdir(metadata);
  assert.equal(entries.some(name => name === ".storage-maintenance"), false);
  const staged = entries.find(name => name.startsWith(".storage-maintenance.staging-"));
  assert.ok(staged, "the unpublished stage remains available for forensic cleanup");
  const owner = JSON.parse(await readFile(path.join(metadata, staged, "owner.json"), "utf8"));
  assert.equal(owner.ownerId, "d77cf014-c905-4d98-8f53-66db8027cf93");
  assert.equal((await lstat(path.join(metadata, staged))).isDirectory(), true);

  assert.equal(await withStorageMaintenance(target, () => "admitted"), "admitted");
  await assert.rejects(lstat(path.join(metadata, ".storage-maintenance")), { code: "ENOENT" });
});

test("only one concurrent admission atomically publishes the exclusion", async t => {
  const target = await mkdtemp(path.join(tmpdir(), "forgeloop-admission-race-"));
  t.after(() => removeTempTree(target));
  await mkdir(path.join(target, ".forgeloop"));
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let entered;
  const acquired = new Promise(resolve => { entered = resolve; });
  const owner = withStorageMaintenance(target, async () => { entered(); await held; });
  await acquired;
  await assert.rejects(withStorageMaintenance(target, () => assert.fail("second owner must not enter")), {
    code: "E_STORAGE_MAINTENANCE_IN_PROGRESS",
  });
  release();
  await owner;
  assert.deepEqual(await readdir(path.join(target, ".forgeloop")), []);
});

test("admission refuses to replace a pre-existing ownerless exclusion", async t => {
  const target = await mkdtemp(path.join(tmpdir(), "forgeloop-admission-existing-"));
  t.after(() => removeTempTree(target));
  const exclusion = path.join(target, ".forgeloop", ".storage-maintenance");
  await mkdir(exclusion, { recursive: true });

  await assert.rejects(withStorageMaintenance(target, () => assert.fail("must not replace existing exclusion")), {
    code: "E_STORAGE_MAINTENANCE_IN_PROGRESS",
  });
  assert.deepEqual(await readdir(exclusion), []);
  assert.deepEqual(await readdir(path.dirname(exclusion)), [".storage-maintenance"]);
});
