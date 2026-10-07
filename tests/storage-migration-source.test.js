import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdir, open, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildDiagnosisProject } from "./helpers/storage-fixtures.js";
import { captureLegacySource, inventoryLegacySource, resumeLegacySourceCapture, verifyLegacySourceCapture } from "../src/storage/migration-source.js";
import { importProjectState } from "../src/storage/importer.js";
import { resumeStorageMaintenance, withStorageMaintenance } from "../src/storage/maintenance.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { acquireTaskLock, acquireProjectClaimsLock } from "../src/core/task-lock.js";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { getPackageRoot } from "../src/core/templates.js";
import { STORAGE_CATALOG_LIMITS } from "../src/storage/metadata-json.js";
import { LEGACY_TASK_ARTIFACT_PATHS } from "../src/core/task-paths.js";

test("namespace import refuses every unconverted singleton task artifact without allocating or discarding source", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    const baseline = await inventoryLegacySource(target);
    for (const [kind, relativePath] of Object.entries(LEGACY_TASK_ARTIFACT_PATHS)) {
      if (kind === "session") continue;
      const source = path.join(target, relativePath);
      if (["gates", "executions"].includes(kind)) {
        await mkdir(source);
        await writeFile(path.join(source, "retained.bin"), "unconverted singleton evidence");
      } else await writeFile(source, "unconverted singleton evidence");
      const before = await inventoryLegacySource(target);
      const databasePath = path.join(target, `candidate-${kind}.sqlite`);
      await assert.rejects(importProjectState(target, databasePath), { code: "E_STORAGE_IMPORT_SINGLETON_UNSUPPORTED" });
      await assert.rejects(stat(databasePath), { code: "ENOENT" });
      assert.deepEqual(await inventoryLegacySource(target), before);
      await rm(source, { recursive: true });
      assert.deepEqual(await inventoryLegacySource(target), baseline);
    }
  } finally { await removeTempTree(target); }
});

test("capture verification rejects oversized and invalid UTF-8 manifests without altering retained source", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    const captured = await captureLegacySource(target, "retained", { writersQuiesced: true });
    const manifestPath = path.join(captured.path, "source-manifest.json");
    const original = await readFile(manifestPath);
    const before = await inventoryLegacySource(captured.source);
    const file = await open(manifestPath, "r+");
    try { await file.truncate(STORAGE_CATALOG_LIMITS.maxBytes + 1); } finally { await file.close(); }
    await assert.rejects(verifyLegacySourceCapture(target, "retained"), { code: "E_STORAGE_MIGRATION_CAPTURE_INVALID" });
    assert.equal((await stat(manifestPath)).size, STORAGE_CATALOG_LIMITS.maxBytes + 1);
    assert.deepEqual(await inventoryLegacySource(captured.source), before);
    await writeFile(manifestPath, Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]));
    await assert.rejects(verifyLegacySourceCapture(target, "retained"), { code: "E_STORAGE_MIGRATION_CAPTURE_INVALID" });
    await writeFile(manifestPath, original);
    assert.equal((await verifyLegacySourceCapture(target, "retained")).manifest.status, "CAPTURED");
  } finally { await removeTempTree(target); }
});

test("retained source capture preserves operational and raw attachment bytes and reimports", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    const attachments = path.join(target, ".forgeloop/attachments");
    await mkdir(attachments);
    const bytes = Buffer.from([0, 255, 128, 13, 10]);
    await writeFile(path.join(attachments, "raw.bin"), bytes);
    const before = await inventoryLegacySource(target);
    const destination = ".forgeloop/storage-migrations/nested/retained";
    const captured = await captureLegacySource(target, destination, { writersQuiesced: true });
    assert.equal(captured.manifest.status, "CAPTURED");
    assert.deepEqual(captured.manifest.files, before);
    assert.deepEqual(await inventoryLegacySource(target), before);
    assert.deepEqual(await readFile(path.join(captured.source, ".forgeloop/attachments/raw.bin")), bytes);
    assert.deepEqual((await verifyLegacySourceCapture(target, destination)).manifest.files, before);
    const imported = await importProjectState(captured.source, path.join(target, "candidate.sqlite"));
    try { assert.equal(imported.report.totals.tasks, 1); }
    finally { imported.db.close(); }
    await assert.rejects(captureLegacySource(target, destination, { writersQuiesced: true }), { code: "EEXIST" });
    await writeFile(path.join(captured.source, ".forgeloop/attachments/raw.bin"), "tampered");
    await assert.rejects(verifyLegacySourceCapture(target, destination), { code: "E_STORAGE_MIGRATION_CAPTURE_INVALID" });
  } finally { await removeTempTree(target); }
});

