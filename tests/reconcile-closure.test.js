import { readFixtureText, overwriteFixtureText } from "./helpers/native-storage-fixture.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runReconcileClosure } from "../src/core/reconcile-closure.js";
import { runPreflight } from "../src/commands/preflight.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent, readEvents } from "../src/core/events.js";
import { advanceWorkState } from "../src/core/phase.js";
import { runComplete } from "../src/commands/complete.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState, readWorkState } from "../src/core/work-state.js";
import { prepareCompletion, recordCheck as recordCheckArtifact } from "../src/core/completion-artifacts.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { currentRepositoryFingerprint } from "../src/core/repository.js";
import { resolveTaskClaimState } from "../src/core/task-claim-state.js";
import { sha256 } from "../src/core/manifest.js";

const root = path.resolve(".");
const cliPath = path.join(root, "src", "cli.js");
const packageRoot = getPackageRoot();

function runCli(target, ...args) {
  return spawnSync(process.execPath, [cliPath, "--path", target, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

async function rimrafWithRetry(target) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error?.code;
      const isTransient = code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
      if (!isTransient || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)));
    }
  }
}

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-reconcile-closure-"));
  try {
    await run(target);
  } finally {
    await rimrafWithRetry(target);
  }
}

const STALE_HEAD = "d6b8991dd0da318543a17d0d1c537687567992d1";

async function setupStaleExecutingTask(target, options = {}) {
  const taskId = options.taskId ?? "stale-executing-task";
  const phase = options.phase ?? "EXECUTING";
  const previousPhase = options.previousPhase ?? "PLANNED";
  await writeTaskDescriptor(target, createTaskDescriptor({
    taskId,
    writeClaims: ["package.json", "tests"],
  }), packageRoot);
  const verificationType = options.omitVerificationType ? {} : { type: "VERIFICATION" };
  const contract = createContract({
    taskId,
    objective: "Make the README banner render only on GitHub, not in the npm package.",
    deliverables: ["package.json", "tests/package.test.js"],
    constraints: [],
    risks: [],
    verification: [
      { id: "regression-tests", text: "pack tarball test asserts the README image is excluded from the npm package", ...verificationType },
      { id: "native-suite", text: "npm test, dependency:policy, lint, coverage, pack:check, docs:generated:check, docs:conformance, and docs:check all exit 0", ...verificationType },
    ],
    successCriteria: ["objective is present in the current repository"],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = options.contractFingerprint ?? contractFingerprint(contract);
  await writeContract(target, contract, packageRoot, { taskId });
  const route = evaluateRoute({ workType: "documentation", surfaces: ["documentation"], platforms: [] });
  const persistedRoute = await persistRoute(target, route, packageRoot, { contractFingerprint: contractHash, taskId });
  await writeWorkState(target, createWorkState({
    taskId,
    contractFingerprint: contractHash,
    routeFingerprint: persistedRoute.fingerprint,
    repositoryFingerprint: options.repositoryFingerprint ?? { branch: "main", head: STALE_HEAD },
    phase,
    previousPhase,
    selectedGuides: route.guides,
    requiredGates: [],
    satisfiedGates: [],
    requiredArtifacts: options.requiredArtifacts ?? [],
    completedSteps: ["implementation"],
    pendingSteps: ["verification"],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
  }), { packageRoot, taskId });
  await appendProtocolEvent(target, { taskId, event: "TASK_RECEIVED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId });
  const preflight = await runPreflight({ target, packageRoot, taskId });
  assert.equal(preflight.status, "READY");
  await appendProtocolEvent(target, { taskId, event: "PLAN_RECORDED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId, event: "EXECUTION_STARTED" }, packageRoot, { taskId });
  return { taskId, contractHash };
}

test("stale EXECUTING checkpoint refuses advance until reconciled", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupStaleExecutingTask(target);
    await assert.rejects(
      () => advanceWorkState(target, "VERIFYING", { packageRoot, taskId }),
      (error) => error.code === "E_STATE_REVALIDATION_REQUIRED"
        && error.message.includes("REPOSITORY_CHANGED"),
    );
  });
});

test("reconcile-closure refreshes a stale EXECUTING checkpoint after contract-bound evidence and the task then completes canonically", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupStaleExecutingTask(target);
    const requirement = "pack tarball test asserts the README image is excluded from the npm package";

    const result = await runReconcileClosure({
      target,
      packageRoot,
      taskId,
      checkId: "regression-tests",
      requirement,
      argv: ["node", "-e", "process.exit(0)"],
    });
    assert.equal(result.reconciled, true);
    assert.equal(result.previousRepositoryFingerprint.head, STALE_HEAD);
    assert.notEqual(result.repositoryFingerprint.head, STALE_HEAD);

    const state = await readWorkState(target, { packageRoot, taskId });
    assert.equal(state.phase, "EXECUTING");
    assert.equal(state.repositoryFingerprint.head, result.repositoryFingerprint.head);

    const events = await readEvents(target, packageRoot, { taskId });
    const reconcileEvent = events.find((event) => event.event === "CHECKPOINT_RECONCILED");
    assert.ok(reconcileEvent, "CHECKPOINT_RECONCILED event must be recorded");
    assert.equal(reconcileEvent.details.previousHead, STALE_HEAD);
    assert.equal(reconcileEvent.details.currentHead, result.repositoryFingerprint.head);
    assert.equal(reconcileEvent.details.checkId, "regression-tests");
    assert.equal(reconcileEvent.details.exitCode, 0);

    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId });

    const prepared = await prepareCompletion({ target, packageRoot, taskId });
    assert.ok(prepared.path);
    await recordCheckArtifact({
      target,
      packageRoot,
      id: "regression-tests",
      kind: "command",
      requirement,
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "node -e process.exit(0)",
      result: "pack tarball test asserts the README image is excluded from the npm package (passed)",
      exitCode: 0,
      executionRef: result.executionId,
      provenance: "FORGELOOP_EXECUTED",
      taskId,
    });
    await recordCheckArtifact({
      target,
      packageRoot,
      id: "native-suite",
      kind: "manual-review",
      requirement: "npm test, dependency:policy, lint, coverage, pack:check, docs:generated:check, docs:conformance, and docs:check all exit 0",
      status: "passed",
      evidenceKind: "OBSERVED",
      result: "full suite green in the current repository",
      taskId,
    });
    await recordCheckArtifact({
      target,
      packageRoot,
      id: "objective-present",
      kind: "manual-review",
      requirement: "objective is present in the current repository",
      status: "passed",
      evidenceKind: "OBSERVED",
      result: "reconciled checkpoint with contract-bound evidence that the objective is satisfied in the current repository",
      taskId,
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId });
    const completion = await runComplete({ target, packageRoot, taskId });
    assert.equal(completion.status, "VALID");
    const finalState = await readWorkState(target, { packageRoot, taskId });
    assert.equal(finalState.phase, "COMPLETE");
  });
});

