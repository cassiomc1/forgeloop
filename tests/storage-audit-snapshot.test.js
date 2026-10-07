import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import { evaluateAudit } from "../src/core/audit.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { openStorageDatabase } from "../src/storage/index.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";

test("native audit retains one canonical snapshot after concurrent receipt deletion", async () => {
  const f = await buildCanonicalDiagnosisProject();
  let db, writer;
  try {
    const expected = await evaluateAudit(f);
    const filename = path.join(f.target, ".forgeloop/state.sqlite");
    db = openStorageDatabase(filename);
    writer = openStorageDatabase(filename);
    await withOperationalStore({ db, target: f.target }, async source => {
      const prototype = Object.getPrototypeOf(source);
      const read = prototype.readText;
      let changed = false;
      prototype.readText = function(relativePath) {
        const value = read.call(this, relativePath);
        if (!changed && this.target === f.target && relativePath === taskArtifactPath(f.taskId, "state")) {
          changed = true;
          assert.equal(writer.prepare("DELETE FROM task_artifacts WHERE task_id = ? AND kind = 'receipt'").run(f.taskId).changes, 1);
        }
        return value;
      };
      try {
        assert.deepEqual(await evaluateAudit(f), expected);
        assert.equal(changed, true);
        assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
      } finally { prototype.readText = read; }
    });
    assert.notDeepEqual(await evaluateAudit(f), expected);
  } finally { writer?.close(); db?.close(); await removeTempTree(f.target); }
});
