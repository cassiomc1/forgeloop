import { removeTempTree } from "./helpers/rm-safe.js";
import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateRoute } from "../src/core/router.js";
import { runCommandExecution } from "../src/core/execution.js";
import { sha256 } from "../src/core/manifest.js";
import { contractFingerprint, createWorkState } from "../src/core/work-state.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repositoryRoot, "src", "cli.js");

function runCli(target, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args, "--path", target], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

test("validate-protocol validates a read-only coherent artifact set", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-conformance-cli-"));
  try {
    const route = evaluateRoute({ workType: "api", surfaces: ["api"], platforms: [] });
    const contract = { objective: "cli conformance" };
    const state = createWorkState({
      taskId: "parent",
      contractFingerprint: contractFingerprint(contract),
      repositoryFingerprint: { branch: null, head: null },
      phase: "ROUTED",
      selectedGuides: route.guides,
      completedSteps: [],
      pendingSteps: ["implementation"],
      checks: [],
      failures: [],
      blockers: [],
      verificationEvidence: [],
    });
    const receipt = {
      schemaVersion: 1,
      protocolVersion: 1,
      taskId: "parent",
      contractFingerprint: state.contractFingerprint,
      selectedGuides: route.guides,
      changedPaths: [],
      checks: [],
      review: { status: "not-run", independent: false },
      limitations: [],
      publication: { committed: false, pushed: false, pullRequest: null, deployed: false },
    };
    const brief = {
      schemaVersion: 1,
      protocolVersion: 1,
      taskId: "child",
      parentTaskId: "parent",
      objective: "child",
      allowedPaths: ["src/child.js"],
      readOnlyPaths: [],
      dependencies: [],
      constraints: [],
      requiredGuides: ["clean"],
      verification: ["npm test"],
      authority: ["write src/child.js"],
      deliverables: ["src/child.js"],
    };
    const delegated = {
      schemaVersion: 1,
      protocolVersion: 1,
      taskId: "child",
      status: "complete-with-concerns",
      changes: [],
      verification: ["npm test"],
      openFindings: [],
      limitations: [],
    };
    for (const [name, value] of Object.entries({ route, state, receipt, brief, delegated })) {
      await writeFile(path.join(target, `${name}.json`), `${JSON.stringify(value)}\n`);
    }
    await writeFile(path.join(target, "contract.json"), `${JSON.stringify(contract)}\n`);

    const result = runCli(
      target,
      "validate-protocol",
      "--route-file", "route.json",
      "--state-file", "state.json",
      "--receipt-file", "receipt.json",
      "--task-brief-file", "brief.json",
      "--delegated-result-file", "delegated.json",
      "--contract-file", "contract.json",
      "--json",
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "VALID");
  } finally {
    await removeTempTree(target);
  }
});

test("validate-protocol validates a single-actor run without delegation inputs", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-conformance-cli-"));
  try {
    const route = evaluateRoute({ workType: "api", surfaces: ["api"], platforms: [] });
    const contract = { objective: "single actor" };
    const state = createWorkState({
      taskId: "single-task",
      contractFingerprint: contractFingerprint(contract),
      repositoryFingerprint: { branch: null, head: null },
      phase: "ROUTED",
      selectedGuides: route.guides,
      completedSteps: [],
      pendingSteps: ["implementation"],
      checks: [],
      failures: [],
      blockers: [],
      verificationEvidence: [],
    });
    const receipt = {
      schemaVersion: 1,
      protocolVersion: 1,
      taskId: "single-task",
      contractFingerprint: state.contractFingerprint,
      selectedGuides: route.guides,
      changedPaths: [],
      checks: [],
      review: { status: "not-run", independent: false },
      limitations: [],
      publication: { committed: false, pushed: false, pullRequest: null, deployed: false },
    };
    await writeFile(path.join(target, "route.json"), `${JSON.stringify(route)}\n`);
    await writeFile(path.join(target, "state.json"), `${JSON.stringify(state)}\n`);
    await writeFile(path.join(target, "receipt.json"), `${JSON.stringify(receipt)}\n`);
    await writeFile(path.join(target, "contract.json"), `${JSON.stringify(contract)}\n`);

    const result = runCli(
      target,
      "validate-protocol",
      "--route-file", "route.json",
      "--state-file", "state.json",
      "--receipt-file", "receipt.json",
      "--contract-file", "contract.json",
      "--json",
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "VALID");
    assert.equal(report.delegation.status, "NOT_APPLICABLE");
    assert.equal(report.delegation.required, false);
  } finally {
    await removeTempTree(target);
  }
});

