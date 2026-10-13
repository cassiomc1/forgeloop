import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { sha256 } from "../src/core/manifest.js";
import {
  classifyWorkState,
  contractFingerprint,
  createWorkState,
  readRequiredArtifactFingerprints,
} from "../src/core/work-state.js";

function input(overrides = {}) {
  return {
    taskId: "freshness-task",
    contractFingerprint: contractFingerprint({ objective: "freshness" }),
    repositoryFingerprint: { branch: "main", head: "same" },
    phase: "VERIFYING",
    selectedGuides: ["clean", "test"],
    completedSteps: ["implementation"],
    pendingSteps: ["verification"],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
    ...overrides,
  };
}

test("contract comparison is required for a fresh checkpoint", () => {
  const state = createWorkState(input());
  const same = classifyWorkState(state, {
    repositoryFingerprint: state.repositoryFingerprint,
    contractFingerprint: state.contractFingerprint,
    requiredArtifacts: [],
  });
  assert.equal(same.status, "FRESH");
  assert.equal(same.contractComparison, "MATCH");

  const missing = classifyWorkState(state, {
    repositoryFingerprint: state.repositoryFingerprint,
    requiredArtifacts: [],
  });
  assert.equal(missing.status, "REVALIDATION_REQUIRED");
  assert.equal(missing.contractComparison, "NOT_VERIFIED");
  assert.ok(missing.reasons.includes("CONTRACT_NOT_VERIFIED"));

  const changed = classifyWorkState(state, {
    repositoryFingerprint: state.repositoryFingerprint,
    contractFingerprint: contractFingerprint({ objective: "changed" }),
    requiredArtifacts: [],
  });
  assert.equal(changed.contractComparison, "MISMATCH");
  assert.ok(changed.reasons.includes("CONTRACT_CHANGED"));
});

test("required artifact hashes detect missing and changed material files", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-freshness-"));
  try {
    const relativePath = "src/material.js";
    const contents = "export const value = 1;\n";
    await mkdir(path.join(target, "src"), { recursive: true });
    await writeFile(path.join(target, relativePath), contents);
    const artifact = { path: relativePath, sha256: sha256(Buffer.from(contents)) };
    const state = createWorkState(input({ requiredArtifacts: [artifact] }));
    const current = await readRequiredArtifactFingerprints(target, state.requiredArtifacts);
    const fresh = classifyWorkState(state, {
      repositoryFingerprint: state.repositoryFingerprint,
      contractFingerprint: state.contractFingerprint,
      requiredArtifacts: current,
    });
    assert.equal(fresh.status, "FRESH");
    assert.equal(fresh.artifactComparison, "MATCH");

    await writeFile(path.join(target, relativePath), "export const value = 2;\n");
    const changed = classifyWorkState(state, {
      repositoryFingerprint: state.repositoryFingerprint,
      contractFingerprint: state.contractFingerprint,
      requiredArtifacts: await readRequiredArtifactFingerprints(target, state.requiredArtifacts),
    });
    assert.equal(changed.artifactComparison, "MISMATCH");
    assert.ok(changed.reasons.includes("REQUIRED_ARTIFACT_CHANGED"));

    await rm(path.join(target, relativePath));
    const missing = classifyWorkState(state, {
      repositoryFingerprint: state.repositoryFingerprint,
      contractFingerprint: state.contractFingerprint,
      requiredArtifacts: await readRequiredArtifactFingerprints(target, state.requiredArtifacts),
    });
    assert.equal(missing.artifactComparison, "MISSING");
    assert.ok(missing.reasons.includes("REQUIRED_ARTIFACT_MISSING"));
  } finally {
    await removeTempTree(target);
  }
});

test("state age is an informational warning rather than a false failure", () => {
  const state = createWorkState(input({ lastUpdated: "2020-01-01T00:00:00.000Z" }));
  const result = classifyWorkState(state, {
    repositoryFingerprint: state.repositoryFingerprint,
    contractFingerprint: state.contractFingerprint,
    requiredArtifacts: [],
    now: Date.parse("2026-01-01T00:00:00.000Z"),
    maxAgeMs: 60_000,
  });
  assert.equal(result.status, "FRESH");
  assert.ok(result.warnings.includes("CHECKPOINT_OLD"));
});

test("required artifact paths and hashes are validated as checkpoint data", () => {
  assert.throws(
    () => createWorkState(input({ requiredArtifacts: [{ path: "../outside", sha256: "a".repeat(64) }] })),
    /relative|escape/i,
  );
  assert.throws(
    () => createWorkState(input({ requiredArtifacts: [{ path: "src/a.js", sha256: "A".repeat(64) }] })),
    /SHA-256|fingerprint/i,
  );
});
