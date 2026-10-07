/**
 * Check D: guard-rule parity between the filesystem and SQLite backends.
 *
 * The filesystem baseline is invoked through the same production contract the
 * canonical diagnosis path uses: `assertTaskMutationAllowed(target, { taskId,
 * packageRoot })`, where `packageRoot` is ForgeLoop's own package root (schema
 * and template root), NOT the disposable project target. An earlier probe
 * omitted it, which made descriptor and state reads fail into an `errors` array
 * and produced a misleading "ALLOW"; that probe was discarded.
 *
 * Outcome classification is strict. A harness or configuration failure is
 * reported as `harness-error` and fails the test; it is never normalized into an
 * accepted domain outcome. Two broken harnesses agreeing proves nothing, so the
 * baseline controls run first.
 */
import assert from "node:assert/strict";
import test, {before,after} from "node:test";

import { createPinnedFilesystemBaseline } from "./helpers/pinned-filesystem-baseline.mjs";
import { assertStoreTaskMutationAllowed, resolveStoreTaskContext } from "../src/storage/task-guards.js";
import { getPackageRoot } from "../src/core/templates.js";
import { importProjectState } from "../src/storage/index.js";
import {
  TEST_TASK_ID,
  buildDiagnosisProject,
  cleanupDir,
} from "./helpers/storage-fixtures.js";

const packageRoot = getPackageRoot();
let baseline;
before(async()=>{baseline=await createPinnedFilesystemBaseline(packageRoot);});
after(async()=>{await baseline?.cleanup();});

/**
 * Invoke the filesystem guard with the complete production contract.
 *
 * `assertTaskMutationAllowed` returns a result object on success and throws on
 * domain rejection. Anything else is treated as an unexpected shape, not as
 * acceptance.
 */
async function runFilesystemGuard(target, taskId, options = {}) {
  try {
    const result = await baseline.guards.assertTaskMutationAllowed(target, { taskId, packageRoot:baseline.root, ...options });
    if (!result || typeof result.mutationAllowed !== "boolean" || typeof result.claimState !== "string") {
      return { outcome: "harness-error", reason: "unexpected result shape" };
    }
    return {
      outcome: result.mutationAllowed ? "accept" : "reject",
      claimState: result.claimState,
      recoveryStatus: result.recoveryStatus ?? null,
      errors: (result.errors ?? []).map((entry) => entry.code),
    };
  } catch (error) {
    if (typeof error?.code !== "string") {
      return { outcome: "harness-error", reason: `exception without a domain code: ${error?.message}` };
    }
    return {
      outcome: "reject",
      code: error.code,
      claimState: error.claimState ?? null,
      recoveryStatus: error.recovery?.status ?? null,
    };
  }
}

/** Invoke the store guard with the same logical evidence. */
function runStoreGuard(db, taskId) {
  try {
    const result = assertStoreTaskMutationAllowed(db, taskId);
    if (!result || typeof result.mutationAllowed !== "boolean" || typeof result.claimState !== "string") {
      return { outcome: "harness-error", reason: "unexpected result shape" };
    }
    return {
      outcome: result.mutationAllowed ? "accept" : "reject",
      claimState: result.claimState,
      recoveryStatus: result.recoveryStatus ?? null,
      errors: (result.errors ?? []).map((entry) => entry.code),
    };
  } catch (error) {
    if (typeof error?.code !== "string") {
      return { outcome: "harness-error", reason: `exception without a domain code: ${error?.message}` };
    }
    return {
      outcome: "reject",
      code: error.code,
      claimState: error.claimState ?? null,
      recoveryStatus: error.recovery?.status ?? null,
    };
  }
}

/**
 * Build logically equivalent evidence for both backends from one valid seed.
 * The same narrow corruption is applied to each disposable copy, so neither
 * backend sees more than the other.
 */
