import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  ensureManagedTgrep,
  downloadTgrepAsset,
  verifyBinaryChecksum,
  verifyArchiveChecksum,
  verifyManagedTgrep,
  verifyTgrepVersion,
  validateArchiveEntry,
} from "../src/repository-index/binary-manager.js";
import { getManagedTgrepBinaryPath } from "../src/repository-index/paths.js";
import { packageRoot } from "./helpers/repository-index.js";

const execFileAsync = promisify(execFile);

async function fakeBinary(directory, version = "1.0.3") {
  const binary = path.join(directory, "tgrep");
  await writeFile(binary, `#!/bin/sh\nprintf 'tgrep ${version}\\n'\n`);
  await chmod(binary, 0o755);
  return binary;
}

function fakeVersionSpawn(version) {
  return (_file, _args, _options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end() {} };
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from(`tgrep ${version}\n`));
      child.emit("close", 0, null);
    });
    return child;
  };
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

test("managed binary checksum verification fails before version execution", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-tgrep-binary-checksum-"));
  try {
    const binary = path.join(directory, "tgrep");
    await writeFile(binary, "tampered binary");
    const expected = createHash("sha256").update("different binary").digest("hex");
    await assert.rejects(
      () => verifyBinaryChecksum(binary, expected),
      (error) => error.code === "E_REPOSITORY_INDEX_ENGINE_BINARY_CHECKSUM_MISMATCH",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("managed same-version tampering is rejected before the version command runs", async () => {
  const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-tgrep-managed-tamper-"));
  try {
    const binary = getManagedTgrepBinaryPath("1.0.3", "darwin-arm64", { homeDirectory });
    await writeFile(binary, "#!/bin/sh\nprintf 'tgrep 1.0.3\\n'\n", { flag: "w" }).catch(async (error) => {
      if (error.code !== "ENOENT") throw error;
      await mkdir(path.dirname(binary), { recursive: true });
      await writeFile(binary, "#!/bin/sh\nprintf 'tgrep 1.0.3\\n'\n");
    });
    await chmod(binary, 0o755);
    await assert.rejects(
      () => verifyManagedTgrep({ packageRoot, repoRoot: homeDirectory, platform: "darwin", arch: "arm64", homeDirectory, env: {}, spawnImpl: () => { throw new Error("version execution must not run"); } }),
      (error) => error.code === "E_REPOSITORY_INDEX_ENGINE_BINARY_CHECKSUM_MISMATCH",
    );
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("setup repairs a tampered managed binary only after verifying the replacement", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-tgrep-managed-repair-"));
  try {
    const packageRootCopy = path.join(directory, "package");
    const manifestDirectory = path.join(packageRootCopy, "src", "repository-index");
    const sourceDirectory = path.join(directory, "asset");
    const archivePath = path.join(directory, "fixture.tar.gz");
    await mkdir(manifestDirectory, { recursive: true });
    await mkdir(sourceDirectory, { recursive: true });

    const replacement = "#!/bin/sh\nprintf 'tgrep 1.0.3\\n'\n";
    const replacementSha = createHash("sha256").update(replacement).digest("hex");
    const replacementPath = path.join(sourceDirectory, "tgrep");
    await writeFile(replacementPath, replacement);
    await chmod(replacementPath, 0o755);
    await execFileAsync("tar", ["-czf", archivePath, "-C", sourceDirectory, "tgrep"]);
    const archiveSha = createHash("sha256").update(await readFile(archivePath)).digest("hex");

    const manifest = JSON.parse(await readFile(path.join(packageRoot, "src", "repository-index", "tgrep-manifest.json"), "utf8"));
    manifest.assets["darwin-arm64"] = {
      ...manifest.assets["darwin-arm64"],
      assetName: "fixture.tar.gz",
      sha256: archiveSha,
      binarySha256: replacementSha,
    };
    await writeFile(path.join(manifestDirectory, "tgrep-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    const managedBinary = getManagedTgrepBinaryPath("1.0.3", "darwin-arm64", { homeDirectory: directory });
    await mkdir(path.dirname(managedBinary), { recursive: true });
    await writeFile(managedBinary, "tampered same-version executable\n");
    await chmod(managedBinary, 0o755);

    const descriptor = await ensureManagedTgrep({
      packageRoot: packageRootCopy,
      repoRoot: directory,
      platform: "darwin",
      arch: "arm64",
      env: {},
      homeDirectory: directory,
      assetPath: archivePath,
      spawnImpl: fakeVersionSpawn("1.0.3"),
    });
    assert.equal(descriptor.managed, true);
    assert.equal(descriptor.canonical, true);
    assert.equal(createHash("sha256").update(await readFile(managedBinary)).digest("hex"), replacementSha);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("explicit development override is version-checked without PATH lookup", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-tgrep-override-"));
  try {
    const binary = await fakeBinary(directory);
    const descriptor = await ensureManagedTgrep({ packageRoot, repoRoot: directory, binaryPath: binary, platform: "darwin", arch: "arm64", spawnImpl: fakeVersionSpawn("1.0.3") });
    assert.equal(descriptor.binaryPath, binary);
    assert.equal(descriptor.managed, false);
    assert.equal(descriptor.overridden, true);
    assert.equal(descriptor.engineVersion, "1.0.3");
    const wrongVersionBinary = await fakeBinary(directory, "1.0.2");
    await assert.rejects(
      () => verifyTgrepVersion({ binaryPath: wrongVersionBinary, expectedVersion: "1.0.3", repoRoot: directory, spawnImpl: fakeVersionSpawn("1.0.2") }),
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
