import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTempTree } from "./helpers/rm-safe.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { runDiscover } from "../src/commands/discover.js";
import { runContractCreate } from "../src/commands/contract-create.js";
import { runRoute } from "../src/commands/route.js";
import { runPreflight } from "../src/commands/preflight.js";
import { runAdvance } from "../src/commands/advance.js";
import { getNextAction } from "../src/core/next-action.js";
import { readPersistedRoute } from "../src/core/route-artifact.js";
import { readWorkState } from "../src/core/work-state.js";
import { readEvents } from "../src/core/events.js";
import { createContract, readContract, writeContract } from "../src/core/contract.js";
import { synchronizePersistedRouteState } from "../src/core/resumability.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-reroute-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function createFeatureContract(target, taskId) {
  const contract = createContract({
    taskId,
    objective: "Exercise reroute checkpoint synchronization",
    deliverables: ["src"],
    constraints: [],
    risks: [],
    verification: [{ id: "verify-reroute", text: "Reroute keeps checkpoint identity synchronized.", type: "VERIFICATION" }],
    successCriteria: [{ id: "complete-reroute", text: "Reroute synchronization is covered.", type: "PRODUCT" }],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  await writeFile(path.join(target, "contract-input.json"), JSON.stringify(contract));
}

async function setupRoutedTask(target, taskId) {
  await runTaskCreate({ target, packageRoot, taskId, claims: ["src"] });
  await runDiscover({ target, packageRoot, taskId });
  await createFeatureContract(target, taskId);
  await runContractCreate({ target, packageRoot, taskId, contractFile: "contract-input.json" });
  await runRoute({
    target,
    packageRoot,
    taskId,
    workType: "code",
    surfaces: ["api"],
    risks: ["external-service"],
    executableChange: true,
  });
  const state = await readWorkState(target, { packageRoot, taskId });
  assert.equal(state.phase, "ROUTED");
  return state;
}

function milestoneCount(events, name) {
  return events.filter((event) => event.event === name).length;
}

test("ROUTED reroute synchronizes checkpoint identity instead of diverging", async () => {
  await withTarget(async (target) => {
    const taskId = "reroute-sync";
    await setupRoutedTask(target, taskId);

    const blocked = await runPreflight({ target, packageRoot, taskId });
    assert.equal(blocked.status, "BLOCKED");
    assert.ok(blocked.errors.some((error) => error.code === "E_GATE_UNVERIFIED"));

    const before = await readWorkState(target, { packageRoot, taskId });
    const oldFingerprint = before.routeFingerprint;

    await runRoute({
      target,
      packageRoot,
      taskId,
      workType: "code",
      surfaces: ["config", "documentation"],
      executableChange: true,
    });

    const persisted = await readPersistedRoute(target, packageRoot, { taskId });
    const after = await readWorkState(target, { packageRoot, taskId });
    assert.notEqual(persisted.fingerprint, oldFingerprint);
    assert.equal(after.routeFingerprint, persisted.fingerprint);
    assert.deepEqual([...after.selectedGuides].sort(), [...persisted.value.guides].sort());
    assert.equal(after.phase, "ROUTED");
    assert.equal(after.contractFingerprint, before.contractFingerprint);
    assert.equal(after.revision, before.revision + 1);

    const events = await readEvents(target, packageRoot, { taskId });
    assert.equal(milestoneCount(events, "ROUTE_VALIDATED"), 1);

    const next = await getNextAction({ target, packageRoot, taskId });
    assert.equal(next.nextAction, "RUN_PREFLIGHT");
  });
});

test("same-route rerun is a safe no-op without revision churn", async () => {
  await withTarget(async (target) => {
    const taskId = "reroute-noop";
    await setupRoutedTask(target, taskId);

    const routeInput = {
      target,
      packageRoot,
      taskId,
      workType: "code",
      surfaces: ["api"],
      risks: ["external-service"],
      executableChange: true,
    };
    await runRoute(routeInput);
    const before = await readWorkState(target, { packageRoot, taskId });
    await runRoute(routeInput);
    const after = await readWorkState(target, { packageRoot, taskId });

    assert.equal(after.routeFingerprint, before.routeFingerprint);
    assert.equal(after.revision, before.revision);
    const events = await readEvents(target, packageRoot, { taskId });
    assert.equal(milestoneCount(events, "ROUTE_VALIDATED"), 1);
  });
});

test("late-phase reroute never rebinds checkpoint identity", async () => {
  await withTarget(async (target) => {
    const taskId = "reroute-late";
    await runTaskCreate({ target, packageRoot, taskId, claims: ["src"] });
    await runDiscover({ target, packageRoot, taskId });
    await createFeatureContract(target, taskId);
    await runContractCreate({ target, packageRoot, taskId, contractFile: "contract-input.json" });
    await runRoute({ target, packageRoot, taskId, workType: "code", surfaces: ["config"], executableChange: true });
    const ready = await runPreflight({ target, packageRoot, taskId });
    assert.equal(ready.status, "READY");
    await runAdvance({ target, packageRoot, taskId, to: "PLANNED" });
    await runAdvance({ target, packageRoot, taskId, to: "EXECUTING" });

    const beforeState = await readWorkState(target, { packageRoot, taskId });

    await runRoute({ target, packageRoot, taskId, workType: "code", surfaces: ["documentation"], executableChange: true });

    const afterState = await readWorkState(target, { packageRoot, taskId });
    assert.equal(afterState.routeFingerprint, beforeState.routeFingerprint);
    assert.deepEqual(afterState.selectedGuides, beforeState.selectedGuides);
    assert.equal(afterState.revision, beforeState.revision);
    assert.equal(afterState.phase, "EXECUTING");
  });
});

test("checkpoint synchronization rejects non-ROUTED phases", async () => {
  await withTarget(async (target) => {
    const taskId = "reroute-phase-guard";
    await runTaskCreate({ target, packageRoot, taskId, claims: ["src"] });
    await runDiscover({ target, packageRoot, taskId });
    await createFeatureContract(target, taskId);
    await runContractCreate({ target, packageRoot, taskId, contractFile: "contract-input.json" });
    await runRoute({ target, packageRoot, taskId, workType: "code", surfaces: ["config"], executableChange: true });
    const ready = await runPreflight({ target, packageRoot, taskId });
    assert.equal(ready.status, "READY");
    await runAdvance({ target, packageRoot, taskId, to: "PLANNED" });

    const route = await readPersistedRoute(target, packageRoot, { taskId });
    await assert.rejects(
      synchronizePersistedRouteState({ target, packageRoot, taskId, route }),
      /ROUTED/,
    );
  });
});

test("contract evolution reroute persists fresh route without rebinding stale checkpoint", async () => {
  await withTarget(async (target) => {
    const taskId = "reroute-contract";
    await setupRoutedTask(target, taskId);

    const beforeRoute = await readPersistedRoute(target, packageRoot, { taskId });
    const beforeState = await readWorkState(target, { packageRoot, taskId });

    const contractArtifact = await readContract(target, packageRoot, { taskId });
    await writeContract(target, { ...contractArtifact.value, objective: "drifted objective" }, packageRoot, { taskId });

    await runRoute({ target, packageRoot, taskId, workType: "code", surfaces: ["config"], executableChange: true });

    const afterRoute = await readPersistedRoute(target, packageRoot, { taskId });
    const afterState = await readWorkState(target, { packageRoot, taskId });
    assert.notEqual(afterRoute.fingerprint, beforeRoute.fingerprint);
    assert.equal(afterState.routeFingerprint, beforeState.routeFingerprint);
    assert.equal(afterState.contractFingerprint, beforeState.contractFingerprint);
    assert.equal(afterState.revision, beforeState.revision);
    assert.equal(afterState.phase, "ROUTED");
  });
});
