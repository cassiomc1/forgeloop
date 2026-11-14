import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { stableStorageReviewPath, verifyStableStorageReview } from "../scripts/verify-stable-storage-review.mjs";

// The retained review binds the source published as v2.0.0, not the moving
// working tree. Unreleased source changes are admitted for development; the
// stable publication gate (check-release-channel.mjs) still verifies HEAD and
// refuses a stable release until a fresh writer review covers the change set.
const REVIEWED_RELEASE_TAG = "v2.0.0";

function extractReviewedSource(root) {
  try {
    execFileSync("git", ["rev-parse", "--verify", `${REVIEWED_RELEASE_TAG}^{commit}`], { stdio: "pipe" });
  } catch {
    throw new Error(`${REVIEWED_RELEASE_TAG} is required to verify the retained storage review; fetch tags (fetch-depth: 0)`);
  }
  const archive = execFileSync("git", ["archive", "--format=tar", REVIEWED_RELEASE_TAG, "src", "integrations/mcp/src"], { maxBuffer: 256 * 1024 * 1024 });
  execFileSync("tar", ["-xf", "-", "-C", root], { input: archive });
}

test("stable storage admission binds complete runtime membership and reviewed source", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forgeloop-reviewed-source-"));
  try {
    extractReviewedSource(root);
    mkdirSync(path.join(root, "benchmarks/storage-sqlite"), { recursive: true });
    const report = "benchmarks/storage-sqlite/stable-2.0.0-writer-review.json.gz";
    copyFileSync(report, path.join(root, report));
    assert.equal(verifyStableStorageReview(root, "2.0.0").valid, true);
    const filename = path.join(root, "src/storage/capabilities.js");
    const original = readFileSync(filename, "utf8");
    writeFileSync(filename, original.replace(/\n/g, "\r\n"));
    assert.equal(verifyStableStorageReview(root, "2.0.0").valid, true);
    writeFileSync(filename, `${original}\n// Unreviewed source drift\n`);
    assert.throws(() => verifyStableStorageReview(root, "2.0.0"), /Reviewed runtime source changed/);
    writeFileSync(filename, original);
    writeFileSync(path.join(root, "src/unreviewed.js"), "export const writer = true;\n");
    assert.throws(() => verifyStableStorageReview(root, "2.0.0"), /module membership changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("stable storage admission selects the exact version's review and never falls back", () => {
  assert.equal(stableStorageReviewPath("2.1.0"), "benchmarks/storage-sqlite/stable-2.1.0-writer-review.json.gz");
  assert.throws(() => stableStorageReviewPath("2.1.0-rc.1"), /exact stable version/);
  const root = mkdtempSync(path.join(os.tmpdir(), "forgeloop-review-version-"));
  try {
    mkdirSync(path.join(root, "benchmarks/storage-sqlite"), { recursive: true });
    copyFileSync("benchmarks/storage-sqlite/stable-2.0.0-writer-review.json.gz", path.join(root, "benchmarks/storage-sqlite/stable-2.0.0-writer-review.json.gz"));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "9.9.9" }));
    assert.throws(() => verifyStableStorageReview(root), /missing for 9\.9\.9/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the current stable package version carries a valid review of the current runtime", () => {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  if (!/^\d+\.\d+\.\d+$/u.test(version) || version === "2.0.0") return;
  const result = verifyStableStorageReview(process.cwd(), version);
  assert.equal(result.valid, true);
  assert.equal(result.version, version);
});
