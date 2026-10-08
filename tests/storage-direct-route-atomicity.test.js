import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runTaskCreate } from "../src/commands/task-create.js";
import { runDiscover } from "../src/commands/discover.js";
import { runContractCreate } from "../src/commands/contract-create.js";
import { runRoute } from "../src/commands/route.js";
import { createContract, readContract } from "../src/core/contract.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { evaluateRoute } from "../src/core/router.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { openStorageDatabase } from "../src/storage/index.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = path.resolve(import.meta.dirname, "..");
const taskId = "direct-route-atomicity";
function database(target, callback) {
  const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
  try { return callback(db); } finally { db.close(); }
}
function snapshot(target) {
  return database(target, db => ({
    tasks: db.prepare("SELECT * FROM tasks ORDER BY task_id").all(),
    artifacts: db.prepare("SELECT * FROM task_artifacts ORDER BY task_id, kind, artifact_id").all(),
    events: db.prepare("SELECT * FROM events ORDER BY task_id, seq").all(),
  }));
}

for (const identity of ["explicit", "inferred", "inferred with supplied fingerprint"]) test(`direct route rollback with ${identity} task identity`, async () => {
  const inferIdentity = identity !== "explicit";
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-direct-route-"));
  try {
    await runTaskCreate({ target, taskId, packageRoot, claims: [] });
    await runDiscover({ target, taskId, packageRoot });
    const contractInput = createContract({ taskId, objective: "route atomicity fixture", deliverables: ["src"],
      verification: ["route parity verified"], successCriteria: ["route synchronization preserved"] });
    await writeFile(path.join(target, "contract-input.json"), JSON.stringify(contractInput));
    await runContractCreate({ target, taskId, packageRoot, contractFile: "contract-input.json" });
    await runRoute({ target, packageRoot, taskId, workType: "documentation", surfaces: ["config"] });
    const contract = await readContract(target, packageRoot, { taskId });
    const route = evaluateRoute({ workType: "complete-website", surfaces: ["ui"], risks: [], platforms: ["web"], executableChange: true });
    const options = inferIdentity ? { contractPath: taskArtifactPath(taskId, "contract"),
      ...(identity === "inferred with supplied fingerprint" ? { routePath: taskArtifactPath(taskId, "route"), contractFingerprint: contract.fingerprint } : {}) }
      : { taskId, contractFingerprint: contract.fingerprint };
    const before = snapshot(target);
    database(target, db => db.exec("CREATE TRIGGER fail_direct_route BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT, 'injected route state failure'); END"));
    await assert.rejects(() => persistRoute(target, route, packageRoot, options), /injected route state failure/);
    assert.deepEqual(snapshot(target), before);
    database(target, db => db.exec("DROP TRIGGER fail_direct_route"));
    const written = await persistRoute(target, route, packageRoot, inferIdentity ? options : { taskId });
    const after = snapshot(target);
    assert.equal(JSON.parse(after.tasks[0].state_json).routeFingerprint, written.fingerprint);
    assert.notEqual(written.fingerprint, JSON.parse(before.tasks[0].state_json).routeFingerprint);
  } finally { await removeTempTree(target); }
});
