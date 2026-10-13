import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { assertOwnedStorageMaintenance } from "../../src/storage/maintenance.js";
import { replaceActiveProjectStorage } from "../../src/storage/project-replacement.js";

const [target, source, checkpoint] = process.argv.slice(2);
let operationId;
const hold = async () => {
  process.send({ operationId, ownerId: await assertOwnedStorageMaintenance(target), checkpoint });
  await new Promise(() => { setInterval(() => {}, 1000); });
};
const nativeRename = fs.promises.rename;
const nativeLink = fs.promises.link;
const nativeMkdir = fs.promises.mkdir;
fs.promises.mkdir = async (directory, ...options) => {
  const result = await nativeMkdir(directory, ...options);
  if (operationId && checkpoint === "OUTGOING_ALLOCATED" && directory === path.join(target, ".forgeloop/storage-restores", operationId, "outgoing")) await hold();
  return result;
};
fs.promises.rename = async (from, to) => {
  const result = await nativeRename(from, to);
  if (path.basename(to) === "replacement-intent.json") {
    const intent = JSON.parse(await fs.promises.readFile(to, "utf8"));
    operationId = intent.operationId;
    if (intent.phase === checkpoint) await hold();
  }
  if (operationId && checkpoint === "OUTGOING_BASELINE" && to === path.join(target, ".forgeloop/storage-restores", operationId, "replacement-manifest.json")) await hold();
  if (operationId && checkpoint === "PUBLICATION_READY" && to === path.join(target, ".forgeloop/storage-restores", operationId, "restore-journal.json")) {
    if (JSON.parse(await fs.promises.readFile(to, "utf8")).phase === "READY") await hold();
  }
  if (operationId && ["OUTGOING_READY", "OUTGOING_PREPARING"].includes(checkpoint) && to === path.join(target, ".forgeloop/storage-restores", operationId, "outgoing/replacement-manifest.json")) {
    if (JSON.parse(await fs.promises.readFile(to, "utf8")).status === checkpoint.slice("OUTGOING_".length)) await hold();
  }
  return result;
};
fs.promises.link = async (from, to) => {
  const result = await nativeLink(from, to);
  if (operationId && checkpoint === "PARTIAL_SNAPSHOT" && to === path.join(target, ".forgeloop/storage-restores", operationId, "snapshot/state.sqlite")) await hold();
  if (operationId && checkpoint === "PARTIAL_OUTGOING" && to === path.join(target, ".forgeloop/storage-restores", operationId, "outgoing/backup/state.sqlite")) await hold();
  return result;
};
syncBuiltinESMExports();
try {
  await replaceActiveProjectStorage(source, target, { writersQuiesced: true });
  throw new Error("Requested preparation checkpoint was not reached");
} catch (error) { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; }