test("capture leaves filesystem-owned policy identity intact without treating it as a writer lock", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    const filename = ".forgeloop/policy/policy.lock";
    await mkdir(path.dirname(path.join(target, filename)), { recursive: true });
    const bytes = JSON.stringify({ schemaVersion: 1, digest: "sha256:fixture-policy-identity" });
    await writeFile(path.join(target, filename), bytes);
    const captured = await captureLegacySource(target, "retained", { writersQuiesced: true });
    assert.equal(captured.manifest.files.some(file => file.path === filename), false);
    assert.equal(await readFile(path.join(target, filename), "utf8"), bytes);
    assert.equal((await verifyLegacySourceCapture(target, "retained")).manifest.status, "CAPTURED");
  } finally { await removeTempTree(target); }
});

test("capture requires explicit writer quiescence and refuses retained task locks", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    await assert.rejects(captureLegacySource(target, "retained"), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
    await mkdir(path.join(target, ".forgeloop/locks"), { recursive: true });
    await writeFile(path.join(target, ".forgeloop/locks/owner.lock"), "{}");
    await assert.rejects(captureLegacySource(target, "retained", { writersQuiesced: true }), { code: "E_STORAGE_MIGRATION_BUSY" });
  } finally { await removeTempTree(target); }
});

test("capture rejects incomplete transactions, source overlap and symlinks", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    await assert.rejects(captureLegacySource(target, ".forgeloop/task-state/capture", { writersQuiesced: true }), { code: "E_STORAGE_MIGRATION_DESTINATION_INVALID" });
    await mkdir(path.join(target, ".forgeloop/.txn/incomplete"), { recursive: true });
    await writeFile(path.join(target, ".forgeloop/.txn/incomplete/manifest.json"), JSON.stringify({ status: "PREPARING" }));
    await assert.rejects(captureLegacySource(target, "retained", { writersQuiesced: true }), { code: "E_STORAGE_MIGRATION_SOURCE_INVALID" });
    await rm(path.join(target, ".forgeloop/.txn/incomplete"), { recursive: true });
    await symlink(path.join(target, "outside"), path.join(target, ".forgeloop/task-state/linked"));
    await assert.rejects(captureLegacySource(target, "retained", { writersQuiesced: true }), /symlink/iu);
  } finally { await removeTempTree(target); }
});

test("capture verification refuses incomplete manifests and changed membership", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    const captured = await captureLegacySource(target, "retained", { writersQuiesced: true });
    const manifestPath = path.join(captured.path, "source-manifest.json");
    await writeFile(manifestPath, JSON.stringify({ ...captured.manifest, status: "CAPTURING" }));
    await assert.rejects(verifyLegacySourceCapture(target, "retained"), { code: "E_STORAGE_MIGRATION_CAPTURE_INVALID" });
    await writeFile(manifestPath, JSON.stringify(captured.manifest));
    await writeFile(path.join(captured.source, ".forgeloop/session.json"), "{}");
    await assert.rejects(verifyLegacySourceCapture(target, "retained"), { code: "E_STORAGE_MIGRATION_CAPTURE_INVALID" });
    await writeFile(path.join(target, ".forgeloop/state.sqlite"), "not a legacy project");
    await assert.rejects(captureLegacySource(target, "second", { writersQuiesced: true }), { code: "E_STORAGE_MIGRATION_SOURCE_INVALID" });
  } finally { await removeTempTree(target); }
});

