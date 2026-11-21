import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { removeTempTree } from "./helpers/rm-safe.js";

// The independent verifier ships on its own as @cassiomc1/forgeloop-verify,
// Apache-2.0 and dependency-free, separate from the PolyForm-licensed CLI.

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

test("the verifier package is Apache-2.0, dependency-free and exposes its bin", async () => {
  const manifest = JSON.parse(await readFile("verifier/package.json", "utf8"));
  assert.equal(manifest.name, "@cassiomc1/forgeloop-verify");
  assert.equal(manifest.license, "Apache-2.0");
  assert.deepEqual(manifest.bin, { "forgeloop-verify": "forgeloop-verify.mjs" });
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.publishConfig.access, "public");
  const license = await readFile("verifier/LICENSE", "utf8");
  assert.equal(license, await readFile("LICENSE-APACHE", "utf8"));
  const source = await readFile("verifier/forgeloop-verify.mjs", "utf8");
  assert.ok(source.startsWith("#!/usr/bin/env node\n// SPDX-License-Identifier: Apache-2.0"));
});

test("the packed verifier contains only the verifier, its README, licence and manifest", { skip: process.platform === "win32" }, () => {
  const [pack] = JSON.parse(execFileSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: "verifier", encoding: "utf8" }));
  assert.deepEqual(pack.files.map((file) => file.path).sort(), ["LICENSE", "README.md", "forgeloop-verify.mjs", "package.json"]);
});

test("the bin runs when invoked through a node_modules/.bin symlink, as npx does", { skip: process.platform === "win32" }, async () => {
  const bin = await mkdtemp(path.join(tmpdir(), "forgeloop-verify-bin-"));
  try {
    const link = path.join(bin, "forgeloop-verify");
    await symlink(path.resolve("verifier/forgeloop-verify.mjs"), link);
    const help = spawnSync(process.execPath, [link, "--help"], { encoding: "utf8" });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^Usage: forgeloop-verify /u);
    const missing = spawnSync(process.execPath, [link], { encoding: "utf8" });
    assert.equal(missing.status, 2, "a run without --base/--head must not exit 0");
  } finally { await removeTempTree(bin); }
});

test("importing the verifier does not run its CLI", () => {
  const url = pathToFileURL(path.resolve("verifier/forgeloop-verify.mjs")).href;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)});`], { encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.equal(run.stdout, "");
});
