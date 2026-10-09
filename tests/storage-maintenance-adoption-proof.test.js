import assert from "node:assert/strict";
import { AsyncResource } from "node:async_hooks";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resumeStorageMaintenance, retainStorageMaintenance, assertStorageMaintenanceOwnerContinuity } from "../src/storage/maintenance.js";
import { readMaintenanceOwner } from "../src/storage/maintenance-owner.js";
import { removeTempTree } from "./helpers/rm-safe.js";

for (const changedArchive of [false, true]) {
  test(`adopted dead owner proof ${changedArchive ? "rejects changed history" : "survives PID reuse only in its live context"}`, async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-adoption-proof-"));
    let worker;
    let inherited;
    const originalKill = process.kill;
    try {
      await mkdir(path.join(target, ".forgeloop"));
      worker = fork(new URL("./helpers/maintenance-adoption-owner-worker.mjs", import.meta.url), [target], { silent: true });
      let stderr = "";
      worker.stderr.on("data", bytes => { stderr += bytes; });
      const [ready] = await Promise.race([
        once(worker, "message"),
        once(worker, "exit").then(() => { throw new Error(`Owner exited before readiness: ${stderr}`); }),
      ]);
      const previous = await readMaintenanceOwner(target);
      assert.equal(previous.value.ownerId, ready.ownerId);
      const closed = once(worker, "close");
      worker.kill("SIGKILL");
      await closed;
      let currentOwnerId;
      await resumeStorageMaintenance(target, { expectedOwnerId: ready.ownerId, writersQuiesced: true }, async () => {
        inherited = new AsyncResource("maintenance-adoption-test");
        currentOwnerId = (await readMaintenanceOwner(target)).value.ownerId;
        await retainStorageMaintenance(target);
        if (changedArchive) {
          await writeFile(path.join(target, ".forgeloop/storage-maintenance-history", `${ready.ownerId}.json`),
            JSON.stringify({ ...previous.value, acquiredAt: "2000-01-01T00:00:00.000Z" }) + "\n");
        }
        // Adoption has already observed actual owner death. Model another
        // process acquiring that PID before recovery validates the same bytes.
        process.kill = (pid, signal) => pid === previous.value.pid && signal === 0 ? true : originalKill(pid, signal);
        const verify = () => assertStorageMaintenanceOwnerContinuity(target, {
          expectedOwnerId: currentOwnerId, recordedOwnerId: ready.ownerId,
        });
        if (changedArchive) await assert.rejects(verify, { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
        else await verify();
      });
      // No persisted flag or caller option can reuse the private observation.
      await assert.rejects(() => inherited.runInAsyncScope(() => assertStorageMaintenanceOwnerContinuity(target, {
        expectedOwnerId: currentOwnerId, recordedOwnerId: ready.ownerId,
      })), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
    } finally {
      process.kill = originalKill;
      inherited?.emitDestroy();
      if (worker && worker.exitCode === null && worker.signalCode === null) {
        const closed = once(worker, "close"); worker.kill("SIGKILL"); await closed;
      }
      await removeTempTree(target);
    }
  });
}
