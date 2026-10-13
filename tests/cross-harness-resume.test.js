import { removeTempTree } from "./helpers/rm-safe.js";
import { ensureFixtureTask, readFixtureText } from "./helpers/native-storage-fixture.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { canonicalFingerprint } from "../src/core/artifacts.js";

const root = path.resolve(".");

function runModule(source, env) {
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return run.stdout.trim();
}

test("a fresh process resumes the same task from persisted continuity", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-cross-harness-"));
  try {
    const contract = { schemaVersion:1, protocolVersion:1, taskId:"task-cross", objective:"Build site" };
    const contractFingerprint = canonicalFingerprint(contract);
    const state = {
      schemaVersion:1, protocolVersion:1, taskId:"task-cross", contractFingerprint,
      repositoryFingerprint:{branch:"main",head:"abc"}, phase:"EXECUTING",
      selectedGuides:[], completedSteps:["planning"], pendingSteps:["implementation","verification"],
      requiredArtifacts:[], checks:[], failures:[], blockers:[], verificationEvidence:[],
      lastUpdated:"2026-08-16T17:00:00.000Z",
    };
    await writeFile(path.join(target, "state.json"), JSON.stringify(state));
    await writeFile(path.join(target, "contract.json"), JSON.stringify(contract));

    await ensureFixtureTask(target, "task-cross", root);
    runModule(`
      import { readFile } from "node:fs/promises";
      import { runRecordContinuity } from "./src/commands/record-continuity.js";
      import { canonicalFingerprint } from "./src/core/artifacts.js";
      const target=process.env.TARGET;
      const state=JSON.parse(await readFile(target+"/state.json","utf8"));
      const contract=JSON.parse(await readFile(target+"/contract.json","utf8"));
      const result=await runRecordContinuity({
        target, taskId:"task-cross", packageRoot:process.cwd(), state,
        contract:{value:contract,fingerprint:canonicalFingerprint(contract)},
        repositoryFingerprint:{branch:"main",head:"abc"},
        now:"2026-08-16T17:05:00.000Z",
        focusId:"hero", focusSummary:"Finish hero",
        remaining:["contact:Finish contact form"], inspectFirst:["src/app.js"]
      });
      console.log(result.value.taskId);
    `, { TARGET: target });

    const output = runModule(`
      import { readFile } from "node:fs/promises";
      import { readContinuity } from "./src/core/continuity.js";
      import { classifyContinuity } from "./src/core/continuity-reconciliation.js";
      import { nextActionForContinuity } from "./src/core/next-action-continuity.js";
      import { canonicalFingerprint } from "./src/core/artifacts.js";
      const target=process.env.TARGET;
      const state=JSON.parse(await readFile(target+"/state.json","utf8"));
      const artifact=await readContinuity(target,{packageRoot:process.cwd(),taskId:"task-cross"});
      const classified=classifyContinuity({
        continuity:artifact.value,state,contractFingerprint:state.contractFingerprint,
        repositoryFingerprint:{branch:"main",head:"abc"},changedPaths:[]
      });
      const next=nextActionForContinuity({context:{taskId:state.taskId,currentPhase:state.phase},continuity:{...classified,continuity:artifact.value}});
      console.log(JSON.stringify({taskId:artifact.value.taskId,phase:artifact.value.phase,nextAction:next.nextAction,remaining:artifact.value.remainingWork.map(x=>x.id)}));
    `, { TARGET: target });
    const resumed=JSON.parse(output);
    assert.deepEqual(resumed, {
      taskId:"task-cross", phase:"EXECUTING", nextAction:"CONTINUE_IMPLEMENTATION", remaining:["contact"],
    });

    const persisted=JSON.parse(await readFixtureText(target, taskArtifactPath("task-cross", "continuity")));
    assert.equal(persisted.workStateFingerprint,canonicalFingerprint(state));
  } finally {
    await removeTempTree(target);
  }
});