test("validate-protocol treats an explicitly missing continuity artifact as optional", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-conformance-cli-"));
  try {
    const route = evaluateRoute({ workType: "api", surfaces: ["api"], platforms: [] });
    const contract = { objective: "optional continuity" };
    const state = createWorkState({
      taskId: "single-task",
      contractFingerprint: contractFingerprint(contract),
      repositoryFingerprint: { branch: null, head: null },
      phase: "ROUTED",
      selectedGuides: route.guides,
      completedSteps: [],
      pendingSteps: ["implementation"],
      checks: [],
      failures: [],
      blockers: [],
      verificationEvidence: [],
    });
    const receipt = {
      schemaVersion: 1,
      protocolVersion: 1,
      taskId: "single-task",
      contractFingerprint: state.contractFingerprint,
      selectedGuides: route.guides,
      changedPaths: [],
      checks: [],
      review: { status: "not-run", independent: false },
      limitations: [],
      publication: { committed: false, pushed: false, pullRequest: null, deployed: false },
    };
    await writeFile(path.join(target, "route.json"), `${JSON.stringify(route)}\n`);
    await writeFile(path.join(target, "state.json"), `${JSON.stringify(state)}\n`);
    await writeFile(path.join(target, "receipt.json"), `${JSON.stringify(receipt)}\n`);
    await writeFile(path.join(target, "contract.json"), `${JSON.stringify(contract)}\n`);

    const result = runCli(
      target,
      "validate-protocol",
      "--route-file", "route.json",
      "--state-file", "state.json",
      "--receipt-file", "receipt.json",
      "--contract-file", "contract.json",
      "--continuity-file", "missing-continuity.json",
      "--json",
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "VALID");
    assert.equal(report.continuity.status, "NOT_APPLICABLE");
    assert.equal(report.continuity.classification, "ABSENT");
  } finally {
    await removeTempTree(target);
  }
});

test("validate-protocol accepts task-scoped observed command provenance", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-conformance-cli-"));
  try {
    const route = evaluateRoute({ workType: "api", surfaces: ["api"], platforms: [] });
    const contract = { objective: "command provenance" };
    const state = createWorkState({
      taskId: "single-task",
      contractFingerprint: contractFingerprint(contract),
      repositoryFingerprint: { branch: null, head: null },
      phase: "ROUTED",
      selectedGuides: route.guides,
      completedSteps: [],
      pendingSteps: ["implementation"],
      checks: [],
      failures: [],
      blockers: [],
      verificationEvidence: [],
    });
    await ensureFixtureTask(target, state.taskId, repositoryRoot);
    const execution = await runCommandExecution({
      target,
      packageRoot: repositoryRoot,
      taskId: state.taskId,
      checkId: "provenance-check",
      requirement: "tests",
      argv: [process.execPath, "-e", "process.exit(0)"],
    });
    const check = {
      schemaVersion: 1,
      protocolVersion: 1,
      id: "provenance-check",
      kind: "command",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      source: `${process.execPath} -e process.exit(0)`,
      exitCode: 0,
      executionRef: execution.execution.executionId,
      provenance: "FORGELOOP_EXECUTED",
      details: { verificationCycle: 1 },
    };
    state.checks = [check];
    const receipt = {
      schemaVersion: 1,
      protocolVersion: 1,
      taskId: state.taskId,
      contractFingerprint: state.contractFingerprint,
      selectedGuides: route.guides,
      changedPaths: [],
      checks: [check],
      review: { status: "not-run", independent: false },
      limitations: [],
      publication: { committed: false, pushed: false, pullRequest: null, deployed: false },
    };
    await writeFile(path.join(target, "route.json"), `${JSON.stringify(route)}\n`);
    await writeFile(path.join(target, "state.json"), `${JSON.stringify(state)}\n`);
    await writeFile(path.join(target, "receipt.json"), `${JSON.stringify(receipt)}\n`);
    await writeFile(path.join(target, "contract.json"), `${JSON.stringify(contract)}\n`);

    const result = runCli(
      target,
      "validate-protocol",
      "--route-file", "route.json",
      "--state-file", "state.json",
      "--receipt-file", "receipt.json",
      "--contract-file", "contract.json",
      "--json",
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "VALID");
    assert.deepEqual(report.errors, []);
  } finally {
    await removeTempTree(target);
  }
});

