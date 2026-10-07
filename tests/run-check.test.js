import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  classifyCommandResolution,
  E_INSTALLATION_AUTHORITY_REQUIRED,
  E_COMMAND_RESOLUTION_AMBIGUOUS,
} from "../src/core/verification-capability.js";
import { createConfig, writeConfig } from "../src/core/config.js";
import { runCheck } from "../src/commands/run-check.js";
import {
  readExecutionArtifact,
  runCommandExecution,
  validateExecutionBinding,
} from "../src/core/execution.js";
import { executionArtifactPath } from "../src/core/artifacts.js";
import { getPackageRoot } from "../src/core/templates.js";
import { captureVerificationScope } from "../src/core/verification-scope.js";
import { taskVerificationScopePath } from "../src/core/task-paths.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-run-check-"));
  try {
    await ensureFixtureTask(target, "task-1", packageRoot);
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

test("run-check launches the registered scoped checker with exact argv and scope evidence", async () => {
  const target = await createGitRepository("forgeloop-run-check-scope-");
  const taskId = "run-check-scope-001";
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });
    await writeConfig(target, createConfig({
      verification: {
        checkers: [{
          checkId: "unit-tests",
          scopeMode: "PATH_ARGUMENTS",
          argvPrefix: [process.execPath, "--test"],
          pathInsertion: "APPEND",
        }],
      },
    }), packageRoot);
    await writeFile(path.join(target, "src", "index.js"), "export const fixture = false;\n", "utf8");
    await captureVerificationScope(target, { taskId, packageRoot, mode: "CHANGED" });

    const result = await runCheck({
      target,
      packageRoot,
      taskId,
      id: "unit-tests",
      requirement: "postcondition verified",
      scopeRef: taskVerificationScopePath(taskId),
      argv: [process.execPath, "--test", "src/index.js"],
    });

    assert.deepEqual(result.execution.argv, [process.execPath, "--test", "src/index.js"]);
    assert.deepEqual(result.check.details.verificationScope.argv, result.execution.argv);
    assert.equal(result.check.details.verificationScope.mode, "CHANGED");
    assert.equal(result.check.details.verificationScope.checkerId, "unit-tests");
    assert.match(result.check.details.verificationScope.fingerprint, /^[a-f0-9]{64}$/);
    assert.match(result.check.details.verificationScope.checkerCapabilityFingerprint, /^[a-f0-9]{64}$/);
  } finally {
    await removeTempTree(target);
  }
});

test("run-check rejects a scoped argv mismatch before launching a process", async () => {
  const target = await createGitRepository("forgeloop-run-check-scope-mismatch-");
  const taskId = "run-check-scope-mismatch-001";
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });
    await writeConfig(target, createConfig({
      verification: {
        checkers: [{
          checkId: "unit-tests",
          scopeMode: "PATH_ARGUMENTS",
          argvPrefix: [process.execPath, "--test"],
          pathInsertion: "APPEND",
        }],
      },
    }), packageRoot);
    await writeFile(path.join(target, "src", "index.js"), "export const fixture = false;\n", "utf8");
    await captureVerificationScope(target, { taskId, packageRoot, mode: "CHANGED" });

    await assert.rejects(
      () => runCheck({
        target,
        packageRoot,
        taskId,
        id: "unit-tests",
        requirement: "postcondition verified",
        scopeRef: taskVerificationScopePath(taskId),
        argv: [process.execPath, "--test", "wrong.js"],
      }),
      (error) => error.code === "E_VERIFICATION_SCOPE_UNRESOLVED" && error.reason === "ARGV_MISMATCH",
    );
  } finally {
    await removeTempTree(target);
  }
});

test("classifyCommandResolution uses the exact argv vector", () => {
  assert.deepEqual(classifyCommandResolution(["npx", "@liustack/modlens", "image.png"]), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npx",
    tool: "@liustack/modlens",
  });
  assert.deepEqual(classifyCommandResolution(["npx", "--no-install", "@liustack/modlens"]), {
    resolutionMode: "NON_INSTALLING_RESOLUTION",
    mayInstall: false,
    installer: "npx",
    tool: "@liustack/modlens",
  });
});

