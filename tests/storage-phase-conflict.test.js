import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";
import { openStorageDatabase } from "../src/storage/index.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";
import { advanceWorkState } from "../src/core/phase.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { logicalSnapshot } from "./helpers/storage-fixtures.js";

for (const boundary of ["readiness", "identity"]) {
  for (const kind of ["contract", "route"]) {
    for (const code of ["E_STATE_REVISION_CONFLICT", "ARTIFACT_MISSING", "ARTIFACT_INVALID"]) {
      test(`phase ${kind} ${boundary} preserves ${code} handling without publishing`, async () => {
        const fixture = await buildCanonicalDiagnosisProject();
        const db = openStorageDatabase(path.join(fixture.target, ".forgeloop/state.sqlite"));
        const before = logicalSnapshot(db, fixture.taskId);
        const relative = taskArtifactPath(fixture.taskId, kind);
        const injected = Object.assign(new Error(`Controlled ${kind} read failure`), { code, artifacts: [relative] });
        try {
          await withOperationalStore({ db, target: fixture.target }, async store => {
            const originalRead = store.readText;
            let reached = false;
            store.readText = function(relativePath) {
              // Let readiness finish when targeting the later identity wrapper.
              const selectedBoundary = boundary === "readiness" || (new Error().stack ?? "").includes("readPhaseIdentityArtifacts");
              if (relativePath === relative && selectedBoundary) { reached = true; throw injected; }
              return originalRead.call(this, relativePath);
            };
            try {
              await assert.rejects(advanceWorkState(fixture.target, "CORRECTING", { taskId: fixture.taskId, packageRoot: fixture.packageRoot }), error => {
                assert.equal(error.code, code === "E_STATE_REVISION_CONFLICT" ? code : "E_PHASE_PREREQUISITE_MISSING", error.stack);
                if (code === "E_STATE_REVISION_CONFLICT") assert.equal(error, injected, "Preserve the original authoritative conflict and artifacts");
                return true;
              });
              assert.equal(reached, true);
            } finally { store.readText = originalRead; }
          });
          assert.deepEqual(logicalSnapshot(db, fixture.taskId), before);
        } finally { db.close(); await fixture.cleanup(); }
      });
    }
  }
}

test("phase readiness preserves a persisted preflight revision conflict without publishing", async () => {
  const fixture = await buildCanonicalDiagnosisProject();
  const db = openStorageDatabase(path.join(fixture.target, ".forgeloop/state.sqlite"));
  const before = logicalSnapshot(db, fixture.taskId);
  const relative = taskArtifactPath(fixture.taskId, "preflight");
  const injected = Object.assign(new Error("Controlled preflight conflict"), { code: "E_STATE_REVISION_CONFLICT", artifacts: [relative] });
  try {
    await withOperationalStore({ db, target: fixture.target }, async store => {
      const originalRead = store.readText;
      let reached = false;
      store.readText = function(relativePath) {
        if (relativePath === relative) { reached = true; throw injected; }
        return originalRead.call(this, relativePath);
      };
      try {
        await assert.rejects(advanceWorkState(fixture.target, "CORRECTING", { taskId: fixture.taskId, packageRoot: fixture.packageRoot }), error => error === injected);
        assert.equal(reached, true);
      } finally { store.readText = originalRead; }
    });
    assert.deepEqual(logicalSnapshot(db, fixture.taskId), before);
  } finally { db.close(); await fixture.cleanup(); }
});
