import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { createEvidence } from "../src/core/evidence.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { writeAttestationStatement } from "../src/core/attestation.js";
import { withTaskTransaction } from "../src/core/transaction.js";
import { runAdvance } from "../src/commands/advance.js";
import { runCheck } from "../src/commands/run-check.js";
import { runComplete } from "../src/commands/complete.js";
import { runPrepareCompletion } from "../src/commands/prepare-completion.js";
import { runContextPlan } from "../src/commands/context-plan.js";
import { clearTestSemanticProvider, installTestSemanticProvider, testSemanticProvider } from "../src/core/decision/test-provider.js";
import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { createConfig, writeConfig } from "../src/core/config.js";
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

function assertCommitWitness(db, taskId, eventType, operation, expectedCount = 1) {
  const ledger = events(db, taskId);
  const records = ledger.filter((event) => event.event === eventType);
  assert.equal(records.length, expectedCount, `${eventType} must add exactly one canonical record to this fixture`);
  const index = ledger.findIndex((event) => event.seq === records.at(-1).seq);
  const commit = ledger[index + 1];
  assert.equal(commit?.event, "TRANSACTION_COMMITTED", `${eventType} must be followed by a commit witness`);
  assert.equal(commit?.details?.operation, operation, "commit witness must bind the exact public operation");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM events WHERE task_id = ? AND event_type = ?")
    .get(taskId, eventType).count, expectedCount);
}

function evaluationScenario() {
  return {
    schemaVersion: 1,
    scenarioId: "public-evaluation-atomicity",
    requiredMilestones: [
      "CONTRACT_VALIDATED",
      "ROUTE_VALIDATED",
      "PREFLIGHT_READY",
      "EXECUTION_STARTED",
      "VERIFICATION_STARTED",
      "COMPLETION_VALIDATED",
    ],
    forbidden: { completionBeforeVerification: true, unresolvedRequiredAction: true },
    limits: { maxVerificationCycles: 2, maxNonInformativeInterventions: 0, maxAmbiguousActions: 0 },
    reference: { comparableSteps: 10 },
  };
}

async function setupEvaluationTask(target, taskId) {
  await ensureFixtureTask(target, taskId, packageRoot);
  const fingerprint = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  await writeWorkState(target, createWorkState({
    taskId,
    contractFingerprint: fingerprint,
    routeFingerprint: fingerprint,
    repositoryFingerprint: { branch: null, head: null },
    phase: "COMPLETE",
    completedSteps: ["contract", "route", "implementation", "verification"],
    pendingSteps: [],
    verificationCycle: 1,
    checks: [{ id: "tests", requirement: "tests", status: "passed", evidenceKind: "OBSERVED" }],
    verificationEvidence: [createEvidence({ kind: "OBSERVED", source: "tests", result: "passed" })],
  }), { packageRoot, taskId });
  for (const [event, details] of [
    ["TASK_RECEIVED"],
    ["CONTRACT_VALIDATED"],
    ["ROUTE_VALIDATED"],
    ["PREFLIGHT_READY"],
    ["EXECUTION_STARTED"],
    ["VERIFICATION_STARTED", { verificationCycle: 1 }],
    ["VERIFICATION_RECORDED", { id: "tests", requirement: "tests", status: "passed", exitCode: 0, verificationCycle: 1 }],
    ["COMPLETION_VALIDATED"],
  ]) {
    await appendProtocolEvent(target, {
      taskId,
      event,
      ...(details ? { details } : {}),
    }, packageRoot, { taskId });
  }
  await writeFile(path.join(target, "scenario.json"), JSON.stringify(evaluationScenario()), "utf8");
}

function fixtureStatement(taskId, verificationCycle) {
  const zero = "0".repeat(64);
  return {
    schemaVersion: 1,
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: `forgeloop-task:${taskId}`, digest: { sha256: zero } }],
    predicateType: "https://forgeloop.dev/attestation/v1",
    predicate: {
      schemaVersion: 1,
      protocol: { name: "ForgeLoop", protocolVersion: 1 },
      task: { taskId, verificationCycle },
      content: { manifestFingerprint: zero, contentDigest: zero, coveredPaths: [] },
      evidence: {
        contractFingerprint: zero,
        routeFingerprint: null,
        stateFingerprint: zero,
        receiptFingerprint: zero,
        ledgerSeq: 1,
        ledgerHash: zero,
      },
      verification: { completion: "VALID", audit: "VALID" },
    },
  };
}

