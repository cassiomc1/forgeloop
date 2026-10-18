#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(new URL("../skills/forgeloop/references/revenue-centric-design/", import.meta.url));
const files = ["LICENSE", "SKILL.md", "references/playbook.md"];
async function regular(filename, directory = false) {
  const metadata = await lstat(filename);
  if (metadata.isSymbolicLink() || !(directory ? metadata.isDirectory() : metadata.isFile())) throw new Error("Design companion must contain regular files and directories only");
}
export async function verifyRevenueDesignSkill({ rootDir = defaultRoot } = {}) {
  await regular(rootDir, true);
  await regular(path.join(rootDir, "references"), true);
  await regular(path.join(rootDir, "PIN.json"));
  const pin = JSON.parse(await readFile(path.join(rootDir, "PIN.json"), "utf8"));
  if (pin.schemaVersion !== 1 || pin.repository !== "https://github.com/heliocosta-dev/revenue-centric-design"
    || pin.commit !== "1942760c2242f609bf63ce2c97204f5a1791bd68"
    || JSON.stringify(Object.keys(pin.files ?? {}).sort()) !== JSON.stringify(files)) throw new Error("Invalid design companion pin");
  const rootNames = (await readdir(rootDir)).sort();
  if (JSON.stringify(rootNames) !== JSON.stringify(["LICENSE", "PIN.json", "SKILL.md", "references"])
    || JSON.stringify(await readdir(path.join(rootDir, "references"))) !== JSON.stringify(["playbook.md"])) throw new Error("Unexpected design companion files");
  for (const name of files) {
    const filename = path.join(rootDir, name);
    await regular(filename);
    const bytes = (await readFile(filename, "utf8")).replaceAll("\r\n", "\n");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== pin.files[name]) throw new Error(`Design companion hash mismatch: ${name}`);
  }
  if (pin.files.LICENSE !== pin.upstreamLicenseSha256) throw new Error("Upstream design license differs");
  return { valid: true, commit: pin.commit, filesChecked: files.length, digestFormat: pin.digestFormat };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await verifyRevenueDesignSkill())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
