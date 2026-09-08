import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

import { runTgrep } from "../src/repository-index/process.js";

function fixtureSpawn(_executable, args, options) {
  const script = args[0] === "--emit-large"
    ? "process.stdout.write('0123456789'.repeat(100))"
    : "process.stdout.write('fixture-output')";
  return spawn(process.execPath, ["-e", script], options);
}

test("runTgrep preserves exact argv and uses a shell-free project boundary", async () => {
  let observed;
  const result = await runTgrep({
    binaryPath: "/opt/tgrep",
    repoRoot: process.cwd(),
    args: ["search", "--regexp", "$(touch injected)"],
    spawnImpl: (executable, args, options) => {
      observed = { executable, args, options };
      return fixtureSpawn(executable, args, options);
    },
  });

  assert.deepEqual(observed.args, ["search", "--regexp", "$(touch injected)"]);
  assert.equal(observed.executable, "/opt/tgrep");
  assert.equal(observed.options.cwd, process.cwd());
  assert.equal(observed.options.shell, false);
  assert.match(result.stdout, /fixture-output/u);
  assert.equal(result.exitCode, 0);
});

test("runTgrep fails closed when native output exceeds the bounded limit", async () => {
  await assert.rejects(
    () => runTgrep({
      binaryPath: "/opt/tgrep",
      repoRoot: process.cwd(),
      args: ["--emit-large"],
      maxOutputBytes: 32,
      spawnImpl: fixtureSpawn,
    }),
    (error) => error.code === "E_REPOSITORY_INDEX_OUTPUT_LIMIT",
  );
});
