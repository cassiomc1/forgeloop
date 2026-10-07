import { removeTempTree } from "./helpers/rm-safe.js";
import { ensureFixtureTask, readFixtureText, overwriteFixtureText } from "./helpers/native-storage-fixture.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARTIFACT_PATHS,
  canonicalFingerprint,
  readJsonArtifact,
  writeJsonArtifact,
  writePortableJsonArtifact,
} from "../src/core/artifacts.js";
import { contractFingerprint, createContract, readContract, writeContract } from "../src/core/contract.js";
import { createConfig } from "../src/core/config.js";
import { createGate } from "./helpers/gates.js";
import { createSourceRegistry } from "../src/core/sources.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-artifacts-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

test("canonical fingerprints ignore object key order", () => {
  assert.equal(
    canonicalFingerprint({ b: 2, a: { d: 4, c: 3 } }),
    canonicalFingerprint({ a: { c: 3, d: 4 }, b: 2 }),
  );
  assert.notEqual(canonicalFingerprint({ value: 1 }), canonicalFingerprint({ value: 2 }));
});

test("current contracts are schema-valid, persisted, and fingerprinted", async () => {
  const contract = createContract({
    taskId: "task-001",
    objective: "validate protocol preparation",
    deliverables: ["current-contract.json"],
    constraints: ["offline"],
    risks: ["untrusted-input"],
    verification: ["npm test"],
    successCriteria: ["contract is current"],
    stopConditions: ["missing source"],
    unresolvedDecisions: [],
    sourceRefs: ["USER-001"],
  });

  assert.equal(contract.contractFingerprint, undefined);
  assert.equal(contractFingerprint(contract), canonicalFingerprint(contract));

  await withTarget(async (target) => {
    await ensureFixtureTask(target, contract.taskId, repositoryRoot);
    const written = await writeContract(target, contract, repositoryRoot, { taskId: contract.taskId });
    const loaded = await readContract(target, repositoryRoot, { taskId: contract.taskId });
    assert.equal(written.fingerprint, loaded.fingerprint);
    assert.deepEqual(loaded.value, contract);
    assert.match(await readFixtureText(target, taskArtifactPath(contract.taskId, "contract")), /task-001/);
  });
});

test("generic artifact reads reject missing and unsafe paths with stable codes", async () => {
  await withTarget(async (target) => {
    await assert.rejects(
      () => readJsonArtifact(target, "missing.json", "current-contract", repositoryRoot),
      (error) => error.code === "ARTIFACT_MISSING",
    );
    await assert.rejects(
      () => writePortableJsonArtifact(target, "../escape.json", {}, "current-contract", repositoryRoot),
      /inside target|escapes target/i,
    );
  });
});

test("artifact writes reject secret-like values before touching disk", async () => {
  await withTarget(async (target) => {
    await assert.rejects(
      () => writeJsonArtifact(
        target,
        ARTIFACT_PATHS.contract,
        { schemaVersion: 1, protocolVersion: 1, taskId: "x", objective: "x", apiKey: "secret" },
        "current-contract",
        repositoryRoot,
      ),
      /secret|credential/i,
    );
  });
});

test("route persistence rejects a manually persisted invalid current contract", async () => {
  await withTarget(async (target) => {
    const sensitiveValue = "sk-" + "U".repeat(20);
    const contract = {
      schemaVersion: 1,
      protocolVersion: 1,
      taskId: "route-invalid-contract",
      objective: "Reject invalid contract reads before routing",
      assumptions: [{
        value: sensitiveValue,
        reason: "Exercise the direct route boundary",
        scope: "local test",
        reversible: true,
        source: "agent-default",
      }],
      deliverables: [],
      constraints: [],
      risks: [],
      verification: [],
      successCriteria: [],
      stopConditions: [],
      unresolvedDecisions: [],
      sourceRefs: [],
    };
    await ensureFixtureTask(target, contract.taskId, repositoryRoot);
    await writeContract(target, { ...contract, assumptions: [] }, repositoryRoot, { taskId: contract.taskId });
    const contractPath = taskArtifactPath(contract.taskId, "contract");
    await overwriteFixtureText(target, contractPath, JSON.stringify(contract));

    await assert.rejects(
      () => persistRoute(target, evaluateRoute({ workType: "bug" }), repositoryRoot, { taskId: contract.taskId }),
      (error) => {
        assert.match(error.message, /secret-like/i);
        assert.equal(error.message.includes(sensitiveValue), false);
        return true;
      },
    );
  });
});

test("gate, source, and compliance configuration artifacts expose versioned shapes", () => {
  assert.deepEqual(createGate({
    taskId: "task-001",
    gate: "design",
    status: "satisfied",
    requiredBy: ["premium"],
    artifacts: [],
    decisions: [],
    unknowns: [],
    approvedAssumptions: [],
    evidence: [],
  }), {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId: "task-001",
    gate: "design",
    status: "satisfied",
    requiredBy: ["premium"],
    artifacts: [],
    decisions: [],
    unknowns: [],
    approvedAssumptions: [],
    evidence: [],
  });
  assert.equal(createSourceRegistry({
    "USER-001": { kind: "user-request", summary: "Implement the protocol" },
  }).sources["USER-001"].kind, "user-request");
  assert.equal(createConfig({ complianceMode: "strict" }).complianceMode, "strict");
  assert.deepEqual(createConfig({
    verification: {
      checkers: [{
        checkId: "unit-tests",
        scopeMode: "PATH_ARGUMENTS",
        argvPrefix: ["node", "--test"],
        pathInsertion: "APPEND",
      }],
    },
  }).verification.checkers, [{
    checkId: "unit-tests",
    scopeMode: "PATH_ARGUMENTS",
    argvPrefix: ["node", "--test"],
    pathInsertion: "APPEND",
  }]);
});
