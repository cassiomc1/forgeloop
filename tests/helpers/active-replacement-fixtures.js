import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { executeForgeLoopCommand } from "../../src/core/command-runtime.js";
import { openStorageDatabase } from "../../src/storage/connection.js";
import { registerAttachment } from "../../src/storage/attachment-references.js";
import { backupProjectStorage } from "../../src/storage/project-backup.js";

export async function buildActiveReplacementFixture() {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-archive-outgoing-"));
  const source = await mkdtemp(path.join(os.tmpdir(), "forgeloop-archive-incoming-"));
  const operationId = randomUUID();
  const operationRoot = path.join(target, ".forgeloop/storage-restores", operationId);
  const references = {};
  const cleanup = async () => { await rm(target, { recursive: true, force: true }); await rm(source, { recursive: true, force: true }); };
  try {
    for (const [kind, projectPath] of [["outgoing", target], ["incoming", source]]) {
      const taskId = `replacement-${kind}-task`;
      const created = await executeForgeLoopCommand({ command: "task-create", projectPath, input: { taskId, claims: [] } });
      assert.equal(created.ok, true, JSON.stringify(created));
      const db = openStorageDatabase(path.join(projectPath, ".forgeloop/state.sqlite"));
      try {
        references[kind] = await registerAttachment(db, projectPath, { taskId, referenceId: `${kind}-bytes`, readable: Readable.from([`${kind} independent bytes`]) });
        if (kind === "incoming") {
          await mkdir(operationRoot, { recursive: true });
          await backupProjectStorage(db, projectPath, path.join(operationRoot, "snapshot"));
        }
      } finally { db.close(); }
    }
    const orphanPath = ".forgeloop/attachments/objects/" + "e".repeat(64);
    await writeFile(path.join(target, orphanPath), "retained orphan evidence");
    return { target, source, operationId, operationRoot, references, orphanPath, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
