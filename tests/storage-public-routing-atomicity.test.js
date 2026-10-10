import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { ensureSemanticDecision } from "../src/core/decision/service.js";
import {
  buildExecutionProfileQuestionSet,
  buildRouteQuestionSet,
} from "../src/core/decision/question-registry.js";
import {
  clearTestSemanticProvider,
  installTestSemanticProvider,
  testSemanticProvider,
} from "../src/core/decision/test-provider.js";
import { canonicalFingerprint } from "../src/core/artifacts.js";
import { createContract, readContract } from "../src/core/contract.js";
import { detectProjectEvidence } from "../src/core/project-detection.js";
import { evaluateRoute } from "../src/core/router.js";
import { readTaskDescriptor } from "../src/core/task-descriptor.js";
import { getPackageRoot } from "../src/core/templates.js";
import { openStorageDatabase } from "../src/storage/index.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();
const ROUTE_INPUT = Object.freeze({
  workType: "documentation",
  surfaces: ["config"],
  risks: [],
  platforms: [],
  behaviorChange: false,
  executableChange: false,
});

function database(target) {
  return openStorageDatabase(path.join(target, ".forgeloop", "state.sqlite"));
}

function snapshot(db) {
  return db.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map(({ name }) => ({
    name,
    rows: db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
      .map((row) => JSON.stringify(row))
      .sort(),
  }));
}

function eventRows(db, taskId) {
  return db.prepare(
    "SELECT seq, event_type, event_json FROM events WHERE task_id = ? ORDER BY seq",
  ).all(taskId).map((row) => ({
    ...row,
    event: JSON.parse(row.event_json),
  }));
}

function installEventFault(db, triggerName, eventType, message) {
  db.exec(`CREATE TRIGGER "${triggerName}" AFTER INSERT ON events
    WHEN NEW.event_type = '${eventType}'
    BEGIN SELECT RAISE(ABORT, '${message}'); END`);
}

function installArtifactFault(db, triggerName, artifactKind, message) {
  db.exec(`CREATE TRIGGER "${triggerName}" AFTER INSERT ON task_artifacts
    WHEN NEW.kind = '${artifactKind}'
    BEGIN SELECT RAISE(ABORT, '${message}'); END`);
}

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-public-routing-atomicity-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function invoke(target, command, input) {
  return executeForgeLoopCommand({ command, projectPath: target, input });
}

async function primeRouteDecisions(target, taskId, routeInput) {
  const contract = (await readContract(target, packageRoot, { taskId })).value;
  const descriptor = (await readTaskDescriptor(target, taskId, packageRoot)).value;
  const projectEvidence = await detectProjectEvidence(target, { claims: descriptor.writeClaims ?? [] });
  const deterministicInput = {
    ...routeInput,
    ...(projectEvidence ? { projectEvidence } : {}),
  };
  const deterministicRoute = evaluateRoute(deterministicInput, {
    contract,
    taskDescriptor: descriptor,
    configuredProfile: "auto",
    requestedProfile: null,
  });
  await ensureSemanticDecision({
    target,
    packageRoot,
    taskId,
    provider: testSemanticProvider,
    request: {
      decisionKind: "INTAKE",
      questionSetId: "intake-v1",
      state: { routeInput: deterministicRoute.input },
    },
  });
  const routeQuestionSet = buildRouteQuestionSet(deterministicRoute.guides);
  await ensureSemanticDecision({
    target,
    packageRoot,
    taskId,
    provider: testSemanticProvider,
    request: {
      decisionKind: "ROUTE",
      questionSetId: routeQuestionSet.id,
      questionSet: routeQuestionSet,
      state: {
        routeInput: deterministicRoute.input,
        eligibleGuides: deterministicRoute.guides.map((guide) => ({
          id: guide,
          reasons: deterministicRoute.reasons[guide],
        })),
      },
      candidateIds: deterministicRoute.guides,
      candidateSetFingerprint: canonicalFingerprint(deterministicRoute.guides),
    },
  });
  const profileQuestionSet = buildExecutionProfileQuestionSet();
  await ensureSemanticDecision({
    target,
    packageRoot,
    taskId,
    provider: testSemanticProvider,
    request: {
      decisionKind: "EXECUTION_PROFILE",
      questionSetId: profileQuestionSet.id,
      questionSet: profileQuestionSet,
      state: {
        routeInput: deterministicRoute.input,
        deterministicFloor: deterministicRoute.executionProfile.floor,
        requestedProfile: deterministicRoute.executionProfile.requested,
      },
    },
  });
}

