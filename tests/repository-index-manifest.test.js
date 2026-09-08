import assert from "node:assert/strict";
import { test } from "node:test";

import { validateTgrepManifest, loadTgrepManifest } from "../src/repository-index/manifest.js";
import { REPOSITORY_INDEX_SUPPORTED_PLATFORMS } from "../src/repository-index/constants.js";

test("the shipped tgrep manifest is pinned and verified for all supported platforms", async () => {
  const manifest = await loadTgrepManifest();
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.engine, "tgrep");
  assert.equal(manifest.version, "1.0.3");
  assert.equal(manifest.releaseBaseUrl, "https://github.com/microsoft/tgrep/releases/download/v1.0.3");
  assert.deepEqual(Object.keys(manifest.assets).sort(), [...REPOSITORY_INDEX_SUPPORTED_PLATFORMS].sort());
  for (const asset of Object.values(manifest.assets)) {
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(asset.sha256, /replace|todo|placeholder/i);
  }
});

test("manifest validation rejects placeholder checksums and untrusted release URLs", () => {
  const valid = {
    schemaVersion: 1,
    engine: "tgrep",
    repository: "microsoft/tgrep",
    version: "1.0.3",
    license: "MIT",
    releaseBaseUrl: "https://github.com/microsoft/tgrep/releases/download/v1.0.3",
    assets: Object.fromEntries(REPOSITORY_INDEX_SUPPORTED_PLATFORMS.map((key) => [key, {
      assetName: `${key}.tar.gz`,
      archive: key === "windows-x64" ? "zip" : "tar.gz",
      binaryName: key === "windows-x64" ? "tgrep.exe" : "tgrep",
      sha256: "a".repeat(64),
    }])),
  };
  assert.equal(validateTgrepManifest(valid).version, "1.0.3");
  assert.throws(() => validateTgrepManifest({ ...valid, releaseBaseUrl: "https://example.invalid/tgrep" }));
  assert.throws(() => validateTgrepManifest({ ...valid, assets: { ...valid.assets, "linux-x64": { ...valid.assets["linux-x64"], sha256: "REPLACE_WITH_VERIFIED_SHA256" } } }));
  assert.throws(() => validateTgrepManifest({ ...valid, assets: { ...valid.assets, "linux-x64": { ...valid.assets["linux-x64"], assetName: "../escape.tar.gz" } } }));
  assert.throws(() => validateTgrepManifest({ ...valid, assets: { ...valid.assets, "darwin-arm64": { ...valid.assets["darwin-arm64"], binaryName: "other" } } }));
});
