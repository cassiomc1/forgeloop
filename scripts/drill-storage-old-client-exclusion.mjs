import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmod, chown, mkdtemp, readdir, readFile, rm, stat, symlink, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildDiagnosisProject } from "../tests/helpers/storage-fixtures.js";
import { migrateProjectStorage } from "../src/storage/migration.js";
import { resumeStorageMaintenance, withStorageMaintenance } from "../src/storage/maintenance.js";
import { inventoryLegacySource, verifyLegacySourceCapture } from "../src/storage/migration-source.js";
import { verifyPublishedMigration } from "../src/storage/migration-terminal.js";
import { executeForgeLoopCommand } from "../src/core/command-runtime.js";
import { openStorageDatabase } from "../src/storage/connection.js";

// Disposable operational drill. Never changes the supplied legacy checkout or
// an existing project. Permissions apply only to fixtures created by this run.
const PINNED_HEAD = "ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5";
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const argument = process.argv.slice(2);
assert.equal(argument.length, 1, "Usage: node scripts/drill-storage-old-client-exclusion.mjs --legacy-root=/absolute/pinned-checkout");
assert.ok(argument[0].startsWith("--legacy-root="));
const legacyRoot = path.resolve(argument[0].slice("--legacy-root=".length));
const workspace = await mkdtemp(path.join(os.tmpdir(), "forgeloop-old-client-drill-"));
await chmod(workspace, 0o755);
const legacyClient = path.join(workspace, "legacy-client");
const isolateDataIdentity = process.platform === "linux" && process.getuid() === 0;
const legacyIdentity = isolateDataIdentity ? { uid: 65534, gid: 65534 } : {};
const inheritedEnv = { ...process.env, NODE_OPTIONS: "" };
let target;
let child;
let disabled = false;
let sid;
let aclBackup;
let legacyEntryBytes;

function command(executable, args, options = {}) {
  return spawnSync(executable, args, { encoding: "utf8", timeout: 120_000, ...options });
}
function requireSuccess(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
  return result.stdout;
}
async function setDataOwner(root, uid) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const filename = path.join(root, entry.name);
    if (entry.isDirectory()) await setDataOwner(filename, uid);
    else { await chown(filename, uid, uid); await chmod(filename, 0o644); }
  }
  await chown(root, uid, uid);
  await chmod(root, 0o755);
}
function oldRun(taskId) {
  if (process.platform === "win32") {
    return command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(packageRoot, "scripts/lib/windows-old-client-token.ps1"), "-NodeExe", process.execPath,
      "-EntryPoint", path.join(legacyClient, "src/cli.js"), "-ProjectPath", target, "-TaskId", taskId],
    { cwd: legacyClient, env: inheritedEnv });
  }
  return command(process.execPath, [path.join(legacyClient, "src/cli.js"), "task-create", "--path", target, "--task", taskId, "--json"],
    { cwd: legacyClient, ...legacyIdentity, env: inheritedEnv });
}
function windowsSourceReadRefusal() {
  const probe = command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(packageRoot, "scripts/lib/windows-old-client-token.ps1"), "-NodeExe", process.execPath,
    "-EntryPoint", path.join(legacyClient, "src/cli.js"), "-ProbeRead"], { env: inheritedEnv });
  requireSuccess(probe);
  const code = JSON.parse(probe.stdout).code;
  assert.ok(["EACCES", "EPERM"].includes(code));
  return code;
}
async function assertPermissionRefusal(result) {
  assert.notEqual(result.status, 0);
  if (process.platform === "win32") {
    const entrypoint = path.join(legacyClient, "src/cli.js");
    assert.deepEqual(await readFile(entrypoint), legacyEntryBytes, "The privileged controller must prove unchanged pinned source still exists");
    const deniedRead = windowsSourceReadRefusal();
    if (result.stderr.includes(`Cannot find module '${entrypoint}'`) && /requireStack: \[\]/u.test(result.stderr)) {
      assert.match(result.stderr, /code: 'MODULE_NOT_FOUND'/u);
      return { deniedRead, sourcePresentMatchesPinned: true, maskedMainEntrypoint: true };
    }
    assert.match(`${result.stderr}\n${result.error?.code ?? ""}`, /EACCES|EPERM|permission denied|access is denied/i);
    return { deniedRead, sourcePresentMatchesPinned: true, maskedMainEntrypoint: false };
  }
  assert.match(`${result.stderr}\n${result.error?.code ?? ""}`, /EACCES|EPERM|permission denied|access is denied/i);
  return { directPermissionRefusal: true };
}
async function excludeOldClient() {
  // Permission propagation and cleanup must never cross the shared dependency
  // junction into another checkout. This installation is being retired.
  if (!isolateDataIdentity) await unlink(path.join(legacyClient, "node_modules"));
  if (isolateDataIdentity) await setDataOwner(target, 0);
  else if (process.platform === "win32") {
    sid = requireSuccess(command("powershell.exe", ["-NoProfile", "-Command", "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value"])).trim();
    assert.match(sid, /^S-1-[0-9-]+$/u);
    aclBackup = path.join(workspace, "legacy-acls.txt");
    requireSuccess(command("icacls.exe", [legacyClient, "/save", aclBackup, "/T", "/C"]));
    disabled = true;
    requireSuccess(command("icacls.exe", [legacyClient, "/deny", `*${sid}:(OI)(CI)(RX)`, "/T", "/C"]));
  } else await chmod(legacyClient, 0o000);
  disabled = true;
  if (process.platform === "win32") {
    windowsSourceReadRefusal();
  } else if (!isolateDataIdentity) {
    await assert.rejects(readFile(path.join(legacyClient, "src/cli.js")),
      error => ["EACCES", "EPERM"].includes(error.code), "Old source must be denied, not merely missing its dependencies");
  }
}
async function restoreFixtureAccess() {
  if (!disabled || isolateDataIdentity) return;
  if (process.platform === "win32") requireSuccess(command("icacls.exe", [workspace, "/restore", aclBackup, "/C"]));
  else await chmod(legacyClient, 0o755);
  disabled = false;
}

