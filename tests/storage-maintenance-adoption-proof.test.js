import assert from "node:assert/strict";
import { AsyncResource } from "node:async_hooks";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resumeStorageMaintenance, retainStorageMaintenance, assertStorageMaintenanceOwnerContinuity } from "../src/storage/maintenance.js";
import { readMaintenanceOwner } from "../src/storage/maintenance-owner.js";
import { readWindowsProcessIncarnation, WINDOWS_PROCESS_INCARNATION_KIND } from "../src/storage/windows-process-incarnation.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const ownerPath = target => path.join(target, ".forgeloop/.storage-maintenance/owner.json");
const historyOwnerPath = (target, ownerId) => path.join(target, ".forgeloop/storage-maintenance-history", `${ownerId}.json`);

for (const changedArchive of [false, true]) {
  test(`legacy adopted dead owner proof ${changedArchive ? "rejects changed history" : "survives PID reuse only in its live context"}`, async () => {
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
      // This control deliberately exercises the retained schema-1 fallback.
      // Native Windows token behavior is covered separately below.
      const legacyValue = { ...previous.value };
      delete legacyValue.processIncarnation;
      const legacyText = `${JSON.stringify(legacyValue)}\n`;
      await writeFile(ownerPath(target), legacyText);
      const legacyPrevious = await readMaintenanceOwner(target);
      assert.equal(legacyPrevious.value.processIncarnation, undefined);
      let currentOwnerId;
      await resumeStorageMaintenance(target, { expectedOwnerId: legacyPrevious.value.ownerId, writersQuiesced: true }, async () => {
        inherited = new AsyncResource("maintenance-adoption-test");
        currentOwnerId = (await readMaintenanceOwner(target)).value.ownerId;
        await retainStorageMaintenance(target);
        if (changedArchive) {
          await writeFile(historyOwnerPath(target, legacyPrevious.value.ownerId),
            JSON.stringify({ ...legacyPrevious.value, acquiredAt: "2000-01-01T00:00:00.000Z" }) + "\n");
        }
        // Adoption has already observed actual owner death. For this legacy
        // fixture, model another process acquiring that PID before recovery
        // validates the same bytes.
        process.kill = (pid, signal) => pid === legacyPrevious.value.pid && signal === 0 ? true : originalKill(pid, signal);
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

test("legacy schema-1 recovery preserves the PID absence boundary after a child closes", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-legacy-owner-"));
  let worker;
  try {
    await mkdir(path.join(target, ".forgeloop"));
    worker = fork(new URL("./helpers/maintenance-adoption-owner-worker.mjs", import.meta.url), [target], { silent: true });
    let stderr = "";
    worker.stderr.on("data", bytes => { stderr += bytes; });
    const [ready] = await Promise.race([
      once(worker, "message"),
      once(worker, "exit").then(() => { throw new Error(`Owner exited before readiness: ${stderr}`); }),
    ]);
    const observed = await readMaintenanceOwner(target);
    assert.equal(observed.value.ownerId, ready.ownerId);
    const closed = once(worker, "close");
    worker.kill("SIGKILL");
    await closed;
    const legacy = { ...observed.value };
    delete legacy.processIncarnation;
    const legacyText = `${JSON.stringify(legacy)}\n`;
    await writeFile(ownerPath(target), legacyText);
    let absent = false;
    try { process.kill(legacy.pid, 0); }
    catch (error) { assert.equal(error.code, "ESRCH"); absent = true; }
    if (!absent) {
      await assert.rejects(
        resumeStorageMaintenance(target, { expectedOwnerId: legacy.ownerId, writersQuiesced: true }, () => assert.fail("a reused legacy PID must refuse recovery")),
        { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" },
      );
      assert.deepEqual(await readFile(ownerPath(target)), Buffer.from(legacyText));
      return;
    }
    let invoked = false;
    await resumeStorageMaintenance(target, { expectedOwnerId: legacy.ownerId, writersQuiesced: true }, async () => {
      invoked = true;
    });
    assert.equal(invoked, true);
    assert.deepEqual(await readFile(historyOwnerPath(target, legacy.ownerId)), Buffer.from(legacyText));
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      const closed = once(worker, "close");
      worker.kill("SIGKILL");
      await closed;
    }
    await removeTempTree(target);
  }
});

test("legacy schema-1 owner with a live PID remains refused", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-legacy-live-owner-"));
  try {
    await mkdir(path.join(target, ".forgeloop/.storage-maintenance"), { recursive: true });
    const owner = {
      schemaVersion: 1,
      ownerId: randomUUID(),
      pid: process.pid,
      hostname: os.hostname(),
      acquiredAt: new Date().toISOString(),
    };
    const text = `${JSON.stringify(owner)}\n`;
    await writeFile(ownerPath(target), text);
    await assert.rejects(
      resumeStorageMaintenance(target, { expectedOwnerId: owner.ownerId, writersQuiesced: true }, () => assert.fail("a live legacy owner must not be displaced")),
      { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" },
    );
    assert.deepEqual(await readFile(ownerPath(target)), Buffer.from(text));
  } finally {
    await removeTempTree(target);
  }
});

test("Windows continuity validates a closed token owner outside private proof and distinguishes same-token live PID from a different incarnation", {
  skip: process.platform !== "win32",
  concurrency: false,
}, async () => {
  const self = await readWindowsProcessIncarnation(process.pid);
  assert.ok(self?.status === "ALIVE" && self.hasExited === false && typeof self.startTimeTicks === "string");
  const selfToken = {
    kind: WINDOWS_PROCESS_INCARNATION_KIND,
    pid: process.pid,
    schemaVersion: 1,
    startTimeTicks: self.startTimeTicks,
  };
  const reusedPidToken = { ...selfToken, startTimeTicks: (BigInt(self.startTimeTicks) + 1n).toString() };
  const makePrevious = processIncarnation => ({
    schemaVersion: 1,
    ownerId: randomUUID(),
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString(),
    processIncarnation,
  });
  const writeFixture = async previous => {
    const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-native-continuity-"));
    const current = {
      schemaVersion: 1,
      ownerId: randomUUID(),
      pid: process.pid,
      hostname: os.hostname(),
      acquiredAt: new Date().toISOString(),
      resumedFrom: previous.ownerId,
      processIncarnation: selfToken,
    };
    await mkdir(path.dirname(ownerPath(target)), { recursive: true });
    await mkdir(path.join(target, ".forgeloop/storage-maintenance-history"), { recursive: true });
    await writeFile(ownerPath(target), `${JSON.stringify(current)}\n`);
    await writeFile(historyOwnerPath(target, previous.ownerId), `${JSON.stringify(previous)}\n`);
    return { target, current, previous };
  };

  const sameToken = await writeFixture(makePrevious(selfToken));
  try {
    await assert.rejects(
      assertStorageMaintenanceOwnerContinuity(sameToken.target, {
        expectedOwnerId: sameToken.current.ownerId,
        recordedOwnerId: sameToken.previous.ownerId,
      }),
      { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" },
    );
  } finally {
    await removeTempTree(sameToken.target);
  }

  const differentToken = await writeFixture(makePrevious(reusedPidToken));
  try {
    await assertStorageMaintenanceOwnerContinuity(differentToken.target, {
      expectedOwnerId: differentToken.current.ownerId,
      recordedOwnerId: differentToken.previous.ownerId,
    });
  } finally {
    await removeTempTree(differentToken.target);
  }

  const deadTarget = await mkdtemp(path.join(os.tmpdir(), "forgeloop-native-dead-continuity-"));
  let worker;
  try {
    await mkdir(path.join(deadTarget, ".forgeloop"));
    worker = fork(new URL("./helpers/maintenance-adoption-owner-worker.mjs", import.meta.url), [deadTarget], { silent: true });
    let stderr = "";
    worker.stderr.on("data", bytes => { stderr += bytes; });
    const [ready] = await Promise.race([
      once(worker, "message"),
      once(worker, "exit").then(() => { throw new Error(`Owner exited before readiness: ${stderr}`); }),
    ]);
    const deadOwner = (await readMaintenanceOwner(deadTarget)).value;
    assert.equal(deadOwner.ownerId, ready.ownerId);
    assert.equal(deadOwner.processIncarnation?.kind, WINDOWS_PROCESS_INCARNATION_KIND);
    const closed = once(worker, "close");
    worker.kill("SIGKILL");
    await closed;
    const deadObservation = await readWindowsProcessIncarnation(deadOwner.pid);
    assert.ok(
      ["EXITED", "NOT_FOUND"].includes(deadObservation?.status)
        || (deadObservation?.status === "ALIVE" && deadObservation.startTimeTicks !== deadOwner.processIncarnation.startTimeTicks),
      JSON.stringify(deadObservation),
    );
    const current = {
      schemaVersion: 1,
      ownerId: randomUUID(),
      pid: process.pid,
      hostname: os.hostname(),
      acquiredAt: new Date().toISOString(),
      resumedFrom: deadOwner.ownerId,
      processIncarnation: selfToken,
    };
    await mkdir(path.join(deadTarget, ".forgeloop/storage-maintenance-history"), { recursive: true });
    await writeFile(ownerPath(deadTarget), `${JSON.stringify(current)}\n`);
    await writeFile(historyOwnerPath(deadTarget, deadOwner.ownerId), `${JSON.stringify(deadOwner)}\n`);
    await assertStorageMaintenanceOwnerContinuity(deadTarget, {
      expectedOwnerId: current.ownerId,
      recordedOwnerId: deadOwner.ownerId,
    });
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      const closed = once(worker, "close");
      worker.kill("SIGKILL");
      await closed;
    }
    await removeTempTree(deadTarget);
  }
});
