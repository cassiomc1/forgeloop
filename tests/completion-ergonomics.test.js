import assert from "node:assert/strict";
import { lstat, readFile, symlink, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTempTree } from "./helpers/rm-safe.js";
import { runComplete } from "../src/commands/complete.js";
import { runPreflight } from "../src/commands/preflight.js";
import { prepareCompletion, recordCheck } from "../src/core/completion-artifacts.js";

import { canonicalFingerprint } from "../src/core/artifacts.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent, validateEventLedger } from "../src/core/events.js";
import { advanceWorkState } from "../src/core/phase.js";
import { NEXT_ACTIONS, getNextAction } from "../src/core/next-action.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, readWorkState, writeWorkState } from "../src/core/work-state.js";

import { buildTaskArtifactPaths } from "../src/core/task-paths.js";
import { ensureFixtureTask, readRawFixtureText, overwriteFixtureText } from "./helpers/native-storage-fixture.js";

const packageRoot = getPackageRoot();
const taskId = "task-ergonomics";
const ARTIFACT_PATHS = buildTaskArtifactPaths(taskId);

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-completion-"));
  try {
    await ensureFixtureTask(target, taskId, packageRoot);
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function setupTarget(target, { advanceToVerifying = true, successCriteria = ["tests"] } = {}) {
  const contract = createContract({
    taskId: "task-ergonomics",
    objective: "Exercise completion ergonomics",
    deliverables: ["src/example.js"],
    constraints: ["offline"],
    risks: [],
    verification: ["tests"],
    successCriteria,
    stopConditions: ["verification unavailable"],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  await writeContract(target, contract, packageRoot, { taskId });
  const route = evaluateRoute({ workType: "api", surfaces: ["api"], platforms: [] });
  const persistedRoute = await persistRoute(target, route, packageRoot, {
    contractFingerprint: contractHash,
    taskId,
  });
  const state = createWorkState({
    taskId: contract.taskId,
    contractFingerprint: contractHash,
    routeFingerprint: persistedRoute.fingerprint,
    repositoryFingerprint: { branch: null, head: null },
    phase: "EXECUTING",
    previousPhase: "PLANNED",
    selectedGuides: route.guides,
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: ["implementation"],
    pendingSteps: ["verification", "receipt"],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
  });
  await writeWorkState(target, state, { packageRoot, taskId });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId });
  const preflight = await runPreflight({ target, packageRoot, taskId });
  assert.equal(preflight.status, "READY");
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "EXECUTION_STARTED" }, packageRoot, { taskId });
  if (advanceToVerifying) await advanceWorkState(target, "VERIFYING", { packageRoot, taskId });
  return { contract, route, persistedRoute };
}

