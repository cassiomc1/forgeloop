import { removeTempTree } from "./helpers/rm-safe.js";
import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  E_VERIFICATION_EXECUTION_INVALID,
  E_VERIFICATION_ISOLATION_UNAVAILABLE,
  normalizeVerificationExecutionResult,
} from "../src/core/verification-execution.js";
import { validateCheckExecutionProvenance } from "../src/core/completion-artifacts.js";
import { readExecutionArtifact, runCommandExecution } from "../src/core/execution.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-verification-isolation-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

function isolatedResult(overrides = {}) {
  return {
    cwd: "/disposable/verification-workspace",
    isolation: {
      mode: "PROJECT_ISOLATED",
      isolated: true,
      liveProjectWritable: false,
      networkPolicy: "DENIED",
      environmentPolicy: "ISOLATED",
    },
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "verified\n",
    stderr: "",
    stdoutBytes: 10,
    stderrBytes: 0,
    outputTruncated: false,
    ...overrides,
  };
}

test("verification uses one trusted adapter call and binds the disposable cwd", async () => {
  await withTarget(async (target) => {
    const calls = [];
    const adapter = {
      execute: async (request) => {
        calls.push(request);
        return isolatedResult();
      },
    };

    await ensureFixtureTask(target, "task-isolation", packageRoot);
    const result = await runCommandExecution({
      target,
      packageRoot,
      taskId: "task-isolation",
      checkId: "check-isolation",
      requirement: "verification runs outside the live project",
      argv: [process.execPath, "-e", "process.exit(0)"],
      timeoutMs: 500,
      runtimeContext: {
        verificationExecutionAdapter: adapter,
        verificationExecutionPolicy: { requiredIsolation: "PROJECT_ISOLATED" },
      },
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      argv: [process.execPath, "-e", "process.exit(0)"],
      protocolProjectRoot: target,
      taskId: "task-isolation",
      checkId: "check-isolation",
      requirement: "verification runs outside the live project",
      timeoutMs: 500,
      resolution: result.execution.resolution,
    });
    assert.equal(result.execution.executionKind, "VERIFICATION");
    assert.equal(result.execution.protocolProjectRoot, target);
    assert.equal(result.execution.cwd, "/disposable/verification-workspace");
    assert.equal(result.execution.executionIsolation, "PROJECT_ISOLATED");
    assert.deepEqual(result.execution.isolation, isolatedResult().isolation);

    const artifact = await readExecutionArtifact({
      target,
      taskId: "task-isolation",
      executionRef: result.execution.executionId,
      packageRoot,
    });
    assert.deepEqual(artifact.value, result.execution);

    const provenance = await validateCheckExecutionProvenance({
      id: "check-isolation",
      kind: "command",
      evidenceKind: "OBSERVED",
      provenance: "FORGELOOP_EXECUTED",
      executionRef: result.execution.executionId,
      requirement: "verification runs outside the live project",
      status: "passed",
      details: { verificationCycle: 1 },
    }, {
      target,
      taskId: "task-isolation",
      executionArtifacts: { [result.execution.executionId]: result.execution },
    });
    assert.equal(provenance.cwd, "/disposable/verification-workspace");
  });
});

test("required isolation fails closed without an adapter and writes no execution artifact", async () => {
  await withTarget(async (target) => {
    await assert.rejects(
      () => runCommandExecution({
        target,
        packageRoot,
        taskId: "task-isolation-required",
        checkId: "check-required",
        requirement: "verification isolation is mandatory",
        argv: [process.execPath, "-e", "process.exit(0)"],
        runtimeContext: {
          verificationExecutionPolicy: { requiredIsolation: "PROJECT_ISOLATED" },
        },
      }),
      (error) => error.code === E_VERIFICATION_ISOLATION_UNAVAILABLE,
    );
  });
});

test("standalone native fallback is explicit and never claims isolation", async () => {
  await withTarget(async (target) => {
    await ensureFixtureTask(target, "task-native", packageRoot);
    const result = await runCommandExecution({
      target,
      packageRoot,
      taskId: "task-native",
      checkId: "check-native",
      requirement: "native fallback is labeled",
      argv: [process.execPath, "-e", "process.exit(0)"],
    });

    assert.equal(result.execution.executionKind, "VERIFICATION");
    assert.equal(result.execution.protocolProjectRoot, target);
    assert.equal(result.execution.cwd, target);
    assert.equal(result.execution.executionIsolation, "NATIVE_PROJECT");
    assert.deepEqual(result.execution.isolation, {
      mode: "NATIVE_PROJECT",
      isolated: false,
      liveProjectWritable: true,
      networkPolicy: "INHERITED",
      environmentPolicy: "INHERITED",
    });
  });
});

test("adapter output preserves timeout, termination, hashes, and truncation", async () => {
  await withTarget(async (target) => {
    await ensureFixtureTask(target, "task-timeout", packageRoot);
    const result = await runCommandExecution({
      target,
      packageRoot,
      taskId: "task-timeout",
      checkId: "check-timeout",
      requirement: "adapter timeout is observable",
      argv: [process.execPath, "-e", "process.exit(0)"],
      runtimeContext: {
        verificationExecutionAdapter: {
          execute: async () => isolatedResult({
            exitCode: null,
            signal: "SIGTERM",
            timedOut: true,
            stdout: "partial",
            stderr: "diagnostic",
            stdoutBytes: 7,
            stderrBytes: 9,
            outputTruncated: true,
          }),
        },
        verificationExecutionPolicy: { requiredIsolation: "PROJECT_ISOLATED" },
      },
    });

    assert.equal(result.execution.status, "failed");
    assert.equal(result.execution.termination, "timeout");
    assert.equal(result.execution.exitCode, null);
    assert.equal(result.execution.signal, "SIGTERM");
    assert.equal(result.execution.stdoutBytes, 7);
    assert.equal(result.execution.stderrBytes, 9);
    assert.equal(result.execution.outputTruncated, true);
    assert.match(result.execution.stdoutSha256, /^[a-f0-9]{64}$/);
    assert.match(result.execution.stderrSha256, /^[a-f0-9]{64}$/);
  });
});

