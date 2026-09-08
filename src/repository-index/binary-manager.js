import { createHash, randomUUID } from "node:crypto";
import { execFile as nodeExecFile } from "node:child_process";
import {
  access,
  chmod,
  constants as fsConstants,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  lstat,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { REPOSITORY_INDEX_DEFAULTS, REPOSITORY_INDEX_ENV_BINARY } from "./constants.js";
import { REPOSITORY_INDEX_ERROR_CODES, repositoryIndexError } from "./errors.js";
import { getRepositoryIndexPlatform } from "./platform.js";
import { getManagedTgrepBinaryPath, getManagedTgrepDirectory, getEngineHome } from "./paths.js";
import { getTgrepAsset, loadTgrepManifest } from "./manifest.js";
import { runTgrep } from "./process.js";
import { acquireRepositoryIndexLock } from "./lock.js";

const VERSION_PATTERN = /\btgrep\s+(?:v)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/i;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

function assertTrustedDownloadUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch (cause) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_DOWNLOAD_FAILED, "Pinned tgrep asset URL is invalid", { cause, url: value });
  }
  if (parsed.protocol !== "https:" || !ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname)) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_DOWNLOAD_FAILED, `Pinned tgrep asset URL is not trusted: ${parsed.hostname}`, { url: value });
  }
  return parsed;
}

function absolutePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_MISSING, `${label} must be an absolute path`);
  }
  return path.normalize(value);
}

async function ensureRegularFile(filePath, code, label) {
  let info;
  try {
    info = await lstat(filePath);
  } catch (cause) {
    if (cause.code === "ENOENT") throw repositoryIndexError(code, `${label} is missing: ${filePath}`, { cause, path: filePath });
    throw repositoryIndexError(code, `${label} cannot be inspected: ${filePath}: ${cause.message}`, { cause, path: filePath });
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw repositoryIndexError(code, `${label} must be a regular file: ${filePath}`, { path: filePath });
  }
  return info;
}

async function verifyExecutable(filePath, { platform = process.platform } = {}) {
  await ensureRegularFile(filePath, REPOSITORY_INDEX_ERROR_CODES.ENGINE_MISSING, "Managed tgrep binary");
  if (platform !== "win32") {
    try {
      await access(filePath, fsConstants.X_OK);
    } catch (cause) {
      throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_MISSING, `Managed tgrep binary is not executable: ${filePath}`, { cause, path: filePath });
    }
  }
}

function parseVersion(output) {
  return output.match(VERSION_PATTERN)?.[1] ?? null;
}

export async function verifyTgrepVersion({ binaryPath, expectedVersion, repoRoot = process.cwd(), spawnImpl, timeoutMs = 15_000 } = {}) {
  const result = await runTgrep({
    binaryPath,
    repoRoot,
    args: ["--version"],
    spawnImpl,
    timeoutMs,
    maxOutputBytes: 64 * 1024,
  });
  if (result.timedOut || result.exitCode !== 0) {
    throw repositoryIndexError(
      REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXECUTION_FAILED,
      `Unable to verify tgrep version at ${binaryPath}`,
      { result: { exitCode: result.exitCode, stderr: result.stderr.slice(0, 2000), timedOut: result.timedOut } },
    );
  }
  const actualVersion = parseVersion(`${result.stdout}\n${result.stderr}`);
  if (actualVersion !== expectedVersion) {
    throw repositoryIndexError(
      REPOSITORY_INDEX_ERROR_CODES.ENGINE_VERSION_MISMATCH,
      `Managed tgrep version is ${actualVersion ?? "unknown"}; expected ${expectedVersion}`,
      { actualVersion, expectedVersion, binaryPath },
    );
  }
  return actualVersion;
}

