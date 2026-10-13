import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp } from "node:fs/promises";
import { removeTempTree } from "./helpers/rm-safe.js";
import { getPackageRoot } from "../src/core/templates.js";
import {
  assertDecisionCriterionDetails,
  criterionForDecision,
  decisionId,
  normalizeDecisionText,
} from "../src/core/settlement-model.js";
import { recordDecisionCriterion } from "../src/core/settlement.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent, readEvents, validateEventLedger } from "../src/core/events.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { getNextAction } from "../src/core/next-action.js";
import { formatNextActionResult } from "../src/commands/next.js";
import { runPreflight } from "../src/commands/preflight.js";

const packageRoot = getPackageRoot();

test("settlement pure model - decisionId & normalization", () => {
  assert.equal(normalizeDecisionText("  Which   Provider?  "), "which provider?");
  const id1 = decisionId("Which Auth Provider?");
  const id2 = decisionId("  which   auth provider?  ");
  assert.equal(id1, id2);
  assert.match(id1, /^decision-[a-f0-9]{16}$/);
});

test("settlement pure model - assertDecisionCriterionDetails", () => {
  const dec = "Which database to use?";
  const valid = {
    decision: dec,
    decisionId: decisionId(dec),
    settledBy: "Use SQLite for local tests",
    contractFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  };
  assert.doesNotThrow(() => assertDecisionCriterionDetails(valid));

  // Mismatched decisionId
  assert.throws(() => assertDecisionCriterionDetails({ ...valid, decisionId: "decision-wrongid123456" }), { code: "E_DECISION_CRITERION_INVALID" });
  // Empty settledBy
  assert.throws(() => assertDecisionCriterionDetails({ ...valid, settledBy: "  " }), { code: "E_DECISION_CRITERION_INVALID" });
  // Invalid contractFingerprint
  assert.throws(() => assertDecisionCriterionDetails({ ...valid, contractFingerprint: "short" }), { code: "E_DECISION_CRITERION_INVALID" });
});

test("recordDecisionCriterion persists in event ledger and respects contract binding", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-settlement-test-"));
  try {
    const taskId = "task-settlement-1";
    await ensureFixtureTask(target, taskId, packageRoot);
    const decisionText = "Which authentication provider should be used?";

    const contract = createContract({
      taskId,
      objective: "Test decision criteria",
      deliverables: ["src/auth.js"],
      constraints: [],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests pass"],
      stopConditions: [],
      unresolvedDecisions: [decisionText],
      sourceRefs: [],
    });
    const contractHash = contractFingerprint(contract);
    await writeContract(target, contract, packageRoot, { taskId });

    await appendProtocolEvent(target, { taskId, event: "TASK_RECEIVED" }, packageRoot, { taskId });
    await appendProtocolEvent(target, { taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId });

    // Valid record
    const res = await recordDecisionCriterion({
      target,
      packageRoot,
      decision: decisionText,
      settledBy: "Choose provider supporting existing session middleware",
      taskId,
    });

    assert.equal(res.event.event, "DECISION_CRITERION_RECORDED");
    assert.equal(res.criterion.decision, decisionText);
    assert.equal(res.criterion.decisionId, decisionId(decisionText));
    assert.equal(res.criterion.contractFingerprint, contractHash);

    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);

    // Reject if decision is not in contract unresolvedDecisions
    await assert.rejects(
      () => recordDecisionCriterion({
        target,
        packageRoot,
        decision: "Non-existent decision?",
        settledBy: "Some criterion",
        taskId,
      }),
      { code: "E_DECISION_NOT_UNRESOLVED" }
    );

    // Reject if settledBy is empty
    await assert.rejects(
      () => recordDecisionCriterion({
        target,
        packageRoot,
        decision: decisionText,
        settledBy: "   ",
        taskId,
      }),
      { code: "E_DECISION_CRITERION_INVALID" }
    );

    // Record newer criterion for same decision
    const res2 = await recordDecisionCriterion({
      target,
      packageRoot,
      decision: decisionText,
      settledBy: "Updated settlement criterion",
      taskId,
    });
    assert.equal(res2.criterion.settledBy, "Updated settlement criterion");

    const events = await readEvents(target, packageRoot, { taskId });
    const criterion = criterionForDecision(events, taskId, decisionText, contractHash);
    assert.equal(criterion.settledBy, "Updated settlement criterion");

    // Stale contract fingerprint lookup returns null
    const staleLookup = criterionForDecision(events, taskId, decisionText, "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    assert.equal(staleLookup, null);

  } finally {
    await removeTempTree(target);
  }
});

