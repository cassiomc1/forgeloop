import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { claimMaintenanceHandoff } from "../src/storage/maintenance-handoff.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const ownerPath = target => path.join(target, ".forgeloop/.storage-maintenance/owner.json");
const historyRoot = target => path.join(target, ".forgeloop/storage-maintenance-history");

function ownerRecord(extra = {}) {
  return {
    schemaVersion: 1,
    ownerId: randomUUID(),
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString(),
    ...extra,
  };
}

test("handoff refuses claimant bytes changed during awaited death verification", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-maintenance-handoff-async-"));
  try {
    await mkdir(path.dirname(ownerPath(target)), { recursive: true });
    const previous = ownerRecord();
    const previousText = JSON.stringify(previous) + "\n";
    await writeFile(ownerPath(target), previousText);
    const sourceSha256 = createHash("sha256").update(previousText).digest("hex");
    const claimant = ownerRecord({ resumedFrom: previous.ownerId, handoffSourceSha256: sourceSha256 });
    const claimantRelative = ".forgeloop/storage-maintenance-history/handoffs/" + previous.ownerId + ".json";
    const claimantPath = path.join(target, claimantRelative);
    const claimantText = JSON.stringify(claimant) + "\n";
    await mkdir(path.dirname(claimantPath), { recursive: true });
    await writeFile(claimantPath, claimantText);
    const mutatedText = JSON.stringify({ ...claimant, acquiredAt: "2000-01-01T00:00:00.000Z" }) + "\n";
    const successor = ownerRecord({ resumedFrom: previous.ownerId });

    await assert.rejects(
      claimMaintenanceHandoff(target, { value: previous, text: previousText }, successor, async () => {
        await setImmediate();
        await writeFile(claimantPath, mutatedText);
      }),
      { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" },
    );
    assert.equal(await readFile(claimantPath, "utf8"), mutatedText);
    assert.deepEqual(await readdir(path.join(historyRoot(target), "handoffs")), [previous.ownerId + ".json"]);
  } finally {
    await removeTempTree(target);
  }
});
