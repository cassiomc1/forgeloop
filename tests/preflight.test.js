import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";


import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent, validateEventLedger } from "../src/core/events.js";
import { createGate } from "./helpers/gates.js";
import { persistGate } from "../src/core/gate-artifact.js";
import { formatPreflightResult, runPreflight } from "../src/commands/preflight.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";

import { buildTaskArtifactPaths } from "../src/core/task-paths.js";
import { ensureFixtureTask, readRawFixtureText, overwriteFixtureText, overwriteFixtureStateBytes } from "./helpers/native-storage-fixture.js";

const packageRoot = getPackageRoot();
const taskId = "website-001";
const ARTIFACT_PATHS = buildTaskArtifactPaths(taskId);

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-preflight-"));
  try {
    await ensureFixtureTask(target, taskId, packageRoot);
    await appendProtocolEvent(target, { taskId, event: "TASK_RECEIVED" }, packageRoot, { taskId });
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function prepareWebsite(target, options = {}) {
  const {
    objective = "Prepare website",
    assumptions = [],
    unresolvedDecisions = [],
  } = options;
  const contract = createContract({
    taskId: "website-001",
    objective,
    assumptions,
    deliverables: ["website"],
    constraints: ["offline"],
    risks: [],
    verification: ["build"],
    successCriteria: ["build"],
    stopConditions: ["missing evidence"],
    unresolvedDecisions,
    sourceRefs: [],
  });
  await writeContract(target, contract, packageRoot, { taskId });
  const route = evaluateRoute({ workType: "complete-website", surfaces: ["ui"], platforms: ["web"] });
  const persistedRoute = await persistRoute(target, route, packageRoot, { contractFingerprint: contractFingerprint(contract), taskId });
  for (const gate of ["design", "quality", "threat-boundary"]) {
    await persistGate(target, createGate({
      taskId: contract.taskId,
      gate,
      status: "satisfied",
      requiredBy: ["test"],
      artifacts: [],
      decisions: [],
      unknowns: [],
      approvedAssumptions: [],
      evidence: [],
    }), packageRoot, { taskId });
  }
  return { contract, route, persistedRoute };
}

async function artifactHashes(target) {
  const hashes = {};
  for (const relativePath of [
    ARTIFACT_PATHS.contract,
    ARTIFACT_PATHS.route,
    ARTIFACT_PATHS.state,
    ARTIFACT_PATHS.preflight,
    ARTIFACT_PATHS.events,
    `${ARTIFACT_PATHS.gates}/design.json`,
    `${ARTIFACT_PATHS.gates}/quality.json`,
    `${ARTIFACT_PATHS.gates}/threat-boundary.json`,
  ]) {
    try {
      const bytes = await readRawFixtureText(target, path.join(target, relativePath));
      hashes[relativePath] = bytes === null ? null : createHash("sha256").update(bytes).digest("hex");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hashes[relativePath] = null;
    }
  }
  return hashes;
}

function manualWebsiteContract({ assumptions = [], unresolvedDecisions = [] } = {}) {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId: "website-001",
    objective: "Prepare website",
    assumptions,
    deliverables: ["website"],
    constraints: ["offline"],
    risks: [],
    verification: ["build"],
    successCriteria: ["build"],
    stopConditions: ["missing evidence"],
    unresolvedDecisions,
    sourceRefs: [],
  };
}

async function prepareManualWebsite(target, contract) {
  const contractPath = path.join(target, ARTIFACT_PATHS.contract);
  await overwriteFixtureText(target, contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  const route = evaluateRoute({ workType: "complete-website", surfaces: ["ui"], platforms: ["web"] });
  await persistRoute(target, route, packageRoot, { contractFingerprint: contractFingerprint(contract), taskId });
  for (const gate of ["design", "quality", "threat-boundary"]) {
    await persistGate(target, createGate({
      taskId: contract.taskId,
      gate,
      status: "satisfied",
      requiredBy: ["test"],
      artifacts: [],
      decisions: [],
      unknowns: [],
      approvedAssumptions: [],
      evidence: [],
    }), packageRoot, { taskId });
  }
}

test("preflight blocks missing contract and route with stable codes", async () => {
  await withTarget(async (target) => {
    const result = await runPreflight({ target, packageRoot, taskId });
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.errors.some((error) => error.code === "E_CONTRACT_MISSING"));
    assert.ok(result.errors.some((error) => error.code === "E_ROUTE_MISSING"));
  });
});