async function setupAttestationTask() {
  const target = await createGitRepository("forgeloop-public-attestation-atomicity-");
  const taskId = "public-attestation-atomicity";
  try {
    // The durable lifecycle route asks for its pinned semantic provider. This
    // is the repository's trusted test injection, never actor-controlled input.
    installTestSemanticProvider();
    const sourcePath = path.join(target, "src", "index.js");
    const originalSource = await readFile(sourcePath, "utf8");
    await setupVerifyingTask(target, packageRoot, { taskId, requirement: "tests" });
    await writeConfig(target, createConfig({
      attestation: {
        mode: "required",
        revisionProvider: "git",
        requireCompleteCoverage: true,
        signing: { provider: "none", required: false, policy: {} },
      },
    }), packageRoot);
    await writeFile(sourcePath, `${originalSource}export const publicAttestationAtomicity = true;\n`, "utf8");
    await runPrepareCompletion({ target, packageRoot, taskId });

    await runCheck({
      target,
      packageRoot,
      taskId,
      id: "attestation-cycle-check",
      requirement: "tests",
      argv: [process.execPath, "-e", "process.exit(0)"],
    });
    await runCheck({
      target,
      packageRoot,
      taskId,
      id: "attestation-completion-check",
      requirement: "required action satisfies tests",
      argv: [process.execPath, "-e", "process.exit(0)"],
    });
    await runAdvance({ target, packageRoot, taskId, to: "REVIEWING" });

    const completion = await runComplete({ target, packageRoot, taskId });
    assert.equal(completion.status, "VALID", JSON.stringify(completion.errors));
    assert.equal(completion.attestation.status, "CAPTURED");
    clearTestSemanticProvider();
    return { target, taskId };
  } catch (error) {
    clearTestSemanticProvider();
    await removeTempTree(target);
    throw error;
  }
}

function contextCandidates() {
  return [{
    id: "public-atomicity-candidate",
    sourceRef: "docs/public-atomicity.md",
    summary: "Bounded public context for the atomicity regression.",
  }];
}

test("public eval rolls back the evaluation artifact when event publication fails", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-public-eval-"));
  const taskId = "public-evaluation-atomicity";
  let db;
  try {
    await setupEvaluationTask(target, taskId);
    db = new DatabaseSync(path.join(target, ".forgeloop/state.sqlite"));
    const invoke = () => executeForgeLoopCommand({
      command: "eval",
      projectPath: target,
      input: { taskId, scenarioPath: "scenario.json" },
    });
    const before = snapshot(db);
    db.exec("CREATE TRIGGER public_eval_fault BEFORE INSERT ON events WHEN NEW.event_type='TRAJECTORY_EVALUATED' BEGIN SELECT RAISE(ABORT, 'PUBLIC_EVAL_FAULT'); END");
    try {
      const failed = await invoke();
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.match(JSON.stringify(failed.error), /PUBLIC_EVAL_FAULT/);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.isTransaction, false);
    } finally {
      db.exec("DROP TRIGGER public_eval_fault");
    }
    const retried = await invoke();
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.result.result, "PASS");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM task_artifacts WHERE task_id = ? AND kind = 'evaluation'").get(taskId).count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM events WHERE task_id = ? AND event_type = 'TRAJECTORY_EVALUATED'").get(taskId).count, 1);
  } finally {
    db?.close();
    await removeTempTree(target);
  }
});

