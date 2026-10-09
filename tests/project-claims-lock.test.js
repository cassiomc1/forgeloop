import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { withProjectClaimsLock } from "../src/core/task-lock.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { getPackageRoot } from "../src/core/templates.js";

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-project-claims-lock-"));
  try {
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await run(target);
  } finally {
    await removeTempTree(target);
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

test("native admission preserves retained claims ownership", async () => {
  await withTarget(async target => {
    const lockPath = path.join(target, ".forgeloop/.claims.lock");
    for (const lock of [staleLock(), staleLock({ heartbeatAt: new Date().toISOString(), leaseMs: 300000 })]) {
      const bytes = `${JSON.stringify(lock)}\n`;
      await writeFile(lockPath, bytes);
      await assert.rejects(withProjectClaimsLock(target, () => "unsafe"), { code: "E_STORAGE_MIGRATION_REQUIRED" });
      assert.equal(await readFile(lockPath, "utf8"), bytes);
      await assert.rejects(readFile(path.join(target, ".forgeloop/state.sqlite")), { code: "ENOENT" });
    }
  });
});

test("native admission preserves a replacement legacy owner", async () => {
  await withTarget(async target => {
    const lockPath = path.join(target, ".forgeloop/.claims.lock");
    const replacement = staleLock({ lockId: "replacement", ownerInstanceId: "replacement-owner" });
    const bytes = `${JSON.stringify(replacement)}\n`;
    await writeFile(lockPath, bytes);
    await assert.rejects(withProjectClaimsLock(target, () => "unsafe"), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    assert.equal(await readFile(lockPath, "utf8"), bytes);
  });
});

test("native admission preserves corrupt and unknown legacy ownership", async () => {
  await withTarget(async target => {
    const lockPath = path.join(target, ".forgeloop/.claims.lock");
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
    await runTaskCreate({ target, packageRoot: getPackageRoot(), taskId: "after-failure", claims: [] });
  });
});