export async function verifyManagedTgrep({ packageRoot, repoRoot = process.cwd(), platform, arch, env = process.env, binaryPath: explicitBinaryPath, homeDirectory = os.homedir(), spawnImpl } = {}) {
  const manifest = await loadTgrepManifest(packageRoot);
  const selectedPlatform = platform && arch
    ? getRepositoryIndexPlatform({ platform, arch })
    : getRepositoryIndexPlatform();
  const override = explicitBinaryPath ?? env?.[REPOSITORY_INDEX_ENV_BINARY];
  if (override) {
    const overridePath = absolutePath(override, REPOSITORY_INDEX_ENV_BINARY);
    await ensureRegularFile(overridePath, REPOSITORY_INDEX_ERROR_CODES.ENGINE_MISSING, "Explicit tgrep override");
    if (selectedPlatform.platform !== "win32") {
      try { await access(overridePath, fsConstants.X_OK); } catch (cause) {
        throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_MISSING, `Explicit tgrep override is not executable: ${overridePath}`, { cause, path: overridePath });
      }
    }
    const version = await verifyTgrepVersion({ binaryPath: overridePath, expectedVersion: manifest.version, repoRoot, spawnImpl });
    return Object.freeze({
      engine: manifest.engine,
      engineVersion: version,
      platform: selectedPlatform,
      binaryPath: overridePath,
      managed: false,
      overridden: true,
      canonical: false,
      asset: null,
    });
  }

  const binaryPath = getManagedTgrepBinaryPath(manifest.version, selectedPlatform.key, {
    homeDirectory,
    windows: selectedPlatform.platform === "win32",
  });
  await verifyExecutable(binaryPath, { platform: selectedPlatform.platform });
  const version = await verifyTgrepVersion({ binaryPath, expectedVersion: manifest.version, repoRoot, spawnImpl });
  return Object.freeze({
    engine: manifest.engine,
    engineVersion: version,
    platform: selectedPlatform,
    binaryPath,
    managed: true,
    overridden: false,
    canonical: true,
    asset: manifest.assets[selectedPlatform.key],
  });
}

function execFileAsync(execFileImpl, file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFileImpl(file, args, { shell: false, ...options }, (error, stdout, stderr) => {
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

export function validateArchiveEntry(entry) {
  const portable = entry.replaceAll("\\", "/").replace(/^\.\//, "") || ".";
  if (portable.includes("\0") || path.posix.isAbsolute(portable) || path.win32.isAbsolute(portable)) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXTRACTION_FAILED, `Archive contains an absolute path: ${entry}`);
  }
  const normalized = path.posix.normalize(portable);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXTRACTION_FAILED, `Archive path escapes extraction directory: ${entry}`);
  }
  return normalized;
}

async function listArchiveEntries(archivePath, { archive = "tar.gz", execFileImpl = nodeExecFile } = {}) {
  const listCommand = archive === "zip" && process.platform !== "win32" ? "unzip" : "tar";
  const listArgs = listCommand === "unzip" ? ["-Z1", archivePath] : ["-tf", archivePath];
  try {
    const listed = await execFileAsync(execFileImpl, listCommand, listArgs, { maxBuffer: 2 * 1024 * 1024 });
    return listed.stdout.split(/\r?\n/).filter(Boolean).map(validateArchiveEntry);
  } catch (cause) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXTRACTION_FAILED, `Unable to inspect tgrep archive: ${cause.message}`, { cause });
  }
}

async function extractArchive(archivePath, extractionDirectory, { archive = "tar.gz", execFileImpl = nodeExecFile } = {}) {
  await listArchiveEntries(archivePath, { archive, execFileImpl });
  const extractCommand = archive === "zip" && process.platform !== "win32" ? "unzip" : "tar";
  const extractArgs = extractCommand === "unzip"
    ? ["-q", archivePath, "-d", extractionDirectory]
    : ["-xf", archivePath, "-C", extractionDirectory];
  try {
    await execFileAsync(execFileImpl, extractCommand, extractArgs, { maxBuffer: 2 * 1024 * 1024 });
  } catch (cause) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXTRACTION_FAILED, `Unable to extract tgrep archive: ${cause.message}`, { cause });
  }
}