test("validate-protocol reports inconsistencies and rejects unsafe paths", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-conformance-cli-"));
  try {
    await writeFile(path.join(target, "route.json"), JSON.stringify({ schemaVersion: 1, protocolVersion: 1, guides: [] }));
    await writeFile(path.join(target, "state.json"), JSON.stringify({ schemaVersion: 1, protocolVersion: 1, taskId: "p", selectedGuides: ["clean"] }));
    await writeFile(path.join(target, "receipt.json"), JSON.stringify({ schemaVersion: 1, protocolVersion: 1, taskId: "p", selectedGuides: [] }));

    const inconsistent = runCli(target, "validate-protocol", "--route-file", "route.json", "--state-file", "state.json", "--receipt-file", "receipt.json", "--json");
    assert.equal(inconsistent.status, 1);
    assert.equal(JSON.parse(inconsistent.stdout).status, "INVALID");

    const unsafe = runCli(target, "validate-protocol", "--route-file", "../route.json", "--json");
    assert.equal(unsafe.status, 1);
    assert.match(unsafe.stderr, /inside target|escapes target/i);
  } finally {
    await removeTempTree(target);
  }
});

async function writeConformanceFixture(target, {
  stateContract = { objective: "cli conformance" },
  currentContract = stateContract,
  repositoryFingerprint = { branch: null, head: null },
  requiredArtifacts = [],
} = {}) {
  const route = evaluateRoute({ workType: "api", surfaces: ["api"], platforms: [] });
  const state = createWorkState({
    taskId: "parent",
    contractFingerprint: contractFingerprint(stateContract),
    repositoryFingerprint,
    phase: "ROUTED",
    selectedGuides: route.guides,
    completedSteps: [],
    pendingSteps: ["implementation"],
    requiredArtifacts,
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
  });
  const receipt = {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId: "parent",
    contractFingerprint: state.contractFingerprint,
    selectedGuides: route.guides,
    changedPaths: [],
    checks: [],
    review: { status: "not-run", independent: false },
    limitations: [],
    publication: { committed: false, pushed: false, pullRequest: null, deployed: false },
  };
  const brief = {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId: "child",
    parentTaskId: "parent",
    objective: "child",
    allowedPaths: ["src/child.js"],
    readOnlyPaths: [],
    dependencies: [],
    constraints: [],
    requiredGuides: ["clean"],
    verification: ["npm test"],
    authority: ["write src/child.js"],
    deliverables: ["src/child.js"],
  };
  const delegated = {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId: "child",
    status: "complete-with-concerns",
    changes: [],
    verification: ["npm test"],
    openFindings: [],
    limitations: [],
  };
  for (const [name, value] of Object.entries({ route, state, receipt, brief, delegated })) {
    await writeFile(path.join(target, `${name}.json`), `${JSON.stringify(value)}\n`);
  }
  await writeFile(path.join(target, "contract.json"), `${JSON.stringify(currentContract)}\n`);
  return { state };
}

function runConformance(target, ...extraArgs) {
  return runCli(
    target,
    "validate-protocol",
    "--route-file", "route.json",
    "--state-file", "state.json",
    "--receipt-file", "receipt.json",
    "--task-brief-file", "brief.json",
    "--delegated-result-file", "delegated.json",
    ...extraArgs,
    "--json",
  );
}

test("validate-protocol derives STALE when the current contract changed", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-conformance-cli-"));
  try {
    await writeConformanceFixture(target, {
      stateContract: { objective: "old contract" },
      currentContract: { objective: "new contract" },
    });
    const result = runConformance(target, "--contract-file", "contract.json");
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "STALE");
    assert.ok(report.stale.reasons.includes("CONTRACT_CHANGED"));
    assert.equal(report.stale.contractComparison, "MISMATCH");
  } finally {
    await removeTempTree(target);
  }
});

