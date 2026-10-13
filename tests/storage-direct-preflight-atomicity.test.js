import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runTaskCreate } from "../src/commands/task-create.js";
import { runDiscover } from "../src/commands/discover.js";
import { runContractCreate } from "../src/commands/contract-create.js";
import { runRoute } from "../src/commands/route.js";
import { createContract } from "../src/core/contract.js";
import { runPreflight } from "../src/core/preflight.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { openStorageDatabase } from "../src/storage/index.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = path.resolve(import.meta.dirname, "..");
const taskId = "direct-preflight-atomicity";
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

for (const inferIdentity of [false, true]) test(`direct preflight rollback with ${inferIdentity ? "canonical paths" : "explicit task identity"}`, async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-direct-preflight-"));
  try {
    await runTaskCreate({ target, taskId, packageRoot, claims: [] });
    await runDiscover({ target, taskId, packageRoot });
    const contract = createContract({ taskId, objective: "preflight atomicity fixture", deliverables: ["src"],
      verification: ["preflight parity verified"], successCriteria: ["preflight synchronization preserved"] });
    await writeFile(path.join(target, "contract-input.json"), JSON.stringify(contract));
    await runContractCreate({ target, taskId, packageRoot, contractFile: "contract-input.json" });
    await runRoute({ target, packageRoot, taskId, workType: "documentation", surfaces: ["config"] });
    const options = inferIdentity ? { target, packageRoot,
      contractPath: taskArtifactPath(taskId, "contract"), routePath: taskArtifactPath(taskId, "route"),
      statePath: taskArtifactPath(taskId, "state"), preflightPath: taskArtifactPath(taskId, "preflight"),
      eventsPath: taskArtifactPath(taskId, "events") } : { target, taskId, packageRoot };
    const before = snapshot(target);
    assert.equal((await runPreflight({ ...options, persist: false })).status, "READY");
    assert.deepEqual(snapshot(target), before);
    database(target, db => db.exec("CREATE TRIGGER fail_direct_preflight BEFORE INSERT ON task_artifacts WHEN NEW.kind = 'preflight' BEGIN SELECT RAISE(ABORT, 'injected persisted preflight failure'); END"));
    await assert.rejects(() => runPreflight(options), /injected persisted preflight failure/);
    assert.deepEqual(snapshot(target), before);
    database(target, db => db.exec("DROP TRIGGER fail_direct_preflight"));
    const result = await runPreflight(options);
    assert.equal(result.status, "READY");
    assert.equal(result.taskId, taskId);
    assert.ok(snapshot(target).artifacts.some(row => row.kind === "preflight"));
  } finally { await removeTempTree(target); }
});
