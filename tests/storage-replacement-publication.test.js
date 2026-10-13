import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { buildActiveReplacementFixture } from "./helpers/active-replacement-fixtures.js";
import { prepareActiveStorageReplacement } from "../src/storage/restore-replacement.js";
import { archiveActiveStorageReplacement } from "../src/storage/restore-replacement-archive.js";
import { publishArchivedStorageReplacement, resumeProjectStorageRestore } from "../src/storage/project-restore.js";
import { withStorageMaintenance } from "../src/storage/maintenance.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { verifyActiveProjectRestore } from "../src/storage/restore-terminal.js";
import { replaceActiveProjectStorage } from "../src/storage/project-replacement.js";

test("initial replacement orchestrates independent source through retained outgoing authority", async () => {
  const fixture = await buildActiveReplacementFixture();
  try {
    const source = path.join(fixture.operationRoot, "snapshot");
    await assert.rejects(replaceActiveProjectStorage(source, fixture.target), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
    const incomingFile = path.join(source, fixture.references.incoming.path);
    const originalBytes = await readFile(incomingFile);
    await writeFile(incomingFile, "corrupt before admission");
    await assert.rejects(replaceActiveProjectStorage(source, fixture.target, { writersQuiesced: true }));
    assert.equal((await executeForgeLoopCommand({ command: "task-list", projectPath: fixture.target, input: {} })).ok, true);
    await writeFile(incomingFile, originalBytes);
    const result = await replaceActiveProjectStorage(source, fixture.target, { writersQuiesced: true });
    assert.equal(result.replaced, true);
    assert.notEqual(result.operationId, fixture.operationId);
    const intent = JSON.parse(await readFile(result.replacementIntent, "utf8"));
    assert.equal(intent.phase, "READY");
    assert.equal(intent.operationId, result.operationId);
    assert.equal(intent.source, source);
    assert.equal(await readFile(path.join(fixture.target, ".forgeloop/storage-restores", result.operationId, "outgoing/archive", fixture.orphanPath), "utf8"), "retained orphan evidence");
    assert.equal((await verifyActiveProjectRestore(fixture.target, result.operationId)).active, true);
    const listed = await executeForgeLoopCommand({ command: "task-list", projectPath: fixture.target, input: {} });
    assert.equal(listed.ok, true, JSON.stringify(listed));
    assert.match(JSON.stringify(listed), /replacement-incoming-task/);
    assert.doesNotMatch(JSON.stringify(listed), /replacement-outgoing-task/);
  } finally { await fixture.cleanup(); }
});

for (const checkpoint of ["READY", "PUBLISHING", "PENDING_MARKER", "ATTACHMENT", "DATABASE", "ACTIVE_MARKER", "ACTIVE"]) {
  test(`replacement resumes actual SIGKILL after publication ${checkpoint}`, { timeout: 60000 }, async () => {
    const fixture = await buildActiveReplacementFixture();
    let worker;
    try {
      worker = fork(new URL("./helpers/storage-replacement-publication-worker.mjs", import.meta.url), [fixture.target, fixture.operationId, checkpoint], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
      let stderr = "";
      worker.stderr.on("data", bytes => { stderr += bytes; });
      const ready = await Promise.race([once(worker, "message").then(([message]) => message), once(worker, "exit").then(([code]) => { throw new Error(`Publication worker exited ${code}: ${stderr}`); })]);
      assert.equal(ready.checkpoint, checkpoint);
      const options = { operationId: fixture.operationId, expectedOwnerId: ready.ownerId, writersQuiesced: true };
      await assert.rejects(resumeProjectStorageRestore(fixture.target, options), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
      const excluded = await executeForgeLoopCommand({ command: "task-list", projectPath: fixture.target, input: {} });
      assert.equal(excluded.ok, false);
      assert.match(JSON.stringify(excluded), /E_STORAGE_MAINTENANCE_IN_PROGRESS/);
      const exited = once(worker, "exit");
      assert.equal(worker.kill("SIGKILL"), true);
      assert.equal((await exited)[1], "SIGKILL");
      if (["READY", "ACTIVE"].includes(checkpoint)) {
        const adoptionCheckpoint = checkpoint === "READY" ? "PUBLICATION_OWNER" : "PUBLICATION_INTENT";
        worker = fork(new URL("./helpers/storage-replacement-failed-resume-worker.mjs", import.meta.url), [fixture.target, fixture.operationId, ready.ownerId, adoptionCheckpoint], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
        let adoptionErrors = "";
        worker.stderr.on("data", bytes => { adoptionErrors += bytes; });
        const adopted = await Promise.race([once(worker, "message").then(([message]) => message), once(worker, "exit").then(([code]) => { throw new Error(`Publication adoption exited ${code}: ${adoptionErrors}`); })]);
        assert.equal(adopted.checkpoint, adoptionCheckpoint);
        assert.notEqual(adopted.ownerId, ready.ownerId);
        const adoptedExit = once(worker, "exit");
        assert.equal(worker.kill("SIGKILL"), true);
        assert.equal((await adoptedExit)[1], "SIGKILL");
        options.expectedOwnerId = adopted.ownerId;
      }
      assert.equal((await resumeProjectStorageRestore(fixture.target, options)).replaced, true);
      assert.equal((await verifyActiveProjectRestore(fixture.target, fixture.operationId)).active, true);
      const listed = await executeForgeLoopCommand({ command: "task-list", projectPath: fixture.target, input: {} });
      assert.equal(listed.ok, true, JSON.stringify(listed));
      assert.match(JSON.stringify(listed), /replacement-incoming-task/);
      assert.doesNotMatch(JSON.stringify(listed), /replacement-outgoing-task/);
      assert.equal(await readFile(path.join(fixture.operationRoot, "outgoing/archive", fixture.orphanPath), "utf8"), "retained orphan evidence");
    } finally {
      if (worker && worker.exitCode === null && worker.signalCode === null) { const exited = once(worker, "exit"); worker.kill("SIGKILL"); await exited; }
      await fixture.cleanup();
    }
  });
}

test("archived replacement activates incoming authority and releases admission only after validation", async () => {
  const fixture = await buildActiveReplacementFixture();
  try {
    let archived;
    await withStorageMaintenance(fixture.target, async () => {
      await prepareActiveStorageReplacement(fixture.target, fixture.operationId, { writersQuiesced: true });
      archived = await archiveActiveStorageReplacement(fixture.target, fixture.operationId);
      const result = await publishArchivedStorageReplacement(fixture.target, fixture.operationId);
      assert.equal(result.replaced, true);
      assert.equal(result.active, true);
      assert.equal((await publishArchivedStorageReplacement(fixture.target, fixture.operationId)).currentStateVerified, true);
    });
    const listed = await executeForgeLoopCommand({ command: "task-list", projectPath: fixture.target, input: {} });
    assert.equal(listed.ok, true, JSON.stringify(listed));
    assert.match(JSON.stringify(listed), /replacement-incoming-task/);
    assert.doesNotMatch(JSON.stringify(listed), /replacement-outgoing-task/);
    assert.equal(await readFile(path.join(archived.archive, fixture.orphanPath), "utf8"), "retained orphan evidence");
    assert.equal(await readFile(path.join(fixture.target, fixture.references.incoming.path), "utf8"), "incoming independent bytes");
    const created = await executeForgeLoopCommand({ command: "task-create", projectPath: fixture.target, input: { taskId: "replacement-after-activation", claims: [] } });
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal((await verifyActiveProjectRestore(fixture.target, fixture.operationId)).active, true);
    await writeFile(path.join(archived.archive, fixture.orphanPath), "corrupt archived evidence");
    await assert.rejects(verifyActiveProjectRestore(fixture.target, fixture.operationId), { code: "E_STORAGE_RESTORE_INVALID" });
  } finally { await fixture.cleanup(); }
});

test("incoming corruption after archival retains exclusion and refuses publication", async () => {
  const fixture = await buildActiveReplacementFixture();
  try {
    await withStorageMaintenance(fixture.target, async () => {
      await prepareActiveStorageReplacement(fixture.target, fixture.operationId, { writersQuiesced: true });
      const archived = await archiveActiveStorageReplacement(fixture.target, fixture.operationId);
      await writeFile(path.join(archived.incomingSnapshot, fixture.references.incoming.path), "corrupt incoming bytes");
      await assert.rejects(publishArchivedStorageReplacement(fixture.target, fixture.operationId));
    });
    const listed = await executeForgeLoopCommand({ command: "task-list", projectPath: fixture.target, input: {} });
    assert.equal(listed.ok, false);
    assert.match(JSON.stringify(listed), /E_STORAGE_MAINTENANCE_IN_PROGRESS/);
  } finally { await fixture.cleanup(); }
});
