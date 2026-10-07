import assert from "node:assert/strict";
import test from "node:test";
import { fork, execFileSync } from "node:child_process";
import { once } from "node:events";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildActiveReplacementFixture } from "./helpers/active-replacement-fixtures.js";
import { resumeProjectReplacementPreparation, resumeActiveProjectReplacement } from "../src/storage/project-replacement.js";
import { verifyActiveProjectRestore } from "../src/storage/restore-terminal.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { randomUUID } from "node:crypto";
import { withStorageMaintenance } from "../src/storage/maintenance.js";
import { prepareActiveStorageReplacement } from "../src/storage/restore-replacement.js";
import { adoptPreparedReplacementOwner } from "../src/storage/restore-replacement-owner.js";

test("outgoing owner journal refuses altered evidence bindings and unrelated owners", async () => {
  const fixture = await buildActiveReplacementFixture();
  try {
    await withStorageMaintenance(fixture.target, async () => {
      await prepareActiveStorageReplacement(fixture.target, fixture.operationId, { writersQuiesced: true });
      const journal = await adoptPreparedReplacementOwner(fixture.target, fixture.operationId);
      const filename = path.join(fixture.operationRoot, "outgoing/owner-journal.json");
      await writeFile(filename, JSON.stringify({ ...journal, outgoingFingerprint: "a".repeat(64) }));
      await assert.rejects(adoptPreparedReplacementOwner(fixture.target, fixture.operationId), { code: "E_STORAGE_RESTORE_INVALID" });
      await writeFile(filename, JSON.stringify({ ...journal, ownerId: randomUUID() }));
      await assert.rejects(adoptPreparedReplacementOwner(fixture.target, fixture.operationId, { expectedOwnerId: journal.ownerId }), { code: "E_STORAGE_RESTORE_INVALID" });
    });
  } finally { await fixture.cleanup(); }
});

