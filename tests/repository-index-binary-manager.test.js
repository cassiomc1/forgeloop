import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  ensureManagedTgrep,
  downloadTgrepAsset,
  verifyArchiveChecksum,
  verifyTgrepVersion,
  validateArchiveEntry,
} from "../src/repository-index/binary-manager.js";
import { packageRoot } from "./helpers/repository-index.js";

async function fakeBinary(directory, version = "1.0.3") {
  const binary = path.join(directory, "tgrep");
  await writeFile(binary, `#!/bin/sh\nprintf 'tgrep ${version}\\n'\n`);
  await chmod(binary, 0o755);
  return binary;
}

test("checksum verification is exact and fails closed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-tgrep-checksum-"));
  try {
    const archive = path.join(directory, "asset.tar.gz");
    const contents = Buffer.from("pinned asset");
    await writeFile(archive, contents);
    const digest = createHash("sha256").update(contents).digest("hex");
    assert.equal(await verifyArchiveChecksum(archive, digest), digest);
    await assert.rejects(() => verifyArchiveChecksum(archive, "0".repeat(64)), (error) => error.code === "E_REPOSITORY_INDEX_ENGINE_CHECKSUM_MISMATCH");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("explicit development override is version-checked without PATH lookup", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-tgrep-override-"));
  try {
    const binary = await fakeBinary(directory);
    const descriptor = await ensureManagedTgrep({ packageRoot, repoRoot: directory, binaryPath: binary, platform: "darwin", arch: "arm64" });
    assert.equal(descriptor.binaryPath, binary);
    assert.equal(descriptor.managed, false);
    assert.equal(descriptor.overridden, true);
    assert.equal(descriptor.engineVersion, "1.0.3");
    const wrongVersionBinary = await fakeBinary(directory, "1.0.2");
    await assert.rejects(
      () => verifyTgrepVersion({ binaryPath: wrongVersionBinary, expectedVersion: "1.0.3", repoRoot: directory }),
      (error) => error.code === "E_REPOSITORY_INDEX_ENGINE_VERSION_MISMATCH",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("archive paths reject traversal and absolute entries", () => {
  assert.equal(validateArchiveEntry("./tgrep"), "tgrep");
  for (const entry of ["../escape", "/absolute", "C:\\\\absolute", "nested/../../escape"]) {
    assert.throws(() => validateArchiveEntry(entry), (error) => error.code === "E_REPOSITORY_INDEX_ENGINE_EXTRACTION_FAILED");
  }
});

test("download rejects an untrusted asset URL before network access", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-tgrep-download-"));
  try {
    await assert.rejects(
      () => downloadTgrepAsset({
        asset: { assetName: "tgrep.tar.gz", url: "https://example.invalid/tgrep.tar.gz", sha256: "a".repeat(64) },
        destinationDirectory: directory,
        fetchImpl: async () => { throw new Error("network should not be called"); },
      }),
      (error) => error.code === "E_REPOSITORY_INDEX_ENGINE_DOWNLOAD_FAILED",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
