import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { createCanonicalHandoff } from "../src/core/handoff.js";
import { recordStructuredDiagnosticCase } from "../src/core/diagnostic-record.js";
import { mutateWorkState, readWorkState } from "../src/core/work-state.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createContract } from "../src/core/contract.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { runDiscover } from "../src/commands/discover.js";
import { runContractCreate } from "../src/commands/contract-create.js";
import { runRoute } from "../src/commands/route.js";
import { runPreflight } from "../src/commands/preflight.js";
import { testSemanticProvider } from "../src/core/decision/test-provider.js";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();

function snapshot(db) {
  return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(({ name }) => ({
      name,
      rows: db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
        .all()
        .map((row) => JSON.stringify(row))
        .sort(),
    }));
}

function events(db, taskId) {
  return db.prepare("SELECT * FROM events WHERE task_id = ? ORDER BY seq").all(taskId)
    .map((row) => JSON.parse(row.event_json));
}

function assertOneTransitionWithCommit(db, taskId, eventType) {
  const ledger = events(db, taskId);
  const transitions = ledger.filter((event) => event.event === eventType);
  assert.equal(transitions.length, 1, `${eventType} must be published exactly once`);
  const transitionIndex = ledger.findIndex((event) => event.seq === transitions[0].seq);
  const commit = ledger[transitionIndex + 1];
  assert.equal(commit?.event, "TRANSACTION_COMMITTED", `${eventType} must be followed by a commit witness`);
  const operation = {
    RESPONSIBILITY_SET: "responsibility-set",
    HANDOFF_ACCEPTED: "handoff-accept",
    INTERVENTION_RECORDED: "record-intervention",
    HYPOTHESIS_DISPOSITION_RECORDED: "record-hypothesis-disposition",
    DECISION_CRITERION_RECORDED: "record-decision-criterion",
  }[eventType];
  assert.equal(commit?.details?.operation, operation, "commit witness must bind the exact public operation");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM events WHERE task_id = ? AND event_type = ?")
    .get(taskId, eventType).count, 1);
}

async function setupResponsibilityTask() {
  const target = await createGitRepository("forgeloop-responsibility-public-atomicity-");
  const taskId = "responsibility-public-atomicity";
  try {
    await runTaskCreate({ target, packageRoot, taskId, claims: ["src"] });
    await runDiscover({ target, packageRoot, taskId });
    const contract = createContract({
      taskId,
      objective: "Exercise public responsibility atomicity",
      deliverables: ["src"],
      constraints: [],
      risks: [],
      stopConditions: [],
      unresolvedDecisions: [],
      sourceRefs: [],
      verification: [{ id: "responsibility-check", text: "Responsibility remains atomic", type: "VERIFICATION" }],
      successCriteria: ["Responsibility remains atomic"],
    });
    await writeFile(path.join(target, "fixture-contract.json"), JSON.stringify(contract));
    await runContractCreate({ target, packageRoot, taskId, contractFile: "fixture-contract.json", semanticProvider: testSemanticProvider });
    await runRoute({ target, packageRoot, taskId, workType: "code", surfaces: ["config"], executableChange: true, semanticProvider: testSemanticProvider });
    assert.equal((await runPreflight({ target, packageRoot, taskId })).status, "READY");
    return { target, taskId };
  } catch (error) {
    await removeTempTree(target);
    throw error;
  }
}

function diagnosticCase() {
  return {
    schemaVersion: 1,
    failureClass: "VERIFICATION_FAILURE",
    observations: [{
      id: "obs-lint",
      kind: "CHECK_RESULT",
      evidenceRef: "check-auth-boundary",
      statement: "The fixture check reports the expected failure.",
    }],
    contributors: [],
    hypotheses: [{
      id: "h-public-atomicity",
      statement: "The fixture failure is caused by the controlled test condition.",
      contributorRefs: [],
      evidenceRefs: ["check-auth-boundary"],
      settledBy: { type: "CHECK_STATUS", checkId: "check-auth-boundary", expectedStatus: "passed" },
    }],
    nextSafeAction: { statement: "Apply the controlled correction." },
  };
}

async function setupDiagnosticTask() {
  const fixture = await buildCanonicalDiagnosisProject({ taskId: "secondary-diagnostic-atomicity" });
  try {
    const casePath = path.join(fixture.target, "diagnostic-case.json");
    await writeFile(casePath, JSON.stringify(diagnosticCase()));
    await recordStructuredDiagnosticCase({
      target: fixture.target,
      packageRoot,
      caseFile: "diagnostic-case.json",
      taskId: fixture.taskId,
    });
    const state = await readWorkState(fixture.target, { packageRoot, taskId: fixture.taskId });
    await mutateWorkState(fixture.target, {
      expectedRevision: state.revision ?? 0,
      packageRoot,
      taskId: fixture.taskId,
    }, () => ({ ...state, previousPhase: "DIAGNOSING", phase: "CORRECTING" }));
    return fixture;
  } catch (error) {
    await fixture.cleanup();
    throw error;
  }
}

