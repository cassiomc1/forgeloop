import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, link, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resumeStorageMaintenance } from "../src/storage/maintenance.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";

const worker = fileURLToPath(new URL("./helpers/storage-maintenance-handoff-worker.mjs", import.meta.url));
const ownerPath = target => path.join(target, ".forgeloop/.storage-maintenance/owner.json");
async function start(target, mode, expectedOwnerId = "") {
  const child = spawn(process.execPath, [worker, target, mode, expectedOwnerId], { stdio: ["pipe", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Handoff worker did not reach checkpoint")), 10000);
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.includes("READY")) { clearTimeout(timeout); resolve(); }
    });
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("exit", () => { clearTimeout(timeout); reject(new Error(`Handoff worker exited: ${output}`)); });
  });
  return child;
}
async function kill(child) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
async function withDeadOwner(callback) {
  const target = await mkdtemp(path.join(tmpdir(), "forgeloop-handoff-"));
  await mkdir(path.join(target, ".forgeloop"));
  const children = [];
  try {
    const child = await start(target, "OWNER"); children.push(child);
    await kill(child);
    const original = await readFile(ownerPath(target));
    await callback(target, JSON.parse(original), original, children);
  } finally { for (const child of children) child.kill("SIGKILL"); await removeTempTree(target); }
}

for (const checkpoint of ["CLAIM", "BEFORE_OWNER", "AFTER_OWNER"]) {
  test(`SIGKILL at maintenance handoff ${checkpoint} preserves exclusion and permits exact dead-owner recovery`, async () => {
    await withDeadOwner(async (target, originalOwner, original, children) => {
      const child = await start(target, checkpoint, originalOwner.ownerId); children.push(child);
      await kill(child);
      const previous = JSON.parse(await readFile(ownerPath(target)));
      assert.equal(previous.ownerId === originalOwner.ownerId, checkpoint !== "AFTER_OWNER");
      const blocked = await executeForgeLoopCommand({ command: "task-list", projectPath: target });
      assert.equal(blocked.error.code, "E_STORAGE_MAINTENANCE_IN_PROGRESS");
      let invoked = 0;
      await resumeStorageMaintenance(target, { expectedOwnerId: previous.ownerId, writersQuiesced: true }, async () => {
        invoked += 1;
        const adopted = JSON.parse(await readFile(ownerPath(target)));
        assert.equal(adopted.resumedFrom, previous.ownerId);
        assert.notEqual(adopted.ownerId, previous.ownerId);
        const stillBlocked = await executeForgeLoopCommand({ command: "task-list", projectPath: target });
        assert.equal(stillBlocked.error.code, "E_STORAGE_MAINTENANCE_IN_PROGRESS");
      });
      assert.equal(invoked, 1);
      assert.deepEqual(await readFile(path.join(target, `.forgeloop/storage-maintenance-history/${originalOwner.ownerId}.json`)), original);
      assert.equal((await executeForgeLoopCommand({ command: "task-list", projectPath: target })).ok, true);
    });
  });
}

test("a live handoff claimant cannot be displaced while the canonical owner is still dead", async () => {
  await withDeadOwner(async (target, owner, original, children) => {
    const child = await start(target, "CLAIM", owner.ownerId); children.push(child);
    const claim = path.join(target, `.forgeloop/storage-maintenance-history/handoffs/${owner.ownerId}.json`);
    const bytes = await readFile(claim);
    assert.equal(JSON.parse(bytes).pid, child.pid);
    const status = await executeForgeLoopCommand({ command: "storage-migration-status", projectPath: target });
    assert.equal(status.result.maintenance.handoffPresent, true);
    await assert.rejects(resumeStorageMaintenance(target, { expectedOwnerId: owner.ownerId, writersQuiesced: true }, () => assert.fail("live claimant cannot be displaced")), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
    assert.deepEqual(await readFile(claim), bytes);
    assert.deepEqual(await readFile(ownerPath(target)), original);
    await kill(child);
    await resumeStorageMaintenance(target, { expectedOwnerId: owner.ownerId, writersQuiesced: true }, () => undefined);
    assert.equal((await readdir(path.dirname(claim))).length, 2, "dead claim is retained and gains one successor");
  });
});

test("two independent maintenance resumers accept exactly one callback and retain canonical exclusion", async () => {
  await withDeadOwner(async (target, owner) => {
    const run = promisify(execFile);
    const outputs = await Promise.all([1, 2].map(() => run(process.execPath, [worker, target, "ONCE", owner.ownerId], { encoding: "utf8" })));
    const results = outputs.map(output => JSON.parse(output.stdout.trim()));
    assert.equal(results.filter(result => result.ok).length, 1, JSON.stringify(results));
    assert.equal(results.find(result => !result.ok).code, "E_STORAGE_MAINTENANCE_IN_PROGRESS");
    const current = JSON.parse(await readFile(ownerPath(target)));
    assert.equal(current.resumedFrom, owner.ownerId);
    const blocked = await executeForgeLoopCommand({ command: "task-list", projectPath: target });
    assert.equal(blocked.error.code, "E_STORAGE_MAINTENANCE_IN_PROGRESS");
    await resumeStorageMaintenance(target, { expectedOwnerId: current.ownerId, writersQuiesced: true }, () => undefined);
  });
});


test("a delayed contender cannot occupy the promoted owner's next handoff identity", async () => {
  await withDeadOwner(async (target, owner, _original, children) => {
    const contender = await start(target, "LATE_CONTENDER", owner.ownerId);
    children.push(contender);
    const winner = await promisify(execFile)(process.execPath, [worker, target, "ONCE", owner.ownerId], { encoding: "utf8" });
    assert.equal(JSON.parse(winner.stdout.trim()).ok, true);
    const promotedBytes = await readFile(ownerPath(target));
    const promoted = JSON.parse(promotedBytes);
    assert.equal(promoted.resumedFrom, owner.ownerId);
    let output = "";
    contender.stdout.on("data", bytes => { output += bytes; });
    const exited = once(contender, "exit");
    contender.stdin.end("continue\n");
    await exited;
    const rejected = JSON.parse(output.trim());
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "E_STORAGE_MAINTENANCE_IN_PROGRESS");
    assert.deepEqual(await readFile(ownerPath(target)), promotedBytes);
    await resumeStorageMaintenance(target, { expectedOwnerId: promoted.ownerId, writersQuiesced: true }, () => undefined);
    assert.equal((await executeForgeLoopCommand({ command: "task-list", projectPath: target })).ok, true);
  });
});

