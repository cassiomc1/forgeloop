import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { access, copyFile, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildActiveReplacementFixture } from "./helpers/active-replacement-fixtures.js";
import { prepareActiveStorageReplacement, verifyPreparedActiveStorageReplacement } from "../src/storage/restore-replacement.js";
import { archiveActiveStorageReplacement, inspectActiveStorageReplacementPartition, verifyActiveStorageReplacementArchive, verifyRetainedStorageReplacementArchive } from "../src/storage/restore-replacement-archive.js";
import { withStorageMaintenance, resumeStorageMaintenance } from "../src/storage/maintenance.js";
import { readMaintenanceOwner } from "../src/storage/maintenance-owner.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";

async function assertExcluded(target) {
  const result = await executeForgeLoopCommand({ command: "task-list", projectPath: target, input: {} });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result), /E_STORAGE_MAINTENANCE_IN_PROGRESS/);
}

test("retained archive verification binds publication intent independently of new active roots", async () => {
  const fixture = await buildActiveReplacementFixture();
  try {
    await withStorageMaintenance(fixture.target, async () => {
      await prepareActiveStorageReplacement(fixture.target, fixture.operationId, { writersQuiesced: true });
      const archived = await archiveActiveStorageReplacement(fixture.target, fixture.operationId);
      const bindings = { outgoingFingerprint: archived.journal.outgoingFingerprint, incomingFingerprint: archived.journal.incomingFingerprint };
      await assert.rejects(verifyRetainedStorageReplacementArchive(fixture.target, fixture.operationId), { code: "E_STORAGE_RESTORE_INVALID" });
      await assert.rejects(verifyRetainedStorageReplacementArchive(fixture.target, fixture.operationId, { ...bindings, incomingFingerprint: "a".repeat(64) }), { code: "E_STORAGE_RESTORE_INVALID" });
      await copyFile(path.join(archived.incomingSnapshot, "state.sqlite"), path.join(fixture.target, ".forgeloop/state.sqlite"));
      assert.equal((await verifyRetainedStorageReplacementArchive(fixture.target, fixture.operationId, bindings)).archived, true);
      await assert.rejects(inspectActiveStorageReplacementPartition(fixture.target, fixture.operationId), { code: "E_STORAGE_RESTORE_INVALID" });
      await writeFile(path.join(archived.archive, fixture.orphanPath), "tampered retained orphan");
      await assert.rejects(verifyRetainedStorageReplacementArchive(fixture.target, fixture.operationId, bindings), { code: "E_STORAGE_RESTORE_INVALID" });
    });
    await assertExcluded(fixture.target);
  } finally { await fixture.cleanup(); }
});

test("replacement archives exact outgoing roots and retains exclusion until validated activation", async () => {
  const fixture = await buildActiveReplacementFixture();
  try {
    const database = path.join(fixture.target, ".forgeloop/state.sqlite");
    const original = await stat(database);
    await withStorageMaintenance(fixture.target, async () => {
      await prepareActiveStorageReplacement(fixture.target, fixture.operationId, { writersQuiesced: true });
      const result = await archiveActiveStorageReplacement(fixture.target, fixture.operationId);
      assert.equal(result.archived, true);
      assert.equal(result.replaced, false);
      assert.equal(result.roots.every(root => root.location !== "ACTIVE"), true);
      assert.equal((await stat(path.join(result.archive, ".forgeloop/state.sqlite"))).ino, original.ino);
      assert.equal(await readFile(path.join(result.archive, fixture.orphanPath), "utf8"), "retained orphan evidence");
      assert.equal(await readFile(path.join(result.backup, fixture.references.outgoing.path), "utf8"), "outgoing independent bytes");
      assert.equal(await readFile(path.join(result.incomingSnapshot, fixture.references.incoming.path), "utf8"), "incoming independent bytes");
      assert.equal((await archiveActiveStorageReplacement(fixture.target, fixture.operationId)).archived, true);
      await assertExcluded(fixture.target);
    });
    await assert.rejects(access(database), { code: "ENOENT" });
    await assertExcluded(fixture.target);
  } finally { await fixture.cleanup(); }
});

for (const failure of ["missing", "corrupt", "unrecorded"]) {
  test(`replacement refuses ${failure} incoming/archival evidence before moving active authority`, async () => {
    const fixture = await buildActiveReplacementFixture();
    try {
      const database = await readFile(path.join(fixture.target, ".forgeloop/state.sqlite"));
      const marker = await readFile(path.join(fixture.target, ".forgeloop/storage-version.json"));
      await withStorageMaintenance(fixture.target, async () => {
        await prepareActiveStorageReplacement(fixture.target, fixture.operationId, { writersQuiesced: true });
        if (failure === "missing") await rm(path.join(fixture.operationRoot, "snapshot"), { recursive: true });
        else if (failure === "corrupt") await writeFile(path.join(fixture.operationRoot, "snapshot", fixture.references.incoming.path), "corrupt source");
        else {
          const { mkdir } = await import("node:fs/promises");
          await mkdir(path.join(fixture.operationRoot, "outgoing/archive"));
        }
        await assert.rejects(archiveActiveStorageReplacement(fixture.target, fixture.operationId));
        assert.deepEqual(await readFile(path.join(fixture.target, ".forgeloop/state.sqlite")), database);
        assert.deepEqual(await readFile(path.join(fixture.target, ".forgeloop/storage-version.json")), marker);
      }, { retainOnError: true });
      await assertExcluded(fixture.target);
    } finally { await fixture.cleanup(); }
  });
}