test("validate-protocol derives STALE when the current contract is not supplied", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-conformance-cli-"));
  try {
    await writeConformanceFixture(target);
    const result = runConformance(target);
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "STALE");
    assert.ok(report.stale.reasons.includes("CONTRACT_NOT_VERIFIED"));
    assert.equal(report.stale.contractComparison, "NOT_VERIFIED");
  } finally {
    await removeTempTree(target);
  }
});

test("validate-protocol derives STALE when the repository fingerprint changed", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-conformance-cli-"));
  try {
    await writeConformanceFixture(target, {
      repositoryFingerprint: { branch: "main", head: "old-head" },
    });
    const result = runConformance(target, "--contract-file", "contract.json");
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "STALE");
    assert.ok(report.stale.reasons.includes("REPOSITORY_CHANGED"));
    assert.equal(report.stale.repositoryComparison, "MISMATCH");
  } finally {
    await removeTempTree(target);
  }
});

test("validate-protocol derives STALE when a required artifact changed or is missing", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-conformance-cli-"));
  try {
    await mkdir(path.join(target, "src"), { recursive: true });
    const artifactPath = "src/material.js";
    const original = "export const value = 1;\n";
    await writeFile(path.join(target, artifactPath), original);
    await writeConformanceFixture(target, {
      requiredArtifacts: [{ path: artifactPath, sha256: sha256(Buffer.from(original)) }],
    });
    await writeFile(path.join(target, artifactPath), "export const value = 2;\n");
    let result = runConformance(target, "--contract-file", "contract.json");
    let report = JSON.parse(result.stdout);
    assert.equal(report.status, "STALE");
    assert.ok(report.stale.reasons.includes("REQUIRED_ARTIFACT_CHANGED"));

    await rm(path.join(target, artifactPath));
    result = runConformance(target, "--contract-file", "contract.json");
    report = JSON.parse(result.stdout);
    assert.equal(report.status, "STALE");
    assert.ok(report.stale.reasons.includes("REQUIRED_ARTIFACT_MISSING"));
    assert.equal(report.stale.artifactComparison, "MISSING");
  } finally {
    await removeTempTree(target);
  }
});

test("validate-protocol returns VALID when freshness and artifacts match", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-conformance-cli-"));
  try {
    const artifactPath = "material.js";
    const contents = "export const value = 1;\n";
    await writeFile(path.join(target, artifactPath), contents);
    await writeConformanceFixture(target, {
      requiredArtifacts: [{ path: artifactPath, sha256: sha256(Buffer.from(contents)) }],
    });
    const result = runConformance(target, "--contract-file", "contract.json");
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "VALID");
    assert.equal(report.stale, null);
  } finally {
    await removeTempTree(target);
  }
});

test("validate-protocol human output explains stale freshness evidence", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-conformance-cli-"));
  try {
    await writeConformanceFixture(target, {
      stateContract: { objective: "old contract" },
      currentContract: { objective: "new contract" },
    });
    const result = runCli(
      target,
      "validate-protocol",
      "--route-file", "route.json",
      "--state-file", "state.json",
      "--receipt-file", "receipt.json",
      "--task-brief-file", "brief.json",
      "--delegated-result-file", "delegated.json",
      "--contract-file", "contract.json",
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Protocol: STALE/);
    assert.match(result.stdout, /Contract: MISMATCH/);
    assert.match(result.stdout, /CONTRACT_CHANGED/);
  } finally {
    await removeTempTree(target);
  }
});

test("validate-protocol preserves INVALID precedence over stale freshness", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-conformance-cli-"));
  try {
    await writeConformanceFixture(target, {
      stateContract: { objective: "old contract" },
      currentContract: { objective: "new contract" },
    });
    await writeFile(path.join(target, "route.json"), JSON.stringify({
      schemaVersion: 1,
      protocolVersion: 99,
      guides: [],
    }));
    const result = runConformance(target, "--contract-file", "contract.json");
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "INVALID");
    assert.equal(report.stale, null);
  } finally {
    await removeTempTree(target);
  }
});
