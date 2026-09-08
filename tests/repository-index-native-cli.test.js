import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

import { createFixtureRepository, explicitNativeBinary, nativeOptions, removeFixtureRepository } from "./helpers/repository-index.js";
import { stopRepositoryIndexServer } from "../src/repository-index/server.js";

const repositoryRoot = path.resolve(".");
const cliPath = path.join(repositoryRoot, "src", "cli.js");

function runCli(target, binary, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args, "--path", target], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, FORGELOOP_TGREP_BINARY: binary },
    timeout: 120_000,
  });
}

function runCliJson(target, binary, ...args) {
  return runCli(target, binary, ...args, "--json");
}

test("native CLI acceptance covers init, doctor, search, rebuild, and stop", async (t) => {
  const binary = explicitNativeBinary();
  if (!binary) {
    t.skip("native CLI acceptance requires an explicit FORGELOOP_TGREP_BINARY");
    return;
  }
  const target = await createFixtureRepository();
  const options = nativeOptions(binary);
  try {
    const initialized = runCli(target, binary, "init");
    assert.equal(initialized.status, 0, initialized.stderr);
    assert.match(initialized.stdout, /repository index ready:/u);

    const doctor = runCliJson(target, binary, "doctor");
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.equal(JSON.parse(doctor.stdout).repositoryIndex.status, "READY");

    const matches = runCliJson(target, binary, "search", "alphaNeedle", "--fixed-strings", "--glob", "src/**");
    assert.equal(matches.status, 0, matches.stderr);
    assert.deepEqual(JSON.parse(matches.stdout).matches.map(({ path: matchPath, line }) => [matchPath, line]), [["src/alpha.js", 1]]);

    const empty = runCliJson(target, binary, "search", "missingNativeNeedle", "--fixed-strings", "--glob", "src/**");
    assert.equal(empty.status, 0, empty.stderr);
    assert.equal(JSON.parse(empty.stdout).metrics.exitCode, 1);
    assert.deepEqual(JSON.parse(empty.stdout).matches, []);

    const rebuilt = runCliJson(target, binary, "index-rebuild");
    assert.equal(rebuilt.status, 0, rebuilt.stderr);
    const rebuiltResult = JSON.parse(rebuilt.stdout);
    assert.equal(rebuiltResult.status.health, "READY");
    assert.equal(rebuiltResult.smokeSearch.status, "OK");

    const stopped = runCliJson(target, binary, "index-stop");
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.equal(JSON.parse(stopped.stdout).status.health, "SERVER_DOWN");
  } finally {
    await stopRepositoryIndexServer(target, options).catch(() => {});
    await removeFixtureRepository(target);
  }
});
