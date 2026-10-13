import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const repositoryRoot = process.cwd();

test("attestation summary writes stable fields and reports invocation errors", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-attestation-summary-"));
  const inputPath = path.join(directory, "result.json");
  const outputPath = path.join(directory, "summary.md");
  try {
    await writeFile(inputPath, JSON.stringify({
      status: "VALID",
      level: "VERIFIED",
      revisionProvider: "git",
      baseRevision: "base",
      headRevision: "head",
      changedPaths: 2,
      coveredPaths: 2,
      uncoveredPaths: [],
      tasks: 1,
      signature: { status: "UNSIGNED" },
      errors: [],
    }), "utf8");
    const stdout = execFileSync(process.execPath, [
      "scripts/write-forgeloop-attestation-summary.mjs",
      "--input",
      inputPath,
      "--output",
      outputPath,
    ], { cwd: repositoryRoot, encoding: "utf8" });
    assert.match(stdout, /Wrote ForgeLoop attestation summary/u);
    const summary = await readFile(outputPath, "utf8");
    assert.match(summary, /\*\*Status:\*\* VALID/u);
    assert.match(summary, /\*\*Coverage:\*\* 2 \/ 2 changed paths/u);

    assert.throws(
      () => execFileSync(process.execPath, ["scripts/write-forgeloop-attestation-summary.mjs"], {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
      (error) => error.status === 2 && /--input is required/u.test(error.stderr),
    );
  } finally {
    await removeTempTree(directory);
  }
});
