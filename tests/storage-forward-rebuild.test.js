import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { executeForgeLoopCommand } from "../src/integration.js";
import { openStorageDatabase } from "../src/storage/connection.js";
import { logicalSnapshot } from "../src/storage/migration-candidate.js";
import { registerAttachment } from "../src/storage/attachment-references.js";
import { buildDiagnosisProject } from "./helpers/storage-fixtures.js";

function snapshot(filename) {
  const db = openStorageDatabase(filename, { readOnly: true });
  try { return logicalSnapshot(db); }
  finally { db.close(); }
}

async function command(target, name, input) {
  const response = await executeForgeLoopCommand({ command: name, projectPath: target, input });
  assert.equal(response.ok, true, JSON.stringify(response.error));
  return response.result;
}

test("native rebuild from a verified latest snapshot retains post-native-write tasks, events and attachments", async () => {
  const target = await buildDiagnosisProject();
  const database = path.join(target, ".forgeloop/state.sqlite");
  try {
    await mkdir(path.join(target, "retained"));
    await command(target, "storage-backup", { destination: "retained/before-new-work", includeAttachments: true });
    const taskId = "accepted-after-native-cutover";
    await command(target, "task-create", { taskId, claims: [] });
    const bytes = Buffer.from([0, 255, 128, 13, 10]);
    const db = openStorageDatabase(database);
    let reference;
    try { reference = await registerAttachment(db, target, { taskId, referenceId: "post-native-binary", readable: Readable.from([bytes]) }); }
    finally { db.close(); }

    const accepted = snapshot(database);
    // An operator must reject a stale snapshot for lossless recovery. Explicit
    // replace-active is a general restore operation, not a freshness guarantee.
    assert.notDeepEqual(snapshot(path.join(target, "retained/before-new-work/state.sqlite")), accepted);
    await command(target, "storage-backup", { destination: "retained/latest-native", includeAttachments: true });
    assert.deepEqual(snapshot(path.join(target, "retained/latest-native/state.sqlite")), accepted);
    const nativeBytes = await readFile(database);
    const nativeDigest = createHash("sha256").update(nativeBytes).digest("hex");
    // No writer runs between snapshot selection and this explicitly quiesced
    // replacement. The original authority is retained, not discarded.
    const restored = await command(target, "storage-restore", {
      source: "retained/latest-native", writersQuiesced: true, replaceActive: true,
    });
    assert.equal(restored.replaced, true);
    assert.equal(restored.active, true);
    assert.deepEqual(snapshot(database), accepted);
    assert.deepEqual(await readFile(path.join(target, reference.path)), bytes);
    const archived = path.join(target, ".forgeloop/storage-restores", restored.operationId, "outgoing/archive/.forgeloop/state.sqlite");
    assert.equal(createHash("sha256").update(await readFile(archived)).digest("hex"), nativeDigest);
    const listed = await command(target, "task-list", {});
    assert.match(JSON.stringify(listed), new RegExp(taskId));
  } finally { await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});
