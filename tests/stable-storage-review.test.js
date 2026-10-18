import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyStableStorageReview } from "../scripts/verify-stable-storage-review.mjs";

test("stable storage admission binds complete runtime membership and reviewed source", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forgeloop-reviewed-source-"));
  try {
    for (const directory of ["src", "integrations/mcp/src"]) cpSync(directory, path.join(root, directory), { recursive: true });
    mkdirSync(path.join(root, "benchmarks/storage-sqlite"), { recursive: true });
    const report = "benchmarks/storage-sqlite/stable-2.0.0-writer-review.json.gz";
    copyFileSync(report, path.join(root, report));
    assert.equal(verifyStableStorageReview(root).valid, true);
    const filename = path.join(root, "src/storage/capabilities.js");
    const original = readFileSync(filename, "utf8");
    writeFileSync(filename, original.replace(/\n/g, "\r\n"));
    assert.equal(verifyStableStorageReview(root).valid, true);
    writeFileSync(filename, `${original}\n// Unreviewed source drift\n`);
    assert.throws(() => verifyStableStorageReview(root), /Reviewed runtime source changed/);
    writeFileSync(filename, original);
    writeFileSync(path.join(root, "src/unreviewed.js"), "export const writer = true;\n");
    assert.throws(() => verifyStableStorageReview(root), /module membership changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