async function findBinary(root, binaryName) {
  const found = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXTRACTION_FAILED, `Archive contains a symbolic link: ${entry.name}`);
      }
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && entry.name === binaryName) {
        found.push(entryPath);
      }
    }
  }
  await visit(root);
  if (found.length !== 1) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXTRACTION_FAILED, `Expected exactly one ${binaryName} in tgrep archive; found ${found.length}`);
  }
  return found[0];
}

export async function verifyArchiveChecksum(archivePath, expectedSha256) {
  const actual = createHash("sha256").update(await readFile(archivePath)).digest("hex");
  if (actual !== expectedSha256) {
    throw repositoryIndexError(
      REPOSITORY_INDEX_ERROR_CODES.ENGINE_CHECKSUM_MISMATCH,
      `tgrep archive checksum mismatch: expected ${expectedSha256}, got ${actual}`,
      { expectedSha256, actualSha256: actual, archivePath },
    );
  }
  return actual;
}

async function downloadResponse(url, { fetchImpl = fetch, maxBytes = REPOSITORY_INDEX_DEFAULTS.maxAssetBytes } = {}) {
  assertTrustedDownloadUrl(url);
  let response;
  try {
    response = await fetchImpl(url, { redirect: "follow" });
  } catch (cause) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_DOWNLOAD_FAILED, `Unable to download pinned tgrep asset: ${cause.message}`, { cause, url });
  }
  if (!response?.ok) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_DOWNLOAD_FAILED, `Pinned tgrep asset download returned HTTP ${response?.status ?? "unknown"}`, { url, status: response?.status ?? null });
  }
  if (response.url) {
    assertTrustedDownloadUrl(response.url);
  }
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (cause) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_DOWNLOAD_FAILED, `Unable to read pinned tgrep asset: ${cause.message}`, { cause, url });
  }
  if (bytes.byteLength > maxBytes) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_DOWNLOAD_FAILED, `Pinned tgrep asset exceeds ${maxBytes} bytes`, { url, maxBytes });
  }
  return bytes;
}

export async function downloadTgrepAsset({ asset, destinationDirectory, assetPath, fetchImpl, maxBytes = REPOSITORY_INDEX_DEFAULTS.maxAssetBytes } = {}) {
  if (!asset || typeof asset.assetName !== "string") {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_DOWNLOAD_FAILED, "A pinned tgrep asset descriptor is required");
  }
  await mkdir(destinationDirectory, { recursive: true });
  const destination = path.join(destinationDirectory, asset.assetName);
  let bytes;
  if (assetPath) {
    const source = absolutePath(assetPath, "--asset");
    try {
      await ensureRegularFile(source, REPOSITORY_INDEX_ERROR_CODES.ENGINE_DOWNLOAD_FAILED, "Preloaded tgrep asset");
      const info = await stat(source);
      if (info.size > maxBytes) throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_DOWNLOAD_FAILED, `Preloaded tgrep asset exceeds ${maxBytes} bytes`, { source, maxBytes });
      bytes = await readFile(source);
    } catch (cause) {
      if (cause.code?.startsWith?.("E_REPOSITORY_INDEX")) throw cause;
      throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_DOWNLOAD_FAILED, `Unable to read preloaded tgrep asset: ${cause.message}`, { cause, source });
    }
  } else {
    bytes = await downloadResponse(asset.url, { fetchImpl, maxBytes });
  }
  await writeFile(destination, bytes, { flag: "w" });
  await verifyArchiveChecksum(destination, asset.sha256);
  return destination;
}

function binaryDescriptor({ manifest, selectedPlatform, binaryPath, managed, overridden, asset }) {
  return Object.freeze({
    engine: manifest.engine,
    engineVersion: manifest.version,
    platform: selectedPlatform,
    binaryPath,
    managed,
    overridden,
    canonical: managed && !overridden,
    asset: asset ?? null,
  });
}