async function prepareRoutableTask(target, taskId) {
  const contract = createContract({
    taskId,
    objective: "Exercise public route and preflight atomicity",
    deliverables: ["src"],
    constraints: [],
    risks: [],
    verification: ["focused route and preflight checks"],
    successCriteria: ["public persistence remains atomic"],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  await writeFile(path.join(target, "fixture-contract.json"), `${JSON.stringify(contract)}\n`);
  for (const [command, input] of [
    ["task-create", { taskId, claims: [] }],
    ["discover", { taskId }],
    ["contract-create", { taskId, contractFile: "fixture-contract.json" }],
  ]) {
    const result = await invoke(target, command, input);
    assert.equal(result.ok, true, `${command} fixture failed: ${JSON.stringify(result)}`);
  }
  await primeRouteDecisions(target, taskId, ROUTE_INPUT);
}

async function assertRouteFaultRollbackAndRetry(target, db, taskId) {
  const before = snapshot(db);
  const beforeEvents = eventRows(db, taskId);
  const input = { taskId, ...ROUTE_INPUT };
  installEventFault(db, "public_route_event_fault", "ROUTE_VALIDATED", "PUBLIC_ROUTE_EVENT_FAULT");
  try {
    const failed = await invoke(target, "route", input);
    assert.equal(failed.ok, false, JSON.stringify(failed));
    assert.match(JSON.stringify(failed.error), /PUBLIC_ROUTE_EVENT_FAULT/);
    assert.deepEqual(snapshot(db), before, "public route failure changed canonical rows");
    assert.equal(db.isTransaction, false, "public route failure left a transaction open");
  } finally {
    db.exec("DROP TRIGGER public_route_event_fault");
  }

  const retried = await invoke(target, "route", input);
  assert.equal(retried.ok, true, JSON.stringify(retried));
  const after = snapshot(db);
  assert.notDeepEqual(after, before, "public route retry must publish its route state");
  const afterEvents = eventRows(db, taskId);
  const routeEventsBefore = beforeEvents.filter((row) => row.event_type === "ROUTE_VALIDATED").length;
  const routeEventsAfter = afterEvents.filter((row) => row.event_type === "ROUTE_VALIDATED");
  assert.equal(routeEventsAfter.length, routeEventsBefore + 1, "retry must publish one ROUTE_VALIDATED event");
  const routeEvent = routeEventsAfter.at(-1);
  const commitsBefore = beforeEvents.filter((row) => row.event_type === "TRANSACTION_COMMITTED"
    && row.event?.details?.operation === "route").length;
  const commitsAfter = afterEvents.filter((row) => row.event_type === "TRANSACTION_COMMITTED"
    && row.event?.details?.operation === "route");
  assert.equal(commitsAfter.length, commitsBefore + 1, "retry must publish one route commit witness");
  assert.equal(commitsAfter.at(-1).seq, routeEvent.seq + 1, "route commit must immediately follow ROUTE_VALIDATED");
  assert.equal(commitsAfter.at(-1).event.details.operation, "route");
  assert.equal(retried.result.input.workType, ROUTE_INPUT.workType);
  assert.equal(db.isTransaction, false, "public route retry left a transaction open");
}

async function assertPreflightFaultRollbackAndRetry(target, db, taskId) {
  const before = snapshot(db);
  const beforeEvents = eventRows(db, taskId);
  installArtifactFault(db, "public_preflight_artifact_fault", "preflight", "PUBLIC_PREFLIGHT_ARTIFACT_FAULT");
  try {
    const failed = await invoke(target, "preflight", { taskId });
    assert.equal(failed.ok, false, JSON.stringify(failed));
    assert.match(JSON.stringify(failed.error), /PUBLIC_PREFLIGHT_ARTIFACT_FAULT/);
    assert.deepEqual(snapshot(db), before, "public preflight failure changed canonical rows");
    assert.equal(db.isTransaction, false, "public preflight failure left a transaction open");
  } finally {
    db.exec("DROP TRIGGER public_preflight_artifact_fault");
  }

  const retried = await invoke(target, "preflight", { taskId });
  assert.equal(retried.ok, true, JSON.stringify(retried));
  assert.equal(retried.result.status, "READY", JSON.stringify(retried.result));
  assert.equal(retried.exitCode, 0);
  const after = snapshot(db);
  assert.notDeepEqual(after, before, "public preflight retry must publish its READY result");
  const afterEvents = eventRows(db, taskId);
  const readyBefore = beforeEvents.filter((row) => row.event_type === "PREFLIGHT_READY").length;
  const readyAfter = afterEvents.filter((row) => row.event_type === "PREFLIGHT_READY");
  assert.equal(readyAfter.length, readyBefore + 1, "retry must publish one PREFLIGHT_READY event");
  const readyEvent = readyAfter.at(-1);
  const commitsBefore = beforeEvents.filter((row) => row.event_type === "TRANSACTION_COMMITTED"
    && row.event?.details?.operation === "preflight").length;
  const commitsAfter = afterEvents.filter((row) => row.event_type === "TRANSACTION_COMMITTED"
    && row.event?.details?.operation === "preflight");
  assert.equal(commitsAfter.length, commitsBefore + 1, "retry must publish one preflight commit witness");
  assert.equal(commitsAfter.at(-1).seq, readyEvent.seq + 1, "preflight commit must immediately follow PREFLIGHT_READY");
  assert.equal(commitsAfter.at(-1).event.details.operation, "preflight");
  const artifact = db.prepare("SELECT COUNT(*) AS count FROM task_artifacts WHERE task_id = ? AND kind = 'preflight'")
    .get(taskId);
  assert.equal(artifact.count, 1, "clean retry must retain one preflight artifact");
  assert.equal(db.isTransaction, false, "public preflight retry left a transaction open");
}

test.after(() => clearTestSemanticProvider());
installTestSemanticProvider();

test("public route rolls back route artifact/state and ROUTE_VALIDATED publication, then retries cleanly", async () => {
  await withTarget(async (target) => {
    const taskId = "public-route-atomicity";
    await prepareRoutableTask(target, taskId);
    const db = database(target);
    try {
      await assertRouteFaultRollbackAndRetry(target, db, taskId);
    } finally {
      db.close();
    }
  });
});

test("public preflight rolls back artifact and PREFLIGHT_READY publication, then retries cleanly", async () => {
  await withTarget(async (target) => {
    const taskId = "public-preflight-atomicity";
    await prepareRoutableTask(target, taskId);
    const routed = await invoke(target, "route", { taskId, ...ROUTE_INPUT });
    assert.equal(routed.ok, true, JSON.stringify(routed));
    const db = database(target);
    try {
      await assertPreflightFaultRollbackAndRetry(target, db, taskId);
    } finally {
      db.close();
    }
  });
});