test("runCommandExecution captures exact argv, target cwd, and non-zero exit", async () => {
  await withTarget(async (target) => {
    const result = await runCommandExecution({
      target,
      packageRoot,
      taskId: "task-1",
      checkId: "tests",
      requirement: "tests",
      verificationCycle: 1,
      argv: [process.execPath, "-e", "process.exit(3)"],
    });

    assert.deepEqual(result.execution.argv, [process.execPath, "-e", "process.exit(3)"]);
    assert.equal(result.execution.cwd, target);
    assert.equal(result.execution.exitCode, 3);
    assert.equal(result.execution.status, "failed");
    assert.match(result.execution.startedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(result.execution.finishedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual((await readExecutionArtifact({
      target,
      executionRef: result.execution.executionId,
      taskId: "task-1",
      packageRoot,
    })).value, result.execution);
  });
});

test("runCommandExecution records bounded output provenance and terminates a timed-out check", async () => {
  await withTarget(async (target) => {
    const output = "before timeout";
    const captured = await runCommandExecution({ target, packageRoot, taskId: "task-1", checkId: "bounded-output",
      requirement: "bounded-output", verificationCycle: 1, timeoutMs: 5000,
      argv: [process.execPath, "-e", "process.stdout.write('before timeout')"] });
    assert.equal(captured.execution.status, "passed");
    assert.equal(captured.execution.stdoutBytes, Buffer.byteLength(output));
    assert.equal(captured.execution.stdoutSha256, createHash("sha256").update(output).digest("hex"));
    assert.equal(captured.execution.outputTruncated, false);
    const result = await runCommandExecution({
      target,
      packageRoot,
      taskId: "task-1",
      checkId: "timeout",
      requirement: "timeout",
      verificationCycle: 1,
      timeoutMs: 150,
      argv: [process.execPath, "-e", "process.stdout.write('before timeout'); setInterval(() => {}, 1000)"],
    });

    assert.equal(result.execution.status, "failed");
    assert.equal(result.execution.termination, "timeout");
    assert.equal(result.execution.exitCode, null);
    assert.equal(result.execution.signal, "SIGTERM");
    assert.ok(result.execution.stdoutBytes === 0 || result.execution.stdoutBytes === Buffer.byteLength(output));
    assert.match(result.execution.stdoutSha256, /^[a-f0-9]{64}$/);
    assert.match(result.execution.stderrSha256, /^[a-f0-9]{64}$/);
    assert.ok(result.execution.durationMs >= 0);
    assert.equal(result.execution.outputTruncated, false);
  });
});

test("runCommandExecution escalates a timed-out process that ignores SIGTERM", async () => {
  await withTarget(async (target) => {
    const started = Date.now();
    const result = await runCommandExecution({
      target,
      packageRoot,
      taskId: "task-1",
      checkId: "timeout-force",
      requirement: "timeout-force",
      verificationCycle: 1,
      timeoutMs: 100,
      argv: [process.execPath, "-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    });
    assert.equal(result.execution.termination, "timeout");
    assert.ok(["SIGTERM", "SIGKILL"].includes(result.execution.signal));
    assert.equal(result.execution.timeoutMs, 100);
    assert.ok(Date.now() - started < 2_000);
  });
});

test("install-capable commands are blocked before process launch without authority", async () => {
  await withTarget(async (target) => {
    await assert.rejects(
      () => runCommandExecution({
        target,
        packageRoot,
        taskId: "task-1",
        checkId: "visual",
        requirement: "visual-verification",
        verificationCycle: 1,
        argv: ["npx", "@liustack/modlens", "image.png"],
      }),
      (error) => error.code === E_INSTALLATION_AUTHORITY_REQUIRED,
    );
    await assert.rejects(
      () => access(path.join(target, executionArtifactPath("exec-blocked"))),
      (error) => error.code === "ENOENT",
    );
  });
});

test("npm exec and npm x without authority are blocked before process launch", async () => {
  await withTarget(async (target) => {
    await assert.rejects(
      () => runCommandExecution({
        target,
        packageRoot,
        taskId: "task-1",
        checkId: "visual",
        requirement: "visual-verification",
        verificationCycle: 1,
        argv: ["npm", "exec", "--", "@liustack/modlens", "image.png"],
      }),
      (error) => error.code === E_INSTALLATION_AUTHORITY_REQUIRED,
    );
    await assert.rejects(
      () => runCommandExecution({
        target,
        packageRoot,
        taskId: "task-1",
        checkId: "visual",
        requirement: "visual-verification",
        verificationCycle: 1,
        argv: ["npm", "x", "@liustack/modlens"],
      }),
      (error) => error.code === E_INSTALLATION_AUTHORITY_REQUIRED,
    );
  });
});

test("positive authorized npm exec proceeds when host authority matches", async () => {
  await withTarget(async (target) => {
    const validAuthority = {
      schemaVersion: 1,
      protocolVersion: 1,
      authorityId: "auth-modlens",
      taskId: "task-1",
      type: "SOFTWARE_INSTALLATION",
      status: "AUTHORIZED",
      scope: { tool: "@liustack/modlens" },
      source: "operator",
    };

    const result = await runCommandExecution({
      target,
      packageRoot,
      taskId: "task-1",
      checkId: "visual",
      requirement: "visual-verification",
      verificationCycle: 1,
      argv: [process.execPath, "-e", "process.exit(0)"],
      details: {
        installationAuthorityRef: "auth-modlens",
      },
      authorityContext: {
        trustMode: "HOST_ATTESTED",
        authorities: { "auth-modlens": validAuthority },
      },
    });

    assert.equal(result.execution.status, "passed");
  });
});

test("nested install-capable npm script without authority is blocked before process launch", async () => {
  await withTarget(async (target) => {
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        test: "npx @liustack/modlens image.png",
      },
    }), "utf8");

    await assert.rejects(
      () => runCommandExecution({
        target,
        packageRoot,
        taskId: "task-1",
        checkId: "tests",
        requirement: "tests",
        verificationCycle: 1,
        argv: ["npm", "test"],
      }),
      (error) => error.code === E_INSTALLATION_AUTHORITY_REQUIRED,
    );
  });
});

test("recursive multi-level npm run without authority is blocked before process launch", async () => {
  await withTarget(async (target) => {
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        test: "npm run visual",
        visual: "npx @liustack/modlens image.png",
      },
    }), "utf8");

    await assert.rejects(
      () => runCommandExecution({
        target,
        packageRoot,
        taskId: "task-1",
        checkId: "tests",
        requirement: "tests",
        verificationCycle: 1,
        argv: ["npm", "test"],
      }),
      (error) => error.code === E_INSTALLATION_AUTHORITY_REQUIRED,
    );
  });
});