async function artifactContents(target, paths) {
  return Promise.all(paths.map(async (relativePath) => {
    try {
      return await readRawFixtureText(target, path.join(target, relativePath));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }));
}

async function replacePersistedPreflight(target, mutate) {
  const preflightPath = path.join(target, ARTIFACT_PATHS.preflight);
  const preflight = JSON.parse(await readRawFixtureText(target, preflightPath));
  mutate(preflight);
  await overwriteFixtureText(target, preflightPath, `${JSON.stringify(preflight, null, 2)}\n`);
}

async function replacePreflightReadyEvent(target, mutate) {
  const eventsPath = path.join(target, ARTIFACT_PATHS.events);
  const events = (await readRawFixtureText(target, eventsPath)).trim().split("\n").map((line) => JSON.parse(line));
  const ready = events.find((event) => event.event === "PREFLIGHT_READY");
  mutate(ready);
  let previousHash = null;
  for (const event of events) {
    event.previousHash = previousHash;
    const { hash, ...body } = event;
    event.hash = canonicalFingerprint(body);
    previousHash = event.hash;
  }
  await overwriteFixtureText(target, eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

async function setupReviewedTarget(target) {
  await setupTarget(target);
  await prepareCompletion({ target, packageRoot, taskId });
  await recordCheck({
    target,
    packageRoot,
    taskId,
    id: "tests",
    kind: "manual-review",
    requirement: "tests",
    status: "passed",
    evidenceKind: "OBSERVED",
    result: "tests passed",
    exitCode: 0,
  });
  await advanceWorkState(target, "REVIEWING", { packageRoot, taskId });
}

test("completion rejects implemented work that stops in EXECUTING", async () => {
  await withTarget(async (target) => {
    await setupTarget(target, { advanceToVerifying: false });
    await writeFile(path.join(target, "src-example.js"), "export const implemented = true;\n");

    const completion = await runComplete({ target, packageRoot, taskId });

    assert.equal(completion.status, "REJECTED");
    assert.equal(completion.taskStatus, "INCOMPLETE");
    assert.ok(completion.errors.some((error) => error.code === "E_RECEIPT_MISSING"));
    assert.ok(completion.errors.some((error) => error.code === "E_PHASE_PREREQUISITE_MISSING"));
    assert.match(completion.errors.find((error) => error.code === "E_PHASE_PREREQUISITE_MISSING").next, /VERIFYING.*REVIEWING/i);
    assert.equal((await readWorkState(target, { packageRoot, taskId })).phase, "EXECUTING");
  });
});

test("post-execution paths reject foreign or stale persisted preflight before mutating", async (t) => {
  await t.test("foreign persisted preflight blocks next and direct VERIFYING advance", async () => {
    await withTarget(async (target) => {
      await setupTarget(target, { advanceToVerifying: false });
      await replacePersistedPreflight(target, (preflight) => {
        preflight.taskId = "foreign-task";
      });
      const before = await artifactContents(target, [ARTIFACT_PATHS.state, ARTIFACT_PATHS.events]);

      const next = await getNextAction({ target, packageRoot, taskId });
      assert.equal(next.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);
      assert.ok(next.reasonCodes.includes("E_PREFLIGHT_TASK_MISMATCH"));
      await assert.rejects(
        () => advanceWorkState(target, "VERIFYING", { packageRoot, taskId }),
        (error) => error.code === "E_PREFLIGHT_TASK_MISMATCH"
          && error.message === "Persisted preflight does not belong to the current task",
      );

      assert.deepEqual(await artifactContents(target, [ARTIFACT_PATHS.state, ARTIFACT_PATHS.events]), before);
    });
  });

  await t.test("stale persisted preflight blocks preparation and evidence recording", async () => {
    await withTarget(async (target) => {
      await setupTarget(target);
      await replacePersistedPreflight(target, (preflight) => {
        preflight.fingerprints.routing = "a".repeat(64);
      });
      const before = await artifactContents(target, [ARTIFACT_PATHS.state, ARTIFACT_PATHS.receipt, ARTIFACT_PATHS.events]);

      const next = await getNextAction({ target, packageRoot, taskId });
      assert.equal(next.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);
      assert.ok(next.reasonCodes.includes("E_PREFLIGHT_ROUTE_STALE"));
      await assert.rejects(
        () => prepareCompletion({ target, packageRoot, taskId }),
        (error) => error.code === "E_PREFLIGHT_ROUTE_STALE",
      );
      await assert.rejects(
        () => recordCheck({
          target,
          packageRoot,
          taskId,
          id: "tests",
          kind: "manual-review",
          requirement: "tests",
          status: "passed",
          evidenceKind: "OBSERVED",
          result: "tests passed",
          exitCode: 0,
        }),
        (error) => error.code === "E_PREFLIGHT_ROUTE_STALE",
      );

      assert.deepEqual(await artifactContents(target, [ARTIFACT_PATHS.state, ARTIFACT_PATHS.receipt, ARTIFACT_PATHS.events]), before);
    });
  });

  await t.test("foreign persisted preflight rejects complete without changing a reviewed target", async () => {
    await withTarget(async (target) => {
      await setupReviewedTarget(target);
      await replacePersistedPreflight(target, (preflight) => {
        preflight.taskId = "foreign-task";
      });
      const before = await artifactContents(target, [ARTIFACT_PATHS.state, ARTIFACT_PATHS.receipt, ARTIFACT_PATHS.events]);

      const next = await getNextAction({ target, packageRoot, taskId });
      assert.equal(next.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);
      assert.ok(next.reasonCodes.includes("E_PREFLIGHT_TASK_MISMATCH"));
      const completion = await runComplete({ target, packageRoot, taskId });

      assert.equal(completion.status, "REJECTED");
      assert.ok(completion.errors.some((error) => error.code === "E_PREFLIGHT_TASK_MISMATCH"));
      assert.deepEqual(await artifactContents(target, [ARTIFACT_PATHS.state, ARTIFACT_PATHS.receipt, ARTIFACT_PATHS.events]), before);
    });
  });

  await t.test("PREFLIGHT_READY contract fingerprint drift blocks every post-execution writer", async () => {
    await withTarget(async (target) => {
      await setupTarget(target);
      await prepareCompletion({ target, packageRoot, taskId });
      await replacePreflightReadyEvent(target, (event) => {
        event.fingerprint = "a".repeat(64);
      });
      const before = await artifactContents(target, [ARTIFACT_PATHS.state, ARTIFACT_PATHS.receipt, ARTIFACT_PATHS.events]);

      const next = await getNextAction({ target, packageRoot, taskId });
      assert.equal(next.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);
      assert.ok(next.reasonCodes.includes("E_PHASE_CHRONOLOGY_INVALID"));
      assert.equal(next.commands.length, 0);
      await assert.rejects(
        () => advanceWorkState(target, "REVIEWING", { packageRoot, taskId }),
        (error) => error.code === "E_PHASE_CHRONOLOGY_INVALID",
      );
      await assert.rejects(
        () => prepareCompletion({ target, packageRoot, taskId }),
        (error) => error.code === "E_PHASE_CHRONOLOGY_INVALID",
      );
      await assert.rejects(
        () => recordCheck({
          target,
          packageRoot,
          taskId,
          id: "tests",
          kind: "manual-review",
          requirement: "tests",
          status: "passed",
          evidenceKind: "OBSERVED",
          result: "tests passed",
          exitCode: 0,
        }),
        (error) => error.code === "E_PHASE_CHRONOLOGY_INVALID",
      );
      const completion = await runComplete({ target, packageRoot, taskId, persist: true });

      assert.equal(completion.status, "REJECTED");
      assert.ok(completion.errors.some((error) => error.code === "E_PHASE_CHRONOLOGY_INVALID"));
      assert.deepEqual(await artifactContents(target, [ARTIFACT_PATHS.state, ARTIFACT_PATHS.receipt, ARTIFACT_PATHS.events]), before);
    });
  });

  await t.test("next blocks stale execution gate sets and route-bound preflight events", async (t) => {
    await t.test("state gate-set mismatch", async () => {
      await withTarget(async (target) => {
        await setupTarget(target, { advanceToVerifying: false });
        const statePath = path.join(target, ARTIFACT_PATHS.state);
        const state = JSON.parse(await readRawFixtureText(target, statePath));
        state.requiredGates = ["foreign-gate"];
        await overwriteFixtureText(target, statePath, `${JSON.stringify(state, null, 2)}\n`);

        const next = await getNextAction({ target, packageRoot, taskId });

        assert.equal(next.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);
        assert.ok(next.reasonCodes.includes("E_PREFLIGHT_GATES_STALE"));
        assert.equal(next.commands.includes("forgeloop advance --to VERIFYING"), false);
      });
    });

    await t.test("PREFLIGHT_READY route fingerprint mismatch", async () => {
      await withTarget(async (target) => {
        await setupTarget(target, { advanceToVerifying: false });
        await replacePreflightReadyEvent(target, (event) => {
          event.details.routingFingerprint = "b".repeat(64);
        });

        const next = await getNextAction({ target, packageRoot, taskId });

        assert.equal(next.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);
        assert.ok(next.reasonCodes.includes("E_PHASE_CHRONOLOGY_INVALID"));
        assert.equal(next.commands.includes("forgeloop advance --to VERIFYING"), false);
      });
    });
  });
});

test("prepare-completion derives a safe receipt skeleton without verification claims", async () => {
  await withTarget(async (target) => {
    const { contract, route, persistedRoute } = await setupTarget(target);
    const result = await prepareCompletion({ target, packageRoot, taskId });

    assert.equal(result.receipt.taskId, contract.taskId);
    assert.equal(result.receipt.contractFingerprint, contractFingerprint(contract));
    assert.equal(result.receipt.routeFingerprint, persistedRoute.fingerprint);
    assert.deepEqual(result.receipt.selectedGuides, route.guides);
    assert.equal(result.receipt.publicationStatus, "local-only");
    assert.equal(result.receipt.productionReadiness, "not-verified");
    assert.equal(result.receipt.checks.length, 0);
    assert.ok(result.receipt.evidenceCoverage.every((item) => item.status === "NOT_VERIFIED"));
    await readRawFixtureText(target, path.join(target, ARTIFACT_PATHS.receipt));
  });
});

test("recordCheck stores observed evidence and completion recognizes it", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);
    await prepareCompletion({ target, packageRoot, taskId });
    const sentinel = path.join(target, "must-not-run.txt");
    const result = await recordCheck({
      target,
      packageRoot,
      taskId,
      id: "tests",
      kind: "manual-review",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: `touch ${sentinel}`,
      result: "4/4 tests passed",
      exitCode: 0,
    });

    assert.equal(result.check.status, "passed");
    assert.equal(result.evidence.kind, "OBSERVED");
    assert.equal(result.coverage.find((item) => item.requirement === "tests").status, "COVERED");
    await assert.rejects(() => readFile(sentinel));
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId });
    const completion = await runComplete({ target, packageRoot, taskId });
    assert.equal(completion.status, "VALID");
    assert.equal(completion.taskStatus, "COMPLETE");

    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);
    const eventNames = ledger.events.map((event) => event.event);
    for (const event of [
      "CONTRACT_VALIDATED",
      "ROUTE_VALIDATED",
      "PREFLIGHT_READY",
      "EXECUTION_STARTED",
      "VERIFICATION_STARTED",
      "VERIFICATION_RECORDED",
      "COMPLETION_VALIDATED",
    ]) {
      assert.ok(eventNames.includes(event), `missing ${event}`);
    }
    assert.ok(eventNames.indexOf("PREFLIGHT_READY") < eventNames.indexOf("EXECUTION_STARTED"));
    assert.ok(eventNames.indexOf("EXECUTION_STARTED") < eventNames.indexOf("VERIFICATION_STARTED"));
    assert.ok(eventNames.indexOf("VERIFICATION_RECORDED") < eventNames.indexOf("COMPLETION_VALIDATED"));
  });
});

