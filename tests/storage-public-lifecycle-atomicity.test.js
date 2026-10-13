import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { ensureSemanticDecision } from "../src/core/decision/service.js";
import {
  clearTestSemanticProvider,
  installTestSemanticProvider,
  testSemanticProvider,
} from "../src/core/decision/test-provider.js";
import { getPackageRoot } from "../src/core/templates.js";
import { openStorageDatabase } from "../src/storage/index.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();

function database(target) {
  return openStorageDatabase(path.join(target, ".forgeloop", "state.sqlite"));
}

function snapshot(db) {
  return db.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map(({ name }) => ({
    name,
    rows: db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
      .map(row => JSON.stringify(row))
      .sort(),
  }));
}

function eventRows(db, taskId) {
  return db.prepare(
    "SELECT seq, event_type, event_json FROM events WHERE task_id = ? ORDER BY seq",
  ).all(taskId).map(row => ({ ...row, event: JSON.parse(row.event_json) }));
}

function installEventFault(db, triggerName, eventType, message) {
  db.exec(`CREATE TRIGGER "${triggerName}" AFTER INSERT ON events
    WHEN NEW.event_type = '${eventType}'
    BEGIN SELECT RAISE(ABORT, '${message}'); END`);
}

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-public-lifecycle-atomicity-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function invoke(target, command, input) {
  const result = await executeForgeLoopCommand({ command, projectPath: target, input });
  assert.equal(result.ok, true, `${command} failed: ${JSON.stringify(result)}`);
  return result.result;
}

async function primeContractApplicability(target, taskId, preset = "feature") {
  await ensureSemanticDecision({
    target,
    packageRoot,
    taskId,
    provider: testSemanticProvider,
    request: {
      decisionKind: "CONTRACT_APPLICABILITY",
      questionSetId: "contract-v1",
      state: { source: "preset", preset },
    },
  });
}

async function assertPublicEventAtomicity({
  target,
  db,
  taskId,
  command,
  input,
  eventType,
  operation,
  triggerName,
  faultMessage,
}) {
  const before = snapshot(db);
  const beforeEvents = eventRows(db, taskId);
  installEventFault(db, triggerName, eventType, faultMessage);
  try {
    const failed = await executeForgeLoopCommand({ command, projectPath: target, input });
    assert.equal(failed.ok, false, `${command} unexpectedly succeeded: ${JSON.stringify(failed)}`);
    assert.match(JSON.stringify(failed.error), new RegExp(faultMessage));
    assert.deepEqual(snapshot(db), before, `${command} changed canonical rows after publication failure`);
    assert.equal(db.isTransaction, false, `${command} left the native transaction open`);
  } finally {
    db.exec(`DROP TRIGGER "${triggerName}"`);
  }

  const retried = await invoke(target, command, input);
  const after = snapshot(db);
  assert.notDeepEqual(after, before, `${command} retry must publish a new canonical outcome`);
  const afterEvents = eventRows(db, taskId);
  const domainEvents = afterEvents.filter(row => row.event_type === eventType);
  assert.equal(domainEvents.length, beforeEvents.filter(row => row.event_type === eventType).length + 1);
  const domain = domainEvents.at(-1);
  const commits = afterEvents.filter(row => row.event_type === "TRANSACTION_COMMITTED"
    && row.event?.details?.operation === operation);
  assert.equal(commits.length, beforeEvents.filter(row => row.event_type === "TRANSACTION_COMMITTED"
    && row.event?.details?.operation === operation).length + 1);
  const commit = commits.at(-1);
  assert.equal(commit.seq, domain.seq + 1, `${command} must append its commit witness immediately after its domain event`);
  assert.equal(commit.event?.details?.operation, operation);
  assert.equal(retried.taskId, taskId);
  return { domain, commit };
}

test.after(() => clearTestSemanticProvider());
installTestSemanticProvider();

test("public discover rolls back its event and task snapshot when publication fails", async () => {
  await withTarget(async target => {
    const taskId = "public-discover-atomicity";
    await invoke(target, "task-create", { taskId, claims: [] });
    const db = database(target);
    try {
      await assertPublicEventAtomicity({
        target,
        db,
        taskId,
        command: "discover",
        input: { taskId },
        eventType: "DISCOVERY_STARTED",
        operation: "discover",
        triggerName: "public_discover_event_fault",
        faultMessage: "PUBLIC_DISCOVER_EVENT_FAULT",
      });
    } finally {
      db.close();
    }
  });
});

