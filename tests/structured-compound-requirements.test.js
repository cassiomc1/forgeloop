import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTempTree } from "./helpers/rm-safe.js";
import { createContract, contractFingerprint, writeContract, validateContract } from "../src/core/contract.js";
import { createCheck } from "../src/core/checks.js";
import { classifyRequirement, evaluateRequiredEvidence } from "../src/core/evidence-readiness.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-compound-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

test("backward compatibility with string array verification requirements", async () => {
  const contract = createContract({
    taskId: "task-string-reqs",
    objective: "Support string arrays seamlessly",
    deliverables: ["src/app.js"],
    constraints: [],
    risks: [],
    verification: ["Unit tests pass", "Lint checks pass"],
    successCriteria: ["App builds cleanly"],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  });

  await validateContract(contract, packageRoot);
  assert.equal(contract.verification.length, 2);
  assert.equal(contract.verification[0], "Unit tests pass");
});

test("structured requirement objects are schema-valid and validate cleanly (P1-7)", async () => {
  const contract = createContract({
    taskId: "task-structured-reqs",
    objective: "Support structured requirement objects",
    deliverables: ["src/app.js"],
    constraints: [],
    risks: [],
    verification: [
      {
        id: "REQ_A11Y_COMPOUND",
        text: "Accessibility comprehensive verification",
        type: "VERIFICATION",
        operator: "ALL",
        requirements: [
          { id: "REQ_KEYBOARD", text: "Keyboard navigation works" },
          { id: "REQ_ZOOM", text: "Zoom mode 200% works" },
        ],
      },
      "Integration tests pass",
    ],
    successCriteria: [
      {
        id: "SC_PERF",
        text: "Performance budget met",
        type: "VERIFICATION",
      },
    ],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  });

  await validateContract(contract, packageRoot);
  assert.equal(contract.verification.length, 2);
  assert.equal(typeof contract.verification[0], "object");
  assert.equal(contract.verification[0].id, "REQ_A11Y_COMPOUND");
});

test("duplicate explicit requirement IDs in contract are rejected", () => {
  assert.throws(
    () => createContract({
      taskId: "task-dup-ids",
      objective: "Reject duplicate requirement IDs",
      deliverables: ["src/app.js"],
      constraints: [],
      risks: [],
      verification: [
        { id: "REQ_DUPLICATE", text: "First requirement" },
        { id: "REQ_DUPLICATE", text: "Second requirement with same ID" },
      ],
      successCriteria: [],
      stopConditions: [],
      unresolvedDecisions: [],
      sourceRefs: [],
    }),
    (err) => err.message.includes("Duplicate requirement ID"),
  );
});

test("compound partial verification fails readiness (Matrix L)", () => {
  const requirement = classifyRequirement({
    id: "SC_ACCESSIBILITY",
    text: "Accessibility passes",
    type: "VERIFICATION",
    operator: "ALL",
    requirements: [
      { id: "SC_KEYBOARD", text: "Keyboard passes" },
      { id: "SC_ZOOM", text: "Zoom passes" },
      { id: "SC_MOTION", text: "Reduced motion passes" },
    ],
  });

  const checks = [
    createCheck({
      id: "chk-keyboard",
      kind: "manual-review",
      requirement: "SC_KEYBOARD",
      status: "passed",
      evidenceKind: "OBSERVED",
      source: "a11y-test",
    }),
    createCheck({
      id: "chk-zoom",
      kind: "manual-review",
      requirement: "SC_ZOOM",
      status: "not-run",
      evidenceKind: "NOT_VERIFIED",
      source: "a11y-test",
    }),
    createCheck({
      id: "chk-motion",
      kind: "manual-review",
      requirement: "SC_MOTION",
      status: "passed",
      evidenceKind: "OBSERVED",
      source: "a11y-test",
    }),
  ];

  const result = evaluateRequiredEvidence({
    requirements: [requirement],
    checks,
  });

  assert.equal(result.ready, false);
  assert.equal(result.partial.length, 1);
  assert.equal(result.partial[0].id, "SC_ACCESSIBILITY");
  assert.deepEqual(result.reasonCodes, ["E_EVIDENCE_PARTIAL"]);
});