test("recordCheck rejects invalid and contradictory evidence before writing", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);
    await prepareCompletion({ target, packageRoot, taskId });
    const input = {
      target,
      packageRoot,
      taskId,
      id: "tests",
      kind: "command",
      requirement: "tests",
      command: "npm test",
      result: "exit 0",
    };

    await assert.rejects(
      () => recordCheck({ ...input, kind: "manual-review", status: "unknown", evidenceKind: "OBSERVED" }),
      (error) => error.code === "E_CHECK_INVALID",
    );
    await assert.rejects(
      () => recordCheck({ ...input, kind: "manual-review", status: "passed", evidenceKind: "UNKNOWN" }),
      (error) => error.code === "E_EVIDENCE_KIND_INVALID",
    );
    await assert.rejects(
      () => recordCheck({ ...input, kind: "manual-review", status: "passed", evidenceKind: "NOT_VERIFIED" }),
      (error) => error.code === "E_CHECK_STATUS_CONTRADICTION",
    );
    await assert.rejects(
      () => recordCheck({ ...input, kind: "manual-review", status: "passed", evidenceKind: "OBSERVED", details: "not an object" }),
      (error) => error.code === "E_CHECK_INVALID",
    );
    await assert.rejects(
      () => recordCheck({ ...input, kind: "manual-review", status: "passed", evidenceKind: "OBSERVED", command: "echo sk-1234567890" }),
      /secret/i,
    );
  });
});