test("public contract-create rolls back its contract/state artifacts when publication fails", async () => {
  await withTarget(async target => {
    const taskId = "public-contract-create-atomicity";
    await invoke(target, "task-create", { taskId, preset: "feature", claims: [] });
    await invoke(target, "discover", { taskId });
    await primeContractApplicability(target, taskId);
    const db = database(target);
    try {
      await assertPublicEventAtomicity({
        target,
        db,
        taskId,
        command: "contract-create",
        input: { taskId, preset: "feature" },
        eventType: "CONTRACT_VALIDATED",
        operation: "contract-create",
        triggerName: "public_contract_create_event_fault",
        faultMessage: "PUBLIC_CONTRACT_CREATE_EVENT_FAULT",
      });
    } finally {
      db.close();
    }
  });
});

test("public contract-revise rolls back replacement contract/state artifacts when publication fails", async () => {
  await withTarget(async target => {
    const taskId = "public-contract-revise-atomicity";
    await invoke(target, "task-create", { taskId, preset: "feature", claims: [] });
    await invoke(target, "discover", { taskId });
    await invoke(target, "contract-create", { taskId, preset: "feature" });
    const db = database(target);
    try {
      await assertPublicEventAtomicity({
        target,
        db,
        taskId,
        command: "contract-revise",
        input: { taskId, preset: "bug" },
        eventType: "CONTRACT_REVISED",
        operation: "contract-revise",
        triggerName: "public_contract_revise_event_fault",
        faultMessage: "PUBLIC_CONTRACT_REVISE_EVENT_FAULT",
      });
    } finally {
      db.close();
    }
  });
});

test("public gate-record rolls back its gate artifact when publication fails", async () => {
  await withTarget(async target => {
    const taskId = "public-gate-record-atomicity";
    await writeFile(path.join(target, "THREAT_MODEL.md"), "public gate evidence\n");
    await invoke(target, "task-create", { taskId, preset: "feature", claims: ["THREAT_MODEL.md"] });
    await invoke(target, "discover", { taskId });
    await invoke(target, "contract-create", { taskId, preset: "feature" });
    await invoke(target, "route", {
      taskId,
      workType: "backend",
      surfaces: ["api"],
      risks: ["untrusted-input"],
      platforms: ["server"],
      behaviorChange: true,
      executableChange: true,
    });
    const db = database(target);
    try {
      await assertPublicEventAtomicity({
        target,
        db,
        taskId,
        command: "gate-record",
        input: {
          taskId,
          gate: "threat-boundary",
          gateStatus: "satisfied",
          gateArtifacts: ["THREAT_MODEL.md"],
          gateDecisions: ["Reviewed the public lifecycle threat boundary"],
        },
        eventType: "GATE_SATISFIED",
        operation: "gate-record",
        triggerName: "public_gate_record_event_fault",
        faultMessage: "PUBLIC_GATE_RECORD_EVENT_FAULT",
      });
    } finally {
      db.close();
    }
  });
});

test("public gate-revalidate rolls back refreshed gate state when publication fails", async () => {
  await withTarget(async target => {
    const taskId = "public-gate-revalidate-atomicity";
    await writeFile(path.join(target, "THREAT_MODEL.md"), "initial gate evidence\n");
    await invoke(target, "task-create", { taskId, preset: "feature", claims: ["THREAT_MODEL.md"] });
    await invoke(target, "discover", { taskId });
    await invoke(target, "contract-create", { taskId, preset: "feature" });
    await invoke(target, "route", {
      taskId,
      workType: "backend",
      surfaces: ["api"],
      risks: ["untrusted-input"],
      platforms: ["server"],
      behaviorChange: true,
      executableChange: true,
    });
    await invoke(target, "gate-record", {
      taskId,
      gate: "threat-boundary",
      gateStatus: "satisfied",
      gateArtifacts: ["THREAT_MODEL.md"],
      gateDecisions: ["Reviewed the public lifecycle threat boundary"],
    });
    const preflight = await invoke(target, "preflight", { taskId });
    assert.equal(preflight.status, "READY", JSON.stringify(preflight));
    await invoke(target, "advance", { taskId, to: "PLANNED" });
    await invoke(target, "advance", { taskId, to: "EXECUTING" });
    await writeFile(path.join(target, "THREAT_MODEL.md"), "refreshed gate evidence\n");

    const db = database(target);
    try {
      await assertPublicEventAtomicity({
        target,
        db,
        taskId,
        command: "gate-revalidate",
        input: { taskId, gate: "threat-boundary", acknowledgeStale: true },
        eventType: "GATE_REVALIDATED",
        operation: "gate-revalidate",
        triggerName: "public_gate_revalidate_event_fault",
        faultMessage: "PUBLIC_GATE_REVALIDATE_EVENT_FAULT",
      });
    } finally {
      db.close();
    }
  });
});
