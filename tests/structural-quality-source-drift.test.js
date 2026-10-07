import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { runActivate } from "../src/commands/activate.js";
import { runAdvance } from "../src/commands/advance.js";
import { runPreflight } from "../src/commands/preflight.js";
import { runQualityBaseline } from "../src/commands/quality-baseline.js";
import { runQualityVerify } from "../src/commands/quality-verify.js";
import { runRoute } from "../src/commands/route.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { createConfig, writeConfig } from "../src/core/config.js";
import { createContract, writeContract } from "../src/core/contract.js";
import { createForgeLoopContext } from "../src/core/runtime-context.js";
import { getPackageRoot } from "../src/core/templates.js";
import { validateStructuralQualityCheckProvenance } from "../src/core/structural-quality/service.js";
import { computeMaterialSourceFingerprint } from "../src/core/structural-quality/source-fingerprint.js";
import { readWorkState } from "../src/core/work-state.js";
import { createSentruxStructuralQualityProvider } from "../src/core/structural-quality/sentrux-mcp.js";

const execFileAsync = promisify(execFile);
const packageRoot = getPackageRoot();
const fakeServerPath = path.join(packageRoot, "tests", "fixtures", "fake-sentrux-mcp.mjs");

async function initGitRepository(target) {
  await execFileAsync("git", ["init", "-b", "main"], { cwd: target });
  await execFileAsync("git", ["config", "user.name", "ForgeLoop Test"], { cwd: target });
  await execFileAsync("git", ["config", "user.email", "test@forgeloop.local"], { cwd: target });
  await writeFile(path.join(target, "README.md"), "# Test Project\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: target });
  await execFileAsync("git", ["commit", "-m", "initial commit"], { cwd: target });
}

async function setupTask(target, taskId, structuralQualityConfig = { mode: "gate", provider: "custom-analyzer" }) {
  await initGitRepository(target);
  await runTaskCreate({ target, packageRoot, taskId, claims: ["README.md"] });
  await writeConfig(target, createConfig({
    complianceMode: "standard",
    structuralQuality: structuralQualityConfig,
  }), packageRoot);
  await writeContract(target, createContract({
    taskId,
    objective: "Test source drift detection",
    deliverables: ["drift-test"],
    successCriteria: ["drift-test"],
    stopConditions: ["drift-test"],
  }), packageRoot, { taskId });
  await runRoute({ target, packageRoot, taskId, workType: "documentation", surfaces: ["config"] });
  const preflight = await runPreflight({ target, packageRoot, taskId });
  assert.equal(preflight.status, "READY", JSON.stringify(preflight.errors));
  await runActivate({ target, packageRoot, taskId });
  await runAdvance({ target, packageRoot, taskId, to: "PLANNED" });
}

function makeCustomContext(target, extraEnv = {}) {
  const sentruxProvider = createSentruxStructuralQualityProvider({
    projectPath: target,
    executable: process.execPath,
    args: [fakeServerPath],
    env: extraEnv,
  });
  const customProvider = {
    id: "custom-analyzer",
    async detect(input) {
      const res = await sentruxProvider.detect(input);
      return { ...res, providerId: "custom-analyzer" };
    },
    async observe(input) {
      const res = await sentruxProvider.observe(input);
      return {
        ...res,
        provider: { ...res.provider, id: "custom-analyzer" },
        detection: { ...res.detection, providerId: "custom-analyzer" },
      };
    },
    async scan(input) {
      return this.observe(input);
    },
  };
  return createForgeLoopContext({ structuralQualityProviders: { "custom-analyzer": customProvider } });
}

test("baseline capture detects mid-scan source drift and fails closed in gate mode", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-source-drift-baseline-"));
  const taskId = "drift-baseline-task";
  try {
    await setupTask(target, taskId, { mode: "gate", provider: "custom-analyzer" });
    const mutateTarget = path.join(target, "mutated-file.txt");
    const runtimeContext = makeCustomContext(target, {
      SENTRUX_FAKE_MUTATE_FILE_DURING_SCAN: mutateTarget,
    });

    await assert.rejects(
      () => runQualityBaseline({ target, packageRoot, taskId, runtimeContext }),
      { code: "E_STRUCTURAL_QUALITY_SOURCE_DRIFT" },
    );
  } finally {
    await removeTempTree(target);
  }
});