test("public attestation-create rolls back the current statement on event publication failure", async () => {
  const fixture = await setupAttestationTask();
  const db = new DatabaseSync(path.join(fixture.target, ".forgeloop/state.sqlite"));
  try {
    const invoke = () => executeForgeLoopCommand({
      command: "attestation-create",
      projectPath: fixture.target,
      input: { taskId: fixture.taskId },
    });
    const before = snapshot(db);
    db.exec("CREATE TRIGGER public_attestation_fault BEFORE INSERT ON events WHEN NEW.event_type='ATTESTATION_STATEMENT_CREATED' BEGIN SELECT RAISE(ABORT, 'PUBLIC_ATTESTATION_FAULT'); END");
    try {
      const failed = await invoke();
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.match(JSON.stringify(failed.error), /PUBLIC_ATTESTATION_FAULT/);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.isTransaction, false);
    } finally {
      db.exec("DROP TRIGGER public_attestation_fault");
    }
    const retried = await invoke();
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.result.statement.predicate.task.verificationCycle, 1);
    const artifacts = db.prepare("SELECT artifact_id, payload_json FROM task_artifacts WHERE task_id = ? AND kind = 'attestation' ORDER BY artifact_id")
      .all(fixture.taskId);
    assert.deepEqual(artifacts.map((row) => row.artifact_id), ["code-manifest", "statement"]);
    assert.equal(JSON.parse(artifacts[1].payload_json).predicate.task.verificationCycle, 1);
    const created = events(db, fixture.taskId).filter((event) => event.event === "ATTESTATION_STATEMENT_CREATED");
    assert.equal(created.length, 1, "the retried public statement must be unique");
    const ledger = events(db, fixture.taskId);
    const lastCreated = ledger.findIndex((event) => event.seq === created.at(-1).seq);
    assert.equal(ledger[lastCreated + 1]?.event, "TRANSACTION_COMMITTED");
    assert.equal(ledger[lastCreated + 1]?.details?.operation, "attestation-create");
  } finally {
    db.close();
    await removeTempTree(fixture.target);
  }
});

test("attestation history writer rolls back current and history artifacts on event publication failure", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-public-attestation-history-"));
  const taskId = "public-attestation-history";
  let db;
  try {
    await ensureFixtureTask(target, taskId, packageRoot);
    const createCycle = (verificationCycle) => withTaskTransaction({
      target,
      packageRoot,
      taskId,
      operation: "attestation-create",
      recordCommitEvent: true,
    }, () => writeAttestationStatement({
      target,
      packageRoot,
      taskId,
      statement: fixtureStatement(taskId, verificationCycle),
    }));
    await createCycle(1);
    db = new DatabaseSync(path.join(target, ".forgeloop/state.sqlite"));
    const before = snapshot(db);
    db.exec("CREATE TRIGGER public_attestation_history_fault BEFORE INSERT ON events WHEN NEW.event_type='ATTESTATION_STATEMENT_CREATED' AND json_extract(NEW.event_json, '$.details.statementFingerprint') IS NOT NULL BEGIN SELECT RAISE(ABORT, 'PUBLIC_ATTESTATION_HISTORY_FAULT'); END");
    try {
      await assert.rejects(() => createCycle(2), /PUBLIC_ATTESTATION_HISTORY_FAULT/);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.isTransaction, false);
    } finally {
      db.exec("DROP TRIGGER public_attestation_history_fault");
    }
    await createCycle(2);
    const artifacts = db.prepare("SELECT artifact_id, payload_json FROM task_artifacts WHERE task_id = ? AND kind = 'attestation' ORDER BY artifact_id")
      .all(taskId);
    assert.deepEqual(artifacts.map((row) => row.artifact_id), ["history/cycle-1/statement", "statement"]);
    assert.equal(JSON.parse(artifacts[0].payload_json).predicate.task.verificationCycle, 1);
    assert.equal(JSON.parse(artifacts[1].payload_json).predicate.task.verificationCycle, 2);
    const ledger = events(db, taskId);
    const created = ledger.filter((event) => event.event === "ATTESTATION_STATEMENT_CREATED");
    assert.equal(created.length, 2);
    const lastCreated = ledger.findIndex((event) => event.seq === created.at(-1).seq);
    assert.equal(ledger[lastCreated + 1]?.event, "TRANSACTION_COMMITTED");
    assert.equal(ledger[lastCreated + 1]?.details?.operation, "attestation-create");
  } finally {
    db?.close();
    await removeTempTree(target);
  }
});