for (const checkpoint of ["OWNER", "INTENT", "OUTGOING_OWNER", "OUTGOING_RETAINING", "OUTGOING_RENAMED", "OUTGOING_RETAINED", "REBUILD_BASELINE", "REBUILD_ALLOCATED"]) {
  test(`replacement reconciles SIGKILL between adoption records at ${checkpoint}`, { timeout: 60000 }, async () => {
    const fixture = await buildActiveReplacementFixture();
    let worker;
    const start = async (url, args) => {
      worker = fork(url, args, { stdio: ["ignore", "ignore", "pipe", "ipc"] });
      let stderr = "";
      worker.stderr.on("data", bytes => { stderr += bytes; });
      return Promise.race([once(worker, "message").then(([message]) => message), once(worker, "exit").then(([code]) => { throw new Error(`Adoption worker exited ${code}: ${stderr}`); })]);
    };
    const kill = async () => { const exited = once(worker, "exit"); assert.equal(worker.kill("SIGKILL"), true); assert.equal((await exited)[1], "SIGKILL"); };
    try {
      const retaining = ["OUTGOING_RETAINING", "OUTGOING_RENAMED", "OUTGOING_RETAINED", "REBUILD_BASELINE", "REBUILD_ALLOCATED"].includes(checkpoint);
      const initial = await start(new URL("./helpers/storage-replacement-preparation-worker.mjs", import.meta.url), [fixture.target, path.join(fixture.operationRoot, "snapshot"), retaining ? "PARTIAL_OUTGOING" : "OUTGOING_READY"]);
      await kill();
      const adopted = await start(new URL("./helpers/storage-replacement-failed-resume-worker.mjs", import.meta.url), [fixture.target, initial.operationId, initial.ownerId, checkpoint]);
      assert.equal(adopted.checkpoint, checkpoint);
      assert.notEqual(adopted.ownerId, initial.ownerId);
      await kill();
      const options = { operationId: initial.operationId, expectedOwnerId: adopted.ownerId, writersQuiesced: true };
      if (checkpoint === "OWNER") {
        const history = path.join(fixture.target, ".forgeloop/storage-maintenance-history", `${initial.ownerId}.json`);
        const bytes = await readFile(history);
        await writeFile(history, JSON.stringify({ ...JSON.parse(bytes), ownerId: randomUUID() }));
        await assert.rejects(resumeProjectReplacementPreparation(fixture.target, options), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
        await writeFile(history, bytes);
      }
      assert.equal((await resumeActiveProjectReplacement(fixture.target, options)).replaced, true);
      assert.equal((await verifyActiveProjectRestore(fixture.target, initial.operationId)).active, true);
      if (retaining) assert.equal((await readdir(path.join(fixture.target, ".forgeloop/storage-restores", initial.operationId, "outgoing-history"))).length, checkpoint.startsWith("REBUILD_") ? 2 : 1);
    } finally {
      if (worker && worker.exitCode === null && worker.signalCode === null) { const exited = once(worker, "exit"); worker.kill("SIGKILL"); await exited; }
      await fixture.cleanup();
    }
  });
}

for (const checkpoint of ["PREPARING", "OUTGOING_BASELINE", "OUTGOING_ALLOCATED", "OUTGOING_PREPARING", "PARTIAL_OUTGOING", "OUTGOING_READY", "PARTIAL_SNAPSHOT", "READY", "PUBLICATION_READY"]) {
  test(`initial replacement resumes SIGKILL at ${checkpoint}`, { timeout: 60000 }, async () => {
    const fixture = await buildActiveReplacementFixture();
    let worker;
    try {
      worker = fork(new URL("./helpers/storage-replacement-preparation-worker.mjs", import.meta.url), [fixture.target, path.join(fixture.operationRoot, "snapshot"), checkpoint], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
      let stderr = "";
      worker.stderr.on("data", bytes => { stderr += bytes; });
      const ready = await Promise.race([once(worker, "message").then(([message]) => message), once(worker, "exit").then(([code]) => { throw new Error(`Preparation worker exited ${code}: ${stderr}`); })]);
      const options = { operationId: ready.operationId, expectedOwnerId: ready.ownerId, writersQuiesced: true };
      await assert.rejects(resumeActiveProjectReplacement(fixture.target, options), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
      const exited = once(worker, "exit");
      assert.equal(worker.kill("SIGKILL"), true);
      assert.equal((await exited)[1], "SIGKILL");
      const root = path.join(fixture.target, ".forgeloop/storage-restores", ready.operationId);
      let originalManifest;
      if (checkpoint === "PUBLICATION_READY") {
        const filename = path.join(root, "replacement-intent.json");
        const bytes = await readFile(filename);
        await writeFile(filename, JSON.stringify({ ...JSON.parse(bytes), snapshotFingerprint: "a".repeat(64) }));
        await assert.rejects(resumeActiveProjectReplacement(fixture.target, options), { code: "E_STORAGE_RESTORE_INVALID" });
        assert.equal(JSON.parse(await readFile(path.join(fixture.target, ".forgeloop/.storage-maintenance/owner.json"))).ownerId, ready.ownerId);
        await writeFile(filename, bytes);
      }
      if (checkpoint === "OUTGOING_ALLOCATED") {
        await writeFile(path.join(root, "outgoing/interrupted.note"), "retained partial allocation bytes");
        const allocation = path.join(root, "replacement-manifest.json");
        const bytes = await readFile(allocation);
        const changed = JSON.parse(bytes);
        changed.preparationBaseline.inventoryFingerprint = "a".repeat(64);
        await writeFile(allocation, JSON.stringify(changed));
        worker = fork(new URL("./helpers/storage-replacement-failed-resume-worker.mjs", import.meta.url), [fixture.target, ready.operationId, ready.ownerId], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
        const finished = once(worker, "exit");
        const [failed] = await once(worker, "message");
        assert.equal(failed.code, "E_STORAGE_RESTORE_INVALID");
        assert.equal((await finished)[0], 0);
        await assert.rejects(readFile(path.join(root, "outgoing/replacement-manifest.json")), { code: "ENOENT" });
        await writeFile(allocation, bytes);
        options.expectedOwnerId = failed.ownerId;
      }
      if (checkpoint === "PARTIAL_OUTGOING") {
        const orphan = path.join(fixture.target, fixture.orphanPath);
        const bytes = await readFile(orphan);
        await writeFile(orphan, "changed outgoing orphan");
        worker = fork(new URL("./helpers/storage-replacement-failed-resume-worker.mjs", import.meta.url), [fixture.target, ready.operationId, ready.ownerId], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
        const finished = once(worker, "exit");
        const [failed] = await once(worker, "message");
        assert.equal(failed.code, "E_STORAGE_RESTORE_INVALID");
        assert.equal((await finished)[0], 0);
        await assert.rejects(readdir(path.join(root, "outgoing-history")), { code: "ENOENT" });
        options.expectedOwnerId = failed.ownerId;
        await writeFile(orphan, bytes);
        worker = fork(new URL("./helpers/storage-replacement-failed-resume-worker.mjs", import.meta.url), [fixture.target, ready.operationId, options.expectedOwnerId, "REBUILD_DATABASE"], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
        const rebuilt = await Promise.race([once(worker, "message").then(([message]) => message), once(worker, "exit").then(([code]) => { throw new Error(`Rebuild worker exited ${code}`); })]);
        assert.equal(rebuilt.checkpoint, "REBUILD_DATABASE", JSON.stringify(rebuilt));
        const rebuiltExit = once(worker, "exit");
        assert.equal(worker.kill("SIGKILL"), true);
        assert.equal((await rebuiltExit)[1], "SIGKILL");
        options.expectedOwnerId = rebuilt.ownerId;
      }
      if (checkpoint === "OUTGOING_READY") {
        originalManifest = await readFile(path.join(root, "outgoing/replacement-manifest.json"));
        const incoming = path.join(fixture.operationRoot, "snapshot", fixture.references.incoming.path);
        const bytes = await readFile(incoming);
        await writeFile(incoming, "corrupt source before recovered preparation");
        worker = fork(new URL("./helpers/storage-replacement-failed-resume-worker.mjs", import.meta.url), [fixture.target, ready.operationId, ready.ownerId], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
        const finished = once(worker, "exit");
        const [failed] = await once(worker, "message");
        assert.equal(failed.code, "E_STORAGE_ATTACHMENT_INVALID");
        assert.notEqual(failed.ownerId, ready.ownerId);
        assert.equal((await finished)[0], 0);
        assert.equal(JSON.parse(await readFile(path.join(root, "outgoing/owner-journal.json"))).ownerId, failed.ownerId);
        options.expectedOwnerId = failed.ownerId;
        await writeFile(incoming, bytes);
      }
      let resumed;
      if (checkpoint === "READY") {
        const response = await executeForgeLoopCommand({ command: "storage-restore-resume", projectPath: fixture.target, input: { ...options, replaceActive: true } });
        assert.equal(response.ok, true, JSON.stringify(response));
        resumed = response.result;
      } else if (checkpoint === "PUBLICATION_READY") {
        const ownerBeforeCli = JSON.parse(await readFile(path.join(fixture.target, ".forgeloop/.storage-maintenance/owner.json")));
        try {
          resumed = JSON.parse(execFileSync(process.execPath, ["src/cli.js", "storage-restore-resume", "--path", fixture.target, "--operation", options.operationId, "--expected-owner", options.expectedOwnerId, "--replace-active", "--writers-quiesced", "--json"], { encoding: "utf8" }));
        } catch (error) {
          error.message += `\nRecovery process identities: ${JSON.stringify({ recordedOwnerPid: ownerBeforeCli.pid, killedWorkerPid: worker.pid, resumeCliPid: error.pid, testPid: process.pid })}`;
          throw error;
        }
      } else resumed = await resumeActiveProjectReplacement(fixture.target, options);
      assert.equal(resumed.replaced, true);
      assert.equal((await verifyActiveProjectRestore(fixture.target, ready.operationId)).active, true);
      if (originalManifest) assert.deepEqual(await readFile(path.join(root, "outgoing/replacement-manifest.json")), originalManifest);
      if (["OUTGOING_BASELINE", "OUTGOING_ALLOCATED", "OUTGOING_PREPARING", "PARTIAL_OUTGOING"].includes(checkpoint)) {
        const history = await readdir(path.join(root, "outgoing-history"));
        assert.equal(history.length, checkpoint === "PARTIAL_OUTGOING" ? 2 : 1);
        for (const name of history) {
          assert.equal(JSON.parse(await readFile(path.join(root, "outgoing-history", name, "replacement-manifest.json"))).status, "PREPARING");
          if (checkpoint === "OUTGOING_ALLOCATED") assert.equal(await readFile(path.join(root, "outgoing-history", name, "interrupted.note"), "utf8"), "retained partial allocation bytes");
          if (checkpoint === "PARTIAL_OUTGOING") assert.equal(JSON.parse(await readFile(path.join(root, "outgoing-history", name, "backup/backup-manifest.json"))).status, "PREPARING");
        }
        if (checkpoint === "PARTIAL_OUTGOING") assert.equal(JSON.parse(await readFile(path.join(root, "replacement-intent.json"))).outgoingRebuild.previous.length, 1);
      }
      assert.equal(await readFile(path.join(root, "outgoing/archive", fixture.orphanPath), "utf8"), "retained orphan evidence");
      if (checkpoint === "PARTIAL_SNAPSHOT") {
        const history = await readdir(path.join(root, "snapshot-history"));
        assert.equal(history.length, 1);
        assert.equal(JSON.parse(await readFile(path.join(root, "snapshot-history", history[0], "backup-manifest.json"))).status, "PREPARING");
      }
      assert.equal((await executeForgeLoopCommand({ command: "task-list", projectPath: fixture.target, input: {} })).ok, true);
    } finally {
      if (worker && worker.exitCode === null && worker.signalCode === null) { const exited = once(worker, "exit"); worker.kill("SIGKILL"); await exited; }
      await fixture.cleanup();
    }
  });
}
