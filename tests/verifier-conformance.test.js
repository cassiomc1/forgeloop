import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// docs/PROTOCOL_SPEC.md Section 10: the reference CLI and the independent
// Apache-2.0 verifier must both pass every verifier conformance case.

function runConformance(extraArgs = []) {
  return spawnSync(process.execPath, ["scripts/run-conformance.mjs", ...extraArgs], { encoding: "utf8" });
}

test("the reference CLI passes the verifier conformance suite", () => {
  const run = runConformance();
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /(\d+)\/\1 conformance cases passed/u);
});

test("the independent verifier passes the same suite without the runtime", () => {
  const run = runConformance(["--independent"]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /(\d+)\/\1 conformance cases passed/u);
});

test("the independent verifier imports nothing from the runtime", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("verifier/forgeloop-verify.mjs", "utf8");
  const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gmu)].map((match) => match[1]);
  assert.ok(imports.length > 0);
  assert.deepEqual(imports.filter((specifier) => !specifier.startsWith("node:")), []);
  assert.match(source, /SPDX-License-Identifier: Apache-2\.0/u);
});