test("malformed adapter isolation fails closed before artifact persistence", async () => {
  await withTarget(async (target) => {
    await assert.rejects(
      () => runCommandExecution({
        target,
        packageRoot,
        taskId: "task-invalid",
        checkId: "check-invalid",
        requirement: "malformed isolation is rejected",
        argv: [process.execPath, "-e", "process.exit(0)"],
        runtimeContext: {
          verificationExecutionAdapter: {
            execute: async () => ({ exitCode: 0, cwd: "/disposable" }),
          },
          verificationExecutionPolicy: { requiredIsolation: "PROJECT_ISOLATED" },
        },
      }),
      (error) => error.code === E_VERIFICATION_EXECUTION_INVALID,
    );
  });
});

test("contradictory isolation metadata is rejected intrinsically", async () => {
  await withTarget(async (target) => {
    const base = {
      cwd: "/disposable/verification-workspace",
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "verified\n",
      stderr: "",
      outputTruncated: false,
    };
    const contradictions = [
      {
        mode: "NATIVE_PROJECT",
        isolated: true,
        liveProjectWritable: true,
        networkPolicy: "INHERITED",
        environmentPolicy: "INHERITED",
      },
      {
        mode: "NATIVE_PROJECT",
        isolated: false,
        liveProjectWritable: false,
        networkPolicy: "INHERITED",
        environmentPolicy: "INHERITED",
      },
      {
        mode: "PROJECT_ISOLATED",
        isolated: false,
        liveProjectWritable: false,
        networkPolicy: "DENIED",
        environmentPolicy: "ISOLATED",
      },
      {
        mode: "PROJECT_ISOLATED",
        isolated: true,
        liveProjectWritable: true,
        networkPolicy: "DENIED",
        environmentPolicy: "ISOLATED",
      },
      {
        mode: "SYSTEM_ISOLATED",
        isolated: true,
        liveProjectWritable: true,
        networkPolicy: "DENIED",
        environmentPolicy: "ISOLATED",
      },
      {
        mode: "SYSTEM_ISOLATED",
        isolated: true,
        liveProjectWritable: false,
        networkPolicy: "INHERITED",
        environmentPolicy: "ISOLATED",
      },
    ];
    for (const isolation of contradictions) {
      assert.throws(
        () => normalizeVerificationExecutionResult({ ...base, isolation }),
        (error) => error.code === E_VERIFICATION_EXECUTION_INVALID,
        `isolation ${JSON.stringify(isolation)} must be rejected intrinsically`,
      );
    }
  });
});

test("canonical isolation metadata combinations remain valid", async () => {
  await withTarget(async (target) => {
    const base = {
      cwd: "/disposable/verification-workspace",
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "verified\n",
      stderr: "",
      outputTruncated: false,
    };
    const canonical = [
      {
        mode: "NATIVE_PROJECT",
        isolated: false,
        liveProjectWritable: true,
        networkPolicy: "INHERITED",
        environmentPolicy: "INHERITED",
      },
      {
        mode: "PROJECT_ISOLATED",
        isolated: true,
        liveProjectWritable: false,
        networkPolicy: "INHERITED",
        environmentPolicy: "ISOLATED",
      },
      {
        mode: "PROJECT_ISOLATED",
        isolated: true,
        liveProjectWritable: false,
        networkPolicy: "DENIED",
        environmentPolicy: "ISOLATED",
      },
      {
        mode: "SYSTEM_ISOLATED",
        isolated: true,
        liveProjectWritable: false,
        networkPolicy: "DENIED",
        environmentPolicy: "ISOLATED",
      },
    ];
    for (const isolation of canonical) {
      const normalized = normalizeVerificationExecutionResult({ ...base, isolation });
      assert.deepEqual(normalized.isolation, isolation);
    }
  });
});

test("adapter-reported contradictory isolation fails closed before artifact persistence", async () => {
  await withTarget(async (target) => {
    await assert.rejects(
      () => runCommandExecution({
        target,
        packageRoot,
        taskId: "task-contradictory",
        checkId: "check-contradictory",
        requirement: "contradictory isolation must never persist",
        argv: [process.execPath, "-e", "process.exit(0)"],
        runtimeContext: {
          verificationExecutionAdapter: {
            execute: async () => isolatedResult({
              isolation: {
                mode: "SYSTEM_ISOLATED",
                isolated: true,
                liveProjectWritable: true,
                networkPolicy: "DENIED",
                environmentPolicy: "ISOLATED",
              },
            }),
          },
          verificationExecutionPolicy: { requiredIsolation: "SYSTEM_ISOLATED" },
        },
      }),
      (error) => error.code === E_VERIFICATION_EXECUTION_INVALID,
    );
  });
});

test("isolated verification cannot claim the live protocol root as its cwd", async () => {
  await withTarget(async (target) => {
    await assert.rejects(
      () => runCommandExecution({
        target,
        packageRoot,
        taskId: "task-cwd",
        checkId: "check-cwd",
        requirement: "isolated cwd is separate",
        argv: [process.execPath, "-e", "process.exit(0)"],
        runtimeContext: {
          verificationExecutionAdapter: {
            execute: async () => isolatedResult({ cwd: target }),
          },
          verificationExecutionPolicy: { requiredIsolation: "PROJECT_ISOLATED" },
        },
      }),
      (error) => error.code === E_VERIFICATION_EXECUTION_INVALID,
    );
  });
});