test("source capture preserves empty directories and rejects directory-membership tampering", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    const empty = ".forgeloop/task-state/0000000000000000000000000000000000000000000000000000000000000000";
    await mkdir(path.join(target, empty));
    const captured = await captureLegacySource(target, "retained", { writersQuiesced: true });
    assert.equal(captured.manifest.schemaVersion, 2);
    assert.ok(captured.manifest.directories.includes(empty));
    await verifyLegacySourceCapture(target, "retained");
    await mkdir(path.join(captured.source, ".forgeloop/task-state/unexpected-empty"));
    await assert.rejects(verifyLegacySourceCapture(target, "retained"), { code: "E_STORAGE_MIGRATION_CAPTURE_INVALID" });
  } finally { await removeTempTree(target); }
});

test("maintenance excludes public commands, lock acquisition and independent CLI processes", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    await withStorageMaintenance(target, async () => {
      const result = await executeForgeLoopCommand({ command: "task-list", projectPath: target, input: {} });
      assert.equal(result.error.code, "E_STORAGE_MAINTENANCE_IN_PROGRESS");
      const status = await executeForgeLoopCommand({ command: "storage-migration-status", projectPath: target, input: {} });
      assert.equal(status.ok, true);
      assert.equal(status.result.maintenance.status, "RETAINED");
      assert.equal(status.result.maintenance.ownerLiveness, "NOT_VERIFIED");
      const cliStatus = await promisify(execFile)(process.execPath, [path.join(getPackageRoot(), "src/cli.js"), "storage-migration-status", "--path", target, "--json"]);
      assert.equal(JSON.parse(cliStatus.stdout).maintenance.owner.ownerId, status.result.maintenance.owner.ownerId);
      await assert.rejects(acquireTaskLock(target, "must-not-write"), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
      await assert.rejects(acquireProjectClaimsLock(target), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
      await assert.rejects(promisify(execFile)(process.execPath, [path.join(getPackageRoot(), "src/cli.js"), "task-list", "--path", target, "--json"]), error =>
        `${error.stdout}${error.stderr}`.includes("E_STORAGE_MAINTENANCE_IN_PROGRESS"));
      // Nested maintenance work joins this exact owner; no second exclusion.
      const captured = await captureLegacySource(target, "retained", { writersQuiesced: true });
      assert.equal(captured.manifest.status, "CAPTURED");
    });
    const result = await executeForgeLoopCommand({ command: "task-list", projectPath: target, input: {} });
    assert.equal(result.ok, true);
    await mkdir(path.join(target, ".forgeloop/.storage-maintenance"));
    await assert.rejects(withStorageMaintenance(target, () => assert.fail("must not run")), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
  } finally { await removeTempTree(target); }
});

test("public migration status reports incomplete or malformed bootstrap state without opening a database", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    const marker = path.join(target, ".forgeloop/.storage-maintenance");
    await mkdir(marker);
    const status = () => executeForgeLoopCommand({ command: "storage-migration-status", projectPath: target, input: {} });
    assert.equal((await status()).result.maintenance.status, "INCOMPLETE");
    for (const bytes of ["not JSON", "null", "[]", JSON.stringify({ schemaVersion: 2 }), "x".repeat(70000)]) {
      await writeFile(path.join(marker, "owner.json"), bytes);
      assert.equal((await status()).result.maintenance.status, "MALFORMED");
    }
    await rm(marker, { recursive: true });
    await writeFile(marker, "not a directory");
    assert.equal((await status()).result.maintenance.status, "MALFORMED");
    await rm(marker);
    const database = path.join(target, ".forgeloop/state.sqlite");
    const bytes = Buffer.from("an invalid database that status must not open");
    await writeFile(database, bytes);
    const mixed = await status();
    assert.equal(mixed.result.layout, "MIXED");
    assert.equal(mixed.result.databaseValidation, "NOT_RUN");
    assert.deepEqual(await readFile(database), bytes);
    await rm(path.join(target, ".forgeloop/task-state"), { recursive: true });
    await rm(path.join(target, ".forgeloop/.txn"), { recursive: true, force: true });
    assert.equal((await status()).result.layout, "SQLITE_PRESENT");
  } finally { await removeTempTree(target); }
});

