import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers";

import {
  OPENSRC_PROCESS_LIMITS,
  parseOpenSrcVersion,
  runOpenSrcCommand,
} from "../src/adapters/opensrc/process.js";
import {
  E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
  E_ADVISORY_CONTEXT_PROVIDER_INVALID,
  E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE,
  E_ADVISORY_CONTEXT_RESULT_INVALID,
  E_ADVISORY_CONTEXT_TIMEOUT,
} from "../src/core/error-codes.js";
import { removeTempTree } from "./helpers/rm-safe.js";

async function withProject(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-opensrc-process-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

function scriptedSpawn(script) {
  return (_executable, _args, options) => spawn(process.execPath, ["-e", script], options);
}

function fakeChild({ stdoutChunks = [], exitCode = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.resume = () => {};
  child.stderr.resume = () => {};
  child.kill = () => true;
  setImmediate(() => {
    for (const chunk of stdoutChunks) child.stdout.emit("data", Buffer.from(chunk));
    child.emit("close", exitCode, null);
  });
  return child;
}

test("process runner keeps shell disabled and forwards argv", async () => {
  await withProject(async (target) => {
    const calls = [];
    const wrapped = (executable, args, options) => {
      calls.push({ executable, args: [...args], shell: options.shell, cwd: options.cwd });
      return spawn(process.execPath, ["-e", "process.stdout.write('/abs/path')"], options);
    };
    const result = await runOpenSrcCommand("/opt/opensrc/bin/opensrc", ["path", "zod", "--cwd", target], {
      cwd: target,
      timeoutMs: 5000,
      spawnImpl: wrapped,
    });
    assert.equal(result.stdout, "/abs/path");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].executable, "/opt/opensrc/bin/opensrc");
    assert.deepEqual(calls[0].args, ["path", "zod", "--cwd", target]);
    assert.equal(calls[0].shell, false);
    assert.equal(calls[0].cwd, target);
  });
});

test("process runner requires an absolute executable", async () => {
  assert.throws(
    () => runOpenSrcCommand("opensrc", ["--version"], { cwd: "/tmp", timeoutMs: 1000, spawnImpl: () => fakeChild() }),
    (error) => error.code === E_ADVISORY_CONTEXT_PROVIDER_INVALID,
  );
});

test("missing executable maps to unavailable", async () => {
  await withProject(async (target) => {
    await assert.rejects(
      runOpenSrcCommand("/nonexistent-opensrc-binary", ["--version"], { cwd: target, timeoutMs: 2000 }),
      (error) => error.code === E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE,
    );
  });
});

test("spawn throw maps to unavailable", async () => {
  await withProject(async (target) => {
    const throwing = () => {
      const error = new Error("spawn failed");
      error.code = "ENOENT";
      throw error;
    };
    assert.throws(
      () => runOpenSrcCommand("/opt/opensrc/bin/opensrc", ["--version"], { cwd: target, timeoutMs: 1000, spawnImpl: throwing }),
      (error) => error.code === E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE,
    );
  });
});

test("non-zero exit maps to result invalid without stderr text", async () => {
  await withProject(async (target) => {
    const failing = scriptedSpawn("process.stderr.write('SECRET-TOKEN-abc123'); process.exitCode = 1;");
    await assert.rejects(
      runOpenSrcCommand("/opt/opensrc/bin/opensrc", ["path", "zod"], { cwd: target, timeoutMs: 5000, spawnImpl: failing }),
      (error) => error.code === E_ADVISORY_CONTEXT_RESULT_INVALID && !String(error.message).includes("SECRET-TOKEN"),
    );
  });
});

test("timeout terminates and maps to timeout", async () => {
  await withProject(async (target) => {
    const hanging = () => fakeChild({ stdoutChunks: [] });
    const neverClose = new EventEmitter();
    neverClose.stdout = new EventEmitter();
    neverClose.stderr = new EventEmitter();
    neverClose.stdout.resume = () => {};
    neverClose.stderr.resume = () => {};
    neverClose.kill = () => true;
    void hanging;
    await assert.rejects(
      runOpenSrcCommand("/opt/opensrc/bin/opensrc", ["--version"], {
        cwd: target,
        timeoutMs: 50,
        spawnImpl: () => neverClose,
      }),
      (error) => error.code === E_ADVISORY_CONTEXT_TIMEOUT,
    );
  });
});

test("stdout overflow maps to output limit", async () => {
  await withProject(async (target) => {
    const flooding = () => fakeChild({ stdoutChunks: ["x".repeat(70000)] });
    await assert.rejects(
      runOpenSrcCommand("/opt/opensrc/bin/opensrc", ["--version"], { cwd: target, timeoutMs: 5000, spawnImpl: flooding }),
      (error) => error.code === E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
    );
  });
});

test("stderr overflow maps to output limit", async () => {
  await withProject(async (target) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.resume = () => {};
    child.stderr.resume = () => {};
    child.kill = () => true;
    setImmediate(() => {
      child.stderr.emit("data", Buffer.from("y".repeat(70000)));
      child.emit("close", 0, null);
    });
    await assert.rejects(
      runOpenSrcCommand("/opt/opensrc/bin/opensrc", ["--version"], { cwd: target, timeoutMs: 5000, spawnImpl: () => child }),
      (error) => error.code === E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
    );
  });
});

test("process limits stay bounded", () => {
  assert.equal(OPENSRC_PROCESS_LIMITS.maxStdoutBytes, 64 * 1024);
  assert.equal(OPENSRC_PROCESS_LIMITS.maxStderrBytes, 64 * 1024);
  assert.equal(OPENSRC_PROCESS_LIMITS.terminationGraceMs, 250);
});

test("version parser qualifies opensrc output", () => {
  assert.equal(parseOpenSrcVersion("opensrc 0.7.3\n"), "0.7.3");
  assert.throws(
    () => parseOpenSrcVersion("something else"),
    (error) => error.code === E_ADVISORY_CONTEXT_RESULT_INVALID,
  );
  assert.throws(
    () => parseOpenSrcVersion(null),
    (error) => error.code === E_ADVISORY_CONTEXT_RESULT_INVALID,
  );
});
