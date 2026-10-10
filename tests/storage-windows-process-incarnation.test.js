import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

import {
  buildWindowsProcessIncarnationScript,
  parseWindowsProcessIncarnationOutput,
  readWindowsProcessIncarnation,
  resolveWindowsPowerShellPath,
  WINDOWS_PROCESS_INCARNATION_DEFAULTS,
} from "../src/storage/windows-process-incarnation.js";

const WINDOWS_ROOT = "C:\\Windows";
const SAMPLE_TICKS = "638955840000000000";

function fakeExecFile({ stdout = "", stderr = "", error = null, onCall = null, call = null } = {}) {
  return (file, args, options, callback) => {
    onCall?.({ file, args, options });
    if (call) return call({ file, args, options, callback });
    callback(error, stdout, stderr);
    return { kill() {} };
  };
}

function observation(status = "ALIVE", pid = 321, startTimeTicks = SAMPLE_TICKS) {
  if (status === "NOT_FOUND") return JSON.stringify({ schemaVersion: 1, pid, status });
  return JSON.stringify({ schemaVersion: 1, pid, status, hasExited: status === "EXITED", startTimeTicks });
}

test("Windows process identity resolves only an absolute system PowerShell path", () => {
  assert.equal(resolveWindowsPowerShellPath({ platform: "darwin", systemRoot: WINDOWS_ROOT }), null);
  assert.equal(resolveWindowsPowerShellPath({ platform: "win32", systemRoot: WINDOWS_ROOT }), "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.equal(resolveWindowsPowerShellPath({ platform: "win32", systemRoot: "Windows" }), null);
  assert.equal(resolveWindowsPowerShellPath({ platform: "win32", systemRoot: "\\Windows" }), null);
  assert.equal(resolveWindowsPowerShellPath({ platform: "win32", systemRoot: "C:Windows" }), null);
  assert.equal(resolveWindowsPowerShellPath({ platform: "win32", systemRoot: "\\\\?\\C:\\Windows" }), null);
  assert.equal(resolveWindowsPowerShellPath({ platform: "win32", systemRoot: "C:\\Windows\\..\\Other" }), null);
  assert.equal(resolveWindowsPowerShellPath({ platform: "win32", systemRoot: "\\\\server\\share" }), null);
});

test("the encoded Windows script retains the process handle before reading kernel start time", () => {
  const script = buildWindowsProcessIncarnationScript(321);
  const retainedHandle = script.indexOf("$retainedHandle = $candidate.Handle");
  const startTime = script.indexOf("$startTimeTicks = $candidate.StartTime");
  const hasExited = script.indexOf("$hasExited = $candidate.HasExited");
  assert.ok(retainedHandle >= 0);
  assert.ok(startTime > retainedHandle);
  assert.ok(hasExited > startTime);
  assert.match(script, /\$candidate\.Dispose\(\)/u);
  assert.match(script, /GetProcessById\(\$targetPid\)/u);
  assert.doesNotMatch(script, /ProcessName|CommandLine|acquiredAt|uptime/u);
  assert.match(script, /ToUniversalTime\(\)\.Ticks\.ToString\('D', \[Globalization\.CultureInfo\]::InvariantCulture\)/u);
});

test("the transport uses a fixed encoded script, strict bounds, and shell-free execution", async () => {
  let observed;
  const result = await readWindowsProcessIncarnation(321, {
    platform: "win32",
    systemRoot: WINDOWS_ROOT,
    execFileImpl: fakeExecFile({ stdout: observation(), onCall: (call) => { observed = call; } }),
  });
  assert.deepEqual(result, {
    schemaVersion: 1,
    pid: 321,
    status: "ALIVE",
    hasExited: false,
    startTimeTicks: SAMPLE_TICKS,
  });
  assert.equal(observed.file, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.deepEqual(observed.args.slice(0, 4), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand"]);
  assert.equal(Buffer.from(observed.args[4], "base64").toString("utf16le").includes("$targetPid = 321"), true);
  assert.equal(observed.options.shell, false);
  assert.equal(observed.options.windowsHide, true);
  assert.equal(observed.options.timeout, WINDOWS_PROCESS_INCARNATION_DEFAULTS.timeoutMs);
  assert.equal(observed.options.maxBuffer, WINDOWS_PROCESS_INCARNATION_DEFAULTS.maxOutputBytes);
  assert.equal(observed.options.encoding, "utf8");
});

test("valid alive, exited, and not-found observations remain typed and preserve full tick precision", () => {
  assert.deepEqual(parseWindowsProcessIncarnationOutput(observation("ALIVE"), { pid: 321 }), {
    schemaVersion: 1,
    pid: 321,
    status: "ALIVE",
    hasExited: false,
    startTimeTicks: SAMPLE_TICKS,
  });
  assert.deepEqual(parseWindowsProcessIncarnationOutput(observation("EXITED"), { pid: 321 }), {
    schemaVersion: 1,
    pid: 321,
    status: "EXITED",
    hasExited: true,
    startTimeTicks: SAMPLE_TICKS,
  });
  assert.deepEqual(parseWindowsProcessIncarnationOutput(observation("NOT_FOUND"), { pid: 321 }), {
    schemaVersion: 1,
    pid: 321,
    status: "NOT_FOUND",
  });
  assert.equal(parseWindowsProcessIncarnationOutput(observation("ALIVE", 321, "3155378975999999999"), { pid: 321 }).startTimeTicks, "3155378975999999999");
});

test("invalid, mismatched, or extra process observations fail closed", () => {
  const invalid = [
    "",
    "[]",
    "not json",
    JSON.stringify({ schemaVersion: 2, pid: 321, status: "ALIVE", hasExited: false, startTimeTicks: SAMPLE_TICKS }),
    JSON.stringify({ schemaVersion: 1, pid: 999, status: "ALIVE", hasExited: false, startTimeTicks: SAMPLE_TICKS }),
    JSON.stringify({ schemaVersion: 1, pid: 321, status: "ALIVE", hasExited: true, startTimeTicks: SAMPLE_TICKS }),
    JSON.stringify({ schemaVersion: 1, pid: 321, status: "ALIVE", hasExited: false, startTimeTicks: 638955840000000000 }),
    JSON.stringify({ schemaVersion: 1, pid: 321, status: "ALIVE", hasExited: false, startTimeTicks: "0" }),
    JSON.stringify({ schemaVersion: 1, pid: 321, status: "ALIVE", hasExited: false, startTimeTicks: "0001" }),
    JSON.stringify({ schemaVersion: 1, pid: 321, status: "ALIVE", hasExited: false, startTimeTicks: "3155378976000000000" }),
    JSON.stringify({ schemaVersion: 1, pid: 321, status: "UNAVAILABLE" }),
    JSON.stringify({ schemaVersion: 1, pid: 321, status: "NOT_FOUND", reason: "access denied" }),
  ];
  for (const stdout of invalid) assert.equal(parseWindowsProcessIncarnationOutput(stdout, { pid: 321 }), null, stdout);
  assert.equal(parseWindowsProcessIncarnationOutput(observation(), { pid: 0 }), null);
});

test("unsupported hosts and invalid PIDs do not launch a process", async () => {
  let calls = 0;
  const execFileImpl = fakeExecFile({ onCall: () => { calls += 1; } });
  assert.equal(await readWindowsProcessIncarnation(process.pid, { platform: "darwin", systemRoot: WINDOWS_ROOT, execFileImpl }), null);
  assert.equal(await readWindowsProcessIncarnation(0, { platform: "win32", systemRoot: WINDOWS_ROOT, execFileImpl }), null);
  assert.equal(await readWindowsProcessIncarnation(-1, { platform: "win32", systemRoot: WINDOWS_ROOT, execFileImpl }), null);
  assert.equal(await readWindowsProcessIncarnation(1.5, { platform: "win32", systemRoot: WINDOWS_ROOT, execFileImpl }), null);
  assert.equal(calls, 0);
});

test("stderr, execution errors, and oversized output are unavailable rather than absence", async () => {
  const options = { platform: "win32", systemRoot: WINDOWS_ROOT };
  assert.equal(await readWindowsProcessIncarnation(321, { ...options, execFileImpl: fakeExecFile({ stdout: observation(), stderr: "Access denied" }) }), null);
  assert.equal(await readWindowsProcessIncarnation(321, { ...options, execFileImpl: fakeExecFile({ error: Object.assign(new Error("permission"), { code: "EACCES" }), stdout: observation() }) }), null);
  assert.equal(await readWindowsProcessIncarnation(321, { ...options, maxOutputBytes: 32, execFileImpl: fakeExecFile({ stdout: observation() }) }), null);
});

test("a hung query is bounded and returns unavailable", async () => {
  let killed = false;
  const result = await readWindowsProcessIncarnation(321, {
    platform: "win32",
    systemRoot: WINDOWS_ROOT,
    timeoutMs: 10,
    execFileImpl: fakeExecFile({ call: ({ callback }) => ({ kill: () => {
      killed = true;
      callback(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }), "", "");
    } }) }),
  });
  assert.equal(result, null);
  assert.equal(killed, true);
});

test("a timed-out child cannot publish a late valid identity", async () => {
  let killed = false;
  const result = await readWindowsProcessIncarnation(321, {
    platform: "win32",
    systemRoot: WINDOWS_ROOT,
    timeoutMs: 10,
    execFileImpl: fakeExecFile({ call: ({ callback }) => ({ kill: () => {
      killed = true;
      setTimeout(() => callback(null, observation(), ""), 10);
    } }) }),
  });
  assert.equal(result, null);
  assert.equal(killed, true);
});

test("real Windows observation proves stable self identity and closed-child status", { skip: process.platform !== "win32" }, async () => {
  const self = await readWindowsProcessIncarnation(process.pid);
  assert.ok(self, "Windows kernel-backed process identity is unavailable; supported Windows validation cannot proceed");
  assert.equal(self.status, "ALIVE");
  assert.equal(self.hasExited, false);
  assert.match(self.startTimeTicks, /^[1-9]\d{0,18}$/u);

  const repeated = await readWindowsProcessIncarnation(process.pid);
  assert.deepEqual(repeated, self, "the same live process must produce a stable incarnation token");

  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  let childClosed = false;
  let childSpawned = false;
  const closed = new Promise((resolve) => child.once("close", () => {
    childClosed = true;
    resolve();
  }));
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", resolve);
    });
    childSpawned = true;
    const childAlive = await readWindowsProcessIncarnation(child.pid);
    assert.ok(childAlive, "a live external child must be observable");
    assert.equal(childAlive.status, "ALIVE");
    assert.equal(childAlive.hasExited, false);

    assert.equal(child.kill(), true);
    await closed;

    const childAfterClose = await readWindowsProcessIncarnation(child.pid);
    assert.ok(childAfterClose, "closed-child observation must return a typed terminal result");
    if (childAfterClose.status === "ALIVE") {
      assert.notEqual(childAfterClose.startTimeTicks, childAlive.startTimeTicks, "an ALIVE result after close must belong to a different PID incarnation");
    } else if (childAfterClose.status === "EXITED") {
      assert.equal(childAfterClose.hasExited, true);
    } else {
      assert.equal(childAfterClose.status, "NOT_FOUND");
    }
  } finally {
    if (childSpawned && !childClosed) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
    }
  }
});
