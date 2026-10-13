import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const worker = fileURLToPath(new URL("./helpers/task-scope-git-boundary-worker.mjs", import.meta.url));

test("public task-scope Git inspection leaves the SQLite writer available", async () => {
  const { stdout } = await execute(process.execPath, [worker], {
    timeout: 15000,
    windowsHide: true,
  });
  assert.deepEqual(JSON.parse(stdout), { observations: ["before", "after"], claims: ["src"] });
});