test("recordCheck rejects a stale receipt binding before writing state, receipt, or ledger", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);
    await prepareCompletion({ target, packageRoot, taskId });
    const statePath = path.join(target, ARTIFACT_PATHS.state);
    const receiptPath = path.join(target, ARTIFACT_PATHS.receipt);
    const eventsPath = path.join(target, ARTIFACT_PATHS.events);
    const receipt = JSON.parse(await readRawFixtureText(target, receiptPath));
    receipt.stateFingerprint = "a".repeat(64);
    await overwriteFixtureText(target, receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const before = await Promise.all([readRawFixtureText(target, statePath), readRawFixtureText(target, receiptPath), readRawFixtureText(target, eventsPath)]);

    await assert.rejects(
      () => recordCheck({
        target,
        packageRoot,
        taskId,
        id: "tests",
        kind: "manual-review",
        requirement: "tests",
        status: "passed",
        evidenceKind: "OBSERVED",
        result: "tests passed",
        exitCode: 0,
      }),
      (error) => error.code === "E_RECEIPT_STATE_MISMATCH",
    );

    assert.deepEqual(
      await Promise.all([readRawFixtureText(target, statePath), readRawFixtureText(target, receiptPath), readRawFixtureText(target, eventsPath)]),
      before,
    );
  });
});