export async function ensureManagedTgrep({ packageRoot, repoRoot = process.cwd(), platform, arch, env = process.env, binaryPath: explicitBinaryPath, assetPath, homeDirectory = os.homedir(), fetchImpl, spawnImpl, execFileImpl } = {}) {
  const manifest = await loadTgrepManifest(packageRoot);
  const selectedPlatform = platform && arch
    ? getRepositoryIndexPlatform({ platform, arch })
    : getRepositoryIndexPlatform();
  const override = explicitBinaryPath ?? env?.[REPOSITORY_INDEX_ENV_BINARY];
  if (override) {
    const verified = await verifyManagedTgrep({ packageRoot, repoRoot, platform: selectedPlatform.platform, arch: selectedPlatform.arch, env: { ...env, [REPOSITORY_INDEX_ENV_BINARY]: override }, binaryPath: override, spawnImpl });
    return verified;
  }

  const binaryPath = getManagedTgrepBinaryPath(manifest.version, selectedPlatform.key, {
    homeDirectory,
    windows: selectedPlatform.platform === "win32",
  });
  const finalDirectory = getManagedTgrepDirectory(manifest.version, selectedPlatform.key, { homeDirectory });
  const provisionLockPath = path.join(getEngineHome({ homeDirectory }), ".provision.lock");
  const lease = await acquireRepositoryIndexLock(provisionLockPath, "tgrep-provision", { timeoutMs: 120_000 });
  try {
    try {
      await verifyExecutable(binaryPath, { platform: selectedPlatform.platform });
      await verifyTgrepVersion({ binaryPath, expectedVersion: manifest.version, repoRoot, spawnImpl });
      return binaryDescriptor({ manifest, selectedPlatform, binaryPath, managed: true, overridden: false, asset: manifest.assets[selectedPlatform.key] });
    } catch (cause) {
      if (cause.code !== REPOSITORY_INDEX_ERROR_CODES.ENGINE_MISSING
        && cause.code !== REPOSITORY_INDEX_ERROR_CODES.ENGINE_VERSION_MISMATCH
        && cause.code !== REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXECUTION_FAILED) throw cause;
      try {
        await rename(binaryPath, `${binaryPath}.invalid-${randomUUID()}`);
      } catch (renameError) {
        if (renameError.code !== "ENOENT") throw cause;
      }
    }

    const asset = await getTgrepAsset(selectedPlatform.key, packageRoot);
    const temporaryRoot = await mkdtemp(path.join(getEngineHome({ homeDirectory }), "tmp-"));
    try {
      const archivePath = await downloadTgrepAsset({
        asset,
        destinationDirectory: temporaryRoot,
        assetPath,
        fetchImpl,
      });
      await verifyArchiveChecksum(archivePath, asset.sha256);
      const extractionDirectory = path.join(temporaryRoot, "extract");
      await mkdir(extractionDirectory);
      await extractArchive(archivePath, extractionDirectory, { archive: asset.archive, execFileImpl });
      const extractedBinary = await findBinary(extractionDirectory, asset.binaryName);
      await ensureRegularFile(extractedBinary, REPOSITORY_INDEX_ERROR_CODES.ENGINE_EXTRACTION_FAILED, "Extracted tgrep binary");
      const stagedBinary = path.join(temporaryRoot, asset.binaryName);
      await copyFile(extractedBinary, stagedBinary);
      if (selectedPlatform.platform !== "win32") await chmod(stagedBinary, 0o755);
      await mkdir(finalDirectory, { recursive: true });
      await rename(stagedBinary, binaryPath);
      if (selectedPlatform.platform !== "win32") await chmod(binaryPath, 0o755);
      await verifyExecutable(binaryPath, { platform: selectedPlatform.platform });
      await verifyTgrepVersion({ binaryPath, expectedVersion: manifest.version, repoRoot, spawnImpl });
      return binaryDescriptor({ manifest, selectedPlatform, binaryPath, managed: true, overridden: false, asset });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  } finally {
    await lease.release();
  }
}
