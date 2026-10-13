import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, lstat, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isWindowsProcessIncarnationToken, readWindowsProcessIncarnation, WINDOWS_PROCESS_INCARNATION_KIND } from "../src/storage/windows-process-incarnation.js";
import { readMaintenanceOwner } from "../src/storage/maintenance-owner.js";
import { resumeStorageMaintenance, withStorageMaintenance } from "../src/storage/maintenance.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const ownerPath = target => path.join(target, ".forgeloop/.storage-maintenance/owner.json");
const exclusionPath = target => path.join(target, ".forgeloop/.storage-maintenance");
const historyPath = target => path.join(target, ".forgeloop/storage-maintenance-history");

function ownerRecord(processIncarnation) {
  return {
    schemaVersion: 1,
    ownerId: randomUUID(),
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString(),
    ...(processIncarnation === undefined ? {} : { processIncarnation }),
  };
}

async function retainedOwner(value) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-maintenance-incarnation-"));
  await mkdir(path.dirname(ownerPath(target)), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(value) + "\n");
  await writeFile(ownerPath(target), bytes);
  return { target, bytes };
}

async function restoreSystemRoot(previous) {
  if (previous === undefined) delete process.env.SystemRoot;
  else process.env.SystemRoot = previous;
}

test("new maintenance records preserve schema 1 and add only an authenticated Windows token", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-maintenance-owner-"));
  try {
    await mkdir(path.join(target, ".forgeloop"));
    let published;
    await withStorageMaintenance(target, async () => {
      published = (await readMaintenanceOwner(target)).value;
    });
    assert.equal(published.schemaVersion, 1);
    if (process.platform === "win32") {
      assert.ok(isWindowsProcessIncarnationToken(published.processIncarnation, { pid: process.pid }));
      assert.equal(published.processIncarnation.kind, WINDOWS_PROCESS_INCARNATION_KIND);
    } else assert.equal(published.processIncarnation, undefined);
  } finally {
    await removeTempTree(target);
  }
});

test("malformed or unsupported optional owner tokens refuse recovery before handoff mutation", async () => {
  const validShape = {
    kind: WINDOWS_PROCESS_INCARNATION_KIND,
    pid: process.pid,
    schemaVersion: 1,
    startTimeTicks: "638955840000000000",
  };
  const invalidTokens = [
    null,
    { ...validShape, schemaVersion: 2 },
    { ...validShape, pid: process.pid + 1 },
    { ...validShape, startTimeTicks: "0" },
    { ...validShape, hasExited: false },
  ];
  for (const processIncarnation of invalidTokens) {
    const fixture = await retainedOwner(ownerRecord(processIncarnation));
    try {
      await assert.rejects(
        resumeStorageMaintenance(fixture.target, { expectedOwnerId: JSON.parse(fixture.bytes).ownerId, writersQuiesced: true }, () => assert.fail("invalid token must not authorize recovery")),
        { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" },
      );
      assert.deepEqual(await readFile(ownerPath(fixture.target)), fixture.bytes);
      await assert.rejects(lstat(historyPath(fixture.target)), { code: "ENOENT" });
    } finally {
      await removeTempTree(fixture.target);
    }
  }
});

test("Windows owner publication refuses missing or inaccessible fixed PowerShell paths", { skip: process.platform !== "win32", concurrency: false }, async () => {
  const previous = process.env.SystemRoot;
  try {
    for (const configuredRoot of [undefined, "C:\\__forgeloop_missing_system_root__"]) {
      const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-maintenance-owner-refusal-"));
      try {
        if (configuredRoot === undefined) delete process.env.SystemRoot;
        else process.env.SystemRoot = configuredRoot;
        await mkdir(path.join(target, ".forgeloop"));
        await assert.rejects(withStorageMaintenance(target, () => assert.fail("unavailable Windows identity must refuse publication")), {
          code: "E_STORAGE_MAINTENANCE_IN_PROGRESS",
        });
        await assert.rejects(lstat(exclusionPath(target)), { code: "ENOENT" });
      } finally {
        await removeTempTree(target);
      }
    }
  } finally {
    await restoreSystemRoot(previous);
  }
});

test("the fixed Windows observer reports a missing PID as NOT_FOUND", { skip: process.platform !== "win32" }, async () => {
  const observation = await readWindowsProcessIncarnation(2_147_483_647);
  assert.equal(observation?.status, "NOT_FOUND", "a verified missing PID must remain distinguishable from an unavailable query");
});

test("Windows owner liveness refuses the same token and accepts a different verified incarnation", { skip: process.platform !== "win32" }, async () => {
  const observed = await readWindowsProcessIncarnation(process.pid);
  assert.ok(observed?.status === "ALIVE" && observed.hasExited === false, "self identity must be available for Windows owner admission");
  const processIncarnation = {
    kind: WINDOWS_PROCESS_INCARNATION_KIND,
    pid: process.pid,
    schemaVersion: 1,
    startTimeTicks: observed.startTimeTicks,
  };
  const fixture = await retainedOwner(ownerRecord(processIncarnation));
  try {
    const owner = JSON.parse(fixture.bytes);
    await assert.rejects(
      resumeStorageMaintenance(fixture.target, { expectedOwnerId: owner.ownerId, writersQuiesced: true }, () => assert.fail("same live incarnation must refuse recovery")),
      { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" },
    );
    const differentToken = { ...processIncarnation, startTimeTicks: processIncarnation.startTimeTicks === "1" ? "2" : "1" };
    await writeFile(ownerPath(fixture.target), JSON.stringify({ ...owner, processIncarnation: differentToken }) + "\n");
    let invoked = false;
    await resumeStorageMaintenance(fixture.target, { expectedOwnerId: owner.ownerId, writersQuiesced: true }, () => { invoked = true; });
    assert.equal(invoked, true);
  } finally {
    await removeTempTree(fixture.target);
  }
});
