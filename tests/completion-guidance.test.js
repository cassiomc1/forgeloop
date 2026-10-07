import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { removeTempTree } from "./helpers/rm-safe.js";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { formatAuditResult } from "../src/commands/audit.js";
import { formatCompleteResult } from "../src/commands/complete.js";
import { evaluateCompletion } from "../src/core/completion.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";

const packageRoot = getPackageRoot();

test("completion findings expose repair-oriented next actions", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-guidance-"));
  try {
    const contract = createContract({
      taskId: "task-guidance",
      objective: "Exercise repair guidance",
      deliverables: [],
      constraints: [],
      risks: [],
      verification: [],
      successCriteria: [],
      stopConditions: [],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    const contractHash = contractFingerprint(contract);
    await ensureFixtureTask(target, contract.taskId, packageRoot);
    await writeContract(target, contract, packageRoot, { taskId: contract.taskId });
    const route = evaluateRoute({ workType: "api", surfaces: ["api"], platforms: [] });
    const persistedRoute = await persistRoute(target, route, packageRoot, { contractFingerprint: contractHash, taskId: contract.taskId });
    await writeWorkState(target, createWorkState({
      taskId: contract.taskId,
      contractFingerprint: contractHash,
      routeFingerprint: persistedRoute.fingerprint,
      repositoryFingerprint: { branch: null, head: null },
      phase: "VERIFYING",
      previousPhase: "EXECUTING",
      selectedGuides: route.guides,
      completedSteps: ["implementation"],
      pendingSteps: ["verification"],
      checks: [],
      failures: [],
      blockers: [],
      verificationEvidence: [],
    }), { packageRoot, taskId: contract.taskId });
    const result = await evaluateCompletion({ target, packageRoot, taskId: contract.taskId });
    const receipt = result.errors.find((error) => error.code === "E_RECEIPT_MISSING");
    const chronology = result.errors.find((error) => error.code === "E_PHASE_CHRONOLOGY_INVALID");

    assert.equal(typeof receipt?.next, "string");
    assert.match(receipt.next, /prepare-completion|receipt/i);
    assert.equal(typeof chronology?.next, "string");
    assert.match(chronology.next, /phase|verification|event/i);
  } finally {
    await removeTempTree(target);
  }
});

test("human completion and audit output renders stable next actions", () => {
  const errors = [{
    code: "E_RECEIPT_MISSING",
    message: "Execution receipt is missing",
    next: "Run forgeloop prepare-completion after recording verification evidence.",
  }];
  assert.match(formatCompleteResult({
    status: "REJECTED",
    errors,
  }), /NEXT: Run forgeloop prepare-completion/);
  assert.match(formatAuditResult({
    status: "INVALID",
    errors,
  }), /NEXT: Run forgeloop prepare-completion/);
});
