import assert from "node:assert/strict";
import { test } from "node:test";

import { NEXT_ACTIONS } from "../src/core/next-action-model.js";
import { taskArtifactPath } from "../src/core/task-paths.js";

test("blocking continuity responses identify the selected task's artifacts", async () => {
  const { nextActionForContinuity } = await import("../src/core/next-action-continuity.js");
  const taskId = "selected-continuity-task";
  const expectedArtifacts = [taskArtifactPath(taskId, "continuity"), taskArtifactPath(taskId, "state")];
  for (const classification of ["RECONCILIATION_REQUIRED", "INVALID", "INCONSISTENT"]) {
    const response = nextActionForContinuity({
      context: { taskId, currentPhase: "EXECUTING" },
      continuity: { classification },
    });
    assert.equal(response.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);
    assert.deepEqual(response.requiredArtifacts, expectedArtifacts);
    assert.ok(response.reasons.length > 0);
    for (const reason of response.reasons) {
      assert.deepEqual([...reason.artifacts].sort(), expectedArtifacts);
    }
    if (classification === "RECONCILIATION_REQUIRED") {
      assert.deepEqual(response.commands, [`forgeloop reconcile-continuity --task ${taskId}`]);
      assert.deepEqual(response.commandSpecs[0].argv, ["reconcile-continuity", `--task=${taskId}`, "--json"]);
    }
  }
});

test("continuity responses retain singleton artifact paths when no task is selected", async () => {
  const { nextActionForContinuity } = await import("../src/core/next-action-continuity.js");
  const response = nextActionForContinuity({
    context: { currentPhase: "EXECUTING" },
    continuity: { classification: "RECONCILIATION_REQUIRED" },
  });
  assert.deepEqual(response.requiredArtifacts, [".forgeloop/continuity.json", ".forgeloop/work-state.json"]);
  assert.deepEqual(response.commands, ["forgeloop reconcile-continuity"]);
});

test("next-action model exposes CONTINUE_IMPLEMENTATION without a phase-change command", async () => {
  const { commandFor } = await import("../src/core/next-action-model.js");
  assert.equal(NEXT_ACTIONS.CONTINUE_IMPLEMENTATION, "CONTINUE_IMPLEMENTATION");
  assert.equal(commandFor(NEXT_ACTIONS.CONTINUE_IMPLEMENTATION), undefined);
});

test("fresh continuity with remaining work keeps EXECUTING", async () => {
  const { nextActionForContinuity } = await import("../src/core/next-action-continuity.js");
  const result = nextActionForContinuity({
    context: { taskId: "task-1", currentPhase: "EXECUTING" },
    continuity: {
      classification: "FRESH",
      continuity: { remainingWork: [{ id: "contact", summary: "Finish contact form" }] },
      reasonCodes: [], reasons: [],
    },
  });
  assert.equal(result.nextAction, NEXT_ACTIONS.CONTINUE_IMPLEMENTATION);
  assert.equal(result.currentPhase, "EXECUTING");
  assert.equal(result.terminal, false);
  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.requiredArtifacts, [taskArtifactPath("task-1", "continuity"), taskArtifactPath("task-1", "state")]);
});

test("fresh continuity without remaining work preserves existing verification transition", async () => {
  const { nextActionForContinuity } = await import("../src/core/next-action-continuity.js");
  const result = nextActionForContinuity({
    context: { taskId: "task-1", currentPhase: "EXECUTING" },
    continuity: { classification: "FRESH", continuity: { remainingWork: [] }, reasonCodes: [], reasons: [] },
  });
  assert.equal(result, null);
});

test("absent continuity preserves existing EXECUTING behavior", async () => {
  const { nextActionForContinuity } = await import("../src/core/next-action-continuity.js");
  assert.equal(nextActionForContinuity({
    context: { taskId: "task-1", currentPhase: "EXECUTING" },
    continuity: { classification: "ABSENT", reasons: ["CONTINUITY_ABSENT"], reasonCodes: [] },
  }), null);
});

test("stale or invalid continuity blocks premature verification", async () => {
  const { nextActionForContinuity } = await import("../src/core/next-action-continuity.js");
  const stale = nextActionForContinuity({
    context: { taskId: "task-1", currentPhase: "EXECUTING" },
    continuity: {
      classification: "RECONCILIATION_REQUIRED",
      reasonCodes: ["E_CONTINUITY_RECONCILIATION_REQUIRED"],
      reasons: ["CONTINUITY_WORK_STATE_CHANGED"],
    },
  });
  assert.equal(stale.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);
  assert.deepEqual(stale.commands, ["forgeloop reconcile-continuity --task task-1"]);
  assert.deepEqual(stale.reasonCodes, ["E_CONTINUITY_RECONCILIATION_REQUIRED"]);

  const invalid = nextActionForContinuity({
    context: { taskId: "task-1", currentPhase: "EXECUTING" },
    continuity: {
      classification: "INVALID",
      reasonCodes: ["E_CONTINUITY_INVALID"],
      reasons: ["bad continuity"],
    },
  });
  assert.equal(invalid.nextAction, NEXT_ACTIONS.RESOLVE_BLOCKER);
  assert.deepEqual(invalid.reasonCodes, ["E_CONTINUITY_INVALID"]);
});