for (const checkpoint of ["MARKER", "ATTACHMENTS", "DATABASE", "ARCHIVED"]) {
  test(`replacement resumes actual SIGKILL after ${checkpoint} while refusing live-owner adoption`, { timeout: 60000 }, async () => {
    const fixture = await buildActiveReplacementFixture();
    let worker;
    try {
      worker = fork(new URL("./helpers/active-replacement-archive-worker.mjs", import.meta.url), [fixture.target, fixture.operationId, checkpoint], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
      let stderr = "";
      worker.stderr.on("data", bytes => { stderr += bytes; });
      const ready = await Promise.race([
        once(worker, "message").then(([message]) => message),
        once(worker, "exit").then(([code]) => { throw new Error(`Archive worker exited ${code}: ${stderr}`); }),
      ]);
      assert.equal(ready.checkpoint, checkpoint);
      const options = { expectedOwnerId: ready.ownerId, writersQuiesced: true };
      await assert.rejects(resumeStorageMaintenance(fixture.target, options, () => archiveActiveStorageReplacement(fixture.target, fixture.operationId, options)), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
      await assertExcluded(fixture.target);
      const interrupted = await inspectActiveStorageReplacementPartition(fixture.target, fixture.operationId);
      assert.equal(interrupted.roots.filter(root => root.location === "ARCHIVED").length, { MARKER: 1, ATTACHMENTS: 2, DATABASE: 3, ARCHIVED: 3 }[checkpoint]);
      const exited = once(worker, "exit");
      assert.equal(worker.kill("SIGKILL"), true);
      const [, signal] = await exited;
      assert.equal(signal, "SIGKILL");
      if (checkpoint === "MARKER") {
        worker = fork(new URL("./helpers/storage-replacement-failed-resume-worker.mjs", import.meta.url), [fixture.target, fixture.operationId, ready.ownerId, "ARCHIVE_OWNER"], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
        const adopted = await Promise.race([once(worker, "message").then(([message]) => message), once(worker, "exit").then(([code]) => { throw new Error(`Archive adoption exited ${code}`); })]);
        assert.equal(adopted.checkpoint, "ARCHIVE_OWNER");
        assert.notEqual(adopted.ownerId, ready.ownerId);
        const adoptionExit = once(worker, "exit");
        assert.equal(worker.kill("SIGKILL"), true);
        assert.equal((await adoptionExit)[1], "SIGKILL");
        options.expectedOwnerId = adopted.ownerId;
      }
      const incomingPath = path.join(fixture.operationRoot, "snapshot", fixture.references.incoming.path);
      const incomingBytes = await readFile(incomingPath);
      if (checkpoint === "MARKER") await writeFile(incomingPath, "interrupted incoming corruption");
      const resumed = await resumeStorageMaintenance(fixture.target, options, async () => {
        if (checkpoint === "MARKER") {
          await assert.rejects(archiveActiveStorageReplacement(fixture.target, fixture.operationId, options), { code: "E_STORAGE_ATTACHMENT_INVALID" });
          const journal = JSON.parse(await readFile(path.join(fixture.operationRoot, "outgoing/archive-journal.json")));
          assert.equal(journal.ownerId, (await readMaintenanceOwner(fixture.target)).value.ownerId);
          assert.equal(journal.phase, "ARCHIVING");
          await assertExcluded(fixture.target);
          await writeFile(incomingPath, incomingBytes);
        }
        return archiveActiveStorageReplacement(fixture.target, fixture.operationId, options);
      });
      assert.equal(resumed.archived, true);
      assert.notEqual(resumed.journal.ownerId, ready.ownerId);
      assert.equal((await readMaintenanceOwner(fixture.target)).value.ownerId, resumed.journal.ownerId);
      assert.equal((await verifyActiveStorageReplacementArchive(fixture.target, fixture.operationId)).archived, true);
      assert.equal(await readFile(path.join(resumed.archive, fixture.orphanPath), "utf8"), "retained orphan evidence");
      assert.equal((await verifyPreparedActiveStorageReplacement(fixture.target, fixture.operationId)).outgoingVerified, true);
      await assertExcluded(fixture.target);
      await copyFile(path.join(resumed.archive, ".forgeloop/state.sqlite"), path.join(fixture.target, ".forgeloop/state.sqlite"));
      await assert.rejects(inspectActiveStorageReplacementPartition(fixture.target, fixture.operationId), { code: "E_STORAGE_RESTORE_INVALID" });
    } finally {
      if (worker && worker.exitCode === null && worker.signalCode === null) { const exited = once(worker, "exit"); worker.kill("SIGKILL"); await exited; }
      await fixture.cleanup();
    }
  });
}
