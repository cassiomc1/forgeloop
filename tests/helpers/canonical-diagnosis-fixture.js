import { execFileSync } from "node:child_process";
import { runWorkspaceBind } from "../../src/commands/workspace-bind.js";
import { createGitRepository } from "./git-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runTaskCreate } from "../../src/commands/task-create.js";
import { runActivate } from "../../src/commands/activate.js";
import { runDiscover } from "../../src/commands/discover.js";
import { runContractCreate } from "../../src/commands/contract-create.js";
import { runRoute } from "../../src/commands/route.js";
import { runPreflight } from "../../src/commands/preflight.js";
import { runAdvance } from "../../src/commands/advance.js";
import { runPrepareCompletion } from "../../src/commands/prepare-completion.js";
import { runCheck } from "../../src/commands/run-check.js";
import { createContract } from "../../src/core/contract.js";
import { getPackageRoot } from "../../src/core/templates.js";
import { readWorkState } from "../../src/core/work-state.js";
import { validateEventLedger, validateStateLedgerCoherence } from "../../src/core/events.js";
import { testSemanticProvider } from "../../src/core/decision/test-provider.js";

/** Build a real correction-cycle seed; never synthesize lifecycle milestones. */
export async function buildCanonicalDiagnosisProject({ taskId = "canonical-diagnosis-task", includePassingCheck = false, git = false, linkedWorktree = false } = {}) {
  assert.equal(typeof git, "boolean");
  assert.equal(typeof linkedWorktree, "boolean");
  assert.ok(!linkedWorktree || git, "Linked worktrees require Git");
  const repository = git
    ? await createGitRepository("forgeloop-canonical-diagnosis-git-")
    : await mkdtemp(path.join(os.tmpdir(), "forgeloop-canonical-diagnosis-"));
  const target = linkedWorktree ? `${repository}-linked` : repository;
  const cleanup = async () => {
    if (linkedWorktree) {
      await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      execFileSync("git", ["-C", repository, "worktree", "prune"], { stdio: "ignore" });
    }
    await rm(repository, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  if (linkedWorktree) execFileSync("git", ["-C", repository, "worktree", "add", "-q", "-b", "codex/reverse-export-fixture", target], { stdio: "ignore" });
  if (git) await writeFile(path.join(repository, ".git/info/exclude"), ".forgeloop/\n", "utf8");
  const packageRoot = getPackageRoot();
  const context = { target, packageRoot, taskId };
  const checkpoints = [];
  async function observe(command) {
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true, `${command}: ${JSON.stringify(ledger.errors)}`);
    const state = await readWorkState(target, { packageRoot, taskId });
    if (state) assert.deepEqual(validateStateLedgerCoherence(state, ledger.events), [], command);
    checkpoints.push({ command, phase: state?.phase ?? null, revision: state?.revision ?? null, head: ledger.events.at(-1)?.hash });
  }
  try {
    await runTaskCreate({ ...context, claims: ["src"] });
    await observe("task-create");
    if (git) {
      await runWorkspaceBind(context);
      await observe("workspace-bind");
    }
    await runDiscover(context);
    await observe("discover");
    const contract = createContract({
      taskId, objective: "Exercise diagnosis and correction through the supported lifecycle",
      deliverables: ["src"], constraints: [], risks: [], stopConditions: [], unresolvedDecisions: [], sourceRefs: [],
      verification: [{ id: "fixture-verification", text: "The deterministic fixture check passes", type: "VERIFICATION" }],
      successCriteria: ["Diagnosis and correction preserve protocol integrity"],
    });
    await writeFile(path.join(target, "fixture-contract.json"), JSON.stringify(contract));
    await runContractCreate({ ...context, contractFile: "fixture-contract.json", semanticProvider: testSemanticProvider });
    await observe("contract-create");
    await runRoute({ ...context, workType: "code", surfaces: ["config"], executableChange: true, semanticProvider: testSemanticProvider });
    await observe("route");
    assert.equal((await runPreflight(context)).status, "READY");
    await observe("preflight");
    await runActivate({ target, packageRoot });
    await observe("activate");
    for (const to of ["PLANNED", "EXECUTING", "VERIFYING"]) {
      await runAdvance({ ...context, to });
      await observe(`advance:${to}`);
    }
    await runPrepareCompletion(context);
    if (includePassingCheck) {
      const passed = await runCheck({ ...context, id: "check-auth-syntax", requirement: "fixture-verification", argv: [process.execPath, "-e", "process.exit(0)"] });
      assert.equal(passed.check.status, "passed");
      await observe("run-check:passed");
    }
    const failed = await runCheck({ ...context, id: "check-auth-boundary", requirement: "fixture-verification", argv: [process.execPath, "-e", "process.exit(1)"] });
    assert.equal(failed.check.status, "failed");
    await observe("run-check:failed");
    await runAdvance({ ...context, to: "DIAGNOSING" });
    await observe("advance:DIAGNOSING");
    return { ...context, cleanup, checkpoints, state: await readWorkState(target, { packageRoot, taskId }) };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
