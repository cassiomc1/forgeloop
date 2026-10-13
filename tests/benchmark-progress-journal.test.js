import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { removeTempTree } from "./helpers/rm-safe.js";

const helper = new URL("../scripts/lib/benchmark-progress-journal.mjs", import.meta.url).href;

test("forced worker death preserves ordered durable progress without claiming completion", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-progress-death-"));
  const filename = path.join(directory, "progress.ndjson");
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      import { createBenchmarkProgressJournal } from ${JSON.stringify(helper)};
      const journal = createBenchmarkProgressJournal(process.argv[1]);
      journal.record({ stage: "EXPECTED", completedSamples: 0 });
      journal.record({ stage: "MEASURED", completedSamples: 10 });
      process.kill(process.pid, "SIGKILL");
    `, filename], { encoding: "utf8", timeout: 10000 });
    assert.notEqual(run.status, 0, run.stderr);
    const rows = (await readFile(filename, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(rows.map(row => row.sequence), [1, 2]);
    assert.deepEqual(rows.map(row => row.stage), ["EXPECTED", "MEASURED"]);
    assert.equal(rows[1].completedSamples, 10);
    assert.ok(rows.every(row => row.pid === run.pid && Number.isFinite(Date.parse(row.at))));
  } finally { await removeTempTree(directory); }
});

test("a reused progress path refuses to overwrite evidence from an earlier run", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-progress-reuse-"));
  const filename = path.join(directory, "progress.ndjson");
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      import { createBenchmarkProgressJournal } from ${JSON.stringify(helper)};
      const journal = createBenchmarkProgressJournal(process.argv[1]);
      journal.record({ stage: "FIRST_RUN" });
      journal.close();
      createBenchmarkProgressJournal(process.argv[1]);
    `, filename], { encoding: "utf8", timeout: 10000 });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /EEXIST/);
    const rows = (await readFile(filename, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].stage, "FIRST_RUN");
  } finally { await removeTempTree(directory); }
});
