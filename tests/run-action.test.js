import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeDurableAction } from "../src/core/action-execution.js";
import { seedPolicyEpoch } from "./helpers/durable-policy.js";
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
