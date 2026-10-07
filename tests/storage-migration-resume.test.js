import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, fork } from "node:child_process";
import { once } from "node:events";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { buildDiagnosisProject } from "./helpers/storage-fixtures.js";
import { resumeProjectStorageMigration } from "../src/storage/migration.js";
import { readMaintenanceOwner } from "../src/storage/maintenance-owner.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";

for (const phase of ["CAPTURING", "PARTIAL_SOURCE", "CAPTURED", "PREPARING", "PARTIAL_CANDIDATE_MOVE", "PREPARED", "EMPTY_STAGE", "STAGING", "STAGED", "PARTIAL_ARCHIVING", "ARCHIVED", "DATABASE_PENDING_MARKER", "ACTIVE_PENDING_JOURNAL", "PUBLISHED"]) {
  test(`killed ${phase} owner resumes verified cutover without rewinding accepted state`, { timeout: 60000 }, async () => {
    const target = await buildDiagnosisProject({ legacy: true });
    let worker;
    try {
      worker = fork(new URL("./helpers/storage-migration-crash-worker.mjs", import.meta.url), [target, phase], { silent: true });
      let errors = "";
      worker.stderr.on("data", data => { errors += data; });
      const ready = await Promise.race([once(worker, "message"), once(worker, "exit").then(() => { throw new Error(errors); })]);
      const ownerId = ready[0].ownerId;
      const originalOwner = (await readMaintenanceOwner(target)).text;
      await assert.rejects(resumeProjectStorageMigration(target, { destination: "retained", expectedOwnerId: ownerId, writersQuiesced: true }), /still present/);
      const exited = once(worker, "exit");
      worker.kill("SIGKILL");
      await exited;
      const missingQuiescence = await executeForgeLoopCommand({ command: "storage-migration-resume", projectPath: target, input: { destination: "retained", expectedOwnerId: ownerId } });
      assert.equal(missingQuiescence.ok, false);
      const wrongOwner = await executeForgeLoopCommand({ command: "storage-migration-resume", projectPath: target, input: { destination: "retained", expectedOwnerId: "00000000-0000-0000-0000-000000000000", writersQuiesced: true } });
      assert.equal(wrongOwner.ok, false);
      assert.equal((await readMaintenanceOwner(target)).text, originalOwner);
      const before = ["PUBLISHED", "DATABASE_PENDING_MARKER", "ACTIVE_PENDING_JOURNAL"].includes(phase) ? await readFile(path.join(target, ".forgeloop/state.sqlite")) : null;
      let recovered;
      if (phase === "STAGED") {
        recovered = JSON.parse(execFileSync(process.execPath, ["src/cli.js", "storage-migration-resume", "--path", target, "--destination", "retained", "--expected-owner", ownerId, "--writers-quiesced", "--json"], { encoding: "utf8" }));
      } else {
        const response = await executeForgeLoopCommand({ command: "storage-migration-resume", projectPath: target, input: { destination: "retained", expectedOwnerId: ownerId, writersQuiesced: true } });
        assert.equal(response.ok, true, JSON.stringify(response));
        recovered = response.result;
      }
      if (["STAGING", "EMPTY_STAGE"].includes(phase)) {
        const history = path.join(target, "retained/publication-history");
        const entries = await readdir(history);
        assert.equal(entries.length, 1);
        if (phase === "STAGING") assert.deepEqual(await readFile(path.join(history, entries[0], "publication/bundle/partial.sqlite")), Buffer.from([0, 255, 128, 13, 10]));
        else assert.deepEqual(await readdir(path.join(history, entries[0], "publication")), []);
      }
      if (["PREPARING", "PARTIAL_CANDIDATE_MOVE"].includes(phase)) {
        const history = path.join(target, "retained/candidate-history");
        const entries = await readdir(history);
        assert.equal(entries.length, 1);
        assert.deepEqual(await readFile(path.join(history, entries[0], "candidate.sqlite")), Buffer.from([0, 255, 128, 13, 10]));
        assert.deepEqual(await readFile(path.join(history, entries[0], "candidate-attachments/.forgeloop/attachments/objects/.publishing-interrupted/bytes")), Buffer.from([99, 0, 255, 128, 13, 10]));
        assert.equal(JSON.parse(await readFile(path.join(history, entries[0], "candidate-manifest.json"))).status, "PREPARING");
        assert.equal(JSON.parse(await readFile(path.join(history, entries[0], "recovery.json"))).kind, "CANDIDATE_RECOVERY");
        await assert.rejects(stat(path.join(target, "retained/candidate-recovery.json")), { code: "ENOENT" });
        await assert.rejects(stat(path.join(target, "retained/candidate-attachments")), { code: "ENOENT" });
      }
      if (["CAPTURING", "PARTIAL_SOURCE"].includes(phase)) {
        const history = path.join(target, "retained/source-history");
        const entries = await readdir(history);
        assert.equal(entries.length, 1);
        assert.equal(JSON.parse(await readFile(path.join(history, entries[0], "source-manifest.json"))).status, "CAPTURING");
        if (phase === "PARTIAL_SOURCE") {
          const expectation = JSON.parse(await readFile(path.join(target, "retained/partial-source-expectation.json")));
          assert.deepEqual(await readFile(path.join(history, entries[0], "partial", expectation.path)), Buffer.from(expectation.bytes));
        }
      }
      assert.equal(recovered.phase, "PUBLISHED");
      assert.equal(recovered.currentStateVerified, true);
      assert.equal(recovered.restored, false);
      assert.equal(recovered.taskCount, phase === "PUBLISHED" ? 2 : 1);
      if (before) assert.deepEqual(await readFile(path.join(target, ".forgeloop/state.sqlite")), before);
      assert.equal(await readFile(path.join(target, `.forgeloop/storage-maintenance-history/${ownerId}.json`), "utf8"), originalOwner);
      await assert.rejects(stat(path.join(target, ".forgeloop/.storage-maintenance")), { code: "ENOENT" });
      const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "resumed-write", claims: ["other-path"] } });
      assert.equal(created.ok, true, JSON.stringify(created));
    } finally { worker?.kill("SIGKILL"); await rm(target, { recursive: true, force: true }); }
  });
}
