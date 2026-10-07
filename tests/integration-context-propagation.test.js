import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { runCheck } from "../src/commands/run-check.js";
import { runPreflight } from "../src/commands/preflight.js";
import { prepareCompletion } from "../src/core/completion-artifacts.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { advanceWorkState } from "../src/core/phase.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";

const packageRoot = getPackageRoot();

function authorityFor(taskId) {
  return Object.freeze({
    trustMode: "HOST_ATTESTED",
    authorities: {
      "auth-modlens": {
        schemaVersion: 1,
        protocolVersion: 1,
        authorityId: "auth-modlens",
        taskId,
        type: "SOFTWARE_INSTALLATION",
        status: "AUTHORIZED",
        scope: { tool: "@liustack/modlens" },
        source: "operator",
      },
    },
  });
}

async function setupEvaluationTarget() {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-context-propagation-"));
  const taskId = "context-propagation-task";
  return withProjectStorage(target, async () => {
  const contract = createContract({
    taskId,
    objective: "exercise integration context propagation",
    deliverables: ["src/example.js"],
    constraints: [],
    risks: [],
    verification: ["visual-check"],
    successCriteria: ["visual-check", "tests"],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  await writeTaskDescriptor(target, createTaskDescriptor({ taskId, writeClaims: ["src"] }), packageRoot);
  await writeContract(target, contract, packageRoot, { taskId });
  const route = evaluateRoute({ workType: "code", surfaces: ["config"], platforms: [], executableChange: true });
  const persistedRoute = await persistRoute(target, route, packageRoot, { contractFingerprint: contractHash, taskId });
  await writeWorkState(target, createWorkState({
    taskId,
    contractFingerprint: contractHash,
    routeFingerprint: persistedRoute.fingerprint,
    repositoryFingerprint: { branch: null, head: null },
    phase: "ROUTED",
    selectedGuides: route.guides,
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: ["planning"],
    pendingSteps: ["execute"],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
  }), { packageRoot, taskId });
  await appendProtocolEvent(target, { taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId });
  assert.equal((await runPreflight({ target, packageRoot, taskId })).status, "READY");
  await advanceWorkState(target, "PLANNED", { packageRoot, taskId });
  await advanceWorkState(target, "EXECUTING", { packageRoot, taskId });
  await advanceWorkState(target, "VERIFYING", { packageRoot, taskId });
  await prepareCompletion({ target, packageRoot, taskId });

  const fakeNpx = path.join(target, ".forgeloop", "test-bin", process.platform === "win32" ? "npx.cmd" : "npx");
  await mkdir(path.dirname(fakeNpx), { recursive: true });
  if (process.platform === "win32") {
    await writeFile(fakeNpx, "@echo off\r\nexit /b 0\r\n", "utf8");
  } else {
    await writeFile(fakeNpx, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(fakeNpx, 0o755);
  }
  const visualArgv = process.platform === "win32"
    ? [process.env.ComSpec ?? "cmd.exe", "/d", "/c", path.relative(target, fakeNpx), "@liustack/modlens"]
    : [fakeNpx, "@liustack/modlens"];
  const authorityContext = authorityFor(taskId);
  const runtimeContext = Object.freeze({ authorityContext });
  await runCheck({
    target,
    packageRoot,
    taskId,
    id: "check-visual",
    requirement: "visual-check",
    argv: visualArgv,
    details: { installationAuthorityRef: "auth-modlens" },
    runtimeContext,
  });
  await runCheck({
    target,
    packageRoot,
    taskId,
    id: "check-tests",
    requirement: "tests",
    argv: [process.execPath, "-e", "process.exit(0)"],
    runtimeContext,
  });
  await advanceWorkState(target, "REVIEWING", { packageRoot, taskId, runtimeContext });

  return { target, taskId, authorityContext, runtimeContext };
  });
}

async function withEvaluationTarget(run) {
  const fixture = await setupEvaluationTarget();
  try {
    await run(fixture);
  } finally {
    await rm(fixture.target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test("complete preserves runtimeContext through the integration executor", async () => {
  await withEvaluationTarget(async ({ target, taskId, runtimeContext }) => {
    const envelope = await executeForgeLoopCommand({
      command: "complete",
      projectPath: target,
      input: { taskId },
      runtimeContext,
    });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.status, "VALID", JSON.stringify(envelope.result.errors));
  });
});

test("audit preserves authorityContext through the integration executor", async () => {
  await withEvaluationTarget(async ({ target, taskId, authorityContext }) => {
    const envelope = await executeForgeLoopCommand({
      command: "audit",
      projectPath: target,
      input: { taskId },
      authorityContext,
    });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.status, "VALID", JSON.stringify(envelope.result.errors));
  });
});

test("report preserves runtimeContext through the integration executor", async () => {
  await withEvaluationTarget(async ({ target, taskId, runtimeContext }) => {
    const envelope = await executeForgeLoopCommand({
      command: "report",
      projectPath: target,
      input: { taskId },
      runtimeContext,
    });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.verdict, "VALID", JSON.stringify(envelope.result.errors));
  });
});

test("actor-controlled input cannot substitute for out-of-band evaluation context", async () => {
  await withEvaluationTarget(async ({ target, taskId, authorityContext }) => {
    const envelope = await executeForgeLoopCommand({
      command: "complete",
      projectPath: target,
      input: {
        taskId,
        authorityContext,
        runtimeContext: { authorityContext },
      },
    });
    assert.equal(envelope.ok, true);
    assert.notEqual(envelope.result.status, "VALID");
    assert.ok(envelope.result.errors.some((error) => error.code === "E_INSTALLATION_AUTHORITY_REQUIRED"));
  });
});