test("forgeloop next surfaces multiple settlement criteria without fabricating missing ones", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-settlement-multi-"));
  try {
    const taskId = "task-multi-criteria";
    await ensureFixtureTask(target, taskId, packageRoot);
    const unresolvedDecisions = [
      "Which cache store to use?",
      "Which queue driver to use?",
      "Which cloud region to deploy to?",
    ];

    const contract = createContract({
      taskId,
      objective: "Test multiple settlement criteria",
      deliverables: ["src/app.js"],
      constraints: [],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests pass"],
      stopConditions: [],
      unresolvedDecisions,
      sourceRefs: [],
    });

    const contractHash = contractFingerprint(contract);
    await writeContract(target, contract, packageRoot, { taskId });

    await appendProtocolEvent(target, { taskId, event: "TASK_RECEIVED" }, packageRoot, { taskId });
    await appendProtocolEvent(target, { taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId });

    const route = evaluateRoute({ workType: "code", surfaces: ["config"], platforms: [] });
    const persistedRoute = await persistRoute(target, route, packageRoot, {
      contractFingerprint: contractHash,
      taskId,
    });
    await appendProtocolEvent(target, { taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId });

    const state = createWorkState({
      taskId,
      contractFingerprint: contractHash,
      routeFingerprint: persistedRoute.fingerprint,
      repositoryFingerprint: { branch: null, head: null },
      phase: "PLANNED",
      selectedGuides: [...persistedRoute.value.guides],
      requiredGates: [],
      satisfiedGates: [],
      completedSteps: ["planning"],
      pendingSteps: ["execute"],
      checks: [],
      failures: [],
      blockers: [],
      verificationEvidence: [],
    });
    await writeWorkState(target, state, { packageRoot, taskId });
    await runPreflight({ target, packageRoot, taskId });

    // Record criteria for 2 of the 3 decisions
    await recordDecisionCriterion({
      target,
      packageRoot,
      taskId,
      decision: "Which cache store to use?",
      settledBy: "Use Redis in-memory cache",
    });

    await recordDecisionCriterion({
      target,
      packageRoot,
      taskId,
      decision: "Which queue driver to use?",
      settledBy: "Use SQS or local in-memory emitter",
    });

    const next = await getNextAction({ target, packageRoot, taskId });
    const decisionReason = next.reasons.find((r) => r.code === "E_CONTRACT_UNRESOLVED_DECISION" || r.code === "E_UNRESOLVED_DECISION");
    assert.ok(decisionReason);
    assert.equal(decisionReason.resolution.kind, "SETTLEMENT_CRITERIA");
    assert.equal(decisionReason.resolution.items.length, 2);
    assert.equal(decisionReason.resolution.items[0].decision, "Which cache store to use?");
    assert.equal(decisionReason.resolution.items[0].settledBy, "Use Redis in-memory cache");
    assert.equal(decisionReason.resolution.items[1].decision, "Which queue driver to use?");
    assert.equal(decisionReason.resolution.items[1].settledBy, "Use SQS or local in-memory emitter");

    // Formatted text output verification
    const formatted = formatNextActionResult(next);
    assert.ok(formatted.includes("SETTLEMENT CRITERIA:"));
    assert.ok(formatted.includes("Which cache store to use?"));
    assert.ok(formatted.includes("SETTLED BY: Use Redis in-memory cache"));
    assert.ok(formatted.includes("Which queue driver to use?"));
    assert.ok(formatted.includes("SETTLED BY: Use SQS or local in-memory emitter"));
    // 3rd decision has no criterion
    assert.ok(!formatted.includes("Which cloud region to deploy to?\n    SETTLED BY:"));

  } finally {
    await removeTempTree(target);
  }
});