test("public context-plan rolls back a semantic decision artifact when record publication fails", async () => {
  const fixture = await buildCanonicalDiagnosisProject({ taskId: "public-context-atomicity" });
  const db = new DatabaseSync(path.join(fixture.target, ".forgeloop/state.sqlite"));
  try {
    const invoke = () => runContextPlan({
      ...fixture,
      decisionId: "context-public-current",
      provider: testSemanticProvider,
      candidates: contextCandidates(),
    });
    const beforeRecordedCount = db.prepare("SELECT COUNT(*) AS count FROM events WHERE task_id = ? AND event_type = 'SEMANTIC_DECISION_RECORDED'")
      .get(fixture.taskId).count;
    const before = snapshot(db);
    db.exec("CREATE TRIGGER public_decision_record_fault BEFORE INSERT ON events WHEN NEW.event_type='SEMANTIC_DECISION_RECORDED' BEGIN SELECT RAISE(ABORT, 'PUBLIC_DECISION_RECORD_FAULT'); END");
    try {
      await assert.rejects(invoke, /PUBLIC_DECISION_RECORD_FAULT/);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.isTransaction, false);
    } finally {
      db.exec("DROP TRIGGER public_decision_record_fault");
    }
    const retried = await invoke();
    assert.equal(retried.candidateItems, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM task_artifacts WHERE task_id = ? AND kind = 'decision' AND artifact_id = 'context-public-current'").get(fixture.taskId).count, 1);
    assertCommitWitness(db, fixture.taskId, "SEMANTIC_DECISION_RECORDED", "semantic-decision", beforeRecordedCount + 1);
  } finally {
    db.close();
    await fixture.cleanup();
  }
});

test("public context-plan rolls back decision supersession without orphaning the replacement", async () => {
  const fixture = await buildCanonicalDiagnosisProject({ taskId: "public-context-supersession" });
  const db = new DatabaseSync(path.join(fixture.target, ".forgeloop/state.sqlite"));
  try {
    const base = {
      ...fixture,
      provider: testSemanticProvider,
      candidates: contextCandidates(),
    };
    await runContextPlan({ ...base, decisionId: "context-public-old" });
    const before = snapshot(db);
    const beforeRecordedCount = db.prepare("SELECT COUNT(*) AS count FROM events WHERE task_id = ? AND event_type = 'SEMANTIC_DECISION_RECORDED'")
      .get(fixture.taskId).count;
    const invoke = () => runContextPlan({
      ...base,
      decisionId: "context-public-new",
      // Change the candidate fingerprint so ensureSemanticDecision cannot
      // satisfy the explicit public call from the prior cache entry.
      candidates: [...contextCandidates(), {
        id: "public-atomicity-new-candidate",
        sourceRef: "docs/public-atomicity-extra.md",
        summary: "A second bounded candidate forces a new decision revision.",
      }],
    });
    db.exec("CREATE TRIGGER public_decision_supersede_fault BEFORE INSERT ON events WHEN NEW.event_type='SEMANTIC_DECISION_SUPERSEDED' BEGIN SELECT RAISE(ABORT, 'PUBLIC_DECISION_SUPERSEDE_FAULT'); END");
    try {
      await assert.rejects(invoke, /PUBLIC_DECISION_SUPERSEDE_FAULT/);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.isTransaction, false);
    } finally {
      db.exec("DROP TRIGGER public_decision_supersede_fault");
    }
    const retried = await invoke();
    assert.equal(retried.candidateItems, 2);
    const decisions = db.prepare("SELECT artifact_id FROM task_artifacts WHERE task_id = ? AND kind = 'decision' ORDER BY artifact_id")
      .all(fixture.taskId).map((row) => row.artifact_id);
    assert.ok(decisions.includes("context-public-old"));
    assert.ok(decisions.includes("context-public-new"));
    const ledger = events(db, fixture.taskId);
    const recorded = ledger.filter((event) => event.event === "SEMANTIC_DECISION_RECORDED");
    assert.equal(recorded.length, beforeRecordedCount + 1);
    const superseded = ledger.filter((event) => event.event === "SEMANTIC_DECISION_SUPERSEDED");
    assert.equal(superseded.length, 1);
    assert.equal(superseded[0].details.decisionId, "context-public-old");
    assert.equal(superseded[0].details.supersededBy, "context-public-new");
    const supersessionIndex = ledger.findIndex((event) => event.seq === superseded[0].seq);
    assert.equal(ledger[supersessionIndex + 1]?.event, "TRANSACTION_COMMITTED");
    assert.equal(ledger[supersessionIndex + 1]?.details?.operation, "semantic-decision");
    const replacement = JSON.parse(db.prepare("SELECT payload_json FROM task_artifacts WHERE task_id = ? AND kind = 'decision' AND artifact_id = 'context-public-new'").get(fixture.taskId).payload_json);
    assert.equal(replacement.decisionId, "context-public-new");
    assert.equal(replacement.authority, "SEMANTIC_DECISION");
  } finally {
    db.close();
    await fixture.cleanup();
  }
});