test("reconcile-closure infers omitted verification type from the contract requirement", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupStaleExecutingTask(target, { omitVerificationType: true });
    const result = await runReconcileClosure({
      target,
      packageRoot,
      taskId,
      checkId: "regression-tests",
      requirement: "pack tarball test asserts the README image is excluded from the npm package",
      argv: ["node", "-e", "process.exit(0)"],
    });
    assert.equal(result.reconciled, true);
  });
});

test("reconcile-closure CLI accepts only contract-bound verification evidence", async () => {
  await withTarget(async (target) => {
    const { taskId } = await withProjectStorage(target, () => setupStaleExecutingTask(target));
    const requirement = "pack tarball test asserts the README image is excluded from the npm package";

    const unknown = runCli(
      target,
      "reconcile-closure",
      "--task", taskId,
      "--id", "regression-tests",
      "--requirement", "some other requirement text",
      "--",
      "node", "-e", "process.exit(0)",
    );
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /E_RECONCILE_REQUIREMENT_UNKNOWN/);

    const failing = runCli(
      target,
      "reconcile-closure",
      "--task", taskId,
      "--id", "regression-tests",
      "--requirement", requirement,
      "--",
      "node", "-e", "process.exit(1)",
    );
    assert.equal(failing.status, 1);
    assert.match(failing.stderr, /E_RECONCILE_EVIDENCE_FAILED/);

    const passing = runCli(
      target,
      "reconcile-closure",
      "--task", taskId,
      "--id", "regression-tests",
      "--requirement", requirement,
      "--json",
      "--",
      "node", "-e", "process.exit(0)",
    );
    assert.equal(passing.status, 0, passing.stderr);
    const report = JSON.parse(passing.stdout);
    assert.equal(report.reconciled, true);
    assert.equal(report.event, "CHECKPOINT_RECONCILED");
  });
});

