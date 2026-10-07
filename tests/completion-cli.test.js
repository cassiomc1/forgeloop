import { removeTempTree } from "./helpers/rm-safe.js";
import { recordExecutedFakeCheck } from "./helpers/executed-fake-check.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runPreflight } from "../src/commands/preflight.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { advanceWorkState } from "../src/core/phase.js";
import { recordCheck } from "../src/core/completion-artifacts.js";
import { runComplete } from "../src/commands/complete.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { readOperationalText } from "../src/storage/operational-context.js";

const root = path.resolve(".");
const cliPath = path.join(root, "src", "cli.js");
const packageRoot = getPackageRoot();
const TASK_ID = "task-cli-ergonomics";

async function readReceipt(target) {
  return withProjectStorage(target, () => {
    const artifact = readOperationalText(target, taskArtifactPath(TASK_ID, "receipt"));
    assert.equal(artifact.selected, true);
    assert.notEqual(artifact.text, null);
    return artifact.text;
  }, { readOnly: true });
}

function runCli(target, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args, "--path", target], {
    cwd: root,
    encoding: "utf8",
  });
}

function runCliWithEnv(target, env, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args, "--path", target], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-completion-cli-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function setupTarget(target) {
  const created = runCli(target, "task-create", "--task", TASK_ID, "--claim", "src/example.js");
  assert.equal(created.status, 0, created.stderr);
  return withProjectStorage(target, async () => {
  const contract = createContract({
    taskId: "task-cli-ergonomics",
    objective: "Exercise completion CLI",
    deliverables: ["src/example.js"],
    constraints: [],
    risks: [],
    verification: ["tests"],
    successCriteria: ["tests"],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  await writeContract(target, contract, packageRoot, { taskId: TASK_ID });
  const route = evaluateRoute({ workType: "api", surfaces: ["api"], platforms: [] });
  const persistedRoute = await persistRoute(target, route, packageRoot, { contractFingerprint: contractHash, taskId: TASK_ID });
  await writeWorkState(target, createWorkState({
    taskId: contract.taskId,
    contractFingerprint: contractHash,
    routeFingerprint: persistedRoute.fingerprint,
    repositoryFingerprint: { branch: null, head: null },
    phase: "EXECUTING",
    previousPhase: "PLANNED",
    selectedGuides: route.guides,
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: ["implementation"],
    pendingSteps: ["verification"],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
  }), { packageRoot, taskId: TASK_ID });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId: TASK_ID });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId: TASK_ID });
  assert.equal((await runPreflight({ target, packageRoot, taskId: TASK_ID })).status, "READY");
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "EXECUTION_STARTED" }, packageRoot, { taskId: TASK_ID });
  await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: TASK_ID });
  });
}

test("completion CLI exposes scoped preparation and recording commands", () => {
  const prepare = spawnSync(process.execPath, [cliPath, "prepare-completion", "--help"], {
    cwd: root,
    encoding: "utf8",
  });
  const record = spawnSync(process.execPath, [cliPath, "record-check", "--help"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(prepare.status, 0, prepare.stderr);
  assert.match(prepare.stdout, /prepare-completion/);
  assert.doesNotMatch(prepare.stdout, /--status/);
  assert.equal(record.status, 0, record.stderr);
  assert.match(record.stdout, /--evidence-kind/);
  assert.match(record.stdout, /recorded only/);
});
test("completion CLI records supplied evidence without executing command text", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);
    const prepared = runCli(target, "prepare-completion", "--json");
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.equal(JSON.parse(prepared.stdout).receipt.taskId, "task-cli-ergonomics");

    const sentinel = path.join(target, "cli-must-not-run.txt");
    const recorded = runCli(
      target,
      "record-check",
      "--id", "tests",
      "--kind", "manual-review",
      "--requirement", "tests",
      "--status", "passed",
      "--evidence-kind", "OBSERVED",
      "--command", `touch ${sentinel}`,
      "--result", "4/4 passed",
      "--exit-code", "0",
      "--json",
    );
    assert.equal(recorded.status, 0, recorded.stderr);
    const report = JSON.parse(recorded.stdout);
    assert.equal(report.check.id, "tests");
    assert.equal(report.coverage[0].status, "COVERED");
    await assert.rejects(() => readFile(sentinel));
    JSON.parse(await readReceipt(target));
  });
});

test("record-check rejects friendly command descriptions without execution provenance", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);
    const prepared = runCli(target, "prepare-completion", "--json");
    assert.equal(prepared.status, 0, prepared.stderr);
    const before = await readReceipt(target);
    const rejected = runCli(
      target,
      "record-check",
      "--id", "visual-check",
      "--requirement", "tests",
      "--status", "passed",
      "--evidence-kind", "OBSERVED",
      "--command", "screenshot analysis (modlens vision bridge)",
      "--result", "visual check",
      "--exit-code", "0",
      "--json",
    );
    assert.equal(rejected.status, 1);
    assert.match(`${rejected.stdout}\n${rejected.stderr}`, /E_COMMAND_PROVENANCE_UNATTESTED/);
    assert.equal(await readReceipt(target), before);
  });
});

