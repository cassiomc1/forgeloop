import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const cli = path.resolve("src/cli.js");

test("Repository Index commands expose the planned help contract", () => {
  const search = spawnSync(process.execPath, [cli, "search", "--help"], { encoding: "utf8" });
  assert.equal(search.status, 0, search.stderr);
  assert.match(search.stdout, /--fixed-strings/);
  assert.match(search.stdout, /--files-with-matches/);
  assert.match(search.stdout, /--stats/);
  const status = spawnSync(process.execPath, [cli, "index-status", "--help"], { encoding: "utf8" });
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /--json/);
});

test("missing search pattern is a valid JSON invocation error", () => {
  const result = spawnSync(process.execPath, [cli, "search", "--json"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, "E_CLI_INVOCATION_INVALID");
});
