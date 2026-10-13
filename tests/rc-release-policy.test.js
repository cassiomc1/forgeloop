import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { RC_BASELINE, RC_SCRIPTS, validateRcSnapshot, validateBaselineRun, validateMcpMetadata, collectRuntimeFiles } from "../scripts/check-rc-release.mjs";
import { inventorySource, assertInventory } from "../scripts/storage-writer-inventory.mjs";
import { validateReleaseChannel } from "../scripts/check-release-channel.mjs";
import { assertTestSummary } from "../scripts/run-rc-tests.mjs";

function fixture() {
  const baselinePackage = { version: "2.0.0", scripts: { test: "node --test" }, dependencies: { example: "1.0.0" }, publishConfig: { access: "restricted" } };
  return { baselinePackage, currentPackage: { ...structuredClone(baselinePackage), version: "2.0.0-rc.1", scripts: { ...baselinePackage.scripts, ...RC_SCRIPTS } },
    baselineLock: { version: "2.0.0", packages: { "": { version: "2.0.0" }, dependency: { integrity: "fixed" } } },
    currentLock: { version: "2.0.0-rc.1", packages: { "": { version: "2.0.0-rc.1" }, dependency: { integrity: "fixed" } } },
    baselineFiles: { "src/cli.js": "fixed" }, currentFiles: { "src/cli.js": "fixed" } };
}

test("RC equivalence accepts metadata-only candidate and makes no stable/coverage claim", () => {
  const result = validateRcSnapshot(fixture());
  assert.equal(result.status, "RC_ONLY_SOURCE_EQUIVALENT");
  assert.equal(result.stableAcceptance, false);
  assert.equal(result.coverageClaim, "NO_NEW_FULL_COVERAGE_CLAIM");
});

test("RC gate refuses stable versions, source drift, added runtime files and dependency changes", () => {
  for (const mutate of [
    value => { value.currentPackage.version = "2.0.0"; },
    value => { value.currentFiles["src/cli.js"] = "changed"; },
    value => { value.currentFiles["src/new.js"] = "added"; },
    value => { value.currentPackage.dependencies.example = "2.0.0"; },
    value => { value.currentLock.packages.dependency.integrity = "changed"; },
    value => { value.currentPackage.scripts.test = "echo skipped"; },
    value => { value.currentLock.version = "different"; },
  ]) {
    const value = fixture(); mutate(value); assert.throws(() => validateRcSnapshot(value));
  }
});

test("trusted baseline evidence refuses wrong source, repository, workflow or non-success", () => {
  const baseline = { head_sha: RC_BASELINE, conclusion: "success", status: "completed", path: ".github/workflows/windows-full-suite.yml", repository: { full_name: "cassiomc1/forgeloop" } };
  assert.doesNotThrow(() => validateBaselineRun(baseline));
  for (const patch of [{ head_sha: "foreign" }, { conclusion: "failure" }, { status: "in_progress" }, { path: "other.yml" }, { repository: { full_name: "other/repo" } }]) {
    assert.throws(() => validateBaselineRun({ ...baseline, ...patch }));
  }
});

test("channel guard forbids RC latest and stable SQLite publication without sole-writer acceptance", () => {
  assert.equal(validateReleaseChannel("2.0.0-rc.1", "next", { soleSQLiteWriter: false }).rc, true);
  assert.throws(() => validateReleaseChannel("2.0.0-rc.1", "latest", { soleSQLiteWriter: false }));
  assert.throws(() => validateReleaseChannel("2.0.0", "latest", { soleSQLiteWriter: false }));
  assert.throws(() => validateReleaseChannel("2.0.0", "next", { soleSQLiteWriter: true }));
  assert.equal(validateReleaseChannel("2.0.0", "latest", { soleSQLiteWriter: true }).rc, false);
});

test("MCP admits explicit RC peer metadata while refusing any resolved dependency drift", () => {
  const core = "@cassiomc1/forgeloop";
  const baselinePackage = { peerDependencies: { [core]: ">=2.0.0 <3" } };
  const currentPackage = { peerDependencies: { [core]: ">=2.0.0-rc.1 <3" } };
  const baselineLock = { packages: { "": baselinePackage, [`node_modules/${core}`]: { version: "2.0.0" }, dependency: { integrity: "fixed" } } };
  const currentLock = { packages: { "": currentPackage, [`node_modules/${core}`]: { version: "2.0.0-rc.1" }, dependency: { integrity: "fixed" } } };
  const value = { baselinePackage, currentPackage, baselineLock, currentLock, version: "2.0.0-rc.1" };
  assert.doesNotThrow(() => validateMcpMetadata(value));
  const drift = structuredClone(value); drift.currentLock.packages.dependency.integrity = "drift";
  assert.throws(() => validateMcpMetadata(drift));
});

test("writer inventory records imports and potential handle/wrapper writes and rejects drift", () => {
  const original = inventorySource("src/example.js", 'import { writeFile } from "node:fs/promises"; await writeFile(file, bytes); await handle.write(bytes); await writeFileAtomic(file, bytes); await import(variable);');
  assert.equal(original.potentialWrites.length, 3);
  assert.deepEqual(original.imports, ["node:fs/promises", "UNRESOLVED_DYNAMIC_IMPORT"]);
  assert.throws(() => assertInventory(original, inventorySource("src/example.js", "await handle.writeFile(data);")));
});

test("bounded RC publishing is explicit, targets next and keeps stable coverage verification", () => {
  const workflow = readFileSync(new URL("../.github/workflows/npm-publish.yml", import.meta.url), "utf8");
  assert.match(workflow, /channel:/u);
  assert.match(workflow, /check-rc-release\.mjs --require-ci/u);
  assert.match(workflow, /npm run release:quick/u);
  assert.match(workflow, /npm run coverage/u);
  assert.match(workflow, /--tag "\$NPM_DIST_TAG"/u);
  const runner = readFileSync(new URL("../scripts/run-rc-release.mjs", import.meta.url), "utf8");
  assert.match(runner, /timeout: 180000/u);
  assert.doesNotMatch(runner, /"coverage"|"verify:prepush"|benchmark-storage/u);
});

test("short test receipt refuses missing cases, failed cases, skips and partial output", () => {
  const output = "# tests 36\n# pass 36\n# fail 0\n# skipped 0\n# todo 0\n";
  assert.doesNotThrow(() => assertTestSummary(output));
  for (const changed of [output.replace("tests 36", "tests 35"), output.replace("skipped 0", "skipped 1"), output.replace("fail 0", "fail 1"), "partial"]) assert.throws(() => assertTestSummary(changed));
});

test("runtime collection includes hidden and untracked source rather than relying on Git ignore rules", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forgeloop-rc-source-"));
  try {
    mkdirSync(path.join(root, "src", "node_modules"), { recursive: true });
    writeFileSync(path.join(root, "src", ".hidden.js"), "untracked");
    writeFileSync(path.join(root, "src", "node_modules", "dependency.js"), "dependency");
    assert.deepEqual(collectRuntimeFiles(root), ["src/.hidden.js"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
