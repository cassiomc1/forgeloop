import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runAdvance } from "../src/commands/advance.js";
import { runCheckpointRevalidate } from "../src/commands/checkpoint-revalidate.js";
import { runContractCreate } from "../src/commands/contract-create.js";
import { runContractRevise } from "../src/commands/contract-revise.js";
import { runDiscover } from "../src/commands/discover.js";
import { runPreflight } from "../src/commands/preflight.js";
import { runRoute } from "../src/commands/route.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { createPresetContract } from "../src/core/contract-presets.js";
import { contractFingerprint, readContract } from "../src/core/contract.js";
import { parseArgs } from "../src/cli.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { readEvents, validateEventLedger, validateStateLedgerCoherence } from "../src/core/events.js";
import { getNextAction, NEXT_ACTIONS } from "../src/core/next-action.js";
import { resolveTaskClaimState } from "../src/core/task-claim-state.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";
import { readWorkState } from "../src/core/work-state.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const execFileAsync = promisify(execFile);
const packageRoot = getPackageRoot();

async function git(target, args) {
  await execFileAsync("git", ["-C", target, ...args]);
}

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-contract-revise-"));
  try {
    await git(target, ["init", "-q", "-b", "main"]);
    await git(target, ["config", "user.email", "test@example.invalid"]);
    await git(target, ["config", "user.name", "ForgeLoop Test"]);
    await writeFile(path.join(target, "README.md"), "fixture\n");
    await git(target, ["add", "README.md"]);
    await git(target, ["commit", "-qm", "fixture"]);
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function setupTask(target, taskId, route = { workType: "documentation", surfaces: ["config"], executableChange: false }, claims = []) {
  await runTaskCreate({
    target, packageRoot, taskId, preset: "feature", claims,
  });
  await runDiscover({ target, packageRoot, taskId });
  await runContractCreate({ target, packageRoot, taskId, preset: "feature" });
  await runRoute({ target, packageRoot, taskId, ...route });
}

async function rewriteStateContractFingerprint(target, taskId, fingerprint) {
  const statePath = path.join(target, taskArtifactPath(taskId, "state"));
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.contractFingerprint = fingerprint;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

test("contract-revise exposes the bounded CLI and MAINTENANCE executor path", () => {
  const parsed = parseArgs(["contract-revise", "--task", "revise-cli", "--preset", "bug", "--json"]);
  assert.equal(parsed.command, "contract-revise");
  assert.equal(parsed.options.taskId, "revise-cli");
  assert.equal(parsed.options.preset, "bug");
  assert.equal(parsed.options.json, true);
});

test("ROUTED contract revision uses the real command path and resets derived authorization", async () => {
  await withTarget(async (target) => {
    const taskId = "revise-routed";
    await setupTask(target, taskId, { workType: "code", surfaces: ["api"], executableChange: true });
    const before = await readWorkState(target, { packageRoot, taskId });
    const execution = await executeForgeLoopCommand({
      projectPath: target,
      command: "contract-revise",
      input: { taskId, preset: "documentation" },
    });
    assert.equal(execution.ok, true);
    assert.equal(execution.result.revised, true);
    const after = await readWorkState(target, { packageRoot, taskId });
    const contract = await readContract(target, packageRoot, { taskId });
    const events = await readEvents(target, packageRoot, { taskId });
    const revision = events.find((event) => event.event === "CONTRACT_REVISED");
    const commit = events[events.indexOf(revision) + 1];
    assert.equal(after.phase, "ROUTED");
    assert.equal(after.revision, before.revision + 1);
    assert.equal(after.contractFingerprint, contract.fingerprint);
    assert.deepEqual(after.requiredGates, []);
    assert.deepEqual(after.satisfiedGates, []);
    assert.equal(revision.details.previousContractFingerprint, before.contractFingerprint);
    assert.equal(revision.details.revisedStateRevision, after.revision);
    assert.equal(commit.event, "TRANSACTION_COMMITTED");
    assert.equal(commit.details.operation, "contract-revise");
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    assert.equal(ledger.valid, true);
    assert.deepEqual(validateStateLedgerCoherence(after, ledger.events), []);
    assert.equal((await getNextAction({ target, packageRoot, taskId })).nextAction, NEXT_ACTIONS.RESOLVE_STALE_ROUTE);
    const claim = await resolveTaskClaimState(target, { packageRoot, taskId });
    assert.equal(claim.claimState, "ACTIVE");
    assert.equal(claim.ownershipValid, true);
    assert.equal(claim.mutationAllowed, true);
  });
});

test("identical contract revision is idempotent and concurrent callers commit exactly once", async () => {
  await withTarget(async (target) => {
    const taskId = "revise-idempotent";
    await setupTask(target, taskId);
    const first = await runContractRevise({ target, packageRoot, taskId, preset: "bug" });
    const eventsAfterFirst = await readFile(path.join(target, taskArtifactPath(taskId, "events")), "utf8");
    const stateAfterFirst = await readWorkState(target, { packageRoot, taskId });
    const second = await runContractRevise({ target, packageRoot, taskId, preset: "bug" });
    assert.equal(first.revised, true);
    assert.equal(second.revised, false);
    assert.equal(second.alreadyCurrent, true);
    assert.equal(await readFile(path.join(target, taskArtifactPath(taskId, "events")), "utf8"), eventsAfterFirst);
    assert.deepEqual(await readWorkState(target, { packageRoot, taskId }), stateAfterFirst);

    const concurrentTaskId = "revise-concurrent";
    await setupTask(target, concurrentTaskId);
    const results = await Promise.all([
      runContractRevise({ target, packageRoot, taskId: concurrentTaskId, preset: "bug" }),
      runContractRevise({ target, packageRoot, taskId: concurrentTaskId, preset: "bug" }),
    ]);
    assert.deepEqual(results.map((result) => result.revised).sort(), [false, true]);
    const ledger = await validateEventLedger(target, packageRoot, { taskId: concurrentTaskId });
    assert.equal(ledger.valid, true);
    assert.equal(ledger.events.filter((event) => event.event === "CONTRACT_REVISED").length, 1);
    assert.equal(ledger.events.filter((event) => event.event === "TRANSACTION_COMMITTED"
      && event.details.operation === "contract-revise").length, 1);
  });
});

test("PLANNED revision rewinds only to ROUTED and requires a fresh route", async () => {
  await withTarget(async (target) => {
    const taskId = "revise-planned";
    await setupTask(target, taskId, undefined, ["README.md"]);
    assert.equal((await runPreflight({ target, packageRoot, taskId })).status, "READY");
    await runAdvance({ target, packageRoot, taskId, to: "PLANNED" });
    const before = await readWorkState(target, { packageRoot, taskId });
    const result = await runContractRevise({ target, packageRoot, taskId, preset: "documentation" });
    const after = await readWorkState(target, { packageRoot, taskId });
    assert.equal(result.revised, true);
    assert.equal(before.phase, "PLANNED");
    assert.equal(after.phase, "ROUTED");
    assert.equal(after.revision, before.revision + 1);
    assert.equal((await getNextAction({ target, packageRoot, taskId })).nextAction, NEXT_ACTIONS.RESOLVE_STALE_ROUTE);
  });
});

test("contract revision rejects malformed, foreign, and late candidates without mutation", async () => {
  await withTarget(async (target) => {
    const taskId = "revise-inputs";
    await setupTask(target, taskId);
    await writeFile(path.join(target, "malformed.json"), "{\"taskId\":");
    await assert.rejects(
      runContractRevise({ target, packageRoot, taskId, contractFile: "malformed.json" }),
      (error) => error.code === "E_CONTRACT_REVISION_UNSAFE",
    );
    const foreign = createPresetContract({ taskId: "foreign-task", preset: "bug", claims: ["README.md"] });
    await writeFile(path.join(target, "foreign.json"), `${JSON.stringify(foreign)}\n`);
    await assert.rejects(
      runContractRevise({ target, packageRoot, taskId, contractFile: "foreign.json" }),
      (error) => error.code === "E_CONTRACT_REVISION_UNSAFE",
    );
    assert.equal((await readEvents(target, packageRoot, { taskId })).some((event) => event.event === "CONTRACT_REVISED"), false);

    const lateTask = "revise-late";
    await setupTask(target, lateTask, undefined, ["README.md"]);
    assert.equal((await runPreflight({ target, packageRoot, taskId: lateTask })).status, "READY");
    await runAdvance({ target, packageRoot, taskId: lateTask, to: "PLANNED" });
    await runAdvance({ target, packageRoot, taskId: lateTask, to: "EXECUTING" });
    await assert.rejects(
      runContractRevise({ target, packageRoot, taskId: lateTask, preset: "bug" }),
      (error) => error.code === "E_CONTRACT_REVISION_UNSAFE",
    );
  });
});

test("historical checkpoint revalidation remains valid through canonical contract and route evolution", async () => {
  await withTarget(async (target) => {
    const taskId = "revise-checkpoint-history";
    await setupTask(target, taskId, { workType: "code", surfaces: ["api"], executableChange: true });
    await writeFile(path.join(target, "README.md"), "checkpoint drift\n");
    await git(target, ["add", "README.md"]);
    await git(target, ["commit", "-qm", "checkpoint drift"]);
    await runCheckpointRevalidate({ target, packageRoot, taskId });
    const checkpoint = (await readEvents(target, packageRoot, { taskId })).find((event) => event.event === "CHECKPOINT_REVALIDATED");
    await runContractRevise({ target, packageRoot, taskId, preset: "documentation" });
    await runRoute({ target, packageRoot, taskId, workType: "documentation", surfaces: [], executableChange: false });
    const state = await readWorkState(target, { packageRoot, taskId });
    const events = await readEvents(target, packageRoot, { taskId });
    const rebound = events.find((event) => event.event === "ROUTE_REBOUND"
      && event.details.previousRouteFingerprint === checkpoint.details.routeFingerprint);
    const reboundIndex = events.indexOf(rebound);
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    const claim = await resolveTaskClaimState(target, { packageRoot, taskId });
    assert.ok(rebound);
    assert.equal(events[reboundIndex + 1].event, "TRANSACTION_COMMITTED");
    assert.equal(events[reboundIndex + 1].details.operation, "route");
    assert.equal(ledger.valid, true);
    assert.deepEqual(validateStateLedgerCoherence(state, ledger.events), []);
    assert.equal(claim.claimState, "ACTIVE");
    assert.equal(claim.ownershipValid, true);
    assert.equal(claim.mutationAllowed, true);
  });
});

test("manual rollback to an intermediate contract revision remains inconsistent", async () => {
  await withTarget(async (target) => {
    const taskId = "revise-rollback";
    await setupTask(target, taskId);
    await runContractRevise({ target, packageRoot, taskId, preset: "bug" });
    const intermediate = await readContract(target, packageRoot, { taskId });
    await runContractRevise({ target, packageRoot, taskId, preset: "documentation" });
    const finalState = await readWorkState(target, { packageRoot, taskId });
    const contractPath = path.join(target, taskArtifactPath(taskId, "contract"));
    await writeFile(contractPath, `${JSON.stringify(intermediate.value, null, 2)}\n`);
    await rewriteStateContractFingerprint(target, taskId, contractFingerprint(intermediate.value));
    const ledger = await validateEventLedger(target, packageRoot, { taskId });
    const state = await readWorkState(target, { packageRoot, taskId });
    const coherence = validateStateLedgerCoherence(state, ledger.events);
    const claim = await resolveTaskClaimState(target, { packageRoot, taskId });
    assert.equal(finalState.revision, state.revision);
    assert.equal(ledger.valid, true);
    assert.ok(coherence.some((error) => error.code === "E_CONTRACT_REVISION_UNSAFE"));
    assert.equal(claim.claimState, "INCONSISTENT");
    assert.equal(claim.ownershipValid, false);
    assert.equal(claim.mutationAllowed, false);
  });
});

test("current contract descriptor claims survive a revision", async () => {
  await withTarget(async (target) => {
    const taskId = "revise-claims";
    await setupTask(target, taskId, undefined, ["README.md"]);
    const descriptorPath = path.join(target, taskArtifactPath(taskId, "descriptor"));
    const before = await readFile(descriptorPath, "utf8");
    await runContractRevise({ target, packageRoot, taskId, preset: "bug" });
    assert.equal(await readFile(descriptorPath, "utf8"), before);
  });
});
