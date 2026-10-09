import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeDurableAction } from "../src/core/action-execution.js";
import { runAction } from "../src/commands/run-action.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { seedPolicyEpoch } from "./helpers/durable-policy.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

async function targetWithPolicy(decision = "ALLOW", taskId = "task-run") {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-run-action-"));
  await seedPolicyEpoch(target, packageRoot, taskId, {
    schemaVersion: 1, defaultDecision: "DENY",
    rules: [{ capability: "filesystem.write", decision }],
  });
  return { target, taskId };
}

function input(overrides = {}) {
  return { actionId: "action-write", effectClass: "REVERSIBLE_WRITE",
    capability: "filesystem.write", target: "sentinel.txt", operation: "write sentinel",
    idempotencyKey: "write:sentinel:v1", requiredForCompletion: false, requirement: null,
    ...overrides };
}

async function waitForFile(filename, { timeoutMs = 5000, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason ?? new Error("File barrier was cancelled");
    try {
      await access(filename);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await delay(Math.min(10, remaining), undefined, { signal });
  }
  throw new Error(`Timed out waiting for external execution marker: ${filename}`);
}

test("public native run-action launches without an open SQLite writer transaction", async () => {
  const target = await createGitRepository("forgeloop-run-action-transaction-");
  const taskId = "run-action-transaction-001";
  const marker = path.join(target, "external-started.txt");
  const release = path.join(target, "external-release.txt");
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });
    await withProjectStorage(target, async store => {
      const childScript = [
        "const fs = require('node:fs');",
        `const marker = ${JSON.stringify(marker)};`,
        `const release = ${JSON.stringify(release)};`,
        "fs.writeFileSync(marker, 'started');",
        "const timer = setInterval(() => { if (fs.existsSync(release)) { clearInterval(timer); process.exit(0); } }, 10);",
        "setTimeout(() => process.exit(2), 5000);",
      ].join(" ");
      const operation = runAction({
        target,
        packageRoot,
        taskId,
        actionId: "action-transaction-boundary",
        capability: "filesystem.write",
        effectClass: "REVERSIBLE_WRITE",
        actionTarget: "external-started.txt",
        idempotencyKey: "run-action:transaction-boundary:v1",
        requirement: null,
        requiredForCompletion: false,
        argv: [process.execPath, "-e", childScript],
        timeoutMs: 3000,
      });
      const completion = operation.then(
        result => ({ kind: "completed", result }),
        error => ({ kind: "failed", error }),
      );
      const markerController = new AbortController();
      const markerObserved = waitForFile(marker, { timeoutMs: 3000, signal: markerController.signal });
      try {
        const first = await Promise.race([
          markerObserved.then(() => ({ kind: "marker" })),
          completion,
        ]);
        if (first.kind === "failed") throw first.error;
        if (first.kind === "completed") throw new Error("run-action completed before its external marker was observed");
        assert.equal(store.db.isTransaction, false);
        assert.equal(store.transaction, null);
        await writeFile(release, "release\n", "utf8");
        const finished = await completion;
        if (finished.kind === "failed") throw finished.error;
        assert.equal(finished.result.action.state, "COMMITTED");
      } finally {
        await writeFile(release, "release\n", "utf8").catch(() => {});
        markerController.abort();
        await Promise.allSettled([markerObserved, completion]);
      }
    });
  } finally {
    await removeTempTree(target);
  }
});

test("side-effecting run-action refuses a missing idempotency key", async () => {
  const { target, taskId } = await targetWithPolicy();
  try {
    await assert.rejects(executeDurableAction({ target, packageRoot, taskId,
      input: input({ idempotencyKey: undefined }), argv: [process.execPath, "-e", "0"] }),
    (error) => error.code === "E_ACTION_IDEMPOTENCY_REQUIRED");
  } finally { await removeTempTree(target); }
});

test("DENY blocks before process launch", async () => {
  const { target, taskId } = await targetWithPolicy("DENY");
  const sentinel = path.join(target, "sentinel.txt");
  try {
    await assert.rejects(executeDurableAction({ target, packageRoot, taskId,
      input: input(), argv: [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(sentinel)},'bad')`] }),
    (error) => error.code === "E_ACTION_CAPABILITY_DENIED");
    await assert.rejects(access(sentinel));
  } finally { await removeTempTree(target); }
});

test("exact argv execution does not interpret shell metacharacters", async () => {
  const { target, taskId } = await targetWithPolicy();
  const sentinel = path.join(target, "sentinel.txt");
  const injected = path.join(target, "injected.txt");
  try {
    const result = await executeDurableAction({ target, packageRoot, taskId,
      input: input(), argv: [process.execPath, "-e", "require('fs').writeFileSync(process.argv[1],process.argv[2])",
        sentinel, `literal;touch ${injected}`] });
    assert.equal(result.action.state, "COMMITTED");
    assert.equal(await readFile(sentinel, "utf8"), `literal;touch ${injected}`);
    await assert.rejects(access(injected));
  } finally { await removeTempTree(target); }
});

test("pre-launch authority rejection leaves the action PROPOSED with no ACTION_STARTED", async () => {
  const { target, taskId } = await targetWithPolicy("ALLOW");
  try {
    await assert.rejects(
      executeDurableAction({ target, packageRoot, taskId,
        input: input(), argv: ["npm", "install", "left-pad"] }),
      (error) => error.code === "E_INSTALLATION_AUTHORITY_REQUIRED",
    );
    const { readAction } = await import("../src/core/actions.js");
    const action = await readAction(target, { packageRoot, taskId, actionId: "action-write" });
    assert.equal(action.state, "PROPOSED");

    const { readEvents } = await import("../src/core/events.js");
    const events = await readEvents(target, packageRoot, { taskId });
    assert.equal(events.some((event) => event.event === "ACTION_STARTED"), false);
  } finally { await removeTempTree(target); }
});

test("argv normalization failure leaves the action PROPOSED with no ACTION_STARTED", async () => {
  const { target, taskId } = await targetWithPolicy("ALLOW");
  try {
    await assert.rejects(
      executeDurableAction({ target, packageRoot, taskId,
        input: input(), argv: [process.execPath, ""] }),
      (error) => error.code === "E_EXECUTION_INVALID",
    );
    const { readAction } = await readActionModule();
    const action = await readAction(target, { packageRoot, taskId, actionId: "action-write" });
    assert.equal(action.state, "PROPOSED");

    const { readEvents } = await import("../src/core/events.js");
    const events = await readEvents(target, packageRoot, { taskId });
    assert.equal(events.some((event) => event.event === "ACTION_STARTED"), false);
  } finally { await removeTempTree(target); }
});

function readActionModule() {
  return import("../src/core/actions.js");
}

test("executeDurableAction returns canonical authorization evidence", async () => {
  const { target, taskId } = await targetWithPolicy();
  try {
    const result = await executeDurableAction({ target, packageRoot, taskId,
      input: input(), argv: [process.execPath, "-e", "process.exit(0)"] });
    assert.equal(result.authorization.capabilityDecision, "ALLOW");
    assert.match(result.authorization.capabilityPolicyFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(result.capability, undefined);
  } finally { await removeTempTree(target); }
});
