import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";

import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";

const packageRoot = getPackageRoot();

function eventRows(db, taskId) {
  return db.prepare(
    "SELECT seq, event_type, event_json FROM events WHERE task_id = ? ORDER BY seq",
  ).all(taskId).map((row) => ({ ...row, event: JSON.parse(row.event_json) }));
}

function installFinalizationFault(db, { triggerName, operation, message }) {
  db.exec(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON events
    WHEN NEW.event_type = 'TRANSACTION_COMMITTED'
      AND json_extract(NEW.event_json, '$.details.operation') = '${operation}'
    BEGIN SELECT RAISE(ABORT, '${message}'); END`);
}

function countCommitWitness(events, operation) {
  return events.filter((row) => row.event_type === "TRANSACTION_COMMITTED"
    && row.event?.details?.operation === operation).length;
}

test("public native run-action retains the captured outcome when finalization publication fails", async () => {
  const target = await createGitRepository("forgeloop-public-external-action-finalization-");
  const taskId = "public-external-action-finalization";
  const actionId = "action-native-finalization";
  const marker = path.join(target, "native-action-outcome.log");
  const markerLine = "native-action-outcome\n";
  let storeDb;
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });
    storeDb = new DatabaseSync(path.join(target, ".forgeloop", "state.sqlite"));
    installFinalizationFault(storeDb, {
      triggerName: "public_run_action_finalization_fault",
      operation: "run-action",
      message: "PUBLIC_RUN_ACTION_FINALIZATION_FAULT",
    });

    const childScript = [
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(markerLine)});`,
    ].join(" ");
    const request = {
      command: "run-action",
      projectPath: target,
      input: {
        taskId,
        actionId,
        actionCapability: "filesystem.write",
        actionEffectClass: "REVERSIBLE_WRITE",
        actionTarget: "native-action-outcome.log",
        actionIdempotencyKey: "public-external-action-finalization:v1",
        actionRequirement: "native action outcome remains durable",
        actionRequiredForCompletion: false,
        commandArgv: [process.execPath, "-e", childScript],
      },
    };
    const failed = await executeForgeLoopCommand(request);

    assert.equal(failed.ok, false, JSON.stringify(failed));
    assert.match(failed.error.message, /PUBLIC_RUN_ACTION_FINALIZATION_FAULT/);
    storeDb.exec("DROP TRIGGER public_run_action_finalization_fault");

    assert.equal(await readFile(marker, "utf8"), markerLine,
      "the native side effect must have been observed exactly once before finalization failed");
    const actionRow = storeDb.prepare(
      "SELECT status, payload_json FROM actions WHERE task_id = ? AND action_id = ?",
    ).get(taskId, actionId);
    assert.equal(actionRow.status, "COMMITTED");
    assert.equal(JSON.parse(actionRow.payload_json).state, "COMMITTED");

    const executionRow = storeDb.prepare(
      "SELECT execution_id, check_id, payload_json FROM executions WHERE task_id = ?",
    ).get(taskId);
    assert.ok(executionRow, "the captured native execution must survive the outer finalization fault");
    assert.equal(executionRow.check_id, `action:${actionId}`);
    assert.equal(JSON.parse(executionRow.payload_json).status, "passed");

    const events = eventRows(storeDb, taskId);
    assert.equal(events.filter((row) => row.event_type === "ACTION_STARTED").length, 1);
    assert.equal(events.filter((row) => row.event_type === "ACTION_COMMIT_RECORDED").length, 1);
    assert.equal(countCommitWitness(events, "run-action"), 0,
      "the injected fault must remove only the public finalization witness");
    assert.equal(storeDb.isTransaction, false);
    const refusedRetry = await executeForgeLoopCommand(request);
    assert.equal(refusedRetry.ok, false, JSON.stringify(refusedRetry));
    assert.equal(refusedRetry.error.code, "E_ACTION_STATE_MISMATCH");
    assert.equal(await readFile(marker, "utf8"), markerLine,
      "retry of the committed action must refuse before another external launch");
    assert.equal(storeDb.prepare("SELECT COUNT(*) AS n FROM executions WHERE task_id = ?").get(taskId).n, 1);
  } finally {
    if (storeDb) {
      storeDb.exec("DROP TRIGGER IF EXISTS public_run_action_finalization_fault");
      storeDb.close();
    }
    await removeTempTree(target);
  }
});

