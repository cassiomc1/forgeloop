import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  parseRipwireVersion,
  runRipwireCommand,
} from "../src/adapters/ripwire/process.js";
import {
  E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
  E_ADVISORY_CONTEXT_TIMEOUT,
  E_ADVISORY_CONTEXT_RESULT_INVALID,
} from "../src/core/error-codes.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(repositoryRoot, "tests/fixtures/ripwire/fake-ripwire.mjs");

function fixtureSpawn(executable, args, options) {
  return spawn(process.execPath, [fixturePath, ...args], options);
}

async function withProject(callback) {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "forgeloop-ripwire-process-"));
  try {
    return await callback(projectPath);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
}

test("runRipwireCommand uses shell-free argv and returns bounded transport measurements", async () => {
  await withProject(async (projectPath) => {
    const result = await runRipwireCommand("/opt/ripwire", ["--version"], {
      cwd: projectPath,
      timeoutMs: 1000,
      spawnImpl: (executable, args, options) => {
        assert.equal(executable, "/opt/ripwire");
        assert.deepEqual(args, ["--version"]);
        assert.equal(options.shell, false);
        assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
        return fixtureSpawn(executable, args, options);
      },
    });
    assert.match(result.stdout, /^ripwire 0\.3\.8/u);
    assert.ok(result.stdoutBytes > 0);
    assert.equal(typeof result.durationMs, "number");
  });
});

test("runRipwireCommand rejects stdout and stderr overflow without exposing bytes", async () => {
  await withProject(async (projectPath) => {
    await assert.rejects(
      () => runRipwireCommand("/opt/ripwire", ["--for=__flood_stdout__"], {
        cwd: projectPath,
        timeoutMs: 1000,
        spawnImpl: fixtureSpawn,
      }),
      (error) => error.code === E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
    );
    await assert.rejects(
      () => runRipwireCommand("/opt/ripwire", ["--for=__flood_stderr__"], {
        cwd: projectPath,
        timeoutMs: 1000,
        spawnImpl: fixtureSpawn,
      }),
      (error) => error.code === E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
    );
  });
});

test("runRipwireCommand stops a timed out child and maps nonzero exits safely", async () => {
  await withProject(async (projectPath) => {
    await assert.rejects(
      () => runRipwireCommand("/opt/ripwire", ["--for=__hang__"], {
        cwd: projectPath,
        timeoutMs: 80,
        spawnImpl: fixtureSpawn,
      }),
      (error) => error.code === E_ADVISORY_CONTEXT_TIMEOUT,
    );
    await assert.rejects(
      () => runRipwireCommand("/opt/ripwire", ["--for=__exit_failure__"], {
        cwd: projectPath,
        timeoutMs: 1000,
        spawnImpl: fixtureSpawn,
      }),
      (error) => error.code === E_ADVISORY_CONTEXT_RESULT_INVALID
        && !error.message.includes("fixture failure detail"),
    );
  });
});

test("version parsing requires the Ripwire prefix and preserves the exact token", () => {
  assert.equal(parseRipwireVersion("ripwire 0.3.8 (fixture)\n"), "0.3.8");
  assert.throws(
    () => parseRipwireVersion("tool 0.3.8"),
    (error) => error.code === E_ADVISORY_CONTEXT_RESULT_INVALID,
  );
});