async function setupSettlementTask() {
  const target = await createGitRepository("forgeloop-settlement-public-atomicity-");
  const taskId = "settlement-public-atomicity";
  const decision = "Which persistence boundary should this wrapper use?";
  try {
    await runTaskCreate({ target, packageRoot, taskId, claims: ["src"] });
    await runDiscover({ target, packageRoot, taskId });
    const contract = createContract({
      taskId,
      objective: "Exercise public settlement atomicity",
      deliverables: ["src"],
      constraints: [],
      risks: [],
      stopConditions: [],
      unresolvedDecisions: [decision],
      sourceRefs: [],
      verification: [{ id: "settlement-check", text: "Settlement remains atomic", type: "VERIFICATION" }],
      successCriteria: ["Settlement remains atomic"],
    });
    await writeFile(path.join(target, "fixture-contract.json"), JSON.stringify(contract));
    await runContractCreate({ target, packageRoot, taskId, contractFile: "fixture-contract.json", semanticProvider: testSemanticProvider });
    await runRoute({ target, packageRoot, taskId, workType: "code", surfaces: ["config"], executableChange: true, semanticProvider: testSemanticProvider });
    return { target, taskId, decision };
  } catch (error) {
    await removeTempTree(target);
    throw error;
  }
}

test("public responsibility-set rolls back its artifact and ledger on event publication failure", async () => {
  const fixture = await setupResponsibilityTask();
  const db = new DatabaseSync(path.join(fixture.target, ".forgeloop/state.sqlite"));
  try {
    const invoke = () => executeForgeLoopCommand({
      command: "responsibility-set",
      projectPath: fixture.target,
      input: {
        taskId: fixture.taskId,
        responsibilityLabel: "atomic responsibility",
        responsibilityAllowedPaths: ["src"],
        responsibilityReadOnlyPaths: [],
        responsibilityRequiredChecks: [],
        responsibilityFreezeContract: true,
        responsibilityFreezeRoute: true,
        responsibilityFreezeClaims: true,
      },
    });
    const before = snapshot(db);
    db.exec("CREATE TRIGGER secondary_responsibility_fault BEFORE INSERT ON events WHEN NEW.event_type='RESPONSIBILITY_SET' BEGIN SELECT RAISE(ABORT, 'SECONDARY_RESPONSIBILITY_FAULT'); END");
    try {
      const failed = await invoke();
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.match(JSON.stringify(failed.error), /SECONDARY_RESPONSIBILITY_FAULT/);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.isTransaction, false);
    } finally {
      db.exec("DROP TRIGGER secondary_responsibility_fault");
    }
    const retried = await invoke();
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.result.responsibility.label, "atomic responsibility");
    assertOneTransitionWithCommit(db, fixture.taskId, "RESPONSIBILITY_SET");
  } finally {
    db.close();
    await removeTempTree(fixture.target);
  }
});

test("public handoff-accept rolls back acceptance and ledger on event publication failure", async () => {
  const target = await createGitRepository("forgeloop-handoff-accept-public-atomicity-");
  const taskId = "handoff-accept-public-atomicity";
  const dbPath = path.join(target, ".forgeloop/state.sqlite");
  let db;
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });
    const created = await createCanonicalHandoff(target, {
      taskId,
      packageRoot,
      handoffId: "handoff-public-atomicity",
      recipientHint: "secondary-consumer",
      note: "Atomic acceptance test",
    });
    db = new DatabaseSync(dbPath);
    const invoke = () => executeForgeLoopCommand({
      command: "handoff-accept",
      projectPath: target,
      input: {
        taskId,
        handoffId: created.handoff.handoffId,
        consumerId: "secondary-consumer",
        harness: "native-test",
      },
    });
    const before = snapshot(db);
    db.exec("CREATE TRIGGER secondary_handoff_accept_fault BEFORE INSERT ON events WHEN NEW.event_type='HANDOFF_ACCEPTED' BEGIN SELECT RAISE(ABORT, 'SECONDARY_HANDOFF_ACCEPT_FAULT'); END");
    try {
      const failed = await invoke();
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.match(JSON.stringify(failed.error), /SECONDARY_HANDOFF_ACCEPT_FAULT/);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.isTransaction, false);
    } finally {
      db.exec("DROP TRIGGER secondary_handoff_accept_fault");
    }
    const retried = await invoke();
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.result.accepted, true);
    assert.equal(retried.result.idempotent, false);
    assertOneTransitionWithCommit(db, taskId, "HANDOFF_ACCEPTED");
  } finally {
    db?.close();
    await removeTempTree(target);
  }
});

