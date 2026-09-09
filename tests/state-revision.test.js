import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { contractFingerprint, createWorkState, mutateWorkState, writeWorkState } from "../src/core/work-state.js";
import { getPackageRoot } from "../src/core/templates.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();

function state(overrides = {}) {
  return createWorkState({
    taskId: "revision-task",
    contractFingerprint: contractFingerprint({ objective: "revision" }),
    repositoryFingerprint: { branch: null, head: null },
    phase: "PLANNED",
    selectedGuides: [],
    completedSteps: [],
    pendingSteps: [],
    checks: [], failures: [], blockers: [], verificationEvidence: [],
    ...overrides,
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

test("mutateWorkState rejects a stale expected revision without overwriting newer state", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-state-revision-"));
  try {
    await writeWorkState(target, state(), { packageRoot });
    const first = await mutateWorkState(target, { packageRoot, expectedRevision: 0 }, (current) => ({ ...current, pendingSteps: ["first"] }));
    assert.equal(first.revision, 1);
    await assert.rejects(
      () => mutateWorkState(target, { packageRoot, expectedRevision: 0 }, (current) => ({ ...current, pendingSteps: ["stale"] })),
      (error) => error.code === "E_STATE_REVISION_CONFLICT",
    );
  } finally {
    await removeTempTree(target);
  }
});

test("concurrent mutations cannot both commit from the same work-state revision", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-state-revision-"));
  try {
    await writeWorkState(target, state(), { packageRoot });
    const firstUpdaterEntered = deferred();
    const releaseFirstUpdater = deferred();
    const first = mutateWorkState(
      target,
      { packageRoot, expectedRevision: 0 },
      async (current) => {
        firstUpdaterEntered.resolve();
        await releaseFirstUpdater.promise;
        return { ...current, pendingSteps: ["first"] };
      },
    );
    await firstUpdaterEntered.promise;
    const second = mutateWorkState(target, { packageRoot, expectedRevision: 0 }, (current) => ({ ...current, pendingSteps: ["second"] }));
    releaseFirstUpdater.resolve();
    const results = await Promise.allSettled([first, second]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal(rejected.reason.code, "E_STATE_REVISION_CONFLICT", rejected.reason.stack ?? rejected.reason.message);
  } finally {
    await removeTempTree(target);
  }
});
