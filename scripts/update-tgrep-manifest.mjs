import { execFile as nodeExecFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateTgrepManifest } from "../src/repository-index/manifest.js";
import { sha256File, validateArchiveEntry } from "../src/repository-index/binary-manager.js";

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

function execFile(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    nodeExecFile(file, args, { shell: false, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function listArchiveEntries(archivePath, archive) {
  const command = archive === "zip" && process.platform !== "win32" ? "unzip" : "tar";
  const args = command === "unzip" ? ["-Z1", archivePath] : ["-tf", archivePath];
  const result = await execFile(command, args, { maxBuffer: 2 * 1024 * 1024 });
  return result.stdout.split(/\r?\n/).filter(Boolean).map(validateArchiveEntry);
}

async function extractBinary(assetPath, asset, destination) {
  const entries = await listArchiveEntries(assetPath, asset.archive);
  if (!entries.some((entry) => path.posix.basename(entry) === asset.binaryName)) {
    throw new Error(`archive does not contain ${asset.binaryName}`);
  }
  const command = asset.archive === "zip" && process.platform !== "win32" ? "unzip" : "tar";
  const args = command === "unzip"
    ? ["-q", assetPath, "-d", destination]
    : ["-xf", assetPath, "-C", destination];
  await execFile(command, args, { maxBuffer: 2 * 1024 * 1024 });

  const found = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`archive extracted a symbolic link: ${entry.name}`);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile() && entry.name === asset.binaryName) found.push(entryPath);
    }
  }
  await visit(destination);
  if (found.length !== 1) throw new Error(`expected exactly one ${asset.binaryName}, found ${found.length}`);
  return found[0];
}

for (const asset of Object.values(manifest.assets)) {
  const assetPath = path.join(assetDir, asset.assetName);
  const info = await stat(assetPath);
  if (!info.isFile()) throw new Error(`asset is not a regular file: ${assetPath}`);
  asset.sha256 = await sha256File(assetPath);
  const extractionDirectory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-tgrep-manifest-"));
  try {
    const extractedBinary = await extractBinary(assetPath, asset, extractionDirectory);
    asset.binarySha256 = await sha256File(extractedBinary);
  } finally {
    await rm(extractionDirectory, { recursive: true, force: true });
  }
}
validateTgrepManifest(manifest);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`updated ${manifestPath}`);
