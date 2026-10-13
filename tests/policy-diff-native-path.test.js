import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runPolicyDiff } from "../src/commands/policy-diff.js";
import { diffPolicies } from "../src/core/policy-diff.js";
import { writeTaskPolicySnapshot } from "../src/core/policy-engine.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();
test("explicit canonical policy diff paths read native snapshots and portable files independently", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-policy-diff-native-"));
  const taskId = "policy-diff-native";
  try {
    const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId, claims: [] } });
    assert.equal(created.ok, true, JSON.stringify(created));
    const snapshot = { schemaVersion: 1, policyDigest: "fixture", rules: [] };
    await writeTaskPolicySnapshot(target, taskId, snapshot, packageRoot);
    const virtual = taskArtifactPath(taskId, "policySnapshot");
    const portable = { rules: [{ id: "TEST.REQUIRED", blocking: true, severity: "HIGH" }], baseline: { entries: [] } };
    await writeFile(path.join(target, "portable.json"), JSON.stringify(portable));
    const expected = diffPolicies(snapshot, portable);
    assert.deepEqual(await runPolicyDiff({ target, packageRoot, before: virtual, after: "portable.json" }), expected);
    assert.deepEqual(await runPolicyDiff({ target, packageRoot, before: path.join(target, virtual), after: "portable.json" }), expected);
    assert.deepEqual(await runPolicyDiff({ target, packageRoot, before: "portable.json", after: virtual }), diffPolicies(portable, snapshot));
    await assert.rejects(runPolicyDiff({ target, packageRoot, before: taskArtifactPath("missing-policy", "policySnapshot"), after: "portable.json" }), { code: "ENOENT" });
    await assert.rejects(runPolicyDiff({ target, packageRoot, before: virtual.replace("policy-snapshot.json", "unknown-input.json"), after: "portable.json" }), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
    await mkdir(path.dirname(path.join(target, virtual)), { recursive: true });
    await writeFile(path.join(target, virtual), JSON.stringify(portable));
    await assert.rejects(runPolicyDiff({ target, packageRoot, before: virtual, after: "portable.json" }), { code: "E_STORAGE_MIGRATION_REQUIRED" });
    assert.deepEqual(await runPolicyDiff({ target, packageRoot, before: "portable.json", after: "portable.json" }), diffPolicies(portable, portable));
  } finally { await removeTempTree(target); }
});