test("recordCheck requires a prepared receipt and rejects a symlink target", async () => {
  await withTarget(async (target) => {
    const context = await setupTarget(target);
    await assert.rejects(
      () => recordCheck({
        target,
        packageRoot,
        taskId,
        id: "tests",
        kind: "manual-review",
        requirement: "tests",
        status: "passed",
        evidenceKind: "OBSERVED",
        command: "npm test",
        result: "exit 0",
      }),
      (error) => error.code === "E_RECEIPT_MISSING",
    );

    const link = `${target}-link`;
    await symlink(target, link, "dir");
    try {
      await assert.rejects(
        () => prepareCompletion({ target: link, packageRoot }),
        /symlink/i,
      );
      assert.equal((await lstat(link)).isSymbolicLink(), true);
    } finally {
      await rm(link, { recursive: true, force: true });
    }
    assert.equal(context.contract.taskId, "task-ergonomics");
  });
});

test("recordCheck keeps verification evidence before REVIEWING", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);
    await prepareCompletion({ target, packageRoot, taskId });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId });

    await assert.rejects(
      () => recordCheck({
        target,
        packageRoot,
        taskId,
        id: "tests",
        kind: "manual-review",
        requirement: "tests",
        status: "passed",
        evidenceKind: "OBSERVED",
        result: "4/4 passed",
      }),
      (error) => error.code === "E_PHASE_PREREQUISITE_MISSING",
    );
  });
});

test("recordCheck rejects future evidence for a lifecycle-owned criterion", async () => {
  await withTarget(async (target) => {
    const requirement = "Lifecycle reaches validator-backed COMPLETE";
    await setupTarget(target, { successCriteria: [requirement] });
    await prepareCompletion({ target, packageRoot, taskId });

    await assert.rejects(
      () => recordCheck({ kind: "manual-review",
        target,
        packageRoot,
        taskId,
        id: "future-complete",
        requirement,
        status: "passed",
        evidenceKind: "OBSERVED",
        result: "claimed complete before terminal validation",
      }),
      (error) => error.code === "E_FUTURE_LIFECYCLE_EVIDENCE",
    );

    assert.deepEqual((await readWorkState(target, { packageRoot, taskId })).checks, []);
  });
});

test("evidence-only completion rejection supports a second legal verification cycle", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);
    await prepareCompletion({ target, packageRoot, taskId });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId,
      id: "tests-incomplete",
      requirement: "tests",
      status: "not-run",
      evidenceKind: "NOT_VERIFIED",
      result: "tests still pending",
    });

    const state = await readWorkState(target, { packageRoot, taskId });
    const reviewed = { ...state, previousPhase: "VERIFYING", phase: "REVIEWING" };
    await writeWorkState(target, reviewed, { packageRoot, taskId });
    await appendProtocolEvent(target, {
      taskId: state.taskId,
      event: "REVIEW_STARTED",
      details: { verificationCycle: 1 },
    }, packageRoot, { taskId });
    const receiptPath = path.join(target, ARTIFACT_PATHS.receipt);
    const receipt = JSON.parse(await readRawFixtureText(target, receiptPath));
    receipt.stateFingerprint = canonicalFingerprint(reviewed);
    await overwriteFixtureText(target, receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const rejected = await runComplete({ target, packageRoot, taskId });
    assert.equal(rejected.status, "REJECTED");
    assert.ok(rejected.errors.some((error) => error.code === "E_EVIDENCE_PARTIAL"));

    const recovery = await getNextAction({ target, packageRoot, taskId });
    assert.equal(recovery.nextAction, NEXT_ACTIONS.ENTER_VERIFYING);
    assert.deepEqual(recovery.commands, ["forgeloop advance --to VERIFYING"]);

    const verifying = await advanceWorkState(target, "VERIFYING", { packageRoot, taskId });
    assert.equal(verifying.verificationCycle, 2);
    assert.equal(verifying.lastCompletionAttempt, undefined);
    await prepareCompletion({ target, packageRoot, taskId });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId,
      id: "tests-complete",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      result: "tests passed in cycle 2",
      exitCode: 0,
    });
    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId });

    const completed = await runComplete({ target, packageRoot, taskId });
    assert.equal(completed.status, "VALID", JSON.stringify(completed.errors));
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.deepEqual(
      ledger.events.filter((event) => event.event === "VERIFICATION_STARTED")
        .map((event) => event.details.verificationCycle),
      [1, 2],
    );
    assert.ok(ledger.events.some((event) => event.event === "COMPLETION_REJECTED"));
  });
});
