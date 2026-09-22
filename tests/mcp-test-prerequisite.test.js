import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  checkMcpPrerequisites,
  resolveMcpTestFiles,
  runMcpTests,
} from "../scripts/run-mcp-tests.mjs";

async function makeFixture(withDependencies = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop mcp test-"));
  await mkdir(path.join(root, "tests"), { recursive: true });
  await writeFile(path.join(root, "tests", "fixture.test.js"), "", "utf8");
  if (withDependencies) {
    for (const dependency of ["@modelcontextprotocol/server", "@modelcontextprotocol/client"]) {
      await mkdir(path.join(root, "node_modules", dependency), { recursive: true });
      await writeFile(path.join(root, "node_modules", dependency, "package.json"), "{}", "utf8");
    }
  }
  return root;
}

test("MCP test wrapper reports one actionable prerequisite without installing", async () => {
  const root = await makeFixture();
  const messages = [];
  const originalError = console.error;
  console.error = (...args) => messages.push(args.join(" "));
  try {
    assert.deepEqual((await checkMcpPrerequisites(root)).ok, false);
    assert.equal(await runMcpTests({ root, spawnProcess: () => { throw new Error("must not spawn"); } }), 1);
  } finally {
    console.error = originalError;
    await rm(root, { recursive: true, force: true });
  }
  assert.deepEqual(messages, [
    "MCP dependencies are not installed.",
    "Run: npm run mcp:setup",
  ]);
});

test("MCP test wrapper launches the discovered suite with literal argv and preserves exit codes", async () => {
  const root = await makeFixture(true);
  try {
    const fixturePath = path.join("tests", "fixture.test.js");
    assert.deepEqual(await resolveMcpTestFiles(root), [fixturePath]);
    let invocation;
    const exitCode = await runMcpTests({
      root,
      spawnProcess(command, args, options) {
        invocation = { command, args, options };
        return {
          once(event, callback) {
            if (event === "exit") process.nextTick(() => callback(7, null));
            return this;
          },
        };
      },
    });
    assert.equal(exitCode, 7);
    assert.deepEqual(invocation.args, ["--test", "--test-concurrency=2", fixturePath]);
    assert.equal(invocation.command, process.execPath);
    assert.equal(invocation.options.cwd, root);
    assert.equal(invocation.options.shell, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
