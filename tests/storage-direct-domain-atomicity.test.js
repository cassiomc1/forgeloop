import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runTaskCreate } from "../src/commands/task-create.js";
import { codeManifestContentDigest, writeCodeManifest } from "../src/core/code-manifest.js";
import { buildCanonicalHandoff, writeCanonicalHandoff } from "../src/core/handoff.js";
import { resolveVerificationScope, persistVerificationScope } from "../src/core/verification-scope.js";
import { bindTaskWorkspace } from "../src/core/workspace-binding.js";
import { getPackageRoot } from "../src/core/templates.js";
import { openStorageDatabase } from "../src/storage/index.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();
const taskId = "direct-domain-atomicity";
function database(target, callback) {
  const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
  try { return callback(db); } finally { db.close(); }
}
function snapshot(target) {
  return database(target, db => ({
    artifacts: db.prepare("SELECT * FROM task_artifacts ORDER BY task_id, kind, artifact_id").all(),
    states: db.prepare("SELECT task_id, state_json FROM tasks ORDER BY task_id").all(),
    events: db.prepare("SELECT * FROM events ORDER BY task_id, seq").all(),
  }));
}
function failEvent(target, event) {
  database(target, db => db.exec(`CREATE TRIGGER fail_direct_domain BEFORE INSERT ON events WHEN NEW.event_type = '${event}' BEGIN SELECT RAISE(ABORT, 'injected direct domain event failure'); END`));
}

for (const kind of ["scope", "handoff"]) test(`direct ${kind} artifact and event roll back together`, async () => {
  const target = await createGitRepository(`forgeloop-direct-${kind}-`);
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });
    await bindTaskWorkspace(target, { taskId, packageRoot });
    const value = kind === "scope"
      ? (await resolveVerificationScope(target, { taskId, packageRoot, mode: "FULL" })).scope
      : await buildCanonicalHandoff(target, { taskId, packageRoot, handoffNote: "atomic direct writer" });
    const before = snapshot(target);
    failEvent(target, kind === "scope" ? "VERIFICATION_SCOPE_CAPTURED" : "HANDOFF_CREATED");
    const write = () => kind === "scope" ? persistVerificationScope(target, value, { taskId, packageRoot }) : writeCanonicalHandoff(target, value, { taskId, packageRoot });
    await assert.rejects(write, /injected direct domain event failure/);
    assert.deepEqual(snapshot(target), before);
    database(target, db => db.exec("DROP TRIGGER fail_direct_domain"));
    await write();
  } finally { await removeTempTree(target); }
});

test("direct code manifest history and replacement roll back together", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-direct-manifest-"));
  try {
    await runTaskCreate({ target, taskId, packageRoot, claims: [] });
    const zero = "0".repeat(64);
    const manifest = { schemaVersion: 1, protocolVersion: 1, taskId, verificationCycle: 1,
      capture: { mode: "WORKTREE", revisionProvider: "fixture", baseRevision: null, observedRevision: "WORKTREE", providerMetadata: {} },
      bindings: { contractFingerprint: zero, routeFingerprint: null, stateFingerprint: zero, receiptFingerprint: zero, ledgerSeq: 1, ledgerHash: zero },
      entries: [], contentDigest: codeManifestContentDigest([]) };
    await writeCodeManifest({ target, taskId, packageRoot, manifest });
    await assert.rejects(() => writeCodeManifest({ target, taskId, packageRoot, manifest }), /immutable within a verification cycle/);
    const before = snapshot(target);
    database(target, db => db.exec("CREATE TRIGGER fail_direct_domain BEFORE UPDATE ON task_artifacts WHEN NEW.kind = 'attestation' AND NEW.artifact_id = 'code-manifest' BEGIN SELECT RAISE(ABORT, 'injected manifest replacement failure'); END"));
    const write = () => writeCodeManifest({ target, taskId, packageRoot, manifest: { ...manifest, verificationCycle: 2 } });
    await assert.rejects(write, /injected manifest replacement failure/);
    assert.deepEqual(snapshot(target), before);
    database(target, db => db.exec("DROP TRIGGER fail_direct_domain"));
    await write();
    assert.ok(snapshot(target).artifacts.some(row => row.kind === "attestation" && row.artifact_id === "history/cycle-1/code-manifest" && JSON.parse(row.payload_json).verificationCycle === 1));
  } finally { await removeTempTree(target); }
});