test("reconcile-closure refuses tasks outside EXECUTING/VERIFYING/REVIEWING", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupStaleExecutingTask(target, { phase: "DIAGNOSING", previousPhase: "VERIFYING" });
    await assert.rejects(
      () => runReconcileClosure({
        target,
        packageRoot,
        taskId,
        checkId: "regression-tests",
        requirement: "pack tarball test asserts the README image is excluded from the npm package",
        argv: ["node", "-e", "process.exit(0)"],
      }),
      (error) => error.code === "E_RECONCILE_PHASE_INVALID",
    );
  });
});

test("reconcile-closure does not bypass a persisted but unauthorized completion rejection", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupStaleExecutingTask(target, { phase: "REVIEWING", previousPhase: "VERIFYING" });
    const state = await readWorkState(target, { packageRoot, taskId });
    await writeWorkState(target, {
      ...state,
      lastCompletionAttempt: {
        status: "REJECTED",
        reasonCodes: ["E_EVIDENCE_REQUIRED"],
        missingRequirementIds: ["missing-evidence"],
        verificationCycle: 1,
        timestamp: new Date().toISOString(),
      },
    }, { packageRoot, taskId });
    await assert.rejects(
      () => runReconcileClosure({
        target,
        packageRoot,
        taskId,
        checkId: "regression-tests",
        requirement: "pack tarball test asserts the README image is excluded from the npm package",
        argv: ["node", "-e", "process.exit(0)"],
      }),
      (error) => error.code === "E_COMPLETION_RECOVERY_UNAUTHORIZED"
        || error.code === "E_COMPLETION_REJECTION_LEDGER_MISMATCH"
        || error.code === "E_COMPLETION_REJECTION_STATE_FINGERPRINT_MISMATCH",
    );
  });
});

test("reconcile-closure bootstraps stale REVIEWING with repository-only drift and preserves canonical closure", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupStaleExecutingTask(target, {
      phase: "VERIFYING",
      previousPhase: "EXECUTING",
      repositoryFingerprint: await currentRepositoryFingerprint(target),
    });
    const requirement = "pack tarball test asserts the README image is excluded from the npm package";
    await appendProtocolEvent(target, { taskId, event: "VERIFICATION_STARTED", details: { verificationCycle: 1 } }, packageRoot, { taskId });
    await prepareCompletion({ target, packageRoot, taskId });
    await recordCheckArtifact({
      target,
      packageRoot,
      taskId,
      id: "regression-tests",
      kind: "manual-review",
      requirement,
      status: "passed",
      evidenceKind: "OBSERVED",
      result: "contract-bound verification evidence passed",
    });
    await recordCheckArtifact({
      target,
      packageRoot,
      taskId,
      id: "objective-present",
      kind: "manual-review",
      requirement: "objective is present in the current repository",
      status: "passed",
      evidenceKind: "OBSERVED",
      result: "the requested objective is present in the current repository",
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId });
    const freshState = await readWorkState(target, { packageRoot, taskId });
    await writeWorkState(target, {
      ...freshState,
      repositoryFingerprint: { branch: "main", head: STALE_HEAD },
    }, { packageRoot, taskId });

    const result = await runReconcileClosure({
      target,
      packageRoot,
      taskId,
      checkId: "regression-tests",
      requirement,
      argv: ["node", "-e", "process.exit(0)"],
    });
    assert.equal(result.reconciled, true);

    let state = await readWorkState(target, { packageRoot, taskId });
    assert.equal(state.phase, "REVIEWING");
    assert.equal(state.lastCompletionAttempt, undefined);
    const ownership = await resolveTaskClaimState(target, { packageRoot, taskId });
    assert.equal(ownership.claimState, "ACTIVE");
    assert.equal(ownership.ownershipValid, true);
    assert.equal(ownership.mutationAllowed, true);
    let events = await readEvents(target, packageRoot, { taskId });
    assert.ok(events.some((event) => event.event === "CHECKPOINT_RECONCILED"));
    assert.equal(events.some((event) => event.event === "COMPLETION_REJECTED"), false);
    assert.equal(events.some((event) => event.event === "COMPLETION_VALIDATED"), false);

    const completion = await runComplete({ target, packageRoot, taskId });
    assert.equal(completion.status, "VALID", JSON.stringify(completion.errors ?? []).slice(0, 500));
    state = await readWorkState(target, { packageRoot, taskId });
    assert.equal(state.phase, "COMPLETE");
    events = await readEvents(target, packageRoot, { taskId });
    assert.ok(events.some((event) => event.event === "COMPLETION_VALIDATED"));
  });
});