test("npm restart fallback without authority is blocked before process launch", async () => {
  await withTarget(async (target) => {
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        start: "npx @liustack/modlens image.png",
      },
    }), "utf8");

    await assert.rejects(
      () => runCommandExecution({
        target,
        packageRoot,
        taskId: "task-1",
        checkId: "tests",
        requirement: "tests",
        verificationCycle: 1,
        argv: ["npm", "restart"],
      }),
      (error) => error.code === E_INSTALLATION_AUTHORITY_REQUIRED,
    );
  });
});

test("npm rum alias without authority is blocked before process launch", async () => {
  await withTarget(async (target) => {
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        visual: "npx @liustack/modlens image.png",
      },
    }), "utf8");

    await assert.rejects(
      () => runCommandExecution({
        target,
        packageRoot,
        taskId: "task-1",
        checkId: "visual",
        requirement: "visual-verification",
        verificationCycle: 1,
        argv: ["npm", "rum", "visual"],
      }),
      (error) => error.code === E_INSTALLATION_AUTHORITY_REQUIRED,
    );
  });
});

test("npm with leading options without authority is blocked before process launch", async () => {
  await withTarget(async (target) => {
    await assert.rejects(
      () => runCommandExecution({
        target,
        packageRoot,
        taskId: "task-1",
        checkId: "visual",
        requirement: "visual-verification",
        verificationCycle: 1,
        argv: ["npm", "--silent", "exec", "--", "@liustack/modlens", "image.png"],
      }),
      (error) => error.code === E_INSTALLATION_AUTHORITY_REQUIRED,
    );
  });
});