test("public record-intervention rolls back its event on publication failure", async () => {
  const fixture = await setupDiagnosticTask();
  const db = new DatabaseSync(path.join(fixture.target, ".forgeloop/state.sqlite"));
  try {
    await writeFile(path.join(fixture.target, "intervention.json"), JSON.stringify({
      schemaVersion: 1,
      id: "secondary-intervention",
      kind: "NO_MUTATION_EXPERIMENT",
      statement: "Repeat the controlled fixture observation.",
      hypothesisRefs: ["h-public-atomicity"],
      reversible: true,
    }));
    const invoke = () => executeForgeLoopCommand({
      command: "record-intervention",
      projectPath: fixture.target,
      input: { taskId: fixture.taskId, file: "intervention.json" },
    });
    const before = snapshot(db);
    db.exec("CREATE TRIGGER secondary_intervention_fault BEFORE INSERT ON events WHEN NEW.event_type='INTERVENTION_RECORDED' BEGIN SELECT RAISE(ABORT, 'SECONDARY_INTERVENTION_FAULT'); END");
    try {
      const failed = await invoke();
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.match(JSON.stringify(failed.error), /SECONDARY_INTERVENTION_FAULT/);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.isTransaction, false);
    } finally {
      db.exec("DROP TRIGGER secondary_intervention_fault");
    }
    const retried = await invoke();
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.result.intervention.intervention.id, "secondary-intervention");
    assertOneTransitionWithCommit(db, fixture.taskId, "INTERVENTION_RECORDED");
  } finally {
    db.close();
    await fixture.cleanup();
  }
});

test("public record-hypothesis-disposition rolls back its event on publication failure", async () => {
  const fixture = await setupDiagnosticTask();
  const db = new DatabaseSync(path.join(fixture.target, ".forgeloop/state.sqlite"));
  try {
    const invoke = () => executeForgeLoopCommand({
      command: "record-hypothesis-disposition",
      projectPath: fixture.target,
      input: {
        taskId: fixture.taskId,
        hypothesis: "h-public-atomicity",
        dispositionStatus: "SUPPORTED",
        evidenceRefs: ["check-auth-boundary"],
        reason: "The controlled observation supports the hypothesis.",
      },
    });
    const before = snapshot(db);
    db.exec("CREATE TRIGGER secondary_disposition_fault BEFORE INSERT ON events WHEN NEW.event_type='HYPOTHESIS_DISPOSITION_RECORDED' BEGIN SELECT RAISE(ABORT, 'SECONDARY_DISPOSITION_FAULT'); END");
    try {
      const failed = await invoke();
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.match(JSON.stringify(failed.error), /SECONDARY_DISPOSITION_FAULT/);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.isTransaction, false);
    } finally {
      db.exec("DROP TRIGGER secondary_disposition_fault");
    }
    const retried = await invoke();
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.result.disposition.status, "SUPPORTED");
    assertOneTransitionWithCommit(db, fixture.taskId, "HYPOTHESIS_DISPOSITION_RECORDED");
  } finally {
    db.close();
    await fixture.cleanup();
  }
});

test("public record-decision-criterion rolls back its event on publication failure", async () => {
  const fixture = await setupSettlementTask();
  const db = new DatabaseSync(path.join(fixture.target, ".forgeloop/state.sqlite"));
  try {
    const invoke = () => executeForgeLoopCommand({
      command: "record-decision-criterion",
      projectPath: fixture.target,
      input: {
        taskId: fixture.taskId,
        decision: fixture.decision,
        settledBy: "Use the canonical transaction boundary.",
      },
    });
    const before = snapshot(db);
    db.exec("CREATE TRIGGER secondary_criterion_fault BEFORE INSERT ON events WHEN NEW.event_type='DECISION_CRITERION_RECORDED' BEGIN SELECT RAISE(ABORT, 'SECONDARY_CRITERION_FAULT'); END");
    try {
      const failed = await invoke();
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.match(JSON.stringify(failed.error), /SECONDARY_CRITERION_FAULT/);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.isTransaction, false);
    } finally {
      db.exec("DROP TRIGGER secondary_criterion_fault");
    }
    const retried = await invoke();
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.result.criterion.decision, fixture.decision);
    assertOneTransitionWithCommit(db, fixture.taskId, "DECISION_CRITERION_RECORDED");
  } finally {
    db.close();
    await removeTempTree(fixture.target);
  }
});