test("complete website preflight is ready only after required gates", async () => {
  await withTarget(async (target) => {
    await prepareWebsite(target);
    const result = await runPreflight({ target, packageRoot, taskId });
    assert.equal(result.status, "READY");
    assert.ok(result.requiredGates.includes("design"));
    assert.deepEqual(result.requiredGates, result.satisfiedGates);
  });
});

test("ready preflight persists its resumable checkpoint and lifecycle events", async () => {
  await withTarget(async (target) => {
    await prepareWebsite(target);

    const result = await runPreflight({ target, packageRoot, taskId });
    const ledger = await validateEventLedger(target, packageRoot, { taskId });

    assert.equal(result.status, "READY");
    assert.equal(ledger.valid, true);
    assert.equal((await readRawFixtureText(target, path.join(target, ARTIFACT_PATHS.state))).length > 0, true);
    assert.deepEqual(ledger.events.map((event) => event.event), [
      "TASK_RECEIVED",
      "CONTRACT_VALIDATED",
      "ROUTE_VALIDATED",
      "GATE_SATISFIED",
      "GATE_SATISFIED",
      "GATE_SATISFIED",
      "PREFLIGHT_READY",
      "TRANSACTION_COMMITTED",
    ]);
    assert.equal(await readRawFixtureText(target, path.join(target, ARTIFACT_PATHS.preflight)).then(Boolean), true);
  });
});

test("equivalent ready preflight rerun does not repeat lifecycle events", async () => {
  await withTarget(async (target) => {
    const { contract } = await prepareWebsite(target);
    await appendProtocolEvent(target, { taskId: contract.taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId });
    await appendProtocolEvent(target, { taskId: contract.taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId });

    assert.equal((await runPreflight({ target, packageRoot, taskId })).status, "READY");
    const eventsBefore = await readRawFixtureText(target, path.join(target, ARTIFACT_PATHS.events));

    assert.equal((await runPreflight({ target, packageRoot, taskId })).status, "READY");

    const eventsAfter = await readRawFixtureText(target, ARTIFACT_PATHS.events);
    assert.ok(eventsAfter.startsWith(eventsBefore));
    const appended = eventsAfter.slice(eventsBefore.length).trim().split("\n").map(line => JSON.parse(line));
    assert.equal(appended.length, 1);
    assert.equal(appended[0].event, "TRANSACTION_COMMITTED");
    assert.equal(appended[0].details.operation, "preflight");
    assert.equal((await validateEventLedger(target, packageRoot, { taskId })).valid, true);
  });
});

test("preflight rejects a conflicting ready lifecycle refresh before artifact mutation", async () => {
  await withTarget(async (target) => {
    const { contract } = await prepareWebsite(target);
    await appendProtocolEvent(target, { taskId: contract.taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId });
    await appendProtocolEvent(target, { taskId: contract.taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId });
    await appendProtocolEvent(target, {
      taskId: contract.taskId,
      event: "PREFLIGHT_READY",
      fingerprint: "a".repeat(64),
      details: {
        requiredGates: ["design", "quality", "threat-boundary"],
        satisfiedGates: ["design", "quality", "threat-boundary"],
      },
    }, packageRoot, { taskId });
    const before = await artifactHashes(target);

    await assert.rejects(
      () => runPreflight({ target, packageRoot, taskId }),
      (error) => error.code === "E_PHASE_CHRONOLOGY_INVALID"
        && error.message.includes("PREFLIGHT_READY already exists with different READY preflight details"),
    );

    assert.deepEqual(await artifactHashes(target), before);
    assert.equal((await validateEventLedger(target, packageRoot, { taskId })).valid, true);
  });
});

