import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runAdvance } from "../src/commands/advance.js";
import { runContractCreate } from "../src/commands/contract-create.js";
import { runDiscover } from "../src/commands/discover.js";
import { runGateRecord } from "../src/commands/gate-record.js";
import { runGateRevalidate } from "../src/commands/gate-revalidate.js";
import { runPreflight } from "../src/commands/preflight.js";
import { runRoute } from "../src/commands/route.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { readEvents } from "../src/core/events.js";
import { readGateIfPresent, validateGateArtifacts } from "../src/core/gate-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";
import { readWorkState } from "../src/core/work-state.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();
const route = { workType: "backend", surfaces: ["api"], risks: ["untrusted-input"], platforms: ["server"], behaviorChange: true, executableChange: true };

for (const operation of ["record", "evidence", "validate", "revalidate"]) {
  test(`gate ${operation} refuses evidence replaced by an outside symlink after path resolution`, { skip: process.platform === "win32" }, async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "forgeloop-gate-contained-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "forgeloop-gate-outside-"));
    const relativePath = operation === "evidence" ? "gate-evidence.json" : "THREAT_MODEL.md";
    const filename = path.join(target, relativePath);
    const external = path.join(outside, "external.txt");
    const taskId = `gate-contained-${operation}`;
    const record = () => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied", artifacts: operation === "evidence" ? [] : ["THREAT_MODEL.md"], decisions: operation === "evidence" ? [] : ["Reviewed contained evidence"], evidenceFile: operation === "evidence" ? relativePath : null });
    const original = fs.realpath;
    let swapped = false;
    try {
      await fs.writeFile(filename, operation === "evidence" ? JSON.stringify({ source: "inside" }) : "inside evidence\n");
      await fs.writeFile(external, operation === "evidence" ? JSON.stringify({ source: "outside" }) : "outside evidence\n");
      await runTaskCreate({ target, packageRoot, taskId, preset: "feature", claims: ["THREAT_MODEL.md"] });
      await runDiscover({ target, packageRoot, taskId });
      await runContractCreate({ target, packageRoot, taskId, preset: "feature" });
      await runRoute({ target, packageRoot, taskId, ...route });
      if (!["record", "evidence"].includes(operation)) await record();
      if (operation === "revalidate") {
        assert.equal((await runPreflight({ target, packageRoot, taskId })).status, "READY");
        await runAdvance({ target, packageRoot, taskId, to: "PLANNED" });
        await runAdvance({ target, packageRoot, taskId, to: "EXECUTING" });
        await fs.writeFile(filename, "changed inside evidence\n");
      }
      const snapshot = async () => ({
        events: await readEvents(target, packageRoot, { taskId }),
        state: await readWorkState(target, { packageRoot, taskId }),
        gate: await readGateIfPresent(target, "threat-boundary", packageRoot, { taskId }),
      });
      const before = await snapshot();
      fs.realpath = async function (file, ...args) {
        const resolved = await original.call(this, file, ...args);
        if (String(file) === filename && !swapped) {
          swapped = true;
          await fs.unlink(filename);
          await fs.symlink(external, filename);
        }
        return resolved;
      };
      syncBuiltinESMExports();
      const invoke = ["record", "evidence"].includes(operation) ? record
        : operation === "validate" ? () => validateGateArtifacts(target, before.gate.value, packageRoot)
          : () => runGateRevalidate({ target, packageRoot, taskId, gate: "threat-boundary", acknowledgeStale: true });
      await assert.rejects(invoke());
      fs.realpath = original;
      syncBuiltinESMExports();
      assert.equal(swapped, true, "the replacement must occur after the actual path-resolution call");
      assert.deepEqual(await snapshot(), before, "refused evidence must not change gate, task state or event history");
    } finally {
      fs.realpath = original;
      syncBuiltinESMExports();
      await removeTempTree(target);
      await removeTempTree(outside);
    }
  });
}