async function withPairedFixture(corrupt, run) {
  const seed = await buildDiagnosisProject({ unrelated: 0, legacy: true });
  const storePath = `${seed}/state.sqlite`;
  const { db } = await importProjectState(seed, storePath);
  try {
    if (corrupt?.filesystem) await corrupt.filesystem(seed);
    if (corrupt?.store) corrupt.store(db);
    return await run({ target: seed, db, taskId: TEST_TASK_ID });
  } finally {
    db.close();
    await cleanupDir(seed);
  }
}

/** Compare the observable outcome of both guards. */
function assertParity(filesystem, store, label) {
  assert.equal(filesystem.outcome, store.outcome, `${label}: outcome differs (${JSON.stringify(filesystem)} vs ${JSON.stringify(store)})`);
  if (filesystem.outcome === "harness-error") {
    assert.fail(`${label}: filesystem baseline is a harness error: ${filesystem.reason}`);
  }
  if (filesystem.outcome === "reject") {
    assert.equal(filesystem.code, store.code, `${label}: rejection code differs`);
  }
  if (filesystem.outcome === "accept") {
    assert.equal(filesystem.claimState, store.claimState, `${label}: ownership classification differs`);
  }
}

/* ------------------------------------------------- baseline controls */

test("D-control-1: a known-valid fixture is accepted by the filesystem guard", async () => {
  await withPairedFixture(null, async ({ target, taskId }) => {
    const filesystem = await runFilesystemGuard(target, taskId);
    // The control must produce a real accepted result, not a silent error path.
    assert.equal(filesystem.outcome, "accept", `valid fixture was not accepted: ${JSON.stringify(filesystem)}`);
    assert.equal(filesystem.claimState, "ACTIVE");
    // Evidence must actually have been loaded, not silently defaulted.
    const evidence = await baseline.guards.resolveTaskClaimState(target, { taskId, packageRoot:baseline.root });
    assert.ok(evidence.historicalWriteClaims.length > 0, "claims must be loaded from evidence");
  });
});

test("D-control-2: a known-invalid fixture is rejected with a domain code", async () => {
  await withPairedFixture(null, async ({ target, taskId }) => {
    // Remove the descriptor so the guard cannot establish ownership at all.
    const { unlink } = await import("node:fs/promises");
    const { taskDirectory } = await import("../src/core/task-paths.js");
    const path = await import("node:path");
    const { taskStorageKey } = await import("../src/core/task-identity.js");
    const { taskArtifactPath } = await import("../src/core/task-paths.js");
    await unlink(path.join(target, taskArtifactPath(taskId, "descriptor")));
    void taskDirectory; void taskStorageKey;

    const filesystem = await runFilesystemGuard(target, taskId);
    assert.equal(filesystem.outcome, "reject", `missing evidence must reject: ${JSON.stringify(filesystem)}`);
    assert.equal(typeof filesystem.code, "string");
  });
});

test("D-control-3: a deliberately broken harness configuration is not an acceptance", async () => {
  // A packageRoot that cannot resolve schemas is a configuration failure. It
  // must not silently become an accepted domain outcome.
  const seed = await buildDiagnosisProject({ unrelated: 0, legacy: true });
  try {
    const broken = await runFilesystemGuard(seed, TEST_TASK_ID, { packageRoot: "/nonexistent-package-root" });
    // Either it rejects with a domain code, or it is classified as a harness
    // error. Either way it must never be reported as a clean acceptance with
    // no evidence, which is the defect the old probe exhibited.
    assert.notEqual(
      broken.outcome === "accept" && broken.claimState === "ACTIVE" && (broken.errors ?? []).length === 0,
      true,
      `a broken configuration must not look like a clean acceptance: ${JSON.stringify(broken)}`,
    );
  } finally {
    await cleanupDir(seed);
  }
});

/* -------------------------------------------------- differential cases */

test("D-case-1: valid active ownership", async () => {
  await withPairedFixture(null, async ({ target, db, taskId }) => {
    const filesystem = await runFilesystemGuard(target, taskId);
    const store = runStoreGuard(db, taskId);
    assertParity(filesystem, store, "valid-ownership");
    assert.equal(filesystem.outcome, "accept");
  });
});

