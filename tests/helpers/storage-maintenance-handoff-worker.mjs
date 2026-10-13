import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { withStorageMaintenance, resumeStorageMaintenance, retainStorageMaintenance } from "../../src/storage/maintenance.js";
const [target, mode, expectedOwnerId] = process.argv.slice(2);
const wait = () => new Promise(() => setInterval(() => {}, 1000));
const ready = async () => { process.stdout.write("READY\n"); await wait(); };
const originalLink = fs.promises.link;
const originalRename = fs.promises.rename;
let pausedContender = false;
fs.promises.link = async (...args) => {
  if (mode === "LATE_CONTENDER" && !pausedContender && args[1].replaceAll("\\", "/").includes("/storage-maintenance-history/handoffs/")) {
    pausedContender = true;
    process.stdout.write("READY\n");
    await new Promise(resolve => process.stdin.once("data", resolve));
  }
  const result = await originalLink(...args);
  if (mode === "CLAIM" && args[1].replaceAll("\\", "/").includes("/storage-maintenance-history/handoffs/")) await ready();
  return result;
};
fs.promises.rename = async (...args) => {
  if (args[1].replaceAll("\\", "/").endsWith("/.storage-maintenance/owner.json")) {
    if (mode === "BEFORE_OWNER") await ready();
    const result = await originalRename(...args);
    if (mode === "AFTER_OWNER") await ready();
    return result;
  }
  return originalRename(...args);
};
syncBuiltinESMExports();
try {
  if (mode === "OWNER") await withStorageMaintenance(target, ready);
  else {
    await resumeStorageMaintenance(target, { expectedOwnerId, writersQuiesced: true }, async () => {
      if (["ONCE", "LATE_CONTENDER"].includes(mode)) await retainStorageMaintenance(target);
      else await ready();
    });
    process.stdout.write(JSON.stringify({ ok: true }) + "\n");
  }
} catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: error.code, message: error.message }) + "\n"); }