test("compound complete verification passes readiness (Matrix M)", () => {
  const requirement = classifyRequirement({
    id: "SC_ACCESSIBILITY",
    text: "Accessibility passes",
    type: "VERIFICATION",
    operator: "ALL",
    requirements: [
      { id: "SC_KEYBOARD", text: "Keyboard passes" },
      { id: "SC_ZOOM", text: "Zoom passes" },
      { id: "SC_MOTION", text: "Reduced motion passes" },
    ],
  });

  const checks = [
    createCheck({
      id: "chk-keyboard",
      kind: "manual-review",
      requirement: "SC_KEYBOARD",
      status: "passed",
      evidenceKind: "OBSERVED",
      source: "a11y-test",
    }),
    createCheck({
      id: "chk-zoom",
      kind: "manual-review",
      requirement: "SC_ZOOM",
      status: "passed",
      evidenceKind: "OBSERVED",
      source: "a11y-test",
    }),
    createCheck({
      id: "chk-motion",
      kind: "manual-review",
      requirement: "SC_MOTION",
      status: "passed",
      evidenceKind: "OBSERVED",
      source: "a11y-test",
    }),
  ];

  const result = evaluateRequiredEvidence({
    requirements: [requirement],
    checks,
  });

  assert.equal(result.ready, true);
  assert.equal(result.covered.length, 1);
  assert.equal(result.covered[0].id, "SC_ACCESSIBILITY");
  assert.equal(result.partial.length, 0);
  assert.equal(result.missing.length, 0);
});

test("compound child FAIL drives DIAGNOSE (P1-5 Test A)", async () => {
  const { getNextAction, NEXT_ACTIONS } = await import("../src/core/next-action.js");
  const { advanceWorkState } = await import("../src/core/phase.js");
  const { persistRoute } = await import("../src/core/route-artifact.js");
  const { evaluateRoute } = await import("../src/core/router.js");
  const { runPreflight } = await import("../src/commands/preflight.js");
  const { appendProtocolEvent } = await import("../src/core/events.js");
  const { createWorkState, writeWorkState } = await import("../src/core/work-state.js");
  const { prepareCompletion, recordCheck } = await import("../src/core/completion-artifacts.js");

  await withTarget(async (target) => {
    const contract = createContract({
      taskId: "task-compound-fail",
      objective: "Exercise compound child failure next action",
      deliverables: ["src/app.js"],
      constraints: [],
      risks: [],
      verification: ["test"],
      successCriteria: [
        {
          id: "SC_COMPOUND",
          text: "Compound verification",
          type: "VERIFICATION",
          operator: "ALL",
          requirements: [
            { id: "SC_CHILD_1", text: "Child 1 pass" },
            { id: "SC_CHILD_2", text: "Child 2 fail" },
          ],
        },
      ],
      stopConditions: [],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await ensureFixtureTask(target, contract.taskId, packageRoot);
    const contractHash = contractFingerprint(contract);
    await writeContract(target, contract, packageRoot, { taskId: contract.taskId });
    const route = evaluateRoute({ workType: "code", surfaces: ["config"], platforms: [] });
    const persistedRoute = await persistRoute(target, route, packageRoot, {
      contractFingerprint: contractHash,
      taskId: contract.taskId,
    });
    const state = createWorkState({
      taskId: contract.taskId,
      contractFingerprint: contractHash,
      routeFingerprint: persistedRoute.fingerprint,
      repositoryFingerprint: { branch: null, head: null },
      phase: "PLANNED",
      selectedGuides: [...persistedRoute.value.guides],
      requiredGates: [],
      satisfiedGates: [],
      completedSteps: ["planning"],
      pendingSteps: ["execute"],
      requiredArtifacts: [],
      checks: [],
      failures: [],
      blockers: [],
      verificationEvidence: [],
    });
    await writeWorkState(target, state, { packageRoot, taskId: contract.taskId });
    await appendProtocolEvent(target, { taskId: contract.taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId: contract.taskId });
    await appendProtocolEvent(target, { taskId: contract.taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId: contract.taskId });
    await runPreflight({ target, packageRoot, taskId: contract.taskId });
    await advanceWorkState(target, "EXECUTING", { packageRoot, taskId: contract.taskId });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: contract.taskId });
    await prepareCompletion({ target, packageRoot, taskId: contract.taskId });

    // Child 1 passes
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: contract.taskId,
      id: "chk-c1",
      requirement: "SC_CHILD_1",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "test1",
      result: "passed",
    });

    // Child 2 fails
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: contract.taskId,
      id: "chk-c2",
      requirement: "SC_CHILD_2",
      status: "failed",
      evidenceKind: "OBSERVED",
      command: "test2",
      result: "failed",
    });

    const next = await getNextAction({ target, packageRoot, taskId: contract.taskId });
    assert.equal(next.nextAction, NEXT_ACTIONS.DIAGNOSE);
  });
});

