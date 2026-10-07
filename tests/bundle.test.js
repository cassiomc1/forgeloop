import { ensureFixtureTask, readRawFixtureText, overwriteFixtureText } from "./helpers/native-storage-fixture.js";
import { exportLegacyFixture } from "./helpers/storage-fixtures.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { exportTaskBundle, readTaskBundle } from "../src/core/bundles.js";
import { taskAttestationBundlePath, taskArtifactPath } from "../src/core/task-paths.js";
import { writeJsonArtifact } from "../src/core/artifacts.js";
import { createCheck } from "../src/core/checks.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { runCommandExecution } from "../src/core/execution.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

const safeAssumption = {
  value: "Use local placeholder content",
  reason: "No production content was supplied",
  scope: "local test",
  reversible: true,
  source: "agent-default",
};

function manualContract(taskId, assumptions = []) {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    objective: "bundle protocol state",
    assumptions,
    deliverables: [],
    constraints: [],
    risks: [],
    verification: [],
    successCriteria: [],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  };
}

async function writeManualJson(target, relativePath, value) {
  const artifactPath = path.join(target, relativePath);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function prepareRouteAndState(target, contract) {
  await persistRoute(target, evaluateRoute({ workType: "documentation" }), packageRoot, {
    contractFingerprint: contractFingerprint(contract),
    taskId: contract.taskId,
  });
  await writeJsonArtifact(target, taskArtifactPath(contract.taskId, "state"), {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId: contract.taskId,
    contractFingerprint: contractFingerprint(contract),
    repositoryFingerprint: { branch: null, head: null },
    phase: "ROUTED",
    selectedGuides: [],
    completedSteps: [],
    pendingSteps: [],
    requiredArtifacts: [],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
    lastUpdated: "2026-08-11T00:00:00.000Z",
  }, "work-state", packageRoot);
}

test("portable task bundles copy only canonical protocol artifacts", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-bundle-"));
  try {
    const contract = createContract({
      taskId: "bundle-001",
      objective: "bundle protocol state",
      deliverables: [],
      constraints: [],
      risks: [],
      verification: [],
      successCriteria: [],
      stopConditions: [],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await ensureFixtureTask(target, contract.taskId, packageRoot);
    await writeContract(target, contract, packageRoot, { taskId: contract.taskId });
    await prepareRouteAndState(target, contract);
    const bundle = await exportTaskBundle(target, contract.taskId, packageRoot);
    assert.equal(bundle.taskId, contract.taskId);
    const loaded = await readTaskBundle(target, contract.taskId, packageRoot);
    assert.deepEqual(loaded.manifest.artifacts.sort(), ["contract.json", "events.ndjson", "route.json", "state.json", "task.json"]);
    assert.match(await readFile(path.join(target, ".forgeloop", "tasks", contract.taskId, "bundle.json"), "utf8"), /bundle-001/);
    const manifestPath = path.join(target, bundle.path);
    const { files, ...legacy } = loaded.manifest;
    await writeFile(manifestPath, JSON.stringify({ ...legacy, schemaVersion: 1 }));
    const legacyRead = await readTaskBundle(target, contract.taskId, packageRoot);
    assert.equal(legacyRead.manifest.schemaVersion, 1);
    await writeFile(manifestPath, JSON.stringify({ ...loaded.manifest, files: [] }));
    await assert.rejects(readTaskBundle(target, contract.taskId, packageRoot), { code: "E_BUNDLE_DIGEST_INVALID" });
    await writeFile(manifestPath, JSON.stringify({ ...loaded.manifest, artifacts: ["../escape.json"], files: [{ ...files[0], path: "../escape.json" }] }));
    await assert.rejects(readTaskBundle(target, contract.taskId, packageRoot), { code: "E_BUNDLE_PATH_INVALID" });
    const {proposeAction}=await import("../src/core/actions.js");
    const proposed=await proposeAction(target,{packageRoot,taskId:contract.taskId,input:{
      actionId:"action-portable-inspection",effectClass:"REVERSIBLE_WRITE",capability:"filesystem.write",
      target:"local.txt",operation:"write local fixture",idempotencyKey:"portable:inspection",provenance:"CALLER_REPORTED",
    }});
    // Explicit compatibility fixture: legacy attachment reads remain supported.
    // Native attachment export is exercised by storage-operational-bootstrap.
    await exportLegacyFixture(target);
    const sourceAttachment = path.join(target, taskAttestationBundlePath(contract.taskId));
    await mkdir(path.dirname(sourceAttachment), { recursive: true });
    const attachmentBytes = JSON.stringify({ payload: "x".repeat(2 * 1024 * 1024) });
    await writeFile(sourceAttachment, attachmentBytes);
    const withAttachment = await exportTaskBundle(target, contract.taskId, packageRoot);
    const binding = withAttachment.files.find(file => file.path === "attestations/statement.sigstore.json");
    const exportedAction=JSON.parse(await readFile(path.join(target,path.dirname(withAttachment.path),"actions",`${proposed.action.actionId}.json`),"utf8"));
    assert.deepEqual(exportedAction,proposed.action);
    const actionPath=path.join(target,taskArtifactPath(contract.taskId,"actions"),`${proposed.action.actionId}.json`);
    const renamedAction=path.join(path.dirname(actionPath),"action-wrong-source.json");
    await rename(actionPath,renamedAction);
    await assert.rejects(exportTaskBundle(target,contract.taskId,packageRoot),{code:"E_BUNDLE_TASK_MISMATCH"});
    await rename(renamedAction,actionPath);
    assert.equal(binding.size, Buffer.byteLength(attachmentBytes));
    assert.equal(await readFile(path.join(target, path.dirname(withAttachment.path), binding.path), "utf8"), attachmentBytes);
    await rm(sourceAttachment);
    await symlink(path.join(target, taskArtifactPath(contract.taskId, "contract")), sourceAttachment);
    await assert.rejects(exportTaskBundle(target, contract.taskId, packageRoot), /symlink/);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("portable task bundles revalidate execution references against bundled artifacts", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-bundle-execution-"));
  try {
    const contract = createContract({
      taskId: "bundle-execution-001",
      objective: "bundle command provenance",
      deliverables: [],
      constraints: [],
      risks: [],
      verification: ["tests"],
      successCriteria: ["tests"],
      stopConditions: [],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await ensureFixtureTask(target, contract.taskId, packageRoot);
    await writeContract(target, contract, packageRoot, { taskId: contract.taskId });
    await prepareRouteAndState(target, contract);
    const execution = await runCommandExecution({
      target,
      packageRoot,
      taskId: contract.taskId,
      checkId: "tests",
      requirement: "tests",
      argv: [process.execPath, "-e", "process.exit(0)"],
    });
    const check = createCheck({
      id: "tests",
      kind: "command",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      source: execution.execution.argv.join(" "),
      executionRef: execution.execution.executionId,
      provenance: "FORGELOOP_EXECUTED",
      exitCode: 0,
      details: { verificationCycle: 1 },
    }, {
      target,
      taskId: contract.taskId,
      packageRoot,
      requireCommandProvenance: true,
    });
    const state = JSON.parse(await readRawFixtureText(target, taskArtifactPath(contract.taskId, "state")));
    state.checks = [check];
    await writeJsonArtifact(target, taskArtifactPath(contract.taskId, "state"), state, "work-state", packageRoot);

    const bundle = await exportTaskBundle(target, contract.taskId, packageRoot);
    const loaded = await readTaskBundle(target, contract.taskId, packageRoot);
    assert.ok(bundle.artifacts.includes(`executions/${execution.execution.executionId}.json`));
    assert.equal(loaded.artifacts.executions[execution.execution.executionId].executionId, execution.execution.executionId);
    assert.equal(loaded.artifacts.state.checks[0].executionRef, execution.execution.executionId);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("bundle export rejects a manually persisted semantically invalid current contract", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-bundle-export-invalid-"));
  try {
    const contract = manualContract("bundle-invalid-export", [{ ...safeAssumption, value: "   " }]);
    await ensureFixtureTask(target, contract.taskId, packageRoot);
    await overwriteFixtureText(target, taskArtifactPath(contract.taskId, "contract"), JSON.stringify(contract));
    await prepareRouteAndState(target, contract);

    await assert.rejects(
      () => exportTaskBundle(target, contract.taskId, packageRoot),
      /non-empty/i,
    );
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("bundle reads reject a manually persisted secret-like bundled contract", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-bundle-read-invalid-"));
  try {
    const contract = createContract({
      ...manualContract("bundle-invalid-read", [safeAssumption]),
    });
    await ensureFixtureTask(target, contract.taskId, packageRoot);
    await writeContract(target, contract, packageRoot, { taskId: contract.taskId });
    await prepareRouteAndState(target, contract);
    await exportTaskBundle(target, contract.taskId, packageRoot);

    const sensitiveValue = "glpat-" + "V".repeat(20);
    const invalidBundledContract = {
      ...contract,
      assumptions: [{ ...safeAssumption, value: sensitiveValue }],
    };
    await writeManualJson(
      target,
      `.forgeloop/tasks/${contract.taskId}/contract.json`,
      invalidBundledContract,
    );

    await assert.rejects(
      () => readTaskBundle(target, contract.taskId, packageRoot),
      (error) => {
        assert.match(error.message, /secret-like|bytes disagree with manifest/i);
        assert.equal(error.message.includes(sensitiveValue), false);
        return true;
      },
    );
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
