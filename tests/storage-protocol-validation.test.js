import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { getPackageRoot } from "../src/core/templates.js";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";

test("public protocol validation reads canonical SQLite artifacts without filesystem mirrors or writes", async () => {
  const { target, taskId } = await buildCanonicalDiagnosisProject();
  try {
    const filename = path.join(target, ".forgeloop/state.sqlite");
    const before = await readFile(filename);
    await assert.rejects(access(path.join(target, ".forgeloop/task-state")), { code: "ENOENT" });
    const result = await executeForgeLoopCommand({ command: "validate-protocol", projectPath: target, input: { task: taskId } });
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0, JSON.stringify(result.result));
    assert.equal(result.result.status, "VALID");
    assert.deepEqual(result.result.errors, []);
    const cli = await promisify(execFile)(process.execPath, [path.join(getPackageRoot(), "src/cli.js"),
      "validate-protocol", "--task", taskId, "--path", target, "--json"]);
    assert.deepEqual(JSON.parse(cli.stdout), result.result);
    assert.deepEqual(await readFile(filename), before);
    await assert.rejects(access(path.join(target, ".forgeloop/task-state")), { code: "ENOENT" });
  } finally {
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