test("compound child BLOCKED drives RESOLVE_BLOCKER (P1-5 Test B)", async () => {
  const { getNextAction, NEXT_ACTIONS } = await import("../src/core/next-action.js");
  const { advanceWorkState } = await import("../src/core/phase.js");
  const { persistRoute } = await import("../src/core/route-artifact.js");
  const { evaluateRoute } = await import("../src/core/router.js");
  const { runPreflight } = await import("../src/commands/preflight.js");
  const { appendProtocolEvent } = await import("../src/core/events.js");
  const { createWorkState, writeWorkState } = await import("../src/core/work-state.js");
  const { prepareCompletion, recordCheck } = await import("../src/core/completion-artifacts.js");

  await withTarget(async (target) => {
    const contract = createContract({
      taskId: "task-compound-block",
      objective: "Exercise compound child blocked next action",
      deliverables: ["src/app.js"],
      constraints: [],
      risks: [],
      verification: ["test"],
      successCriteria: [
        {
          id: "SC_COMPOUND",
          text: "Compound verification",
          type: "VERIFICATION",
          operator: "ALL",
          requirements: [
            { id: "SC_CHILD_1", text: "Child 1 pass" },
            { id: "SC_CHILD_2", text: "Child 2 block" },
          ],
        },
      ],
      stopConditions: [],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await ensureFixtureTask(target, contract.taskId, packageRoot);
    const contractHash = contractFingerprint(contract);
    await writeContract(target, contract, packageRoot, { taskId: contract.taskId });
    const route = evaluateRoute({ workType: "code", surfaces: ["config"], platforms: [] });
    const persistedRoute = await persistRoute(target, route, packageRoot, {
      contractFingerprint: contractHash,
      taskId: contract.taskId,
    });
    const state = createWorkState({
      taskId: contract.taskId,
      contractFingerprint: contractHash,
      routeFingerprint: persistedRoute.fingerprint,
      repositoryFingerprint: { branch: null, head: null },
      phase: "PLANNED",
      selectedGuides: [...persistedRoute.value.guides],
      requiredGates: [],
      satisfiedGates: [],
      completedSteps: ["planning"],
      pendingSteps: ["execute"],
      requiredArtifacts: [],
      checks: [],
      failures: [],
      blockers: [],
      verificationEvidence: [],
    });
    await writeWorkState(target, state, { packageRoot, taskId: contract.taskId });
    await appendProtocolEvent(target, { taskId: contract.taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId: contract.taskId });
    await appendProtocolEvent(target, { taskId: contract.taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId: contract.taskId });
    await runPreflight({ target, packageRoot, taskId: contract.taskId });
    await advanceWorkState(target, "EXECUTING", { packageRoot, taskId: contract.taskId });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: contract.taskId });
    await prepareCompletion({ target, packageRoot, taskId: contract.taskId });

    // Child 1 passes
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: contract.taskId,
      id: "chk-c1",
      requirement: "SC_CHILD_1",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "test1",
      result: "passed",
    });

    // Child 2 blocked
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: contract.taskId,
      id: "chk-c2",
      requirement: "SC_CHILD_2",
      status: "blocked",
      evidenceKind: "BLOCKED",
      command: "test2",
      result: "blocked",
    });

    const next = await getNextAction({ target, packageRoot, taskId: contract.taskId });
    assert.equal(next.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);
  });
});
