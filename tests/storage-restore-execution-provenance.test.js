import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, cp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { validateCheckExecutionProvenance } from "../src/core/completion-artifacts.js";
import { readWorkState } from "../src/core/work-state.js";
import { openStorageDatabase } from "../src/storage/connection.js";

test("restore preserves exact execution history and refuses foreign records outside its retained snapshot", async () => {
  const source = await buildCanonicalDiagnosisProject({ includePassingCheck: true });
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-restored-execution-"));
  const unbound = await mkdtemp(path.join(os.tmpdir(), "forgeloop-unbound-execution-"));
  const { taskId, packageRoot } = source;
  try {
    const backup = path.join(source.target, "backup");
    const backed = await executeForgeLoopCommand({ command: "storage-backup", projectPath: source.target, input: { destination: "backup", includeAttachments: true } });
    assert.equal(backed.ok, true, JSON.stringify(backed));
    const restored = await executeForgeLoopCommand({ command: "storage-restore", projectPath: target, input: { source: backup, writersQuiesced: true } });
    assert.equal(restored.ok, true, JSON.stringify(restored));
    const state = await readWorkState(target, { taskId, packageRoot });
    const check = state.checks.find(item => item.provenance === "FORGELOOP_EXECUTED");
    assert.ok(check);
    await validateCheckExecutionProvenance(check, { target, taskId, packageRoot });
    const original = openStorageDatabase(path.join(backup, "state.sqlite"), { readOnly: true });
    const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
    try {
      const query = "SELECT payload_json FROM executions WHERE task_id = ? AND execution_id = ?";
      const before = original.prepare(query).get(taskId, check.executionRef).payload_json;
      assert.equal(db.prepare(query).get(taskId, check.executionRef).payload_json, before);
      const execution = JSON.parse(before);
      const payload = JSON.stringify({ ...execution, protocolProjectRoot: path.join(source.target, "forged-root") });
      db.prepare("UPDATE executions SET payload_json = ? WHERE task_id = ? AND execution_id = ?").run(payload, taskId, check.executionRef);
      await assert.rejects(validateCheckExecutionProvenance(check, { target, taskId, packageRoot }), { code: "E_EXECUTION_REF_INVALID" });
    } finally { original.close(); db.close(); }
    await mkdir(path.join(unbound, ".forgeloop"));
    await cp(path.join(backup, "state.sqlite"), path.join(unbound, ".forgeloop/state.sqlite"));
    await assert.rejects(validateCheckExecutionProvenance(check, { target: unbound, taskId, packageRoot }), { code: "E_EXECUTION_REF_INVALID" });
  } finally { await source.cleanup(); await removeTempTree(target); await removeTempTree(unbound); }
});
