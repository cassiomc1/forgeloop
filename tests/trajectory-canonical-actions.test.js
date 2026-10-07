import { ensureFixtureTask, overwriteFixtureRecordBytes } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { proposeAction } from "../src/core/actions.js";
import { buildTrajectoryMetrics } from "../src/core/trajectory-metrics.js";
import { evaluateTrajectory } from "../src/core/trajectory-evaluation.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

test("metrics expose trusted action readiness and one comparable-step owner", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-traj-metrics-"));
  const taskId = "traj-metrics-task";
  try {
    await ensureFixtureTask(target, taskId, packageRoot);
    await proposeAction(target, { packageRoot, taskId, input: {
      actionId: "action-traj", effectClass: "REVERSIBLE_WRITE", capability: "filesystem.write",
      target: "f", operation: "op", idempotencyKey: "traj:v1",
      requiredForCompletion: true, requirement: "traj-postcondition", provenance: "CALLER_REPORTED",
    } });
    // Forge the artifact to a raw VERIFIED label without any trusted evidence.
    const { readAction } = await import("../src/core/actions.js");
    const { taskActionPath } = await import("../src/core/task-paths.js");
    const action = await readAction(target, { packageRoot, taskId, actionId: "action-traj" });
    const forged = { ...action, state: "VERIFIED", revision: 2, lastEvidenceRef: "external:forged" };
    await overwriteFixtureRecordBytes(target, taskActionPath(taskId, action.actionId), JSON.stringify(forged));

    const metrics = await buildTrajectoryMetrics({ target, packageRoot, taskId });
    assert.equal(metrics.actions.verified, 1);
    assert.equal(metrics.actions.trustedSatisfied, 0, "raw VERIFIED without evidence is not trusted");
    assert.equal(metrics.actions.unresolvedRequired, 1);

    // Evaluation must not treat the forged label as resolved.
    const scenario = {
      schemaVersion: 1,
      scenarioId: "scn-forged",
      requiredMilestones: ["EXECUTION_STARTED"],
      forbidden: { unresolvedRequiredAction: true },
    };
    const scenarioPath = "scenario-forged.json";
    await writeFile(path.join(target, scenarioPath), JSON.stringify(scenario), "utf8");
    const evaluation = await evaluateTrajectory({ target, packageRoot, taskId, scenarioPath });
    assert.equal(evaluation.safetyValid, false);

    // Comparable steps have exactly one owner: metrics.
    if (evaluation.efficiency) {
      const expected = metrics.comparableSteps;
      assert.equal(evaluation.efficiency.actualComparableSteps >= expected, true);
    }
  } finally { await rm(target, { recursive: true, force: true }); }
});
