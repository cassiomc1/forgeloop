import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTempTree } from "./helpers/rm-safe.js";
import { runComplete } from "../src/commands/complete.js";
import { runPreflight } from "../src/commands/preflight.js";
import { createCheck } from "../src/core/checks.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { coverageForRequirements, createCoverage } from "../src/core/coverage.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { createEvidence } from "../src/core/evidence.js";
import { evaluateCompletion, VERIFICATION_STATUS_INVALID, VERIFICATION_STATUS_VALID, VERIFICATION_STATUSES } from "../src/core/completion.js";
import { canonicalFingerprint, writeJsonArtifact } from "../src/core/artifacts.js";
import { prepareCompletion } from "../src/core/completion-artifacts.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { getPackageRoot } from "../src/core/templates.js";

import { buildTaskArtifactPaths } from "../src/core/task-paths.js";
import { ensureFixtureTask, readRawFixtureText, overwriteFixtureText, deleteFixtureArtifact } from "./helpers/native-storage-fixture.js";

const packageRoot = getPackageRoot();
const taskId = "task-complete";
const ARTIFACT_PATHS = buildTaskArtifactPaths(taskId);

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-complete-"));
  try {
    await ensureFixtureTask(target, taskId, packageRoot);
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function prepareValidTask(target, {
  receiptOverrides = {},
  events,
  requirement = "tests",
  checkId = requirement,
} = {}) {
  const contract = createContract({
    taskId: "task-complete",
    objective: "Validate a complete task",
    deliverables: ["src/example.js"],
    constraints: ["offline"],
    risks: [],
    verification: [requirement],
    successCriteria: [requirement],
    stopConditions: ["verification unavailable"],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  await writeContract(target, contract, packageRoot, { taskId });
  const route = evaluateRoute({ workType: "api", surfaces: ["api"], platforms: [] });
  const persistedRoute = await persistRoute(target, route, packageRoot, { contractFingerprint: contractHash, taskId });
  const check = createCheck({
    id: checkId,
    kind: "manual-review",
    requirement,
    status: "passed",
    evidenceKind: "OBSERVED",
    source: "npm test",
    exitCode: 0,
  });
  const evidence = createEvidence({ kind: "OBSERVED", source: "npm test", result: "exit 0" });
  const coverage = [createCoverage({
    requirement,
    requiredEvidence: [requirement],
    observedEvidence: [requirement],
  })];
  const state = createWorkState({
    taskId: contract.taskId,
    contractFingerprint: contractHash,
    routeFingerprint: persistedRoute.fingerprint,
    repositoryFingerprint: { branch: null, head: null },
    phase: "REVIEWING",
    previousPhase: "VERIFYING",
    selectedGuides: route.guides,
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: ["contract", "route", "execution", "verification"],
    pendingSteps: [],
    checks: [check],
    failures: [],
    blockers: [],
    verificationEvidence: [evidence],
    evidenceCoverage: coverage,
  });
  await writeWorkState(target, state, { packageRoot, taskId });
  const receipt = {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId: contract.taskId,
    contractFingerprint: contractHash,
    routeFingerprint: persistedRoute.fingerprint,
    stateFingerprint: canonicalFingerprint(state),
    status: "complete",
    taskStatus: "complete",
    verificationStatus: "valid",
    publicationStatus: "local-only",
    productionReadiness: "not-verified",
    selectedGuides: route.guides,
    changedPaths: ["src/example.js"],
    checks: [check],
    evidence: [evidence],
    evidenceCoverage: coverage,
    review: { status: "approved", independent: false },
    limitations: [],
    publication: { committed: false, pushed: false, pullRequest: null, deployed: false },
    ...receiptOverrides,
  };
  await writeJsonArtifact(target, ARTIFACT_PATHS.receipt, receipt, "execution-receipt", packageRoot, { taskId });
  for (const event of [
    "TASK_RECEIVED",
    "CONTRACT_VALIDATED",
    "ROUTE_VALIDATED",
  ]) {
    await appendProtocolEvent(target, { taskId: contract.taskId, event }, packageRoot, { taskId });
  }
  assert.equal((await runPreflight({ target, packageRoot, taskId })).status, "READY");
  if (events) {
    await deleteFixtureArtifact(target, path.join(target, ARTIFACT_PATHS.events));
    for (const event of events) {
      await appendProtocolEvent(target, { taskId: contract.taskId, event }, packageRoot, { taskId });
    }
  } else {
    for (const event of ["EXECUTION_STARTED", "VERIFICATION_STARTED", "VERIFICATION_RECORDED"]) {
      await appendProtocolEvent(target, { taskId: contract.taskId, event }, packageRoot, { taskId });
    }
  }
  return { contract, route, receipt };
}

async function artifactHashes(target) {
  const hashes = {};
  for (const relativePath of [ARTIFACT_PATHS.state, ARTIFACT_PATHS.receipt, ARTIFACT_PATHS.events]) {
    const bytes = await readRawFixtureText(target, path.join(target, relativePath));
    hashes[relativePath] = createHash("sha256").update(bytes).digest("hex");
  }
  return hashes;
}

test("complete rejects a task without a current contract", async () => {
  await withTarget(async (target) => {
    const result = await runComplete({ target, packageRoot, taskId, persist: false });
    assert.equal(result.status, "REJECTED");
    assert.ok(result.errors.some((error) => error.code === "E_CONTRACT_MISSING"));
  });
});

test("complete rejects a required observed check backed only by inferred evidence", async () => {
  await withTarget(async (target) => {
    await prepareValidTask(target);
    const receiptPath = path.join(target, ARTIFACT_PATHS.receipt);
    const receipt = JSON.parse(await readRawFixtureText(target, receiptPath));
    receipt.checks[0] = createCheck({
      ...receipt.checks[0],
      evidenceKind: "INFERRED",
    });
    await writeJsonArtifact(target, ARTIFACT_PATHS.receipt, receipt, "execution-receipt", packageRoot, { taskId });
    const result = await runComplete({
      target,
      packageRoot,
      taskId,
      persist: false,
    });
    assert.equal(result.status, "REJECTED");
    assert.ok(result.errors.some((error) => error.code === "E_EVIDENCE_KIND_INVALID"));
  });
});

test("complete validates a coherent task and keeps publication independent", async () => {
  await withTarget(async (target) => {
    const result = await prepareValidTask(target);
    const completion = await runComplete({ target, packageRoot, taskId, persist: false });
    assert.equal(completion.status, "VALID");
    assert.equal(completion.taskStatus, "COMPLETE");
    assert.equal(completion.verificationStatus, "VALID");
    assert.equal(completion.publicationStatus, "local-only");
    assert.equal(result.receipt.productionReadiness, "not-verified");

    // VERIFY-CANON-1: the runtime value is produced from the canonical constant.
    assert.equal(completion.verificationStatus, VERIFICATION_STATUS_VALID);
    assert.ok(VERIFICATION_STATUSES.includes(completion.verificationStatus));
  });
});

test("complete reports a REJECTED completion with the canonical invalid verification status", async () => {
  await withTarget(async (target) => {
    const result = await runComplete({ target, packageRoot, taskId, persist: false });
    assert.equal(result.status, "REJECTED");

    // VERIFY-CANON-2: the runtime value is produced from the canonical constant.
    assert.equal(result.verificationStatus, VERIFICATION_STATUS_INVALID);
    assert.ok(VERIFICATION_STATUSES.includes(result.verificationStatus));
  });
});

test("complete matches required evidence to its check requirement, not only the check id", async () => {
  await withTarget(async (target) => {
    await prepareValidTask(target, {
      checkId: "check-documentation",
    });
    const completion = await runComplete({ target, packageRoot, taskId, persist: false });
    assert.equal(completion.status, "VALID", JSON.stringify(completion.errors));
  });
});

test("prepare-completion rejects a foreign receipt without rebinding its evidence", async () => {
  await withTarget(async (target) => {
    await prepareValidTask(target);
    const receiptPath = path.join(target, ARTIFACT_PATHS.receipt);
    const receipt = JSON.parse(await readRawFixtureText(target, receiptPath));
    receipt.taskId = "foreign-task";
    await writeJsonArtifact(target, ARTIFACT_PATHS.receipt, receipt, "execution-receipt", packageRoot, { taskId });
    const before = await artifactHashes(target);

    await assert.rejects(
      () => prepareCompletion({ target, packageRoot, taskId }),
      (error) => error.code === "E_RECEIPT_TASK_MISMATCH",
    );

    assert.deepEqual(await artifactHashes(target), before);
  });
});

test("prepare-completion rejects a receipt missing its state fingerprint without rewriting it", async () => {
  await withTarget(async (target) => {
    await prepareValidTask(target);
    const receiptPath = path.join(target, ARTIFACT_PATHS.receipt);
    const receipt = JSON.parse(await readRawFixtureText(target, receiptPath));
    delete receipt.stateFingerprint;
    await writeJsonArtifact(target, ARTIFACT_PATHS.receipt, receipt, "execution-receipt", packageRoot, { taskId });
    const before = await artifactHashes(target);

    await assert.rejects(
      () => prepareCompletion({ target, packageRoot, taskId }),
      (error) => error.code === "E_RECEIPT_STATE_MISMATCH",
    );

    assert.deepEqual(await artifactHashes(target), before);
  });
});

test("complete fails closed for stale receipt/state bindings and inconsistent checks", async (t) => {
  const cases = [
    ["missing receipt state fingerprint", async ({ receipt }) => {
      delete receipt.stateFingerprint;
    }, "E_RECEIPT_STATE_MISMATCH"],
    ["stale receipt state fingerprint", async ({ receipt }) => {
      receipt.stateFingerprint = "a".repeat(64);
    }, "E_RECEIPT_STATE_MISMATCH"],
    ["malformed state checks", async ({ state, receipt }) => {
      state.checks = [{ id: "tests" }];
      receipt.stateFingerprint = canonicalFingerprint(state);
    }, "E_CHECK_INVALID"],
    ["divergent receipt and state checks", async ({ state, receipt }) => {
      state.checks = [];
      state.evidenceCoverage = coverageForRequirements(["tests"], state.checks);
      receipt.stateFingerprint = canonicalFingerprint(state);
    }, "E_RECEIPT_STATE_MISMATCH"],
  ];

  for (const [name, mutate, expectedCode] of cases) {
    await t.test(name, async () => {
      await withTarget(async (target) => {
        await prepareValidTask(target);
        const statePath = path.join(target, ARTIFACT_PATHS.state);
        const receiptPath = path.join(target, ARTIFACT_PATHS.receipt);
        const state = JSON.parse(await readRawFixtureText(target, statePath));
        const receipt = JSON.parse(await readRawFixtureText(target, receiptPath));
        await mutate({ state, receipt });
        await overwriteFixtureText(target, statePath, `${JSON.stringify(state, null, 2)}\n`);
        await writeJsonArtifact(target, ARTIFACT_PATHS.receipt, receipt, "execution-receipt", packageRoot, { taskId });
        const before = await artifactHashes(target);

        const result = await runComplete({ target, packageRoot, taskId, persist: true });

        assert.equal(result.status, "REJECTED");
        assert.ok(result.errors.some((error) => error.code === expectedCode));
        assert.deepEqual(await artifactHashes(target), before);
      });
    });
  }
});

test("complete requires the ordered verification milestones before writing", async (t) => {
  const validPrefix = [
    "CONTRACT_VALIDATED",
    "ROUTE_VALIDATED",
    "PREFLIGHT_READY",
    "EXECUTION_STARTED",
    "VERIFICATION_STARTED",
    "VERIFICATION_RECORDED",
  ];
  const cases = [
    ["missing verification start", validPrefix.filter((event) => event !== "VERIFICATION_STARTED")],
    ["verification recorded before execution", [
      "CONTRACT_VALIDATED",
      "ROUTE_VALIDATED",
      "PREFLIGHT_READY",
      "VERIFICATION_RECORDED",
      "EXECUTION_STARTED",
      "VERIFICATION_STARTED",
    ]],
    ...validPrefix.slice(1).map((event, index) => {
      const order = [...validPrefix];
      [order[index], order[index + 1]] = [order[index + 1], order[index]];
      return [`${event} before ${validPrefix[index]}`, order];
    }),
  ];

  for (const [name, events] of cases) {
    await t.test(name, async () => {
      await withTarget(async (target) => {
        await prepareValidTask(target, { events });
        const before = await artifactHashes(target);

        const result = await evaluateCompletion({ target, packageRoot, taskId });
        assert.equal(result.status, "REJECTED");
        assert.ok(result.errors.some((error) => error.code === "E_PHASE_CHRONOLOGY_INVALID"));
        await assert.rejects(runComplete({ target, packageRoot, taskId, persist: true }), error =>
          error.code === "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT"
          && error.reasonCodes.includes("E_PHASE_CHRONOLOGY_INVALID"));
        assert.deepEqual(await artifactHashes(target), before);
      });
    });
  }
});
