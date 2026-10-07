import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { buildDiagnosisProject, TEST_TASK_ID } from "./helpers/storage-fixtures.js";
import { importProjectState } from "../src/storage/importer.js";
import { backupProjectStorage } from "../src/storage/project-backup.js";
import { registerAttachment } from "../src/storage/attachment-references.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { buildActiveReplacementFixture } from "./helpers/active-replacement-fixtures.js";

test("replacement admission rejects missing quiescence and nonboolean selection without allocating evidence", async () => {
  const fixture = await buildActiveReplacementFixture();
  try {
    const directory = path.join(fixture.target, ".forgeloop/storage-restores");
    const before = await readdir(directory);
    const source = path.join(fixture.operationRoot, "snapshot");
    for (const input of [{ source, replaceActive: true }, { source, replaceActive: "true", writersQuiesced: true }, { source, replaceActive: 1, writersQuiesced: true }]) {
      const response = await executeForgeLoopCommand({ command: "storage-restore", projectPath: fixture.target, input });
      assert.equal(response.ok, false);
      assert.match(JSON.stringify(response), /E_CLI_INVOCATION_INVALID/);
      assert.deepEqual(await readdir(directory), before);
      await assert.rejects(stat(path.join(fixture.target, ".forgeloop/.storage-maintenance")), { code: "ENOENT" });
    }
    assert.equal((await executeForgeLoopCommand({ command: "task-list", projectPath: fixture.target, input: {} })).ok, true);
  } finally { await fixture.cleanup(); }
});

for (const mode of ["api", "cli"]) {
  test(`explicit ${mode} replacement retains outgoing state and activates incoming authority`, async () => {
    const fixture = await buildActiveReplacementFixture();
    try {
      const source = path.join(fixture.operationRoot, "snapshot");
      const refused = await executeForgeLoopCommand({ command: "storage-restore", projectPath: fixture.target, input: { source, writersQuiesced: true } });
      assert.equal(refused.ok, false);
      assert.match(JSON.stringify(refused), /E_STORAGE_RESTORE_INVALID/);
      let result;
      if (mode === "api") {
        const response = await executeForgeLoopCommand({ command: "storage-restore", projectPath: fixture.target, input: { source, writersQuiesced: true, replaceActive: true } });
        assert.equal(response.ok, true, JSON.stringify(response));
        result = response.result;
      } else result = JSON.parse(execFileSync(process.execPath, ["src/cli.js", "storage-restore", "--path", fixture.target, "--source", source, "--replace-active", "--writers-quiesced", "--json"], { encoding: "utf8" }));
      assert.equal(result.replaced, true);
      assert.equal(result.active, true);
      assert.equal(await readFile(path.join(fixture.target, ".forgeloop/storage-restores", result.operationId, "outgoing/archive", fixture.orphanPath), "utf8"), "retained orphan evidence");
      const listed = await executeForgeLoopCommand({ command: "task-list", projectPath: fixture.target, input: {} });
      assert.equal(listed.ok, true, JSON.stringify(listed));
      assert.match(JSON.stringify(listed), /replacement-incoming-task/);
      assert.doesNotMatch(JSON.stringify(listed), /replacement-outgoing-task/);
    } finally { await fixture.cleanup(); }
  });
}

test("restore CLI and shared command API activate verified backups and reject missing writer exclusion", async () => {
  const original = await buildDiagnosisProject({ legacy: true });
  const cliTarget = await mkdtemp(path.join(os.tmpdir(), "forgeloop-cli-restore-"));
  const apiTarget = await mkdtemp(path.join(os.tmpdir(), "forgeloop-api-restore-"));
  const { db } = await importProjectState(original, path.join(original, "source.sqlite"));
  try {
    const bytes = Buffer.from([0, 255, 13, 10]);
    const reference = await registerAttachment(db, original, { taskId: TEST_TASK_ID, referenceId: "cli-evidence", readable: Readable.from([bytes]) });
    const source = path.join(original, "backup");
    await backupProjectStorage(db, original, source);
    const refused = await executeForgeLoopCommand({ command: "storage-restore", projectPath: apiTarget, input: { source } });
    assert.equal(refused.ok, false);
    await assert.rejects(stat(path.join(apiTarget, ".forgeloop")), { code: "ENOENT" });
    const api = await executeForgeLoopCommand({ command: "storage-restore", projectPath: apiTarget, input: { source, writersQuiesced: true } });
    assert.equal(api.ok, true, JSON.stringify(api));
    assert.equal(api.result.active, true);
    const cli = JSON.parse(execFileSync(process.execPath, ["src/cli.js", "storage-restore", "--path", cliTarget, "--source", source, "--writers-quiesced", "--json"], { encoding: "utf8" }));
    assert.equal(cli.active, true);
    for (const target of [cliTarget, apiTarget]) {
      assert.deepEqual(await readFile(path.join(target, reference.path)), bytes);
      assert.equal(JSON.parse(await readFile(path.join(target, ".forgeloop/storage-version.json"))).phase, "ACTIVE");
      const listed = await executeForgeLoopCommand({ command: "task-list", projectPath: target, input: {} });
      assert.equal(listed.ok, true, JSON.stringify(listed));
      assert.match(JSON.stringify(listed.result), new RegExp(TEST_TASK_ID));
    }
    const repeated = await executeForgeLoopCommand({ command: "storage-restore", projectPath: apiTarget, input: { source, writersQuiesced: true } });
    assert.equal(repeated.ok, false);
    assert.match(JSON.stringify(repeated), /E_STORAGE_RESTORE_INVALID/);
  } finally {
    db.close();
    for (const target of [original, cliTarget, apiTarget]) await removeTempTree(target);
  }
});