test("reconcile-closure refreshes stale VERIFYING checkpoints and canonical closure completes", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupStaleExecutingTask(target, { phase: "VERIFYING", previousPhase: "EXECUTING" });
    const requirement = "pack tarball test asserts the README image is excluded from the npm package";
    const report = await runReconcileClosure({
      target,
      packageRoot,
      taskId,
      checkId: "regression-tests",
      requirement,
      argv: ["node", "-e", "process.exit(0)"],
    });
    assert.equal(report.reconciled, true);
    assert.equal(report.event, "CHECKPOINT_RECONCILED");
    const state = await readWorkState(target, { packageRoot, taskId });
    assert.equal(state.phase, "VERIFYING");
    assert.notEqual(state.repositoryFingerprint.head, STALE_HEAD);

    await appendProtocolEvent(target, { taskId, event: "VERIFICATION_STARTED", details: { verificationCycle: 1 } }, packageRoot, { taskId });
    await prepareCompletion({ target, packageRoot, taskId, authorityContext: {}, runtimeContext: {} });
    await recordCheckArtifact({
      target,
      packageRoot,
      taskId,
      id: "regression-tests",
      requirement,
      kind: "manual-review",
      status: "passed",
      evidenceKind: "OBSERVED",
      result: "objective present in current repository",
      authorityContext: {},
      runtimeContext: {},
    });
    await recordCheckArtifact({
      target,
      packageRoot,
      taskId,
      id: "objective-present",
      kind: "manual-review",
      requirement: "objective is present in the current repository",
      status: "passed",
      evidenceKind: "OBSERVED",
      result: "reconciled checkpoint with contract-bound evidence that the objective is satisfied in the current repository",
      authorityContext: {},
      runtimeContext: {},
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId });
    const completion = await runComplete({ target, packageRoot, taskId, authorityContext: {}, runtimeContext: {} });
    assert.equal(completion.status, "VALID", JSON.stringify(completion.errors ?? []).slice(0, 500));
  });
});

test("reconcile-closure refuses fresh checkpoints", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupStaleExecutingTask(target, {
      repositoryFingerprint: { branch: null, head: null },
    });
    await assert.rejects(
      () => runReconcileClosure({
        target,
        packageRoot,
        taskId,
        checkId: "regression-tests",
        requirement: "pack tarball test asserts the README image is excluded from the npm package",
        argv: ["node", "-e", "process.exit(0)"],
      }),
      (error) => error.code === "E_RECONCILE_NOT_STALE",
    );
  });
});

test("reconcile-closure refuses unsupported drift kinds", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupStaleExecutingTask(target);
    const amended = createContract({
      taskId,
      objective: "Amended objective after execution started.",
      deliverables: ["package.json", "tests/package.test.js"],
      constraints: [],
      risks: [],
      verification: [
        { id: "regression-tests", text: "pack tarball test asserts the README image is excluded from the npm package", type: "VERIFICATION" },
      ],
      successCriteria: ["objective is present in the current repository"],
      stopConditions: [],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await writeContract(target, amended, packageRoot, { taskId });
    await assert.rejects(
      () => runReconcileClosure({
        target,
        packageRoot,
        taskId,
        checkId: "regression-tests",
        requirement: "pack tarball test asserts the README image is excluded from the npm package",
        argv: ["node", "-e", "process.exit(0)"],
      }),
      (error) => error.code === "E_RECONCILE_UNSUPPORTED_DRIFT"
        && error.message.includes("CONTRACT_CHANGED"),
    );
  });
});

