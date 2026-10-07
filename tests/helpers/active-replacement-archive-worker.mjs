import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { withStorageMaintenance, assertOwnedStorageMaintenance } from "../../src/storage/maintenance.js";
import { prepareActiveStorageReplacement } from "../../src/storage/restore-replacement.js";
import { archiveActiveStorageReplacement } from "../../src/storage/restore-replacement-archive.js";

const [target, operationId, checkpoint] = process.argv.slice(2);
const checkpoints = { MARKER: ".forgeloop/storage-version.json", ATTACHMENTS: ".forgeloop/attachments", DATABASE: ".forgeloop/state.sqlite" };
const nativeRename = fs.promises.rename;
const hold = async () => {
  process.send({ operationId, ownerId: await assertOwnedStorageMaintenance(target), checkpoint });
  await new Promise(() => { setInterval(() => {}, 1000); });
};
fs.promises.rename = async (source, destination) => {
  const result = await nativeRename(source, destination);
  const expected = checkpoints[checkpoint];
  if (expected && destination === path.join(target, ".forgeloop/storage-restores", operationId, "outgoing/archive", expected)) await hold();
  return result;
};
syncBuiltinESMExports();
try {
  await withStorageMaintenance(target, async () => {
    await prepareActiveStorageReplacement(target, operationId, { writersQuiesced: true });
    await archiveActiveStorageReplacement(target, operationId);
    if (checkpoint === "ARCHIVED") await hold();
    else throw new Error("Requested native archival checkpoint was not reached");
  }, { retainOnError: true });
} catch (error) { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; }
