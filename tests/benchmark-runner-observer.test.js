import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { observeBenchmarkRunner } from "../scripts/ci/observe-benchmark-runner.mjs";
import { removeTempTree } from "./helpers/rm-safe.js";

async function writeProcess(procRoot, { pid, parentPid, argv }) {
  const directory = path.join(procRoot, String(pid));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "status"), `Name:\tfixture\nPPid:\t${parentPid}\n`);
  await writeFile(path.join(directory, "cmdline"), `${argv.join("\0")}\0`);
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-runner-observer-"));
  const procRoot = path.join(root, "proc");
  const tempRoot = path.join(root, "tmp");
  await mkdir(procRoot);
  await mkdir(tempRoot);
  await writeProcess(procRoot, { pid: 1, parentPid: 0, argv: ["/sbin/init"] });
  await writeProcess(procRoot, { pid: 20, parentPid: 1, argv: ["/usr/bin/node", "runner.js"] });
  await writeProcess(procRoot, { pid: 30, parentPid: 20, argv: ["/usr/bin/node", "observer.mjs"] });
  return { root, procRoot, tempRoot, observerPid: 30 };
}

function options(f, phase, output, beforePath = null) {
  return {
    phase,
    output,
    beforePath,
    procRoot: f.procRoot,
    tempRoot: f.tempRoot,
    observerPid: f.observerPid,
    platform: "linux",
    environment: {
      RUNNER_OS: "Linux",
      RUNNER_NAME: "fixture-linux",
      GITHUB_RUN_ID: "fixture-run",
      GITHUB_RUN_ATTEMPT: "1",
      EXPECTED_BENCHMARK_SHA: "a".repeat(40),
    },
  };
}

test("runner observer allows only its own node ancestry and retains paired clean observations", async () => {
  const f = await fixture();
  try {
    const beforePath = path.join(f.root, "runner-before.json");
    const afterPath = path.join(f.root, "runner-after.json");
    const before = await observeBenchmarkRunner(options(f, "before", beforePath));
    assert.equal(before.status, "PASS");
    assert.deepEqual(before.processInventory.competingNodeProcesses, []);
    assert.deepEqual(before.temporaryEntries, []);
    assert.equal(before.policy.physicalWindowsHostQuiescence, "NOT_PROVEN");

    const after = await observeBenchmarkRunner(options(f, "after", afterPath, beforePath));
    assert.equal(after.status, "PASS");
    assert.deepEqual(after.newTemporaryEntries, []);
    assert.equal(JSON.parse(await readFile(afterPath, "utf8")).beforeObservation.status, "PASS");
  } finally {
    await removeTempTree(f.root);
  }
});

test("runner observer fails on an orphan worker and direct benchmark temporary entry without deleting it", async () => {
  const f = await fixture();
  try {
    const beforePath = path.join(f.root, "runner-before.json");
    const afterPath = path.join(f.root, "runner-after.json");
    await observeBenchmarkRunner(options(f, "before", beforePath));
    await writeProcess(f.procRoot, {
      pid: 40,
      parentPid: 1,
      argv: ["/usr/bin/node", "/workspace/scripts/lib/storage-mcp-benchmark-worker.mjs"],
    });
    const leakedDirectory = path.join(f.tempRoot, "forgeloop-mcp-benchmark-leak");
    await mkdir(leakedDirectory);

    const after = await observeBenchmarkRunner(options(f, "after", afterPath, beforePath));
    assert.equal(after.status, "FAILED");
    assert.ok(after.violations.some(violation => violation.code === "E_ORPHAN_BENCHMARK_WORKER"));
    assert.ok(after.violations.some(violation => violation.code === "E_BENCHMARK_TEMP_REMAINS"));
    assert.ok(after.processInventory.competingNodeProcesses.some(processRecord => processRecord.pid === 40));
    assert.equal(after.processInventory.processes.find(processRecord => processRecord.pid === 40).commandLine, undefined);
    assert.equal((await stat(leakedDirectory)).isDirectory(), true, "observer must not delete benchmark temp entries");
  } finally {
    await removeTempTree(f.root);
  }
});

test("runner observer refuses a pre-existing benchmark temporary entry before measurement", async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.tempRoot, "forgeloop-mcp-benchmark-stale"));
    const observation = await observeBenchmarkRunner(options(f, "before", path.join(f.root, "runner-before.json")));
    assert.equal(observation.status, "FAILED");
    assert.equal(observation.failureCode, "E_BENCHMARK_TEMP_PREEXISTS");
    assert.deepEqual(observation.temporaryEntries, [{ name: "forgeloop-mcp-benchmark-stale", kind: "directory" }]);
  } finally {
    await removeTempTree(f.root);
  }
});

test("runner cleanup refuses a before-observation from another source or run", async () => {
  const f = await fixture();
  try {
    const beforePath = path.join(f.root, "runner-before.json");
    await observeBenchmarkRunner(options(f, "before", beforePath));
    const changed = options(f, "after", path.join(f.root, "runner-after.json"), beforePath);
    changed.environment.EXPECTED_BENCHMARK_SHA = "b".repeat(40);
    changed.environment.GITHUB_RUN_ID = "another-run";
    const result = await observeBenchmarkRunner(changed);
    assert.equal(result.status, "FAILED");
    assert.deepEqual(result.violations.find(value => value.code === "E_BEFORE_SCOPE_MISMATCH").fields,
      ["sourceRevision", "workflowRun"]);
  } finally { await removeTempTree(f.root); }
});
