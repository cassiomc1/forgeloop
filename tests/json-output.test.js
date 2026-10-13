import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
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

test("structured CLI commands produce deterministic JSON contracts", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-json-"));
  try {
    assert.equal(run(target, "init").status, 0);
    await writeFile(path.join(target, "receipt.json"), `${JSON.stringify({
      schemaVersion: 1,
      protocolVersion: 1,
      taskId: "json-receipt",
      contractFingerprint: "a".repeat(64),
      selectedGuides: [],
      changedPaths: [],
      checks: [],
      review: { status: "not-run", independent: false },
      limitations: [],
      publication: { committed: false, pushed: false, pullRequest: null, deployed: false },
    })}\n`);

    const commands = [
      ["route", "--work", "api-auth", "--surface", "auth", "--json"],
      ["doctor", "--json"],
      ["inspect", "--json"],
      ["status", "--json"],
      ["validate-state", "--json"],
      ["validate-receipt", "--file", "receipt.json", "--json"],
      ["validate-protocol", "--json"],
    ];
    for (const command of commands) {
      const first = run(target, ...command);
      const second = run(target, ...command);
      assert.equal(first.stdout, second.stdout, command[0]);
      assert.doesNotThrow(() => JSON.parse(first.stdout), command[0]);
    }
    const protocolInfo = JSON.parse(run(target, "protocol-info", "--json").stdout);
    assert.deepEqual(protocolInfo.features.structuralQuality, {
      version: 1,
      supported: true,
      schemaVersion: 1,
      modes: ["off", "observe", "gate"],
      builtInProviders: ["sentrux"],
      commands: ["quality-baseline", "quality-verify", "quality-status"],
      resource: "task/structural-quality",
      providerNeutral: true,
      defaultProvider: "sentrux",
      transport: "mcp-stdio",
      rootCauses: ["modularity", "acyclicity", "depth", "equality", "redundancy"],
      baselineImmutableAfterExecution: true,
      optimizationMaxExtraEvaluations: 2,
    });
  } finally {
    await removeTempTree(target);
  }
});