test("baseline capture detects mid-scan source drift and records NOT_OBSERVED in observe mode", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-source-drift-observe-"));
  const taskId = "drift-observe-task";
  try {
    await setupTask(target, taskId, { mode: "observe", provider: "custom-analyzer" });
    const mutateTarget = path.join(target, "mutated-observe.txt");
    const runtimeContext = makeCustomContext(target, {
      SENTRUX_FAKE_MUTATE_FILE_DURING_SCAN: mutateTarget,
    });

    const result = await runQualityBaseline({ target, packageRoot, taskId, runtimeContext });
    assert.equal(result.status, "NOT_OBSERVED");
    assert.equal(result.reasonCodes[0], "E_STRUCTURAL_QUALITY_SOURCE_DRIFT");
  } finally {
    await removeTempTree(target);
  }
});

test("quality verification detects mid-scan source drift and blocks gate check", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-source-drift-verify-"));
  const taskId = "drift-verify-task";
  try {
    await setupTask(target, taskId, { mode: "gate", provider: "custom-analyzer" });
    const normalContext = makeCustomContext(target);
    await runQualityBaseline({ target, packageRoot, taskId, runtimeContext: normalContext });
    await runAdvance({ target, packageRoot, taskId, to: "EXECUTING" });
    await runAdvance({ target, packageRoot, taskId, to: "VERIFYING" });

    const mutateTarget = path.join(target, "mutated-mid-verify.txt");
    const driftContext = makeCustomContext(target, {
      SENTRUX_FAKE_MUTATE_FILE_DURING_SCAN: mutateTarget,
    });

    const verifyResult = await runQualityVerify({ target, packageRoot, taskId, runtimeContext: driftContext });
    assert.equal(verifyResult.evaluation.status, "BLOCKED");
    assert.equal(verifyResult.evaluation.reasonCodes[0], "E_STRUCTURAL_QUALITY_SOURCE_DRIFT");
    assert.equal(verifyResult.evaluation.sourceObservation.stable, false);
    assert.equal(verifyResult.check.status, "blocked");
  } finally {
    await removeTempTree(target);
  }
});

test("provenance check rejects evaluation check if worktree was modified after verification", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-provenance-drift-"));
  const taskId = "provenance-drift-task";
  try {
    await setupTask(target, taskId, { mode: "gate", provider: "custom-analyzer" });
    const runtimeContext = makeCustomContext(target);
    await runQualityBaseline({ target, packageRoot, taskId, runtimeContext });
    await runAdvance({ target, packageRoot, taskId, to: "EXECUTING" });
    await runAdvance({ target, packageRoot, taskId, to: "VERIFYING" });
    const verifyResult = await runQualityVerify({ target, packageRoot, taskId, runtimeContext });
    assert.equal(verifyResult.check.status, "passed");

    // Mutate worktree after verify
    await writeFile(path.join(target, "README.md"), "# Modified after evaluation\n");

    const state = await readWorkState(target, { packageRoot, taskId });
    const check = state.checks.find((c) => c.id === "structural-quality");
    const errors = await validateStructuralQualityCheckProvenance(check, { target, packageRoot, taskId, state });
    assert.ok(errors.some((err) => err.code === "E_STRUCTURAL_QUALITY_EVIDENCE_STALE"));
  } finally {
    await removeTempTree(target);
  }
});

test("source fingerprinting fails closed on unsafe symlinks", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-source-symlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "forgeloop-source-outside-"));
  try {
    await writeFile(path.join(outside, "secret.txt"), "outside material\n");
    await symlink(path.join(outside, "secret.txt"), path.join(target, "linked.txt"));
    await assert.rejects(
      () => computeMaterialSourceFingerprint(target),
      { code: "E_STRUCTURAL_QUALITY_SOURCE_FINGERPRINT_UNAVAILABLE" },
    );
  } finally {
    await removeTempTree(target);
    await removeTempTree(outside);
  }
});
