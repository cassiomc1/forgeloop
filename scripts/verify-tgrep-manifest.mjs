import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateTgrepManifest } from "../src/repository-index/manifest.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(packageRoot, "src", "repository-index", "tgrep-manifest.json");

try {
  const value = JSON.parse(await readFile(manifestPath, "utf8"));
  validateTgrepManifest(value);
  console.log(`valid tgrep manifest: ${value.engine} ${value.version} (${Object.keys(value.assets).length} assets)`);
} catch (error) {
  console.error(`invalid tgrep manifest: ${error.message}`);
  process.exitCode = 1;
}