test("preflight rejects a stale route without state before persisting artifacts", async () => {
  await withTarget(async (target) => {
    await prepareWebsite(target);
    await writeContract(target, createContract({
      taskId: "website-001",
      objective: "Changed objective",
      deliverables: ["website"],
      constraints: ["offline"],
      risks: [],
      verification: ["build"],
      successCriteria: ["build"],
      stopConditions: ["missing evidence"],
      unresolvedDecisions: [],
      sourceRefs: [],
    }), packageRoot, { taskId });
    const before = await artifactHashes(target);

    await assert.rejects(
      () => runPreflight({ target, packageRoot, taskId }),
      (error) => error.code === "E_ROUTE_STALE",
    );

    assert.deepEqual(await artifactHashes(target), before);
  });
});

test("preflight rejects foreign gate task identities before persisting artifacts", async () => {
  await withTarget(async (target) => {
    await prepareWebsite(target);
    for (const gate of ["design", "quality", "threat-boundary"]) {
      await persistGate(target, createGate({
        taskId: "foreign-task",
        gate,
        status: "satisfied",
        requiredBy: ["test"],
        artifacts: [],
        decisions: [],
        unknowns: [],
        approvedAssumptions: [],
        evidence: [],
      }), packageRoot, { taskId });
    }
    const before = await artifactHashes(target);

    await assert.rejects(
      () => runPreflight({ target, packageRoot, taskId }),
      (error) => error.code === "E_GATE_TASK_MISMATCH",
    );

    assert.deepEqual(await artifactHashes(target), before);
  });
});

test("preflight rejects a mixed-task ledger before persisting artifacts", async () => {
  await withTarget(async (target) => {
    const { contract, route, persistedRoute } = await prepareWebsite(target);
    await writeWorkState(target, createWorkState({
      taskId: contract.taskId,
      contractFingerprint: contractFingerprint(contract),
      routeFingerprint: persistedRoute.fingerprint,
      repositoryFingerprint: { branch: null, head: null },
      phase: "ROUTED",
      previousPhase: "CONTRACT_READY",
      selectedGuides: route.guides,
      completedSteps: ["contract", "route"],
      pendingSteps: ["implementation"],
      checks: [],
      failures: [],
      blockers: [],
      verificationEvidence: [],
    }), { packageRoot, taskId });
    const eventsPath = ARTIFACT_PATHS.events;
    const events = (await readRawFixtureText(target, eventsPath)).trim().split("\n").map(line => JSON.parse(line));
    events[0].taskId = "foreign-task";
    await overwriteFixtureText(target, eventsPath, events.map(event => JSON.stringify(event)).join("\n") + "\n");
    const before = await artifactHashes(target);

    await assert.rejects(
      () => runPreflight({ target, packageRoot, taskId }),
      (error) => error.code === "E_TASK_CLAIM_OWNERSHIP_INCONSISTENT"
        && error.reasonCodes.includes("E_STORAGE_PAYLOAD_MISMATCH"),
    );

    assert.deepEqual(await artifactHashes(target), before);
  });
});

test("preflight rejects a malformed work state before persisting artifacts", async () => {
  await withTarget(async (target) => {
    await prepareWebsite(target);
    await overwriteFixtureStateBytes(target, taskId, "{ malformed");
    const before = await artifactHashes(target);

    await assert.rejects(
      () => runPreflight({ target, packageRoot, taskId }),
      (error) => error.code === "E_STORAGE_PAYLOAD_MISMATCH",
    );

    assert.deepEqual(await artifactHashes(target), before);
  });
});

test("preflight blocks unresolved contract decisions with stable guidance", async () => {
  await withTarget(async (target) => {
    await prepareWebsite(target, {
      unresolvedDecisions: ["Need the real production domain"],
    });

    const result = await runPreflight({ target, packageRoot, taskId });
    const issue = result.errors.find((error) => error.code === "E_CONTRACT_UNRESOLVED_DECISION");

    assert.equal(result.status, "BLOCKED");
    assert.deepEqual(issue?.decisions, ["Need the real production domain"]);
    assert.equal(issue?.decisionCount, 1);
    assert.match(issue?.next ?? "", /Resolve the blocking decision/);
    assert.match(formatPreflightResult(result), /NEXT: Resolve the blocking decision/);

    const events = (await readRawFixtureText(target, ARTIFACT_PATHS.events))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.event === "PREFLIGHT_BLOCKED"));
    assert.equal(events.some((event) => event.event === "PREFLIGHT_READY"), false);
  });
});

