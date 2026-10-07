import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { ensureWithin } from "../src/core/filesystem.js";
import {
  acquireProjectClaimsLock,
  CLAIMS_LOCK_REL_PATH,
  classifyProjectClaimsLock,
  readProjectClaimsLockInfo,
  releaseStaleProjectClaimsLockIfUnchanged,
  withProjectClaimsLock,
} from "../src/core/task-lock.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { getPackageRoot } from "../src/core/templates.js";

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-project-claims-lock-"));
  try {
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await run(target);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

function staleLock(overrides = {}) {
  return {
    lockId: "stale-lock",
    scope: "claims-reservation",
    operation: "crashed-operation",
    pid: 1,
    hostname: "fixture",
    processStartToken: "1:1",
    ownerInstanceId: "stale-owner",
    acquiredAt: "2020-01-01T00:00:00.000Z",
    heartbeatAt: "2020-01-01T00:00:00.000Z",
    leaseMs: 1,
    ...overrides,
  };
}

test("project claims lock classifies NONE, LIVE, STALE, UNKNOWN, and CORRUPT", () => {
  assert.equal(classifyProjectClaimsLock(null).status, "NONE");
  assert.equal(classifyProjectClaimsLock({ corrupted: true }).status, "CORRUPT");
  assert.equal(classifyProjectClaimsLock({ lockId: "unknown" }).status, "UNKNOWN");
  assert.equal(classifyProjectClaimsLock(staleLock()).status, "STALE");
  assert.equal(classifyProjectClaimsLock(staleLock({ heartbeatAt: new Date().toISOString(), leaseMs: 300000 })).status, "LIVE");
});

test("retired claims acquisition preserves an unchanged stale legacy lease", async () => {
  await withTarget(async target => {
    const lockPath = ensureWithin(target, CLAIMS_LOCK_REL_PATH);
    const bytes = `${JSON.stringify(staleLock())}\n`;
    await writeFile(lockPath, bytes);
    await assert.rejects(acquireProjectClaimsLock(target), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
    assert.equal(await readFile(lockPath, "utf8"), bytes);
    await assert.rejects(withProjectClaimsLock(target, () => "unsafe"), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    assert.equal(await readFile(lockPath, "utf8"), bytes);
  });
});

test("retired stale claims mutation preserves a replacement owner", async () => {
  await withTarget(async target => {
    const lockPath = ensureWithin(target, CLAIMS_LOCK_REL_PATH);
    const replacement = staleLock({ lockId: "replacement", ownerInstanceId: "replacement-owner" });
    const bytes = `${JSON.stringify(replacement)}\n`;
    await writeFile(lockPath, bytes);
    await assert.rejects(releaseStaleProjectClaimsLockIfUnchanged(target, staleLock()), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
    assert.equal(await readFile(lockPath, "utf8"), bytes);
  });
});

test("native admission preserves corrupt and unknown legacy ownership", async () => {
  await withTarget(async target => {
    const lockPath = ensureWithin(target, CLAIMS_LOCK_REL_PATH);
    for (const bytes of ['{"lockId":', JSON.stringify({ lockId: "unknown" })]) {
      await writeFile(lockPath, bytes);
      await assert.rejects(withProjectClaimsLock(target, () => "unsafe"), { code: "E_STORAGE_MIGRATION_REQUIRED" });
      assert.equal(await readFile(lockPath, "utf8"), bytes);
      await assert.rejects(readFile(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
    }
  });
});

test("native claims exclude overlapping contenders and release callback failure", async () => {
  await withTarget(async target => {
    await mkdir(path.join(target, "src"));
    await withProjectClaimsLock(target, "bootstrap", () => null);
    const create = taskId => runTaskCreate({ target, packageRoot: getPackageRoot(), taskId, claims: ["src"] });
    const outcomes = await Promise.allSettled([create("first"), create("second")]);
    assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
    const rejected = outcomes.find(outcome => outcome.status === "rejected");
    assert.ok(["E_TASK_SCOPE_CONFLICT", "E_STATE_REVISION_CONFLICT"].includes(rejected.reason.code), rejected.reason.message);
    await assert.rejects(withProjectClaimsLock(target, "failing", async () => { throw new Error("callback failed"); }), /callback failed/);
    assert.equal(await readProjectClaimsLockInfo(target), null);
    await runTaskCreate({ target, packageRoot: getPackageRoot(), taskId: "after-failure", claims: [] });
  });
});
