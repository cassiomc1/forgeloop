import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { withStorageMaintenance, assertOwnedStorageMaintenance } from "../../src/storage/maintenance.js";
import { prepareActiveStorageReplacement } from "../../src/storage/restore-replacement.js";
import { archiveActiveStorageReplacement } from "../../src/storage/restore-replacement-archive.js";
import { publishArchivedStorageReplacement } from "../../src/storage/project-restore.js";

const [target, operationId, checkpoint] = process.argv.slice(2);
const hold = async () => {
  process.send({ operationId, ownerId: await assertOwnedStorageMaintenance(target), checkpoint });
  await new Promise(() => { setInterval(() => {}, 1000); });
};
const nativeRename = fs.promises.rename;
const nativeLink = fs.promises.link;
const nativeOpen = fs.promises.open;
fs.promises.open = async (filename, ...options) => {
  const handle = await nativeOpen(filename, ...options);
  if (checkpoint === "PENDING_MARKER" && filename === path.join(target, ".forgeloop/storage-version.json") && options[0] === "wx") {
    const sync = handle.sync.bind(handle);
    handle.sync = async () => { await sync(); await hold(); };
  }
  return handle;
};
fs.promises.rename = async (source, destination) => {
  const result = await nativeRename(source, destination);
  if (destination === path.join(target, ".forgeloop/storage-restores", operationId, "restore-journal.json")) {
    const journal = JSON.parse(await fs.promises.readFile(destination, "utf8"));
    if (journal.phase === checkpoint) await hold();
  }
  if (checkpoint === "ACTIVE_MARKER" && destination === path.join(target, ".forgeloop/storage-version.json")) await hold();
  return result;
};
fs.promises.link = async (source, destination) => {
  const result = await nativeLink(source, destination);
  if (checkpoint === "DATABASE" && destination === path.join(target, ".forgeloop/state.sqlite")) await hold();
  if (checkpoint === "ATTACHMENT" && destination.startsWith(path.join(target, ".forgeloop/attachments/objects/"))) await hold();
  return result;
};
syncBuiltinESMExports();
try {
  await withStorageMaintenance(target, async () => {
    await prepareActiveStorageReplacement(target, operationId, { writersQuiesced: true });
    await archiveActiveStorageReplacement(target, operationId);
    await publishArchivedStorageReplacement(target, operationId);
    throw new Error("Requested publication checkpoint was not reached");
  }, { retainOnError: true });
} catch (error) { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; }
