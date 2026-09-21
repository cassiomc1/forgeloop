import assert from "node:assert/strict";
import { test } from "node:test";

import { readForgeLoopIntegrationResource } from "../src/integration.js";
import { runComplete } from "../src/commands/complete.js";
import { runAdvance } from "../src/commands/advance.js";
import { recordCheck } from "../src/core/completion-artifacts.js";
import { packageRoot, setupAbandonedTask, withRecoveryTarget } from "./helpers/task-recovery-fixture.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";

function resource(target, taskId, options = {}) {
  return readForgeLoopIntegrationResource("task/audit-view", {
    projectPath: target,
    packageRoot,
    taskId,
    ...options,
  });
}

test("task/audit-view is a deterministic bounded read-only projection", async () => {
  await withRecoveryTarget(async (target) => {
    const taskId = "audit-ux-view";
    await setupVerifyingTask(target, packageRoot, { taskId, requirement: "tests" });
    let providerCalls = 0;
    const runtimeContext = {
      browserVerificationProviders: {
        forbidden: () => {
          providerCalls += 1;
          throw new Error("provider invocation is outside the audit-view contract");
        },
      },
    };
    const first = await resource(target, taskId, { runtimeContext, limit: 3 });
    const second = await resource(target, taskId, { runtimeContext, limit: 3 });
    assert.deepEqual(first.data, second.data);
    assert.equal(providerCalls, 0);
    assert.equal(first.data.readOnly, true);
    assert.deepEqual(first.data.authority, {
      readOnly: true,
      lifecycleAuthority: false,
      evidenceAuthority: false,
      completionAuthority: false,
      mutationAuthority: false,
      externalExecution: false,
    });
    assert.equal(first.data.lifecycle.phase, "VERIFYING");
    assert.equal(first.data.timeline.items.length, 3);
    assert.equal(first.data.timeline.truncated, true);
    assert.deepEqual(first.data.timeline.items.map((item) => item.id), ["event-12", "event-13", "event-14"]);
    assert.ok(first.data.timeline.items.every((item) => item.timestamp === null || typeof item.timestamp === "string"));
    assert.equal(Object.prototype.hasOwnProperty.call(first.data.timeline.items[0], "data"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(first.data.timeline.items[0], "source"), false);

    const serialized = JSON.stringify(first.data);
    assert.doesNotMatch(serialized, /\/Users\/|\/home\/|\/private\/|\/tmp\/|C:\\\\|TOKEN=|SECRET=/u);
    assert.doesNotMatch(serialized, /commandArgv|executable|shell|credentials|secrets/u);

    const checksOnly = await resource(target, taskId, { categories: ["CHECK"], limit: 10 });
    assert.deepEqual(checksOnly.data.timeline.items, []);
    const after = await resource(target, taskId, { afterSequence: 12, limit: 10 });
    assert.ok(after.data.timeline.items.every((item) => item.sequence > 12));
    assert.equal(after.data.timeline.cursor.nextAfterSequence, null);
    const before = await resource(target, taskId, { beforeSequence: 13, limit: 10 });
    assert.ok(before.data.timeline.items.every((item) => item.sequence < 13));
    assert.equal(before.data.timeline.cursor.nextBeforeSequence, 3);
    await assert.rejects(
      () => resource(target, taskId, { beforeSequence: 13, afterSequence: 12 }),
      (error) => error.code === "E_AUDIT_UX_INPUT_INVALID",
    );
    await assert.rejects(
      () => resource(target, taskId, { categories: ["../etc"] }),
      (error) => error.code === "E_AUDIT_UX_INPUT_INVALID",
    );
  });
});

test("task/audit-view pagination is gap-free in both directions", async () => {
  await withRecoveryTarget(async (target) => {
    const taskId = "audit-ux-pagination";
    await setupVerifyingTask(target, packageRoot, { taskId, requirement: "pagination" });
    for (let index = 0; index < 20; index += 1) {
      await recordCheck({
        target,
        packageRoot,
        taskId,
        id: `pagination-${index}`,
        kind: "manual-review",
        requirement: "pagination",
        status: "passed",
        evidenceKind: "OBSERVED",
        result: "pagination passed",
        exitCode: 0,
      });
    }

    const complete = await resource(target, taskId, { limit: 200 });
    const sequences = complete.data.timeline.items.map((item) => item.sequence);
    assert.ok(sequences.length > 30);

    const forwardStart = sequences[4];
    const firstForward = await resource(target, taskId, { afterSequence: forwardStart, limit: 5 });
    assert.deepEqual(firstForward.data.timeline.items.map((item) => item.sequence), sequences.slice(5, 10));
    assert.equal(firstForward.data.timeline.cursor.nextAfterSequence, sequences[9]);
    const secondForward = await resource(target, taskId, {
      afterSequence: firstForward.data.timeline.cursor.nextAfterSequence,
      limit: 5,
    });
    assert.deepEqual(secondForward.data.timeline.items.map((item) => item.sequence), sequences.slice(10, 15));

    const collectedForward = [];
    let afterSequence = forwardStart;
    for (let page = 0; page < 100; page += 1) {
      const result = await resource(target, taskId, { afterSequence, limit: 5 });
      collectedForward.push(...result.data.timeline.items.map((item) => item.sequence));
      const next = result.data.timeline.cursor.nextAfterSequence;
      if (next === null) break;
      afterSequence = next;
    }
    assert.deepEqual(collectedForward, sequences.slice(5));
    assert.equal(new Set(collectedForward).size, collectedForward.length);

    const backwardPages = [];
    let beforeSequence = Number.MAX_SAFE_INTEGER;
    for (let page = 0; page < 100; page += 1) {
      const result = await resource(target, taskId, { beforeSequence, limit: 5 });
      backwardPages.unshift(result.data.timeline.items.map((item) => item.sequence));
      const next = result.data.timeline.cursor.nextBeforeSequence;
      if (next === null) break;
      beforeSequence = next;
    }
    const collectedBackward = backwardPages.flat();
    assert.deepEqual(collectedBackward, sequences);
    assert.equal(new Set(collectedBackward).size, sequences.length);

    const checks = await resource(target, taskId, { categories: ["CHECK"], limit: 200 });
    const checkSequences = checks.data.timeline.items.map((item) => item.sequence);
    assert.ok(checkSequences.length >= 20);
    const collectedChecks = [];
    let checkCursor = checkSequences[0];
    for (let page = 0; page < 100; page += 1) {
      const result = await resource(target, taskId, {
        categories: ["CHECK"],
        afterSequence: checkCursor,
        limit: 3,
      });
      collectedChecks.push(...result.data.timeline.items.map((item) => item.sequence));
      const next = result.data.timeline.cursor.nextAfterSequence;
      if (next === null) break;
      checkCursor = next;
    }
    assert.deepEqual(collectedChecks, checkSequences.slice(1));
    assert.equal(new Set(collectedChecks).size, collectedChecks.length);
  });
});

test("task/audit-view redacts adversarial paths, credentials, and URL userinfo", async () => {
  await withRecoveryTarget(async (target) => {
    const taskId = "audit-ux-privacy";
    const sensitive = [
      "Cookie: session=abc123; csrf=xyz789; preference=dark",
      "token=private-token",
      "file=/secret",
      "Authorization: Bearer bearer-secret",
      "https://user:password@example.com/resource",
      "/secret",
      "/config",
      "/root",
      "/token",
      "/etc/passwd",
      "/root/.ssh/id_rsa",
      "/opt/service/config.json",
      "C:\\Users\\cassio\\secret.txt",
      "\\\\server\\share\\private.txt",
      "file:///etc/passwd",
      "Authorization: Bearer super-secret-token",
      "Authorization: Basic basic-secret",
      "Authorization: Digest username=\"admin\", realm=\"private\", nonce=\"abc123\"",
      "Authorization: AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260920/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=deadbeef",
      "Proxy-Authorization: Bearer proxy-secret",
      "Proxy-Authorization: Digest username=\"proxy\", realm=\"internal\"",
      "authorization: Digest username=\"admin\", realm=\"private\"",
      "PROXY-AUTHORIZATION: Bearer proxy-secret",
      "Authorization: Digest username=\"admin\", realm=\"private\", nonce=\"abc123\"\nCookie: session=secret-session; csrf=secret-csrf\nProxy-Authorization: AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE, Signature=deadbeef",
      "Set-Cookie: session=secret-token; Path=/; HttpOnly; Secure",
      "Set-Cookie: auth=secret-token; SameSite=None; Secure",
      "cookie: session=abc123; csrf=xyz789",
      "SET-COOKIE: auth=secret-token; Secure",
      "password=hunter2",
      "token=abc123",
      "client_secret=secret-value",
      "api_key=my-key",
      "FORGELOOP_SECRET=environment-value",
      "https://user:password@example.com/resource",
      "postgres://admin:password@localhost/db",
    ];
    const ordinaryUrls = [
      "https://example.com/api/v1",
      "http://127.0.0.1:3000/health",
      "postgres://host/database",
    ];
    await setupVerifyingTask(target, packageRoot, { taskId, requirement: "privacy" });
    const payloads = [];
    for (let index = 0; index < sensitive.length; index += 5) {
      payloads.push(sensitive.slice(index, index + 5).join("\n"));
    }
    for (const [index, payload] of payloads.entries()) {
      await recordCheck({
        target,
        packageRoot,
        taskId,
        id: `privacy-check-${index}`,
        kind: "manual-review",
        requirement: payload,
        status: "passed",
        evidenceKind: "OBSERVED",
        result: payload,
        exitCode: 0,
      });
    }
    const ordinaryPayload = ordinaryUrls.join("\n");
    await recordCheck({
      target,
      packageRoot,
      taskId,
      id: "ordinary-urls",
      kind: "manual-review",
      requirement: ordinaryPayload,
      status: "passed",
      evidenceKind: "OBSERVED",
      result: ordinaryPayload,
      exitCode: 0,
    });

    const view = await resource(target, taskId, { limit: 200 });
    const serialized = JSON.stringify(view.data);
    for (const value of sensitive) assert.equal(serialized.includes(value), false, value);
    for (const value of [
      "abc123", "xyz789", "dark", "secret-token", "private-token", "bearer-secret", "/secret", "user:password",
      "dXNlcjpwYXNzd29yZA==", "admin", "private", "AKIAEXAMPLE", "deadbeef", "proxy-secret", "proxy", "internal",
      "secret-session", "secret-csrf",
    ]) {
      assert.equal(serialized.includes(value), false, value);
    }
    for (const value of ordinaryUrls) assert.ok(serialized.includes(value), value);
    assert.match(serialized, /Cookie: <credential>/u);
    assert.match(serialized, /Set-Cookie: <credential>/u);
    assert.match(serialized, /cookie: <credential>/u);
    assert.match(serialized, /SET-COOKIE: <credential>/u);
    assert.match(serialized, /Authorization: <credential>/u);
    assert.match(serialized, /authorization: <credential>/u);
    assert.match(serialized, /Proxy-Authorization: <credential>/u);
    assert.match(serialized, /PROXY-AUTHORIZATION: <credential>/u);
    assert.match(serialized, /<path>/u);
    assert.match(serialized, /<credential>/u);
    assert.match(serialized, /<environment>/u);
  });
});

test("task/audit-view projects canonical completion and released ownership", async () => {
  await withRecoveryTarget(async (target) => {
    const taskId = "audit-ux-complete";
    await setupVerifyingTask(target, packageRoot, { taskId, requirement: "tests" });
    await recordCheck({
      target,
      packageRoot,
      taskId,
      id: "tests",
      kind: "manual-review",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      result: "tests passed",
      exitCode: 0,
    });
    await recordCheck({
      target,
      packageRoot,
      taskId,
      id: "required-action",
      kind: "manual-review",
      requirement: "required action satisfies tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      result: "required action satisfied tests",
      exitCode: 0,
    });
    await runAdvance({ target, packageRoot, taskId, to: "REVIEWING" });
    const completion = await runComplete({ target, packageRoot, taskId });
    assert.equal(completion.status, "VALID");
    const view = await resource(target, taskId);
    assert.equal(view.data.completion.state, "COMPLETE");
    assert.equal(view.data.completion.valid, true);
    assert.equal(view.data.completion.claimsReleased, true);
    assert.equal(view.data.ownership.claimState, "RELEASED_BY_COMPLETION");
    assert.equal(view.data.ownership.ownershipValid, true);
    assert.equal(view.data.ownership.mutationAllowed, false);
    assert.equal(view.data.lifecycle.phase, "COMPLETE");
    assert.equal(view.data.lifecycle.terminal, true);
  });
});

test("task/audit-view remains useful and fail-closed for stale inconsistent state", async () => {
  await withRecoveryTarget(async (target) => {
    const taskId = "audit-ux-stale";
    await setupAbandonedTask(target, { taskId });
    const view = await resource(target, taskId);
    assert.equal(view.data.integrity.valid, false);
    assert.ok(view.data.integrity.reasonCodes.length > 0);
    assert.equal(view.data.ownership.claimState, "ACTIVE");
    assert.equal(view.data.ownership.ownershipValid, true);
    assert.equal(view.data.health.currentNextAction, "RECOVER_TASK");
  });
});

test("task/audit-view rejects missing and unknown subjects", async () => {
  await withRecoveryTarget(async (target) => {
    await assert.rejects(
      () => readForgeLoopIntegrationResource("task/audit-view", { projectPath: target, packageRoot }),
      (error) => error.code === "E_TASK_REQUIRED",
    );
    await assert.rejects(
      () => resource(target, "../escape"),
      (error) => error.code === "E_TASK_NOT_FOUND",
    );
  });
});