test("retained flat continuation claims still block live owners and permit exact dead-owner recovery", async () => {
  await withDeadOwner(async (target, owner, original, children) => {
    const first = await start(target, "CLAIM", owner.ownerId); children.push(first);
    await kill(first);
    const history = path.join(target, ".forgeloop/storage-maintenance-history/handoffs");
    const firstClaim = JSON.parse(await readFile(path.join(history, `${owner.ownerId}.json`)));
    const second = await start(target, "CLAIM", owner.ownerId); children.push(second);
    const scoped = path.join(history, `${owner.ownerId}--${firstClaim.ownerId}.json`);
    const legacy = path.join(history, `${firstClaim.ownerId}.json`);
    await rename(scoped, legacy);
    const retained = await readFile(legacy);
    await assert.rejects(resumeStorageMaintenance(target, { expectedOwnerId: owner.ownerId, writersQuiesced: true }, () => assert.fail("live legacy claimant cannot be bypassed")), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
    assert.deepEqual(await readFile(ownerPath(target)), original);
    assert.deepEqual(await readFile(legacy), retained);
    await kill(second);
    await resumeStorageMaintenance(target, { expectedOwnerId: owner.ownerId, writersQuiesced: true }, () => undefined);
    assert.deepEqual(await readFile(legacy), retained);
    assert.equal((await executeForgeLoopCommand({ command: "task-list", projectPath: target })).ok, true);
  });
});

test("coexisting flat and scoped continuation identities refuse recovery and retain both records", async () => {
  await withDeadOwner(async (target, owner, original, children) => {
    const first = await start(target, "CLAIM", owner.ownerId); children.push(first);
    await kill(first);
    const history = path.join(target, ".forgeloop/storage-maintenance-history/handoffs");
    const firstClaim = JSON.parse(await readFile(path.join(history, `${owner.ownerId}.json`)));
    const second = await start(target, "CLAIM", owner.ownerId); children.push(second);
    await kill(second);
    const scoped = path.join(history, `${owner.ownerId}--${firstClaim.ownerId}.json`);
    const legacy = path.join(history, `${firstClaim.ownerId}.json`);
    const bytes = await readFile(scoped);
    await link(scoped, legacy);
    await assert.rejects(resumeStorageMaintenance(target, { expectedOwnerId: owner.ownerId, writersQuiesced: true }, () => assert.fail("ambiguous continuation cannot authorize recovery")), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
    assert.deepEqual(await readFile(ownerPath(target)), original);
    assert.deepEqual(await readFile(scoped), bytes);
    assert.deepEqual(await readFile(legacy), bytes);
  });
});

test("tampered, foreign and cyclic handoff claims refuse recovery without replacing owner or evidence", async () => {
  await withDeadOwner(async (target, owner, original, children) => {
    const child = await start(target, "CLAIM", owner.ownerId); children.push(child);
    await kill(child);
    const filename = path.join(target, `.forgeloop/storage-maintenance-history/handoffs/${owner.ownerId}.json`);
    const bytes = await readFile(filename);
    const claim = JSON.parse(bytes);
    for (const modified of [
      { ...claim, handoffSourceSha256: "f".repeat(64) },
      { ...claim, resumedFrom: randomUUID() },
      { ...claim, hostname: "foreign-host" },
      { ...claim, ownerId: owner.ownerId },
      { malformed: true },
    ]) {
      const tampered = JSON.stringify(modified);
      await writeFile(filename, tampered);
      await assert.rejects(resumeStorageMaintenance(target, { expectedOwnerId: owner.ownerId, writersQuiesced: true }, () => assert.fail("tampered claims cannot authorize recovery")), error => ["E_STORAGE_MAINTENANCE_IN_PROGRESS", "E_STORAGE_MAINTENANCE_OWNER_INVALID"].includes(error.code));
      assert.deepEqual(await readFile(ownerPath(target)), original);
      assert.equal(await readFile(filename, "utf8"), tampered);
    }
    await writeFile(filename, bytes);
    await resumeStorageMaintenance(target, { expectedOwnerId: owner.ownerId, writersQuiesced: true }, () => undefined);
  });
});
