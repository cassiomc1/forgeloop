import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createGitRepository } from "../../tests/helpers/git-fixture.js";
import { migrateProjectStorage } from "../../src/storage/migration.js";

/** Disposable source state built by the pinned legacy runtime, never rewritten to fit it. */
export async function buildLegacyDiagnosisProject({ legacyRoot, taskId }) {
  const load = relative => import(pathToFileURL(path.join(legacyRoot, relative)).href);
  const modules = await Promise.all([
    "task-create", "workspace-bind", "discover", "contract-create", "route", "preflight", "activate", "advance", "prepare-completion", "run-check",
  ].map(name => load(`src/commands/${name}.js`)));
  const [task, workspace, discover, contractCommand, route, preflight, activate, advance, receipt, check] = modules;
  const { createContract } = await load("src/core/contract.js");
  const { testSemanticProvider } = await load("src/core/decision/test-provider.js");
  const repository = await createGitRepository("forgeloop-legacy-diagnosis-");
  const target = `${repository}-linked`;
  const cleanup = async () => {
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    execFileSync("git", ["-C", repository, "worktree", "prune"], { stdio: "ignore" });
    await rm(repository, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  try {
    execFileSync("git", ["-C", repository, "worktree", "add", "-q", "-b", "codex/legacy-rollback-fixture", target], { stdio: "ignore" });
    await writeFile(path.join(repository, ".git/info/exclude"), ".forgeloop/\n");
    const context = { target, taskId, packageRoot: legacyRoot };
    await task.runTaskCreate({ ...context, claims: ["src"] });
    await workspace.runWorkspaceBind(context);
    await discover.runDiscover(context);
    const contract = createContract({ taskId, objective: "Exercise diagnosis and correction through the supported lifecycle",
      deliverables: ["src"], constraints: [], risks: [], stopConditions: [], unresolvedDecisions: [], sourceRefs: [],
      verification: [{ id: "fixture-verification", text: "The deterministic fixture check passes", type: "VERIFICATION" }],
      successCriteria: ["Diagnosis and correction preserve protocol integrity"] });
    await writeFile(path.join(target, "fixture-contract.json"), JSON.stringify(contract));
    await contractCommand.runContractCreate({ ...context, contractFile: "fixture-contract.json", semanticProvider: testSemanticProvider });
    await route.runRoute({ ...context, workType: "code", surfaces: ["config"], executableChange: true, semanticProvider: testSemanticProvider });
    assert.equal((await preflight.runPreflight(context)).status, "READY");
    await activate.runActivate({ target, packageRoot: legacyRoot });
    for (const to of ["PLANNED", "EXECUTING", "VERIFYING"]) await advance.runAdvance({ ...context, to });
    await receipt.runPrepareCompletion(context);
    const failed = await check.runCheck({ ...context, id: "check-auth-boundary", requirement: "fixture-verification", argv: [process.execPath, "-e", "process.exit(1)"] });
    assert.equal(failed.check.status, "failed");
    await advance.runAdvance({ ...context, to: "DIAGNOSING" });
    const migrated = await migrateProjectStorage(target, { destination: "legacy-seed-migration", writersQuiesced: true });
    assert.equal(migrated.currentStateVerified, true);
    return { target, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
