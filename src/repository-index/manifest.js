import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  REPOSITORY_INDEX_ENGINE,
  REPOSITORY_INDEX_SUPPORTED_PLATFORMS,
} from "./constants.js";
import { REPOSITORY_INDEX_ERROR_CODES, repositoryIndexError } from "./errors.js";
import { getPackageRoot } from "../core/templates.js";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ARCHIVES = new Set(["tar.gz", "zip"]);

function manifestError(source, message, code = REPOSITORY_INDEX_ERROR_CODES.ENGINE_MISSING) {
  throw repositoryIndexError(code, `${source} ${message}`);
}

function assertManifestObject(value, source) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    manifestError(source, "must be a JSON object");
  }
  if (value.schemaVersion !== 1) {
    manifestError(source, "schemaVersion must be 1");
  }
}

function assertManifestIdentity(value, source) {
  if (value.engine !== REPOSITORY_INDEX_ENGINE) {
    manifestError(source, `engine must be ${REPOSITORY_INDEX_ENGINE}`);
  }
  if (typeof value.repository !== "string" || value.repository !== "microsoft/tgrep") {
    manifestError(source, "repository must be microsoft/tgrep");
  }
  if (typeof value.version !== "string" || !SEMVER.test(value.version)) {
    manifestError(source, "version is invalid");
  }
}

function assertManifestRelease(value, source) {
  if (typeof value.releaseBaseUrl !== "string"
    || value.releaseBaseUrl !== `https://github.com/microsoft/tgrep/releases/download/v${value.version}`) {
    manifestError(source, "releaseBaseUrl must be the pinned Microsoft tgrep release URL");
  }
}

function assertManifestAsset(asset, platformKey, source) {
  if (!asset || typeof asset !== "object") manifestError(source, `is missing ${platformKey}`);
  if (typeof asset.assetName !== "string" || asset.assetName.trim() === "") {
    manifestError(source, `${platformKey} assetName is required`);
  }
  const assetName = asset.assetName.replaceAll("\\", "/");
  if (path.posix.isAbsolute(assetName) || path.win32.isAbsolute(assetName)
    || path.posix.basename(assetName) !== assetName || path.posix.normalize(assetName) !== assetName
    || !/^[A-Za-z0-9._-]+$/u.test(assetName)) {
    manifestError(source, `${platformKey} assetName must be a single safe filename`);
  }
  if (!ARCHIVES.has(asset.archive)) manifestError(source, `${platformKey} archive is unsupported`);
  if (typeof asset.binaryName !== "string" || asset.binaryName.trim() === "") {
    manifestError(source, `${platformKey} binaryName is required`);
  }
  const expectedBinaryName = platformKey === "windows-x64" ? "tgrep.exe" : "tgrep";
  if (asset.binaryName !== expectedBinaryName) {
    manifestError(source, `${platformKey} binaryName must be ${expectedBinaryName}`);
  }
  if (!SHA256.test(asset.sha256) || /^0+$/.test(asset.sha256) || /replace|todo|placeholder/i.test(asset.sha256)) {
    manifestError(source, `${platformKey} checksum is not a verified SHA-256`, REPOSITORY_INDEX_ERROR_CODES.ENGINE_CHECKSUM_MISMATCH);
  }
}

function assertManifestAssets(value, source) {
  if (!value.assets || typeof value.assets !== "object" || Array.isArray(value.assets)) {
    manifestError(source, "assets are required");
  }
  for (const key of REPOSITORY_INDEX_SUPPORTED_PLATFORMS) {
    assertManifestAsset(value.assets[key], key, source);
  }
  const unsupportedKeys = Object.keys(value.assets).filter((key) => !REPOSITORY_INDEX_SUPPORTED_PLATFORMS.includes(key));
  if (unsupportedKeys.length > 0) {
    manifestError(source, `contains unsupported platforms: ${unsupportedKeys.join(", ")}`);
  }
}

function assertManifest(value, source = "tgrep manifest") {
  assertManifestObject(value, source);
  assertManifestIdentity(value, source);
  assertManifestRelease(value, source);
  assertManifestAssets(value, source);
  return Object.freeze({
    ...value,
    assets: Object.freeze(Object.fromEntries(Object.entries(value.assets).map(([key, asset]) => [key, Object.freeze({ ...asset })]))),
  });
}

export async function loadTgrepManifest(packageRoot = getPackageRoot()) {
  if (typeof packageRoot !== "string" || packageRoot.trim() === "") {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_MISSING, "ForgeLoop package root is required to load the tgrep manifest");
  }
  const manifestPath = path.join(packageRoot, "src", "repository-index", "tgrep-manifest.json");
  let value;
  try {
    value = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (cause) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.ENGINE_MISSING, `Unable to read ${manifestPath}: ${cause.message}`, { cause, manifestPath });
  }
  return assertManifest(value, manifestPath);
}

export function validateTgrepManifest(value) {
  return assertManifest(value);
}

export async function getPinnedTgrepVersion(packageRoot) {
  return (await loadTgrepManifest(packageRoot)).version;
}

export async function getTgrepAsset(platformKey, packageRoot) {
  const manifest = await loadTgrepManifest(packageRoot);
  const asset = manifest.assets[platformKey];
  if (!asset) {
    throw repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.PLATFORM_UNSUPPORTED, `No tgrep asset is available for ${platformKey}`);
  }
  return Object.freeze({
    ...asset,
    url: `${manifest.releaseBaseUrl}/${asset.assetName}`,
    version: manifest.version,
    engine: manifest.engine,
  });
}
