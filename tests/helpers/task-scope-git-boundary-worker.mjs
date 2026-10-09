import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { createGitRepository } from "./git-fixture.js";
import { removeTempTree } from "./rm-safe.js";

// Install before repository.js captures its promisified Git runner. Keep the
// real subprocess and its output; observe both sides of the awaited operation.
const originalExecFile = childProcess.execFile;
const execute = promisify(originalExecFile);
let inspect = null;
function observedExecFile(...args) { return originalExecFile(...args); }
observedExecFile[promisify.custom] = async (file, args, options) => {
  const selected = inspect && file === "git" && args[2] === "status";
  if (selected) inspect("before");
  const result = await execute(file, args, options);
  if (selected) inspect("after");
  return result;
};
childProcess.execFile = observedExecFile;
syncBuiltinESMExports();

const { runTaskCreate } = await import("../../src/commands/task-create.js");
const { runTaskScope } = await import("../../src/commands/task-scope.js");
const { withProjectStorage } = await import("../../src/storage/project-boundary.js");
const { getOperationalStore } = await import("../../src/storage/operational-context.js");
const { openStorageDatabase, listClaims } = await import("../../src/storage/index.js");
const { getPackageRoot } = await import("../../src/core/templates.js");
const target = await createGitRepository("forgeloop-scope-git-boundary-");
const context = { target, packageRoot: getPackageRoot(), taskId: "scope-git-boundary" };
let writer;
try {
  await runTaskCreate({ ...context, claims: [] });
  writer = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"));
  const observations = [];
  await withProjectStorage(target, async () => {
    inspect = edge => {
      const store = getOperationalStore(target);
      assert.ok(store, "Git inspection must remain in the native storage scope");
      assert.equal(store.db.isTransaction, false);
      assert.equal(store.transaction, null);
      // A second connection can reserve the writer while Git is inspected.
      writer.exec("BEGIN IMMEDIATE");
      try { assert.equal(writer.isTransaction, true); }
      finally { writer.exec("ROLLBACK"); }
      observations.push(edge);
    };
    try {
      const result = await runTaskScope({ ...context, claims: ["src"] });
      assert.equal(result.updated, true);
      assert.deepEqual(result.writeClaims, ["src"]);
    } finally { inspect = null; }
  });
  assert.deepEqual(observations, ["before", "after"]);
  assert.deepEqual(listClaims(writer, context.taskId).map(row => row.claim_norm), ["src"]);
  process.stdout.write(JSON.stringify({ observations, claims: ["src"] }) + "\n");
} finally {
  inspect = null;
  childProcess.execFile = originalExecFile;
  syncBuiltinESMExports();
  writer?.close();
  await removeTempTree(target);
}
