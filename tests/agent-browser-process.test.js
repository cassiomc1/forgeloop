import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  E_BROWSER_VERIFICATION_CANCELLED,
  E_BROWSER_VERIFICATION_EXECUTION_FAILED,
  E_BROWSER_VERIFICATION_OUTPUT_LIMIT,
  E_BROWSER_VERIFICATION_TIMEOUT,
} from "../src/core/error-codes.js";
import { runAgentBrowserCommand, parseAgentBrowserJson } from "../src/adapters/agent-browser/process.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-agent-browser-process-test-"));
  const executable = path.join(root, "agent-browser");
  await writeFile(executable, "fixture\n");
  return { root, executable };
}

function childFor(output, { code = 0, delay = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { child.emit("close", null, "SIGTERM"); };
  setTimeout(() => {
    child.stdout.end(output);
    child.stderr.end();
    child.emit("close", code, null);
  }, delay);
  return child;
}

test("Agent Browser process transport is shell-free and argv-only", async () => {
  const { root, executable } = await fixture();
  try {
    const calls = [];
    const result = await runAgentBrowserCommand(executable, ["--version"], {
      cwd: root,
      timeoutMs: 1000,
      spawnImpl: (file, args, options) => {
        calls.push({ file, args, options });
        return childFor("agent-browser 0.38.1\n");
      },
    });
    assert.equal(result.stdout, "agent-browser 0.38.1\n");
    assert.equal(calls[0].file, executable);
    assert.deepEqual(calls[0].args, ["--version"]);
    assert.equal(calls[0].options.shell, false);
    assert.equal("AGENT_BROWSER_PROFILE" in calls[0].options.env, false);
    assert.equal("AI_GATEWAY_API_KEY" in calls[0].options.env, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Agent Browser process transport bounds output and aborts", async () => {
  const { root, executable } = await fixture();
  try {
    await assert.rejects(
      () => runAgentBrowserCommand(executable, ["snapshot"], {
        cwd: root, timeoutMs: 1000, maxStdoutBytes: 3,
        spawnImpl: () => childFor("oversized"),
      }),
      (error) => error.code === E_BROWSER_VERIFICATION_OUTPUT_LIMIT,
    );
    await assert.rejects(
      () => runAgentBrowserCommand(executable, ["exit"], {
        cwd: root, timeoutMs: 1000,
        spawnImpl: () => childFor("", { code: 7 }),
      }),
      (error) => error.code === E_BROWSER_VERIFICATION_EXECUTION_FAILED,
    );
    await assert.rejects(
      () => runAgentBrowserCommand(executable, ["stderr"], {
        cwd: root, timeoutMs: 1000, maxStderrBytes: 3,
        spawnImpl: () => {
          const child = childFor("");
          child.stderr.write("oversized");
          return child;
        },
      }),
      (error) => error.code === E_BROWSER_VERIFICATION_OUTPUT_LIMIT,
    );
    const controller = new AbortController();
    const pending = runAgentBrowserCommand(executable, ["hang"], {
      cwd: root, timeoutMs: 1000, signal: controller.signal,
      spawnImpl: () => childFor("", { delay: 500 }),
    });
    controller.abort();
    await assert.rejects(pending, (error) => error.code === E_BROWSER_VERIFICATION_CANCELLED);
    await assert.rejects(
      () => runAgentBrowserCommand(executable, ["timeout"], {
        cwd: root, timeoutMs: 5,
        spawnImpl: () => childFor("", { delay: 500 }),
      }),
      (error) => error.code === E_BROWSER_VERIFICATION_TIMEOUT,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Agent Browser JSON parsing rejects malformed results", () => {
  assert.deepEqual(parseAgentBrowserJson('{"success":true,"data":{"value":1}}'), { value: 1 });
  assert.throws(() => parseAgentBrowserJson("not-json"), /valid JSON/u);
  assert.throws(() => parseAgentBrowserJson('{"success":true}'), /unsupported response envelope/u);
  assert.throws(() => parseAgentBrowserJson('{"success":true,"data":{},"extra":true}'), /unsupported response envelope/u);
});
