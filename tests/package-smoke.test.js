import { parse as parseYaml } from "yaml";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("package smoke workflow keeps Linux coverage and an explicit release matrix", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const workflow = await readFile(".github/workflows/package-smoke.yml", "utf8");
  assert.equal(packageJson.scripts["pack:smoke"], "node scripts/package_smoke.mjs");
  const parsed = parseYaml(workflow);
  assert.deepEqual(parsed.jobs["tarball-smoke"]["runs-on"], ["self-hosted", "Linux", "X64", "forgeloop-linux-remote"]);
  const matrix = parsed.jobs["release-tarball-smoke"].strategy.matrix.include;
  assert.deepEqual(matrix.map(row => row.os), ["macOS", "Windows"]);
  assert.deepEqual(matrix[0].runner, ["self-hosted", "macOS", "ARM64", "forgeloop-macos-local"]);
  assert.deepEqual(matrix[1].runner, ["self-hosted", "Windows", "X64", "forgeloop-windows-remote"]);
  assert.match(workflow, /full_matrix/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /npm run pack:smoke/);
});