test("public adapter run-check retains captured verification when finalization publication fails", async () => {
  const target = await createGitRepository("forgeloop-public-external-check-finalization-");
  const taskId = "public-external-check-finalization";
  const checkId = "adapter-finalization";
  let storeDb;
  let adapterCalls = 0;
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });
    storeDb = new DatabaseSync(path.join(target, ".forgeloop", "state.sqlite"));
    installFinalizationFault(storeDb, {
      triggerName: "public_run_check_finalization_fault",
      operation: "run-check",
      message: "PUBLIC_RUN_CHECK_FINALIZATION_FAULT",
    });

    const failed = await executeForgeLoopCommand({
      command: "run-check",
      projectPath: target,
      input: {
        taskId,
        checkId,
        checkRequirement: "adapter verification outcome remains durable",
        commandArgv: [process.execPath, "-e", "process.exit(0)"],
      },
      runtimeContext: {
        verificationExecutionAdapter: {
          async execute(request) {
            adapterCalls += 1;
            assert.equal(request.taskId, taskId);
            return {
              exitCode: 0,
              signal: null,
              timedOut: false,
              stdout: "adapter-finalized-once\n",
              stderr: "",
              outputTruncated: false,
              cwd: target,
              isolation: {
                mode: "NATIVE_PROJECT",
                isolated: false,
                liveProjectWritable: true,
                networkPolicy: "INHERITED",
                environmentPolicy: "INHERITED",
              },
            };
          },
        },
      },
    });

    assert.equal(failed.ok, false, JSON.stringify(failed));
    assert.match(failed.error.message, /PUBLIC_RUN_CHECK_FINALIZATION_FAULT/);
    storeDb.exec("DROP TRIGGER public_run_check_finalization_fault");

    assert.equal(adapterCalls, 1,
      "a finalization failure must not cause the external verification adapter to run again");
    const executionRow = storeDb.prepare(
      "SELECT execution_id, check_id, payload_json FROM executions WHERE task_id = ?",
    ).get(taskId);
    assert.ok(executionRow, "the adapter execution must survive the outer finalization fault");
    assert.equal(executionRow.check_id, checkId);
    const execution = JSON.parse(executionRow.payload_json);
    assert.equal(execution.status, "passed");
    assert.equal(execution.stdoutBytes, Buffer.byteLength("adapter-finalized-once\n"));

    const receiptRow = storeDb.prepare(
      "SELECT payload_json FROM task_artifacts WHERE task_id = ? AND kind = 'receipt' AND artifact_id = 'current'",
    ).get(taskId);
    assert.ok(receiptRow, "the verification receipt must survive the outer finalization fault");
    const receipt = JSON.parse(receiptRow.payload_json);
    const check = receipt.checks.find((item) => item.id === checkId);
    assert.ok(check);
    assert.equal(check.status, "passed");
    assert.equal(check.executionRef, executionRow.execution_id);
    assert.equal(check.provenance, "FORGELOOP_EXECUTED");

    const events = eventRows(storeDb, taskId);
    assert.equal(events.filter((row) => row.event_type === "VERIFICATION_RECORDED").length, 1);
    assert.equal(countCommitWitness(events, "record-check"), 1);
    assert.equal(countCommitWitness(events, "run-check"), 0,
      "the injected fault must remove only the public finalization witness");
    assert.equal(storeDb.isTransaction, false);
  } finally {
    if (storeDb) {
      storeDb.exec("DROP TRIGGER IF EXISTS public_run_check_finalization_fault");
      storeDb.close();
    }
    await removeTempTree(target);
  }
});
