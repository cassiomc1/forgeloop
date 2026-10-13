import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import {
  createWorkState,
  initializeWorkState,
  mutateWorkState,
  readContractFingerprint,
  readRequiredArtifactFingerprints,
  readWorkState,
  writeWorkState,
} from "../src/core/work-state.js";
import { sha256 } from "../src/core/manifest.js";
import { withTaskTransaction } from "../src/core/transaction.js";
import { getPackageRoot } from "../src/core/templates.js";

async function project(callback) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-state-transition-"));
  try { return await callback(target); }
  finally { await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}

function stateFor(taskId, phase = "RECEIVED", extra = {}) {
  return createWorkState({
    taskId,
    phase,
    contractFingerprint: "0".repeat(64),
    ...extra,
  });
}

test("work-state transitions preserve the canonical transaction boundary and CAS", async () => {
  await project(async target => {
    const packageRoot = getPackageRoot();
    const taskId = "state-transition-kernel";
    await writeTaskDescriptor(target, createTaskDescriptor({ taskId, writeClaims: [] }), packageRoot);
    await writeWorkState(target, stateFor(taskId), { packageRoot, taskId });

    const first = await mutateWorkState(
      target,
      { packageRoot, taskId, expectedRevision: 0 },
      current => ({ ...current, phase: "DISCOVERING", previousPhase: "RECEIVED" }),
    );
    assert.equal(first.revision, 1);
    assert.equal(first.phase, "DISCOVERING");

    await assert.rejects(
      mutateWorkState(target, { packageRoot, taskId, expectedRevision: 0 }, current => current),
      { code: "E_STATE_REVISION_CONFLICT" },
    );
    assert.deepEqual(await readWorkState(target, { packageRoot, taskId }), first);

    const existing = await initializeWorkState(target, stateFor(taskId), { packageRoot, taskId });
    assert.deepEqual(existing, first, "initialize must not replace an existing canonical state");

    await withTaskTransaction({ target, taskId, operation: "nested-state-transition", packageRoot }, async () => {
      const nested = await mutateWorkState(
        target,
        { packageRoot, taskId, expectedRevision: 1 },
        current => ({ ...current, phase: "CONTRACT_READY", previousPhase: "DISCOVERING" }),
      );
      assert.equal(nested.revision, 2);
      assert.equal(nested.phase, "CONTRACT_READY");
    });

    const final = await readWorkState(target, { packageRoot, taskId });
    assert.equal(final.revision, 2);
    assert.equal(final.phase, "CONTRACT_READY");
    assert.equal(final.previousPhase, "DISCOVERING");
  });
});

test("required artifact fingerprints retain raw filesystem bytes", async () => {
  await project(async target => {
    const relativePath = ".forgeloop/raw-evidence.bin";
    const bytes = Buffer.from([0xff, 0x00, 0xc3, 0x28, 0x80]);
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await writeFile(path.join(target, relativePath), bytes);

    assert.deepEqual(
      await readRequiredArtifactFingerprints(target, [{ path: relativePath, sha256: sha256(bytes) }]),
      [{ path: relativePath, sha256: sha256(bytes), status: "present" }],
    );
  });
});

test("portable contract errors preserve the legacy parse boundary", async () => {
  await project(async target => {
    const contractFile = ".forgeloop/current-contract.json";
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });

    await assert.rejects(
      readContractFingerprint(target, contractFile),
      error => error?.code === "STALE_STATE_FAILURE"
        && error.message.startsWith(`Unable to parse contract ${contractFile}:`)
        && error.message.includes("ENOENT"),
    );

    await writeFile(path.join(target, contractFile), "{\"broken\":");
    await assert.rejects(
      readContractFingerprint(target, contractFile),
      error => error?.code === "STALE_STATE_FAILURE"
        && error.message.startsWith(`Unable to parse contract ${contractFile}:`),
    );
  });
});
