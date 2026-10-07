import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { evaluateAttestationCoverage } from "../src/core/attestation-coverage.js";
import { validateAttestationStatement, writeAttestationStatement } from "../src/core/attestation.js";
import { canonicalFingerprint, writeJsonArtifact } from "../src/core/artifacts.js";
import { codeManifestContentDigest, validateCodeManifest, writeCodeManifest } from "../src/core/code-manifest.js";
import { createContract, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent, validateEventLedger } from "../src/core/events.js";
import { createReceipt } from "../src/core/receipt.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { evaluateRoute } from "../src/core/router.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { resolveAttestationStatus } from "../src/core/attestation.js";
import { verifyAttestation } from "../src/core/attestation-verifier.js";
import { createConfig, writeConfig } from "../src/core/config.js";
import { openStorageDatabase } from "../src/storage/index.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";
import { taskAttestationStatementPath } from "../src/core/task-paths.js";

const packageRoot = getPackageRoot();

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function providerFor(entries, contents) {
  return {
    name: "fixture",
    async detect() { return true; },
    async getCurrentRevision() { return "head"; },
    async getRepositoryIdentity() { return "fixture-repository"; },
    async getChangedEntries() { return entries; },
    async readContent({ path: entryPath }) {
      if (!contents.has(entryPath)) {
        const error = new Error(`Missing fixture content: ${entryPath}`);
        error.notFound = true;
        throw error;
      }
      const value = contents.get(entryPath);
      if (Array.isArray(value)) return value.shift();
      return value;
    },
    async getContentIdentity({ path: entryPath }) { return `fixture:${entryPath}`; },
  };
}

async function createAttestedTask(target, taskId, entries) {
  await writeTaskDescriptor(target, createTaskDescriptor({ taskId, writeClaims: ["src"] }), packageRoot);
  const contract = createContract({
    taskId,
    objective: "Exercise revision range coverage",
    deliverables: entries.map((entry) => entry.path),
    constraints: ["offline"],
    risks: [],
    verification: ["fixture verification"],
    successCriteria: ["fixture verification"],
    stopConditions: ["provider unavailable"],
    unresolvedDecisions: [],
    sourceRefs: entries.map((entry) => entry.path),
  });
  const contractArtifact = await writeContract(target, contract, packageRoot, { taskId });
  const route = evaluateRoute({ workType: "code", surfaces: ["api"], platforms: [] });
  const routeArtifact = await persistRoute(target, route, packageRoot, {
    taskId,
    contractFingerprint: contractArtifact.fingerprint,
  });

  const evidence = [{ kind: "OBSERVED", source: "fixture", result: "passed" }];
  const state = createWorkState({
    taskId,
    contractFingerprint: contractArtifact.fingerprint,
    routeFingerprint: routeArtifact.fingerprint,
    repositoryFingerprint: { branch: null, head: null },
    phase: "REVIEWING",
    previousPhase: "VERIFYING",
    selectedGuides: route.guides,
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: ["contract", "route", "verification"],
    pendingSteps: [],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: evidence,
    verificationCycle: 1,
  });
  await writeWorkState(target, state, { packageRoot, taskId });
  const receipt = await createReceipt({
    taskId,
    contractFingerprint: contractArtifact.fingerprint,
    routeFingerprint: routeArtifact.fingerprint,
    stateFingerprint: canonicalFingerprint(state),
    verificationCycle: 1,
    status: "complete",
    taskStatus: "complete",
    verificationStatus: "valid",
    publicationStatus: "local-only",
    productionReadiness: "not-verified",
    selectedGuides: route.guides,
    changedPaths: entries.flatMap((entry) => [entry.path, entry.sourcePath].filter(Boolean)),
    checks: [],
    evidence,
    review: { status: "approved", independent: false },
    limitations: [],
    publication: { committed: false, pushed: false, pullRequest: null, deployed: false },
  }, packageRoot);
  await writeJsonArtifact(target, taskArtifactPath(taskId, "receipt"), receipt, "execution-receipt", packageRoot, { taskId });
  for (const event of [
    "CONTRACT_VALIDATED",
    "ROUTE_VALIDATED",
    "PREFLIGHT_READY",
    "EXECUTION_STARTED",
    "VERIFICATION_STARTED",
    "VERIFICATION_RECORDED",
    "COMPLETION_VALIDATED",
  ]) {
    await appendProtocolEvent(target, { taskId, event }, packageRoot, { taskId });
  }
  const ledger = await validateEventLedger(target, packageRoot, { taskId });
  assert.equal(ledger.valid, true);
  const completionEvent = ledger.events.find((event) => event.event === "COMPLETION_VALIDATED");
  const manifest = await validateCodeManifest({
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    verificationCycle: 1,
    capture: {
      mode: "WORKTREE",
      revisionProvider: "fixture",
      baseRevision: "base",
      observedRevision: "head",
      providerMetadata: {},
    },
    bindings: {
      contractFingerprint: contractArtifact.fingerprint,
      routeFingerprint: routeArtifact.fingerprint,
      stateFingerprint: canonicalFingerprint(state),
      receiptFingerprint: canonicalFingerprint(receipt),
      ledgerSeq: completionEvent.seq,
      ledgerHash: completionEvent.hash,
    },
    entries,
    contentDigest: codeManifestContentDigest(entries),
  }, packageRoot);
  const manifestArtifact = await writeCodeManifest({ target, packageRoot, taskId, manifest });
  await appendProtocolEvent(target, {
    taskId,
    event: "CODE_MANIFEST_CAPTURED",
    fingerprint: manifestArtifact.fingerprint,
    details: {
      manifestFingerprint: manifestArtifact.fingerprint,
      contentDigest: manifest.contentDigest,
      coveredPaths: new Set(entries.flatMap((entry) => [entry.path, entry.sourcePath].filter(Boolean))).size,
    },
  }, packageRoot, { taskId });
  const statement = await validateAttestationStatement({
    schemaVersion: 1,
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: `forgeloop-task:${taskId}`, digest: { sha256: manifest.contentDigest } }],
    predicateType: "https://forgeloop.dev/attestation/v1",
    predicate: {
      schemaVersion: 1,
      protocol: { name: "ForgeLoop", protocolVersion: 1 },
      task: { taskId, verificationCycle: 1 },
      content: {
        manifestFingerprint: manifestArtifact.fingerprint,
        contentDigest: manifest.contentDigest,
        coveredPaths: [...new Set(entries.flatMap((entry) => [entry.path, entry.sourcePath].filter(Boolean)))].sort(),
      },
      evidence: manifest.bindings,
      verification: { completion: "VALID", audit: "VALID" },
    },
  }, packageRoot);
  await writeAttestationStatement({ target, packageRoot, taskId, statement });
}

