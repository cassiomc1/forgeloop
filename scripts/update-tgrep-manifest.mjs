import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateTgrepManifest } from "../src/repository-index/manifest.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(packageRoot, "src", "repository-index", "tgrep-manifest.json");
const args = process.argv.slice(2);
const assetDirIndex = args.indexOf("--asset-dir");
const assetDir = assetDirIndex >= 0 ? args[assetDirIndex + 1] : null;
const shouldWrite = args.includes("--write");

if (!assetDir || !path.isAbsolute(assetDir) || !shouldWrite) {
  console.error("Usage: node scripts/update-tgrep-manifest.mjs --asset-dir /absolute/release-assets --write");
  process.exit(1);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
validateTgrepManifest(manifest);
for (const asset of Object.values(manifest.assets)) {
  const assetPath = path.join(assetDir, asset.assetName);
  const info = await stat(assetPath);
  if (!info.isFile()) throw new Error(`asset is not a regular file: ${assetPath}`);
  const digest = createHash("sha256").update(await readFile(assetPath)).digest("hex");
  asset.sha256 = digest;
}
validateTgrepManifest(manifest);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`updated ${manifestPath}`);
