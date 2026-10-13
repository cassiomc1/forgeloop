import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const execFileAsync = promisify(execFile);
const packageRoot = process.cwd();

async function runCliJson(args) {
  const { stdout } = await execFileAsync(process.execPath, [path.join(packageRoot, "src/cli.js"), ...args], {
    cwd: packageRoot,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

test("CLI --json output matches the programmatic runtime result for read commands", async () => {
  const target = await mkdtemp(path.join(tmpdir(), "forgeloop-cli-runtime-parity-"));
  try {
    for (const command of ["protocol-info", "task-list"]) {
      const cliResult = await runCliJson([command, "--path", target, "--json"]);
      const envelope = await executeForgeLoopCommand({ command, projectPath: target });

      assert.equal(envelope.ok, true, `${command}: ${envelope.error?.message}`);
      // Presentation-only fields are normalized away.
      const { packageVersion: _cliVersion, ...cliCore } = cliResult;
      const { packageVersion: _rtVersion, ...runtimeCore } = envelope.result;
      if (command === "task-list") {
        assert.deepEqual(runtimeCore.tasks, cliCore.tasks);
      }
    }
  } finally {
    await removeTempTree(target);
  }
});

test("CLI exit codes match runtime exit codes for domain outcomes", async () => {
  const target = await mkdtemp(path.join(tmpdir(), "forgeloop-cli-runtime-parity-exit-"));
  try {
    const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "parity-domain", claims: [] } });
    assert.equal(created.ok, true, JSON.stringify(created));
    let cliExit = 0;
    try {
      await runCliJson(["preflight", "--path", target, "--json"]);
    } catch (error) {
      cliExit = error.code ?? 1;
    }
    const envelope = await executeForgeLoopCommand({ command: "preflight", projectPath: target });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.exitCode === 0 ? 0 : 1, cliExit === 0 ? 0 : 1);

    const nextEnvelope = await executeForgeLoopCommand({ command: "next", projectPath: target });
    const cliNext = await runCliJson(["next", "--path", target, "--json"]);
    assert.equal(nextEnvelope.result.nextAction, cliNext.nextAction);
  } finally {
    await removeTempTree(target);
  }
});