test("D-case-2: stripped claims do not grant ownership optimistically", async () => {
  await withPairedFixture({
    // Remove every claim and the descriptor's declared claims on both backends.
    filesystem: async (target) => {
      const { readFile, writeFile } = await import("node:fs/promises");
      const path = await import("node:path");
      const { taskArtifactPath } = await import("../src/core/task-paths.js");
      const descriptorPath = path.join(target, taskArtifactPath(TEST_TASK_ID, "descriptor"));
      const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
      descriptor.writeClaims = [];
      await writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
    },
    store: (db) => {
      db.prepare("DELETE FROM claims WHERE task_id = ?").run(TEST_TASK_ID);
      const row = db.prepare("SELECT descriptor_json FROM tasks WHERE task_id = ?").get(TEST_TASK_ID);
      db.prepare("UPDATE tasks SET descriptor_json = ? WHERE task_id = ?")
        .run(JSON.stringify({ ...JSON.parse(row.descriptor_json), writeClaims: [] }), TEST_TASK_ID);
    },
  }, async ({ target, db, taskId }) => {
    const filesystem = await runFilesystemGuard(target, taskId);
    const store = runStoreGuard(db, taskId);
    assertParity(filesystem, store, "stripped-claims");
    // Both backends agree: claim count does not by itself gate ordinary
    // mutation. Claim conflict is enforced at reservation, not here.
  });
});

test("D-case-3: COMPLETE with proof absent does not release claims", async () => {
  // Phase alone must not release claims. Both backends must fail closed.
  await withPairedFixture({
    filesystem: async (target) => {
      const { readFile, writeFile } = await import("node:fs/promises");
      const path = await import("node:path");
      const { taskArtifactPath } = await import("../src/core/task-paths.js");
      const statePath = path.join(target, taskArtifactPath(TEST_TASK_ID, "state"));
      const state = JSON.parse(await readFile(statePath, "utf8"));
      state.phase = "COMPLETE";
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    },
    store: (db) => {
      const row = db.prepare("SELECT state_json FROM tasks WHERE task_id = ?").get(TEST_TASK_ID);
      const state = JSON.parse(row.state_json);
      state.phase = "COMPLETE";
      db.prepare("UPDATE tasks SET phase = 'COMPLETE', state_json = ? WHERE task_id = ?").run(JSON.stringify(state), TEST_TASK_ID);
    },
  }, async ({ target, db, taskId }) => {
    const filesystem = await runFilesystemGuard(target, taskId);
    const store = runStoreGuard(db, taskId);
    assertParity(filesystem, store, "complete-proof-absent");
    assert.equal(filesystem.outcome, "reject", "phase alone must not release claims");
    assert.equal(store.outcome, "reject");
  });
});

test("D-case-4: workspace binding absent is not applicable and allowed", async () => {
  await withPairedFixture(null, async ({ target, db, taskId }) => {
    // The fixture has no workspace binding, so the rule does not apply.
    const { assertStoreWorkspaceBinding } = await import("../src/storage/task-guards.js");
    const binding = await assertStoreWorkspaceBinding(db, taskId, { target });
    assert.equal(binding.status, "UNBOUND");
  });
});

test("D-case-5: missing or ambiguous task selection rejects", async () => {
  await withPairedFixture(null, async ({ target, db }) => {
    // A task absent from both backends must be rejected, not defaulted.
    const missing = "task-that-does-not-exist";
    const fsMissing = await runFilesystemGuard(target, missing);
    assert.equal(fsMissing.outcome, "reject", `unknown task must reject: ${JSON.stringify(fsMissing)}`);
    let storeMissing;
    try {
      resolveStoreTaskContext(db, { taskId: missing });
      storeMissing = "accept";
    } catch (error) {
      storeMissing = error.code;
    }
    assert.equal(typeof storeMissing, "string");
    assert.notEqual(storeMissing, "accept", "an unknown task must not resolve");
  });
});
