import { removeTempTree } from "./helpers/rm-safe.js";
import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { validateTaskBrief } from "../src/core/delegation.js";
import { createSentruxStructuralQualityProvider } from "../src/core/structural-quality/sentrux-mcp.js";
import { readWorkState, writeWorkState, createWorkState, contractFingerprint } from "../src/core/work-state.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repositoryRoot, "src", "cli.js");

function runCli(target, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args, "--path", target], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

function isWithinWindows(root, candidate) {
  const relative = path.win32.relative(root, candidate);
  return relative === ""
    || (relative !== ".."
      && !relative.startsWith(`..${path.win32.sep}`)
      && !path.win32.isAbsolute(relative));
}

test("CLI handles target paths with spaces and Unicode", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "forgeloop-portable-"));
  const target = path.join(parent, "projeto com espaço — 测试");
  await mkdir(target);

  try {
    const initialized = runCli(target, "init");
    assert.equal(initialized.status, 0, initialized.stderr);
    await readFile(path.join(target, ".forgeloop", ".gitignore"), "utf8");
    await readFile(path.join(target, ".forgeloop/kit/ORCHESTRATOR_INTEGRATION.md"), "utf8");
    await readFile(path.join(target, ".forgeloop/kit/schemas", "work-state.schema.json"), "utf8");

    const status = runCli(target, "status", "--json");
    assert.equal(status.status, 0, status.stderr);
    const report = JSON.parse(status.stdout);
    assert.equal(report.status, "ABSENT");
    assert.deepEqual(report.repository, { branch: null, head: null });
  } finally {
    await removeTempTree(parent);
  }
});

test("state APIs preserve a CRLF target file and validate a checkpoint on a portable path", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "forgeloop-portable-state-"));
  const target = path.join(parent, "project with spaces — état");
  await mkdir(target);

  try {
    const state = createWorkState({
      taskId: "portable-state",
      contractFingerprint: contractFingerprint({ objective: "portable" }),
      repositoryFingerprint: { branch: null, head: null },
      phase: "VERIFYING",
      selectedGuides: ["clean", "test"],
      completedSteps: ["implementation"],
      pendingSteps: ["verification"],
      checks: [],
      failures: [],
      blockers: [],
      verificationEvidence: [],
    });
    await ensureFixtureTask(target, state.taskId, path.resolve("."));
    await writeWorkState(target, state, { taskId: state.taskId });
    assert.deepEqual(await readWorkState(target, { taskId: state.taskId }), state);

    const profilePath = path.join(target, "profile-crlf.txt");
    const crlf = "profile-mode: project\r\nlanguage: en\r\n";
    await writeFile(profilePath, crlf, "utf8");
    assert.equal(await readFile(profilePath, "utf8"), crlf);

    const validation = runCli(target, "validate-state", "--json");
    assert.equal(validation.status, 0, validation.stderr);
    assert.equal(JSON.parse(validation.stdout).ok, true);
  } finally {
    await removeTempTree(parent);
  }
});

test("delegation paths normalize Windows separators without platform assumptions", async () => {
  const brief = await validateTaskBrief({
    taskId: "portable-child",
    parentTaskId: "portable-parent",
    objective: "Check portable path handling.",
    allowedPaths: ["src\\components\\card.js"],
    readOnlyPaths: ["README.md"],
    dependencies: [],
    constraints: [],
    requiredGuides: ["clean", "test"],
    verification: ["npm test"],
    authority: ["write only the allowed path"],
    deliverables: ["normalized brief"],
  });

  assert.deepEqual(brief.allowedPaths, ["src/components/card.js"]);
  const root = "C:\\workspace\\project";
  assert.equal(isWithinWindows(root, "C:\\workspace\\project\\src\\file.js"), true);
  assert.equal(isWithinWindows(root, "C:\\workspace\\other\\file.js"), false);
  assert.equal(isWithinWindows(root, "D:\\other\\file.js"), false);
});

test("structural-quality MCP normalization survives portable Unicode paths", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "forgeloop-quality-portable-"));
  const target = path.join(parent, "quality project — 测试");
  await mkdir(target);
  const fixture = path.join(repositoryRoot, "tests", "fixtures", "fake-sentrux-mcp.mjs");
  try {
    const qualityProvider = createSentruxStructuralQualityProvider({
      projectPath: target,
      executable: process.execPath,
      args: [fixture],
      timeoutMs: 500,
      env: { SENTRUX_FAKE_MODE: "valid" },
    });
    const result = await qualityProvider.scan({
      projectPath: target,
      taskId: "portable-quality",
      timeoutMs: 500,
      maxOutputBytes: 2 * 1024 * 1024,
    });
    assert.equal(result.snapshot.qualitySignal, 9000);
    assert.equal(result.snapshot.statistics.crossModuleEdges, 2);
  } finally {
    await removeTempTree(parent);
  }
});