test("closed maintenance context cannot reopen an expired exclusion", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    let resume;
    let continuation;
    await withStorageMaintenance(target, () => {
      continuation = new Promise(resolve => { resume = resolve; }).then(() =>
        withStorageMaintenance(target, () => assert.fail("expired callback must not run")));
    });
    resume();
    await assert.rejects(continuation, { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
  } finally { await removeTempTree(target); }
});

test("a killed maintenance owner leaves exclusion for explicit recovery", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  let child;
  try {
    const moduleUrl = new URL("../src/storage/maintenance.js", import.meta.url).href;
    child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { withStorageMaintenance } from ${JSON.stringify(moduleUrl)};
      await withStorageMaintenance(${JSON.stringify(target)}, async () => {
        process.stdout.write('READY\\n');
        await new Promise(() => setInterval(() => {}, 1000));
      });
    `], { stdio: ["ignore", "pipe", "pipe"] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Maintenance child did not become ready")), 10000);
      child.stdout.on("data", bytes => { if (bytes.toString().includes("READY")) { clearTimeout(timer); resolve(); } });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Maintenance child exited before readiness")); });
    });
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const owner = JSON.parse(await readFile(path.join(target, ".forgeloop/.storage-maintenance/owner.json"), "utf8"));
    assert.equal(owner.pid, child.pid);
    await assert.rejects(withStorageMaintenance(target, () => assert.fail("dead owners require explicit recovery")), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
    const result = await executeForgeLoopCommand({ command: "task-list", projectPath: target, input: {} });
    assert.equal(result.error.code, "E_STORAGE_MAINTENANCE_IN_PROGRESS");
    const ownerPath = path.join(target, ".forgeloop/.storage-maintenance/owner.json");
    const originalBytes = await readFile(ownerPath);
    await assert.rejects(resumeStorageMaintenance(target, { expectedOwnerId: owner.ownerId }, () => assert.fail()), { code: "E_STORAGE_MIGRATION_QUIESCENCE_REQUIRED" });
    await assert.rejects(resumeStorageMaintenance(target, { expectedOwnerId: "00000000-0000-0000-0000-000000000000", writersQuiesced: true }, () => assert.fail()), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
    await writeFile(ownerPath, JSON.stringify({ ...owner, hostname: "untrusted-remote-host" }));
    await assert.rejects(resumeStorageMaintenance(target, { expectedOwnerId: owner.ownerId, writersQuiesced: true }, () => assert.fail()), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
    await writeFile(ownerPath, originalBytes);
    const handoffPath = path.join(target, ".forgeloop/.storage-maintenance/handoff");
    await mkdir(handoffPath);
    const interruptedHandoff = await executeForgeLoopCommand({ command: "storage-migration-status", projectPath: target, input: {} });
    assert.equal(interruptedHandoff.result.maintenance.handoffPresent, true);
    await assert.rejects(resumeStorageMaintenance(target, { expectedOwnerId: owner.ownerId, writersQuiesced: true }, () => assert.fail()), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
    assert.deepEqual(await readFile(ownerPath), originalBytes);
    await rm(handoffPath, { recursive: true });
    const historyRoot = path.join(target, ".forgeloop/storage-maintenance-history");
    await mkdir(historyRoot);
    const historyPath = path.join(historyRoot, `${owner.ownerId}.json`);
    const conflictingHistory = JSON.stringify({ ...owner, acquiredAt: "2000-01-01T00:00:00.000Z" });
    await writeFile(historyPath, conflictingHistory);
    await assert.rejects(resumeStorageMaintenance(target, { expectedOwnerId: owner.ownerId, writersQuiesced: true }, () => assert.fail()), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
    assert.deepEqual(await readFile(ownerPath), originalBytes);
    assert.equal(await readFile(historyPath, "utf8"), conflictingHistory);
    // A matching retained archive is a resumable checkpoint; never replace it.
    await writeFile(historyPath, originalBytes);
    await resumeStorageMaintenance(target, { expectedOwnerId: owner.ownerId, writersQuiesced: true }, async () => {
      const resumedOwner = JSON.parse(await readFile(ownerPath, "utf8"));
      assert.notEqual(resumedOwner.ownerId, owner.ownerId);
      assert.equal(resumedOwner.resumedFrom, owner.ownerId);
      const blocked = await executeForgeLoopCommand({ command: "task-list", projectPath: target, input: {} });
      assert.equal(blocked.error.code, "E_STORAGE_MAINTENANCE_IN_PROGRESS");
      const captured = await captureLegacySource(target, "resumed-capture", { writersQuiesced: true });
      assert.equal(captured.manifest.status, "CAPTURED");
    });
    assert.deepEqual(await readFile(path.join(target, `.forgeloop/storage-maintenance-history/${owner.ownerId}.json`)), originalBytes);
    assert.equal((await executeForgeLoopCommand({ command: "task-list", projectPath: target, input: {} })).ok, true);
  } finally { child?.kill("SIGKILL"); await removeTempTree(target); }
});

test("live maintenance ownership cannot be adopted and failed recovery work retains exclusion", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    await withStorageMaintenance(target, async () => {
      const owner = JSON.parse(await readFile(path.join(target, ".forgeloop/.storage-maintenance/owner.json"), "utf8"));
      await assert.rejects(resumeStorageMaintenance(target, { expectedOwnerId: owner.ownerId, writersQuiesced: true }, () => assert.fail()), { code: "E_STORAGE_MAINTENANCE_IN_PROGRESS" });
    });
    await assert.rejects(withStorageMaintenance(target, () => { throw new Error("interrupted recovery work"); }, { retainOnError: true }), /interrupted recovery/u);
    const status = await executeForgeLoopCommand({ command: "storage-migration-status", projectPath: target, input: {} });
    assert.equal(status.result.maintenance.status, "RETAINED");
    const normal = await executeForgeLoopCommand({ command: "task-list", projectPath: target, input: {} });
    assert.equal(normal.error.code, "E_STORAGE_MAINTENANCE_IN_PROGRESS");
  } finally { await removeTempTree(target); }
});

test("capture recovery refuses changed originals and unrecorded partial entries without altering evidence", async () => {
  const target = await buildDiagnosisProject({ legacy: true });
  try {
    const captured = await captureLegacySource(target, "retained", { writersQuiesced: true });
    const manifestPath = path.join(captured.path, "source-manifest.json");
    captured.manifest.status = "CAPTURING";
    await writeFile(manifestPath, JSON.stringify(captured.manifest));
    const recorded = await readFile(manifestPath);
    const ledger = captured.manifest.files.find(file => file.path.includes("/task-state/") && file.path.endsWith("/events.ndjson"));
    assert.ok(ledger);
    const originalPath = path.join(target, ledger.path);
    const original = await readFile(originalPath);
    await writeFile(originalPath, "changed source");
    const resume = () => withStorageMaintenance(target, () => resumeLegacySourceCapture(target, "retained", { writersQuiesced: true }));
    await assert.rejects(resume(), { code: "E_STORAGE_MIGRATION_SOURCE_CHANGED" });
    assert.deepEqual(await readFile(manifestPath), recorded);
    await writeFile(originalPath, original);
    const unexpected = path.join(captured.source, ".forgeloop/unrecorded-file");
    await writeFile(unexpected, "unrecorded bytes");
    await assert.rejects(resume(), { code: "E_STORAGE_MIGRATION_CAPTURE_INVALID" });
    assert.equal(await readFile(unexpected, "utf8"), "unrecorded bytes");
    assert.deepEqual(await readFile(manifestPath), recorded);
    await assert.rejects(readFile(path.join(captured.path, "source-history")), { code: "ENOENT" });
  } finally { await removeTempTree(target); }
});
