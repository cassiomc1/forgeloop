import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { removeTempTree } from "./helpers/rm-safe.js";

const helper = new URL("../scripts/lib/benchmark-failure-journal.mjs", import.meta.url).href;

test("an uncaught asynchronous failure journals its active sample and still exits unsuccessfully", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-benchmark-failure-"));
  const filename = path.join(directory, "failure.json");
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      import { installBenchmarkFailureJournal } from ${JSON.stringify(helper)};
      installBenchmarkFailureJournal(process.argv[1], () => ({ progress: { operation: "projectTasksResource", stage: "MEASURED", sampleIndex: 17 } }));
      setTimeout(() => { throw Object.assign(new Error("controlled request timeout"), { code: "REQUEST_TIMEOUT", data: { timeout: 60000 } }); }, 1);
    `, filename], { encoding: "utf8", timeout: 10000 });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /controlled request timeout/);
    const journal = JSON.parse(await readFile(filename, "utf8"));
    assert.equal(journal.status, "FAILED");
    assert.equal(journal.workerPid, run.pid);
    assert.deepEqual(journal.progress, { operation: "projectTasksResource", stage: "MEASURED", sampleIndex: 17 });
    assert.equal(journal.error.code, "REQUEST_TIMEOUT");
    assert.deepEqual(journal.error.data, { timeout: 60000 });
  } finally { await removeTempTree(directory); }
});

test("a later shutdown failure preserves the recorded request cause without suppressing shutdown failure", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-benchmark-first-cause-"));
  const filename = path.join(directory, "failure.json");
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      import { installBenchmarkFailureJournal } from ${JSON.stringify(helper)};
      const journal = installBenchmarkFailureJournal(process.argv[1], () => ({ stage: "MEASURED" }));
      journal.record(Object.assign(new Error("first request failure"), { code: "REQUEST_TIMEOUT" }));
      throw new Error("later shutdown failure");
    `, filename], { encoding: "utf8", timeout: 10000 });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /later shutdown failure/);
    const journal = JSON.parse(await readFile(filename, "utf8"));
    assert.equal(journal.error.code, "REQUEST_TIMEOUT");
    assert.equal(journal.error.message, "first request failure");
  } finally { await removeTempTree(directory); }
});