test("preflight bounds decision diagnostics and keeps human guidance generic", async () => {
  await withTarget(async (target) => {
    const decisions = Array.from(
      { length: 12 },
      (_, index) => `RAW-DECISION-${index}-` + "x".repeat(300),
    );
    await prepareWebsite(target, { unresolvedDecisions: decisions });

    const result = await runPreflight({ target, packageRoot, taskId, persist: false });
    const issue = result.errors.find((error) => error.code === "E_CONTRACT_UNRESOLVED_DECISION");
    const human = formatPreflightResult(result);

    assert.equal(result.status, "BLOCKED");
    assert.equal(issue?.decisions.length, 10);
    assert.ok(issue?.decisions.every((decision) => decision.length <= 240));
    assert.equal(issue?.decisions[0], decisions[0].slice(0, 240));
    assert.equal(issue?.decisionCount, 12);
    assert.equal(issue?.decisionsTruncated, true);
    assert.equal(issue?.message, "The current contract contains unresolved blocking decisions.");
    assert.match(issue?.next ?? "", /^Resolve the blocking decision/);
    for (const index of decisions.keys()) {
      const marker = `RAW-DECISION-${index}-`;
      assert.equal(issue?.message.includes(marker), false);
      assert.equal(issue?.next.includes(marker), false);
      assert.equal(human.includes(marker), false);
    }
  });
});

test("preflight rejects a manually persisted secret-like assumption without disclosure", async () => {
  await withTarget(async (target) => {
    const sensitiveValue = "sk-" + "S".repeat(20);
    const contract = manualWebsiteContract({
      assumptions: [{
        value: sensitiveValue,
        reason: "Exercise the rejected artifact boundary",
        scope: "local test",
        reversible: true,
        source: "agent-default",
      }],
    });
    await prepareManualWebsite(target, contract);

    const result = await runPreflight({ target, packageRoot, taskId, persist: false });
    const json = JSON.stringify(result);
    const human = formatPreflightResult(result);

    assert.equal(result.status, "BLOCKED");
    assert.ok(result.errors.some((error) => error.code === "E_CONTRACT_INVALID"));
    assert.equal(result.errors.some((error) => error.code === "E_CONTRACT_UNRESOLVED_DECISION"), false);
    assert.equal(json.includes(sensitiveValue), false);
    assert.equal(human.includes(sensitiveValue), false);
    assert.doesNotMatch(human, /FORGELOOP PREFLIGHT: READY/);
  });
});

test("secret-like unresolved decisions are rejected before diagnostic preview", async () => {
  await withTarget(async (target) => {
    const sensitiveValue = "ghp-" + "T".repeat(20);
    const contract = manualWebsiteContract({ unresolvedDecisions: [sensitiveValue] });
    await prepareManualWebsite(target, contract);

    const result = await runPreflight({ target, packageRoot, taskId, persist: false });
    const json = JSON.stringify(result);
    const human = formatPreflightResult(result);

    assert.equal(result.status, "BLOCKED");
    assert.ok(result.errors.some((error) => error.code === "E_CONTRACT_INVALID"));
    assert.equal(result.errors.some((error) => error.code === "E_CONTRACT_UNRESOLVED_DECISION"), false);
    assert.equal(json.includes(sensitiveValue), false);
    assert.equal(human.includes(sensitiveValue), false);
  });
});

test("safe assumptions do not block an otherwise valid preflight", async () => {
  await withTarget(async (target) => {
    await prepareWebsite(target, {
      assumptions: [{
        value: "Use a fictional law-firm identity",
        reason: "No real branding was supplied",
        scope: "local prototype",
        reversible: true,
        source: "agent-default",
      }],
      unresolvedDecisions: [],
    });

    const result = await runPreflight({ target, packageRoot, taskId });
    assert.equal(result.status, "READY");
    assert.equal(result.errors.some((error) => error.code === "E_CONTRACT_UNRESOLVED_DECISION"), false);
  });
});