try {
  requireSuccess(command("git", ["clone", "--no-hardlinks", legacyRoot, legacyClient]));
  assert.equal(requireSuccess(command("git", ["rev-parse", "HEAD"], { cwd: legacyClient })).trim(), PINNED_HEAD);
  legacyEntryBytes = await readFile(path.join(legacyClient, "src/cli.js"));
  await symlink(path.join(packageRoot, "node_modules"), path.join(legacyClient, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  target = await buildDiagnosisProject({ legacy: true, packageRoot });
  if (isolateDataIdentity) await setDataOwner(target, 65534);
  const before = oldRun("old-before-cutover");
  requireSuccess(before);
  const initialInventory = await inventoryLegacySource(target);
  const lockModule = pathToFileURL(path.join(legacyClient, "src/core/task-lock.js")).href;
  child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { acquireProjectClaimsLock } from ${JSON.stringify(lockModule)};
    const lock = await acquireProjectClaimsLock(${JSON.stringify(target)}, "old-client-exclusion-drill");
    process.send({ ready: true, pid: process.pid });
    process.on("message", async message => { if (message === "stop") { await lock.release(); process.exit(0); } });
  `], { cwd: legacyClient, ...legacyIdentity, env: inheritedEnv, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const readyController = new AbortController();
  const readyTimer = setTimeout(() => readyController.abort(), 30_000);
  try {
    const [ready] = await once(child, "message", { signal: readyController.signal });
    assert.equal(ready.ready, true);
    process.kill(child.pid, 0);
  } finally { clearTimeout(readyTimer); }
  await assert.rejects(migrateProjectStorage(target, { destination: "retained", packageRoot }), { code: "E_CLI_INVOCATION_INVALID" });
  const migrationModule = pathToFileURL(path.join(packageRoot, "src/storage/migration.js")).href;
  const busy = command(process.execPath, ["--input-type=module", "-e", `
    import { migrateProjectStorage } from ${JSON.stringify(migrationModule)};
    try { await migrateProjectStorage(${JSON.stringify(target)}, { destination: "busy-attempt", packageRoot: ${JSON.stringify(packageRoot)}, writersQuiesced: true }); process.exit(2); }
    catch (error) { console.log(JSON.stringify({ code: error.code })); process.exit(1); }
  `]);
  assert.equal(busy.status, 1, busy.stderr);
  assert.equal(JSON.parse(busy.stdout).code, "E_STORAGE_MIGRATION_BUSY");
  const exited = once(child, "exit");
  child.send("stop");
  const [exitCode, signal] = await exited;
  assert.equal(exitCode, 0);
  assert.equal(signal, null);
  assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
  const owner = JSON.parse(await readFile(path.join(target, ".forgeloop/.storage-maintenance/owner.json"), "utf8"));
  assert.throws(() => process.kill(owner.pid, 0), { code: "ESRCH" });
  await excludeOldClient();
  const deniedBefore = oldRun("old-after-stop");
  const beforeProof = await assertPermissionRefusal(deniedBefore);
  const migrated = await resumeStorageMaintenance(target, { expectedOwnerId: owner.ownerId, writersQuiesced: true },
    () => migrateProjectStorage(target, { destination: "retained", packageRoot, writersQuiesced: true }));
  assert.equal(migrated.phase, "PUBLISHED");
  assert.equal(migrated.currentStateVerified, true);
  assert.deepEqual((await verifyLegacySourceCapture(target, "retained")).manifest.files, initialInventory);
  await assert.rejects(stat(path.join(target, ".forgeloop/task-state")), { code: "ENOENT" });
  const deniedAfter = oldRun("old-after-cutover");
  const afterProof = await assertPermissionRefusal(deniedAfter);
  const created = await executeForgeLoopCommand({ command: "task-create", projectPath: target, input: { taskId: "native-after-cutover", claims: [] } });
  assert.equal(created.ok, true, JSON.stringify(created));
  const db = openStorageDatabase(path.join(target, ".forgeloop/state.sqlite"), { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE task_id=?").get("old-after-cutover").n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE task_id=?").get("native-after-cutover").n, 1);
  } finally { db.close(); }
  const terminal = await withStorageMaintenance(target, () => verifyPublishedMigration(target, "retained", { writersQuiesced: true, packageRoot }));
  assert.equal(terminal.currentStateVerified, true);
  assert.equal(terminal.taskCount, 3);
  await assert.rejects(stat(path.join(target, ".forgeloop/task-state")), { code: "ENOENT" });
  assert.deepEqual((await verifyLegacySourceCapture(target, "retained")).manifest.files, initialInventory);
  console.log(JSON.stringify({ status: "PASS", platform: process.platform, runtime: process.version, pinnedLegacyHead: PINNED_HEAD,
    strategy: isolateDataIdentity ? "separate-data-owner" : "disabled-legacy-installation", legacyIdentity: isolateDataIdentity ? 65534 : sid ?? process.getuid(),
    removedOldClientPrivileges: process.platform === "win32" ? ["SeBackupPrivilege", "SeRestorePrivilege"] : [],
    oldPreCutover: JSON.parse(before.stdout), oldLock: { pid: child.pid, stoppedExit: exitCode, signal },
    migrationWithoutQuiescence: "REFUSED", actualLegacyLock: "REFUSED_BUSY", deadMaintenanceOwner: { pid: owner.pid, ownerId: owner.ownerId },
    oldAfterStop: { exit: deniedBefore.status, error: deniedBefore.stderr, processError: deniedBefore.error?.code, proof: beforeProof },
    oldAfterCutover: { exit: deniedAfter.status, error: deniedAfter.stderr, processError: deniedAfter.error?.code, proof: afterProof },
    migration: migrated, terminalAfterNewWrite: terminal, sourceFiles: initialInventory, backupPreserved: true, nativeNewWrite: true, oldLayoutAbsent: true,
    limits: "Excludes only the inventoried identity/installation in this disposable fixture. Privileged permission changes and other installations are outside this proof. Production requires all launch sources inventoried, stopped and excluded before asserting writers-quiesced." }));
} finally {
  if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
  await restoreFixtureAccess();
  if (target) await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
