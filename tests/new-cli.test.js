import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repositoryRoot, "src", "cli.js");

function run(target, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args, "--path", target], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

test("preflight, audit, report, and policy expose deterministic local CLI contracts", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-new-cli-"));
  try {
    assert.equal(run(target, "init").status, 0);
    const created = run(target, "task-create", "--task", "local-cli-contract", "--json");
    assert.equal(created.status, 0, created.stderr);
    const first = run(target, "preflight", "--json");
    const second = run(target, "preflight", "--json");
    assert.equal(first.status, 1);
    assert.equal(first.stdout, second.stdout);
    assert.equal(JSON.parse(first.stdout).status, "BLOCKED");

    const policy = run(target, "policy", "prototype", "--json");
    assert.equal(policy.status, 0, policy.stderr);
    assert.equal(JSON.parse(policy.stdout).config.complianceMode, "advisory");
    assert.match(await readFile(path.join(target, ".forgeloop", "config.json"), "utf8"), /prototype/);

    const audit = run(target, "audit", "--json");
    const report = run(target, "report", "--json");
    assert.equal(audit.status, 1);
    assert.equal(report.status, 1);
    assert.equal(JSON.parse(audit.stdout).status, "INVALID");
    assert.equal(JSON.parse(report.stdout).verdict, "INCOMPLETE");
  } finally {
    await removeTempTree(target);
  }
});