async function withTarget(fn) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-attestation-coverage-"));
  try {
    await fn(target);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

for (const operation of ["status", "verify", "range"]) {
  test(`native attestation ${operation} retains bound artifacts across a concurrent deletion`, async () => {
    await withTarget(async target => {
      const taskId = "coverage-snapshot";
      const bytes = Buffer.from("snapshot coverage\n");
      const entries = [{ path: "src/covered.js", operation: "MODIFIED", kind: "FILE", sha256: digest(bytes), providerMetadata: {} }];
      await createAttestedTask(target, taskId, entries);
      await writeConfig(target, createConfig({ attestation: { mode: "required", revisionProvider: "git" } }), packageRoot);
      const provider = providerFor(entries, new Map([["src/covered.js", bytes]]));
      const read = () => operation === "range"
        ? evaluateAttestationCoverage({ target, packageRoot, revisionProvider: provider, baseRevision: "base", headRevision: "head" })
        : operation === "status" ? resolveAttestationStatus({ target, packageRoot, taskId, revisionProvider: provider })
          : verifyAttestation({ target, packageRoot, taskId, revisionProvider: provider });
      assert.equal((await read()).status, "VALID");
      const filename = path.join(target, ".forgeloop/state.sqlite");
      const db = openStorageDatabase(filename);
      const writer = openStorageDatabase(filename);
      try {
        await withOperationalStore({ db, target }, async source => {
          const prototype = Object.getPrototypeOf(source);
          const originalRead = prototype.readText;
          let changed = false;
          prototype.readText = function(relativePath) {
            if (!changed && this.target === target && relativePath === taskAttestationStatementPath(taskId)) {
              changed = true;
              writer.prepare("DELETE FROM task_artifacts WHERE task_id = ?").run(taskId);
            }
            return originalRead.call(this, relativePath);
          };
          try {
            assert.equal((await read()).status, "VALID");
            assert.equal(changed, true);
            assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
          } finally { prototype.readText = originalRead; }
        });
        assert.notEqual((await read()).status, "VALID");
      } finally { writer.close(); db.close(); }
    });
  });
}

test("coverage ignores protocol metadata and reports a valid empty source range", async () => {
  await withTarget(async (target) => {
    const provider = providerFor([
      { path: ".forgeloop/task-state/state.json", operation: "MODIFIED", kind: "FILE" },
    ], new Map());
    const result = await evaluateAttestationCoverage({
      target,
      packageRoot,
      revisionProvider: provider,
      baseRevision: "base",
      headRevision: "head",
      requireCompleteCoverage: true,
    });
    assert.equal(result.status, "VALID");
    assert.equal(result.changedPaths, 0);
    assert.equal(result.uncoveredPaths.length, 0);
  });
});

test("coverage validates one task, detects gaps, and allows identical overlaps", async () => {
  await withTarget(async (target) => {
    const bytes = Buffer.from("covered\n", "utf8");
    const entries = [{ path: "src/covered.js", operation: "MODIFIED", kind: "FILE", sha256: digest(bytes), providerMetadata: {} }];
    await createAttestedTask(target, "coverage-task-a", entries);
    const provider = providerFor(entries, new Map([["src/covered.js", bytes]]));
    let result = await evaluateAttestationCoverage({ target, packageRoot, revisionProvider: provider, baseRevision: "base", headRevision: "head" });
    assert.equal(result.status, "VALID");
    assert.equal(result.changedPaths, 1);
    assert.equal(result.coveredPaths, 1);

    const uncovered = { path: "src/uncovered.js", operation: "ADDED", kind: "FILE", sha256: digest(Buffer.from("new\n")), providerMetadata: {} };
    const rangeProvider = providerFor([...entries, uncovered], new Map([["src/covered.js", bytes], ["src/uncovered.js", Buffer.from("new\n")]]));
    result = await evaluateAttestationCoverage({ target, packageRoot, revisionProvider: rangeProvider, baseRevision: "base", headRevision: "head", requireCompleteCoverage: true });
    assert.equal(result.status, "INVALID");
    assert.ok(result.errors.some((error) => error.code === "E_ATTESTATION_COVERAGE_GAP"));

    await createAttestedTask(target, "coverage-task-b", entries);
    result = await evaluateAttestationCoverage({ target, packageRoot, revisionProvider: provider, baseRevision: "base", headRevision: "head" });
    assert.equal(result.status, "VALID");
    assert.equal(result.tasks, 2);
    assert.ok(result.overlaps.some((overlap) => overlap.path === "src/covered.js"));
  });
});

test("coverage detects conflicting overlapping attestations and deletion/rename coverage", async () => {
  await withTarget(async (target) => {
    const firstBytes = Buffer.from("first\n");
    const secondBytes = Buffer.from("second\n");
    const first = { path: "src/conflict.js", operation: "MODIFIED", kind: "FILE", sha256: digest(firstBytes), providerMetadata: {} };
    const second = { path: "src/conflict.js", operation: "MODIFIED", kind: "FILE", sha256: digest(secondBytes), providerMetadata: {} };
    await createAttestedTask(target, "coverage-conflict-a", [first]);
    await createAttestedTask(target, "coverage-conflict-b", [second]);
    const provider = providerFor([first], new Map([["src/conflict.js", [firstBytes, secondBytes]]]));
    const result = await evaluateAttestationCoverage({ target, packageRoot, revisionProvider: provider, baseRevision: "base", headRevision: "head" });
    assert.equal(result.status, "INVALID");
    assert.ok(result.errors.some((error) => error.code === "E_ATTESTATION_COVERAGE_CONFLICT"));

  });

  await withTarget(async (target) => {
    const deleted = { path: "src/old.js", operation: "DELETED", kind: "DELETED", providerMetadata: {} };
    const renamedBytes = Buffer.from("renamed\n");
    const renamed = { path: "src/new.js", sourcePath: "src/old-name.js", operation: "RENAMED", kind: "FILE", sha256: digest(renamedBytes), providerMetadata: {} };
    await createAttestedTask(target, "coverage-delete-rename", [renamed, deleted]);
    const deleteRenameProvider = providerFor([renamed, deleted], new Map([["src/new.js", renamedBytes]]));
    const deleteRenameResult = await evaluateAttestationCoverage({ target, packageRoot, revisionProvider: deleteRenameProvider, baseRevision: "base", headRevision: "head" });
    assert.equal(deleteRenameResult.status, "VALID");
    assert.equal(deleteRenameResult.uncoveredPaths.length, 0);
  });
});