test("run-check records the exact executed argv as observed evidence", async () => {
  await withTarget(async (target) => {
    await setupTarget(target);
    const prepared = runCli(target, "prepare-completion", "--json");
    assert.equal(prepared.status, 0, prepared.stderr);
    const result = spawnSync(process.execPath, [
      cliPath,
      "run-check",
      "--path", target,
      "--id", "tests",
      "--requirement", "tests",
      "--json",
      "--",
      process.execPath,
      "-e",
      "process.exit(0)",
    ], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.check.provenance, "FORGELOOP_EXECUTED");
    assert.ok(output.check.executionRef);
    assert.deepEqual(output.execution.argv, [process.execPath, "-e", "process.exit(0)"]);
    assert.equal(output.execution.exitCode, 0);
    assert.equal(output.coverage[0].status, "COVERED");
  });
});

test("completion CLI rejects malformed details and command-specific options", () => {
  const malformed = spawnSync(process.execPath, [
    cliPath,
    "record-check",
    "--id", "tests",
    "--requirement", "tests",
    "--status", "passed",
    "--evidence-kind", "OBSERVED",
    "--details", "{",
  ], { cwd: root, encoding: "utf8" });
  const unrelated = spawnSync(process.execPath, [cliPath, "prepare-completion", "--status", "passed"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(malformed.status, 2);
  assert.match(malformed.stderr, /valid JSON/i);
  assert.equal(unrelated.status, 2);
  assert.match(unrelated.stderr, /not valid/i);
});

test("standalone completion CLI rejects actor-selected authority sources", async () => {
  const authorityRoot = await mkdtemp(path.join(os.tmpdir(), "forgeloop-cli-authority-"));
  const authorityFile = path.join(authorityRoot, "host-authority.json");
  const actorFakeFile = path.join(authorityRoot, "actor-fake.json");
  try {
    await withTarget(async (target) => {
      await setupTarget(target);
      const prepared = runCli(target, "prepare-completion", "--json");
      assert.equal(prepared.status, 0, prepared.stderr);

      const authority = {
        schemaVersion: 1,
        protocolVersion: 1,
        authorities: [{
          authorityId: "auth-cli",
          taskId: "task-cli-ergonomics",
          type: "SOFTWARE_INSTALLATION",
          status: "AUTHORIZED",
          scope: { tool: "@liustack/modlens" },
          source: "operator",
        }],
      };
      await writeFile(authorityFile, JSON.stringify(authority), "utf8");
      await writeFile(actorFakeFile, JSON.stringify(authority), "utf8");

      const rejectedRecord = runCliWithEnv(
        target,
        { FORGELOOP_AUTHORITY_FILE: actorFakeFile },
        "record-check",
        "--id", "install-check",
        "--requirement", "tests",
        "--status", "passed",
        "--evidence-kind", "OBSERVED",
        "--command", "npx @liustack/modlens --spec=app.json",
        "--exit-code", "0",
        "--details", JSON.stringify({ installationAuthorityRef: "auth-cli" }),
        "--json",
      );
      assert.equal(rejectedRecord.status, 1);
      assert.match(`${rejectedRecord.stdout}\n${rejectedRecord.stderr}`, /E_COMMAND_PROVENANCE_UNATTESTED/);

      const authorityContext = {
        trustMode: "HOST_ATTESTED",
        trustedAuthorityFile: authorityFile,
      };
      await withProjectStorage(target, async () => {
      await recordExecutedFakeCheck(recordCheck, {
        target,
        packageRoot,
        taskId: TASK_ID,
        id: "install-check",
        kind: "command",
        requirement: "tests",
        status: "passed",
        evidenceKind: "OBSERVED",
        command: "npx @liustack/modlens --spec=app.json",
        details: { installationAuthorityRef: "auth-cli" },
        authorityContext,
      });
      await advanceWorkState(target, "REVIEWING", { packageRoot, authorityContext, taskId: TASK_ID });
      });

      const complete = runCliWithEnv(target, { FORGELOOP_AUTHORITY_FILE: actorFakeFile }, "complete", "--task", TASK_ID, "--json");
      assert.equal(complete.status, 1);
      const completeReport = JSON.parse(complete.stdout);
      assert.equal(completeReport.status, "REJECTED", JSON.stringify(completeReport));
      assert.ok(completeReport.errors.some((error) => error.code === "E_AUTHORITY_UNTRUSTED_SOURCE"));

      const hostedComplete = await withProjectStorage(target, () => runComplete({ target, packageRoot, authorityContext, taskId: TASK_ID }));
      assert.equal(hostedComplete.status, "VALID", JSON.stringify(hostedComplete.errors));

      const audit = runCliWithEnv(target, { FORGELOOP_AUTHORITY_FILE: actorFakeFile }, "audit", "--json");
      assert.equal(audit.status, 1);
      const auditReport = JSON.parse(audit.stdout);
      assert.equal(auditReport.status, "INVALID");
      assert.ok(auditReport.errors.some((error) => error.code === "E_AUTHORITY_UNTRUSTED_SOURCE"));

    });
  } finally {
    await removeTempTree(authorityRoot);
  }
});
