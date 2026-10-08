import { resumeProjectReplacementPreparation } from "../../src/storage/project-replacement.js";
import { resumeProjectStorageRestore } from "../../src/storage/project-restore.js";
import { resumeStorageMaintenance } from "../../src/storage/maintenance.js";
import { archiveActiveStorageReplacement } from "../../src/storage/restore-replacement-archive.js";
import { readMaintenanceOwner } from "../../src/storage/maintenance-owner.js";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const [target, operationId, expectedOwnerId, checkpoint] = process.argv.slice(2);
const initialOwner = (await readMaintenanceOwner(target)).value;
const hold = async () => {
  process.send({ checkpoint, ownerId: (await readMaintenanceOwner(target)).value.ownerId });
  await new Promise(() => { setInterval(() => {}, 1000); });
};
const nativeRename = fs.promises.rename;
const nativeLink = fs.promises.link;
const nativeMkdir = fs.promises.mkdir;
fs.promises.mkdir = async (directory, ...options) => {
  const result = await nativeMkdir(directory, ...options);
  if (checkpoint === "REBUILD_ALLOCATED" && directory === path.join(target, ".forgeloop/storage-restores", operationId, "outgoing")) await hold();
  return result;
};
fs.promises.link = async (from, to) => {
  const result = await nativeLink(from, to);
  if (checkpoint === "REBUILD_DATABASE" && to === path.join(target, ".forgeloop/storage-restores", operationId, "outgoing/backup/state.sqlite")) await hold();
  return result;
};
fs.promises.rename = async (from, to) => {
  const result = await nativeRename(from, to);
  if (["OWNER", "PUBLICATION_OWNER", "ARCHIVE_OWNER"].includes(checkpoint) && to === path.join(target, ".forgeloop/.storage-maintenance/owner.json")) await hold();
  const name = checkpoint === "INTENT" ? "replacement-intent.json" : checkpoint === "OUTGOING_OWNER" ? "outgoing/owner-journal.json" : checkpoint === "PUBLICATION_INTENT" ? "restore-journal.json" : null;
  if (name && to === path.join(target, ".forgeloop/storage-restores", operationId, name)) await hold();
  if (checkpoint === "REBUILD_BASELINE" && to === path.join(target, ".forgeloop/storage-restores", operationId, "replacement-manifest.json")) await hold();
  if (["OUTGOING_RETAINING", "OUTGOING_RETAINED"].includes(checkpoint) && to === path.join(target, ".forgeloop/storage-restores", operationId, "replacement-intent.json")) {
    if (JSON.parse(await fs.promises.readFile(to, "utf8")).outgoingRebuild?.phase === checkpoint.slice("OUTGOING_".length)) await hold();
  }
  if (checkpoint === "OUTGOING_RENAMED" && from === path.join(target, ".forgeloop/storage-restores", operationId, "outgoing")
    && path.dirname(to) === path.join(target, ".forgeloop/storage-restores", operationId, "outgoing-history")) await hold();
  return result;
};
syncBuiltinESMExports();
try {
  const options = { operationId, expectedOwnerId, writersQuiesced: true };
  if (checkpoint === "ARCHIVE_OWNER") await resumeStorageMaintenance(target, options, () => archiveActiveStorageReplacement(target, operationId, options));
  else {
    const resume = checkpoint?.startsWith("PUBLICATION_") ? resumeProjectStorageRestore : resumeProjectReplacementPreparation;
    await resume(target, options);
  }
  throw new Error("Expected corrupt source rejection");
} catch (error) {
  const diagnostics = { recordedOwnerPid: initialOwner.pid, recordedOwnerId: initialOwner.ownerId, workerPid: process.pid, checkpoint };
  if (process.platform === "win32") {
    try {
      diagnostics.ownerProcess = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Get-Process -Id ${initialOwner.pid} -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,StartTime,HasExited | ConvertTo-Json -Compress`], { encoding: "utf8", timeout: 10000 }).trim() || "absent";
    } catch (observationError) { diagnostics.observationError = observationError.code ?? observationError.status; }
  }
  process.send({ code: error.code, message: error.message, ownerId: (await readMaintenanceOwner(target)).value.ownerId, diagnostics });
}
