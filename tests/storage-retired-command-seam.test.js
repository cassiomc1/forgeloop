import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { runAdvance } from "../src/commands/advance.js";
import { runRecordDiagnosis } from "../src/commands/record-diagnosis.js";

test("retired persistence capabilities fail before command storage allocation", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-retired-seam-"));
  try {
    const runtimeContext = { forgeloopPersistence: { connection: { exec() { assert.fail("retired connection must never be used"); } } } };
    for (const [command, input] of [
      ["advance", { taskId: "retired-task", to: "CORRECTING" }],
      ["record-diagnosis", { taskId: "retired-task", hypothesis: "fixture", failureClass: "VERIFICATION_FAILURE", evidenceRefs: ["fixture"], settledBy: "fixture", nextSafeAction: "fixture" }],
    ]) {
      const result = await executeForgeLoopCommand({ command, projectPath: target, input, runtimeContext });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "E_STORAGE_OPERATION_UNSUPPORTED", JSON.stringify(result));
      assert.deepEqual(await readdir(target), []);
    }
    await assert.rejects(runAdvance({ target, to: "CORRECTING", persistence: {} }), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
    await assert.rejects(runRecordDiagnosis({ target, persistence: {} }), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
  } finally { await removeTempTree(target); }
});
