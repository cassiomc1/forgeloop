import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