test("reconcile-closure refuses repository plus required-artifact drift without mutation", async () => {
  await withTarget(async (target) => {
    const artifactPath = "tracked-output.txt";
    const original = "original\n";
    await writeFile(path.join(target, artifactPath), original, "utf8");
    const { taskId } = await setupStaleExecutingTask(target, {
      requiredArtifacts: [{
        path: artifactPath,
        sha256: sha256(Buffer.from(original)),
      }],
    });
    const beforeState = await readWorkState(target, { packageRoot, taskId });
    const beforeEvents = await readEvents(target, packageRoot, { taskId });
    await writeFile(path.join(target, artifactPath), "changed\n", "utf8");

    await assert.rejects(
      () => runReconcileClosure({
        target,
        packageRoot,
        taskId,
        checkId: "regression-tests",
        requirement: "pack tarball test asserts the README image is excluded from the npm package",
        argv: ["node", "-e", "process.exit(0)"],
      }),
      (error) => error.code === "E_RECONCILE_UNSUPPORTED_DRIFT"
        && error.message.includes("REQUIRED_ARTIFACT_CHANGED"),
    );
    assert.deepEqual(await readWorkState(target, { packageRoot, taskId }), beforeState);
    assert.deepEqual(await readEvents(target, packageRoot, { taskId }), beforeEvents);
  });
});

test("reconcile-closure refuses an invalid event ledger", async () => {
  await withTarget(async (target) => {
    const { taskId } = await setupStaleExecutingTask(target);
    const eventsPath = path.join(target, taskArtifactPath(taskId, "events"));
    const raw = await readFixtureText(target, eventsPath);
    const lines = raw.trimEnd().split("\n");
    const broken = lines.slice(0, -1).concat(
      JSON.stringify({ ...JSON.parse(lines.at(-1)), hash: "0000000000000000000000000000000000000000000000000000000000000000" }),
    );
    await overwriteFixtureText(target, eventsPath, `${broken.join("\n")}\n`);
    await assert.rejects(
      () => runReconcileClosure({
        target,
        packageRoot,
        taskId,
        checkId: "regression-tests",
        requirement: "pack tarball test asserts the README image is excluded from the npm package",
        argv: ["node", "-e", "process.exit(0)"],
      }),
      (error) => error.code === "E_RECONCILE_LEDGER_INVALID",
    );
  });
});

test("reconcile-closure help lists reconciliation options only", () => {
  const help = runCli(".", "reconcile-closure", "--help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /reconcile-closure/);
  assert.match(help.stdout, /--requirement/);
  assert.doesNotMatch(help.stdout, /--status/);
});


test("direct native reconciliation rolls back execution, reconciliation event and state after state staging failure", async () => {
  await withTarget(async target => {
    const { taskId } = await setupStaleExecutingTask(target);
    const { openStorageDatabase } = await import("../src/storage/index.js");
    const { withOperationalStore } = await import("../src/storage/unit-of-work.js");
    const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    const records = () => ({
      tasks: db.prepare("SELECT * FROM tasks ORDER BY task_id").all(),
      artifacts: db.prepare("SELECT * FROM task_artifacts ORDER BY task_id, kind, artifact_id").all(),
      events: db.prepare("SELECT * FROM events ORDER BY task_id, seq").all(),
      executions: db.prepare("SELECT * FROM executions ORDER BY task_id, execution_id").all(),
    });
    const before = records();
    const options = { target, packageRoot, taskId, checkId: "regression-tests",
      requirement: "pack tarball test asserts the README image is excluded from the npm package",
      argv: [process.execPath, "-e", "process.exit(0)"] };
    try {
      await withOperationalStore({ db, target }, async source => {
        const prototype = Object.getPrototypeOf(source);
        const stage = prototype.stageText;
        let reached = false;
        prototype.stageText = function(relativePath, text) {
          const result = stage.call(this, relativePath, text);
          if (this.target === target && relativePath === taskArtifactPath(taskId, "state")) {
            reached = true;
            throw new Error("injected reconciliation state failure");
          }
          return result;
        };
        try { await assert.rejects(runReconcileClosure(options), /injected reconciliation state failure/); }
        finally { prototype.stageText = stage; }
        assert.equal(reached, true);
      });
      assert.deepEqual(records(), before);
      const result = await runReconcileClosure(options);
      assert.equal(result.reconciled, true);
      assert.equal(records().events.at(-1).event_type, "TRANSACTION_COMMITTED");
    } finally { db.close(); }
  });
});