test("npm workspace script dispatch is blocked before launch with E_COMMAND_RESOLUTION_AMBIGUOUS", async () => {
  await withTarget(async (target) => {
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        test: "node test.js",
      },
    }), "utf8");

    await assert.rejects(
      () => runCommandExecution({
        target,
        packageRoot,
        taskId: "task-1",
        checkId: "tests",
        requirement: "tests",
        verificationCycle: 1,
        argv: ["npm", "test", "--workspace=a"],
      }),
      (error) => error.code === E_COMMAND_RESOLUTION_AMBIGUOUS,
    );

    await assert.rejects(
      () => runCommandExecution({
        target,
        packageRoot,
        taskId: "task-1",
        checkId: "tests",
        requirement: "tests",
        verificationCycle: 1,
        argv: ["npm", "--workspace=a", "test"],
      }),
      (error) => error.code === E_COMMAND_RESOLUTION_AMBIGUOUS,
    );

    await assert.rejects(
      () => runCommandExecution({
        target,
        packageRoot,
        taskId: "task-1",
        checkId: "visual",
        requirement: "visual-verification",
        verificationCycle: 1,
        argv: ["npm", "run", "visual", "--workspaces"],
      }),
      (error) => error.code === E_COMMAND_RESOLUTION_AMBIGUOUS,
    );
  });
});

test("execution binding rejects a different check", async () => {
  await withTarget(async (target) => {
    const result = await runCommandExecution({
      target,
      packageRoot,
      taskId: "task-1",
      checkId: "tests",
      requirement: "tests",
      verificationCycle: 2,
      argv: [process.execPath, "--version"],
    });

    assert.throws(
      () => validateExecutionBinding({
        execution: result.execution,
        taskId: "task-1",
        checkId: "different-check",
        requirement: "tests",
        verificationCycle: 2,
      }),
      (error) => error.code === "E_EXECUTION_REF_INVALID",
    );
  });
});

test("runCommandExecution throws E_COMMAND_RESOLUTION_AMBIGUOUS for unclassified npm commands without spawning", async () => {
  await withTarget(async (target) => {
    try {
      await runCommandExecution({
        target,
        packageRoot,
        taskId: "task-frobnicate",
        checkId: "check-npm",
        requirement: "matrix",
        argv: ["npm", "frobnicate"],
      });
      assert.fail("Should throw E_COMMAND_RESOLUTION_AMBIGUOUS");
    } catch (err) {
      assert.equal(err.code, E_COMMAND_RESOLUTION_AMBIGUOUS);
      assert.equal(err.resolution.reason, "NPM_COMMAND_UNCLASSIFIED");
    }
  });
});

test("npm version fails closed before process launch", async () => {
  await withTarget(async (target) => {
    const sentinel = path.join(target, "npm-version-spawned.txt");
    const fakeNpm = path.join(target, process.platform === "win32" ? "npm.cmd" : "npm");
    const script = process.platform === "win32"
      ? `@echo spawned>"${sentinel}"\r\n@exit /b 0\r\n`
      : `#!/bin/sh\nprintf spawned > "${sentinel}"\n`;
    await writeFile(fakeNpm, script, "utf8");
    if (process.platform !== "win32") await chmod(fakeNpm, 0o755);

    let rejection;
    try {
      await runCommandExecution({
        target,
        packageRoot,
        taskId: "task-version",
        checkId: "check-npm-version",
        requirement: "npm version remains fail closed",
        argv: [fakeNpm, "version", "patch"],
      });
    } catch (error) {
      rejection = error;
    }

    await assert.rejects(() => access(sentinel), (error) => error.code === "ENOENT");
    await assert.rejects(
      () => access(path.join(target, ".forgeloop", "executions")),
      (error) => error.code === "ENOENT",
    );
    await assert.rejects(
      () => access(path.join(target, ".forgeloop", "work-state.json")),
      (error) => error.code === "ENOENT",
    );
    await assert.rejects(
      () => access(path.join(target, ".forgeloop", "execution-receipt.json")),
      (error) => error.code === "ENOENT",
    );
    assert.equal(rejection?.code, E_COMMAND_RESOLUTION_AMBIGUOUS);
    assert.equal(rejection?.resolution?.reason, "NPM_COMMAND_UNCLASSIFIED");
  });
});

test("runCommandExecution throws E_COMMAND_RESOLUTION_AMBIGUOUS for npm option ambiguity without spawning", async () => {
  await withTarget(async (target) => {
    try {
      await runCommandExecution({
        target,
        packageRoot,
        taskId: "task-scope",
        checkId: "check-npm",
        requirement: "matrix",
        argv: ["npm", "--scope", "@mycorp", "exec", "--", "package"],
      });
      assert.fail("Should throw E_COMMAND_RESOLUTION_AMBIGUOUS");
    } catch (err) {
      assert.equal(err.code, E_COMMAND_RESOLUTION_AMBIGUOUS);
      assert.equal(err.resolution.reason, "NPM_OPTION_VALUE_AMBIGUOUS");
    }
  });
});
