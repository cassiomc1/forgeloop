import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runAdvance } from "../src/commands/advance.js";
import { runContractCreate } from "../src/commands/contract-create.js";
import { runDiscover } from "../src/commands/discover.js";
import { runGateRecord } from "../src/commands/gate-record.js";
import { runGateRevalidate } from "../src/commands/gate-revalidate.js";
import { runPreflight } from "../src/commands/preflight.js";
import { runRoute } from "../src/commands/route.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { eventHash, readEvents, validateEventLedger } from "../src/core/events.js";
import { getNextAction, NEXT_ACTIONS } from "../src/core/next-action.js";
import { getPackageRoot } from "../src/core/templates.js";
import { readGateIfPresent, validateGateArtifacts } from "../src/core/gate-artifact.js";
import { readTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { sha256 } from "../src/core/manifest.js";
import { readFixtureText } from "./helpers/native-storage-fixture.js";

const packageRoot = getPackageRoot();
const ROUTE = Object.freeze({
  workType: "backend",
  surfaces: ["api"],
  risks: ["untrusted-input"],
  platforms: ["server"],
  behaviorChange: true,
  executableChange: true,
});

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-gate-revalidation-"));
  try {
    await writeFile(path.join(target, "THREAT_MODEL.md"), "original gate evidence\n");
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function setupExecutingTask(target, taskId, claims = ["THREAT_MODEL.md"], artifacts = ["THREAT_MODEL.md"]) {
  await runTaskCreate({ target, packageRoot, taskId, preset: "feature", claims });
  await runDiscover({ target, packageRoot, taskId });
  await runContractCreate({ target, packageRoot, taskId, preset: "feature" });
  await runRoute({ target, packageRoot, taskId, ...ROUTE });
  await runGateRecord({
    target,
    packageRoot,
    taskId,
    gate: "threat-boundary",
    status: "satisfied",
    artifacts,
    decisions: ["Reviewed the current threat boundary"],
  });
  assert.equal((await runPreflight({ target, packageRoot, taskId })).status, "READY");
  await runAdvance({ target, packageRoot, taskId, to: "PLANNED" });
  await runAdvance({ target, packageRoot, taskId, to: "EXECUTING" });
}

test("record and revalidate bind canonical gate evidence without operational filesystem mirrors", async () => {
  await withTarget(async target => {
    const taskId = "canonical-gate-lifecycle";
    const descriptorPath = taskArtifactPath(taskId, "descriptor");
    await setupExecutingTask(target, taskId, ["THREAT_MODEL.md"], [descriptorPath]);
    const gate = await readGateIfPresent(target, "threat-boundary", packageRoot, { taskId });
    assert.equal(gate.value.artifacts[0].sha256, sha256(await readFixtureText(target, descriptorPath)));
    assert.deepEqual(await validateGateArtifacts(target, gate.value, packageRoot), []);
    const { value: descriptor } = await readTaskDescriptor(target, taskId, packageRoot);
    await writeTaskDescriptor(target, { ...descriptor, updatedAt: new Date(Date.parse(descriptor.updatedAt) + 1000).toISOString() }, packageRoot);
    assert.deepEqual(await validateGateArtifacts(target, gate.value, packageRoot), [{ path: descriptorPath, status: "changed" }]);
    const result = await runGateRevalidate({ target, packageRoot, taskId, gate: "threat-boundary", acknowledgeStale: true });
    assert.deepEqual(result.stalePaths, [descriptorPath]);
    const refreshed = await readGateIfPresent(target, "threat-boundary", packageRoot, { taskId });
    assert.equal(refreshed.value.artifacts[0].sha256, sha256(await readFixtureText(target, descriptorPath)));
    assert.deepEqual(await validateGateArtifacts(target, refreshed.value, packageRoot), []);
    assert.equal((await validateEventLedger(target, packageRoot, { taskId })).valid, true);
    await assert.rejects(readFile(path.join(target, descriptorPath)), { code: "ENOENT" });
  });
});

test("stale gate dead-end exposes and executes canonical post-execution revalidation", async () => {
  await withTarget(async (target) => {
    const taskId = "stale-gate-recovery";
    await setupExecutingTask(target, taskId);
    await writeFile(path.join(target, "THREAT_MODEL.md"), "refreshed gate evidence\n");

    const next = await getNextAction({ target, packageRoot, taskId });
    assert.equal(next.nextAction, NEXT_ACTIONS.REVALIDATE_GATES);
    assert.equal(next.commandSpecs.length, 1);
    assert.equal(next.commandSpecs[0].commandId, "gate-revalidate");
    assert.equal(next.commandSpecs[0].requiredInputs[0].name, "acknowledgeStale");

    const result = await runGateRevalidate({
      target,
      packageRoot,
      taskId,
      gate: "threat-boundary",
      acknowledgeStale: true,
    });
    assert.deepEqual(result.stalePaths, ["THREAT_MODEL.md"]);
    const events = await readEvents(target, packageRoot, { taskId });
    const revalidated = events.findLast((event) => event.event === "GATE_REVALIDATED");
    const commit = events[events.indexOf(revalidated) + 1];
    assert.ok(revalidated);
    assert.equal(commit.event, "TRANSACTION_COMMITTED");
    assert.equal(commit.details.operation, "gate-revalidate");
    assert.equal(commit.seq, revalidated.seq + 1);
    assert.equal(commit.previousHash, revalidated.hash);
    assert.equal(commit.hash, eventHash(commit));
    assert.equal((await validateEventLedger(target, packageRoot, { taskId })).valid, true);

    assert.equal((await runPreflight({ target, packageRoot, taskId })).status, "READY");
    assert.equal((await getNextAction({ target, packageRoot, taskId })).nextAction, NEXT_ACTIONS.ENTER_VERIFYING);
  });
});

test("gate-record remains phase-frozen after execution", async () => {
  await withTarget(async (target) => {
    const frozenTaskId = "stale-gate-freeze";
    await setupExecutingTask(target, frozenTaskId);
    await assert.rejects(
      runGateRecord({
        target,
        packageRoot,
        taskId: frozenTaskId,
        gate: "threat-boundary",
        status: "satisfied",
        artifacts: ["THREAT_MODEL.md"],
        decisions: ["must remain frozen"],
      }),
      (error) => error.code === "E_PHASE_FREEZE",
    );

  });
});
