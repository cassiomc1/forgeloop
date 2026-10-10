import { execFile as nodeExecFile } from "node:child_process";
import path from "node:path";

export const WINDOWS_PROCESS_INCARNATION_SCHEMA_VERSION = 1;
export const WINDOWS_PROCESS_INCARNATION_KIND = "windows-process-start-time-ticks-v1";
export const WINDOWS_PROCESS_INCARNATION_DEFAULTS = Object.freeze({
  timeoutMs: 5_000,
  maxOutputBytes: 16 * 1024,
});

const MAX_TIMEOUT_MS = WINDOWS_PROCESS_INCARNATION_DEFAULTS.timeoutMs;
const MAX_OUTPUT_BYTES = WINDOWS_PROCESS_INCARNATION_DEFAULTS.maxOutputBytes;
const MAX_PROCESS_ID = 2_147_483_647;
const MAX_DATETIME_TICKS = 3_155_378_975_999_999_999n;
const PROCESS_STATUSES = new Set(["ALIVE", "EXITED", "NOT_FOUND"]);

function boundedPositiveInteger(value, fallback, maximum) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}

function assertProcessId(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > MAX_PROCESS_ID) {
    throw new TypeError("Windows process identity requires a positive 32-bit process ID");
  }
}

/**
 * Resolve only the conventional absolute system PowerShell path. This is a
 * path constraint, not a signer or host attestation; unsupported/untrusted
 * host configuration must remain unavailable to the caller.
 */
export function resolveWindowsPowerShellPath({ platform = process.platform, systemRoot = process.env.SystemRoot } = {}) {
  if (platform !== "win32" || typeof systemRoot !== "string" || systemRoot.length === 0 || systemRoot.includes("\0")) return null;
  // A SystemRoot value must name a fully qualified local drive path. Windows
  // also treats `\\Windows` as absolute, but that form is current-drive
  // relative and must not select an arbitrary host path. Device prefixes,
  // UNC paths, and drive-relative values are rejected by this check.
  if (!/^[A-Za-z]:[\\/]/u.test(systemRoot)) return null;
  if (/(^|[\\/])\.\.([\\/]|$)/u.test(systemRoot)) return null;
  const normalizedRoot = path.win32.normalize(systemRoot);
  if (!/^[A-Za-z]:\\/u.test(normalizedRoot) || !path.win32.isAbsolute(normalizedRoot) || normalizedRoot.startsWith("\\\\")) return null;
  return path.win32.join(normalizedRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/**
 * The script has one authority-bearing operation: StartTime, read while the
 * Process object retains its kernel handle. Names and command lines are never
 * queried. The PID is validated before it is embedded as a numeric literal.
 */
export function buildWindowsProcessIncarnationScript(pid) {
  assertProcessId(pid);
  return [
    "$ErrorActionPreference = 'Stop'",
    "$WarningPreference = 'Stop'",
    "$InformationPreference = 'SilentlyContinue'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$VerbosePreference = 'SilentlyContinue'",
    "$DebugPreference = 'SilentlyContinue'",
    `$targetPid = ${pid}`,
    "$result = $null",
    "try {",
    "  $candidate = $null",
    "  try { $candidate = [System.Diagnostics.Process]::GetProcessById($targetPid) } catch {",
    "    $lookupException = $_.Exception",
    "    while ($lookupException -is [System.Management.Automation.MethodInvocationException] -and $null -ne $lookupException.InnerException) { $lookupException = $lookupException.InnerException }",
    "    if ($lookupException -is [System.ArgumentException]) { $result = [ordered]@{ schemaVersion = 1; pid = $targetPid; status = 'NOT_FOUND' } } else { $result = [ordered]@{ schemaVersion = 1; pid = $targetPid; status = 'UNAVAILABLE' } }",
    "  }",
    "  if ($null -ne $candidate) {",
    "    try {",
    "      $retainedHandle = $candidate.Handle",
    "      if ($retainedHandle -eq [IntPtr]::Zero) { throw [System.InvalidOperationException]::new('Process handle unavailable') }",
    "      $startTimeTicks = $candidate.StartTime.ToUniversalTime().Ticks.ToString('D', [Globalization.CultureInfo]::InvariantCulture)",
    "      $hasExited = $candidate.HasExited",
    "      $status = 'ALIVE'",
    "      if ($hasExited) { $status = 'EXITED' }",
    "      $result = [ordered]@{ schemaVersion = 1; pid = $targetPid; status = $status; hasExited = $hasExited; startTimeTicks = $startTimeTicks }",
    "    } catch {",
    "      $result = [ordered]@{ schemaVersion = 1; pid = $targetPid; status = 'UNAVAILABLE' }",
    "    } finally {",
    "      $candidate.Dispose()",
    "    }",
    "  }",
    "} catch { $result = [ordered]@{ schemaVersion = 1; pid = $targetPid; status = 'UNAVAILABLE' } }",
    "[Console]::Out.Write(($result | ConvertTo-Json -Compress -Depth 2))",
  ].join("\n");
}

function encodeWindowsProcessIncarnationScript(pid) {
  return Buffer.from(buildWindowsProcessIncarnationScript(pid), "utf16le").toString("base64");
}

function windowsProcessIncarnationArgs(pid) {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    encodeWindowsProcessIncarnationScript(pid),
  ];
}

function exactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validTicks(value) {
  if (typeof value !== "string" || !/^[1-9]\d{0,18}$/u.test(value)) return false;
  try { return BigInt(value) <= MAX_DATETIME_TICKS; } catch { return false; }
}

/** Parse only the small, authority-bearing JSON envelope emitted by the fixed script. */
export function parseWindowsProcessIncarnationOutput(stdout, { pid, maxOutputBytes = MAX_OUTPUT_BYTES } = {}) {
  try { assertProcessId(pid); } catch { return null; }
  const outputLimit = boundedPositiveInteger(maxOutputBytes, MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES);
  if (typeof stdout !== "string" || Buffer.byteLength(stdout, "utf8") > outputLimit) return null;
  const text = stdout.trim();
  if (text.length === 0) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.schemaVersion !== WINDOWS_PROCESS_INCARNATION_SCHEMA_VERSION
    || value.pid !== pid || typeof value.status !== "string" || !PROCESS_STATUSES.has(value.status)) return null;
  if (value.status === "NOT_FOUND") {
    return exactKeys(value, ["pid", "schemaVersion", "status"]) ? Object.freeze({
      schemaVersion: value.schemaVersion,
      pid: value.pid,
      status: value.status,
    }) : null;
  }
  if (!exactKeys(value, ["hasExited", "pid", "schemaVersion", "startTimeTicks", "status"])
    || typeof value.hasExited !== "boolean"
    || value.hasExited !== (value.status === "EXITED")
    || !validTicks(value.startTimeTicks)) return null;
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    pid: value.pid,
    status: value.status,
    hasExited: value.hasExited,
    startTimeTicks: value.startTimeTicks,
  });
}

function invokeExecFile(execFileImpl, file, args, options, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    let timedOut = false;
    const finish = (result) => {
      clearTimeout(timer);
      resolve(timedOut
        ? { error: Object.assign(new Error("Windows process identity query timed out"), { code: "ETIMEDOUT" }), stdout: "", stderr: "" }
        : result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try { child?.kill?.(); } catch { /* process may already be gone */ }
      // The child_process implementation invokes the callback after the
      // killed child closes. Do not resolve before that close is observed.
    }, timeoutMs);
    try {
      child = execFileImpl(file, args, options, (error, stdout, stderr) => finish({ error, stdout: stdout ?? "", stderr: stderr ?? "" }));
    } catch (error) {
      finish({ error, stdout: "", stderr: "" });
    }
  });
}

/**
 * Return a kernel-backed Windows process observation, or null when the host
 * cannot provide one. This helper is intentionally not wired into admission;
 * callers must keep legacy schema-v1 ESRCH handling separate.
 */
export async function readWindowsProcessIncarnation(pid, {
  platform = process.platform,
  systemRoot = process.env.SystemRoot,
  execFileImpl = nodeExecFile,
  timeoutMs = WINDOWS_PROCESS_INCARNATION_DEFAULTS.timeoutMs,
  maxOutputBytes = WINDOWS_PROCESS_INCARNATION_DEFAULTS.maxOutputBytes,
} = {}) {
  try { assertProcessId(pid); } catch { return null; }
  const executable = resolveWindowsPowerShellPath({ platform, systemRoot });
  if (!executable) return null;
  const boundedTimeoutMs = boundedPositiveInteger(timeoutMs, WINDOWS_PROCESS_INCARNATION_DEFAULTS.timeoutMs, MAX_TIMEOUT_MS);
  const boundedOutputBytes = boundedPositiveInteger(maxOutputBytes, WINDOWS_PROCESS_INCARNATION_DEFAULTS.maxOutputBytes, MAX_OUTPUT_BYTES);
  const result = await invokeExecFile(execFileImpl, executable, windowsProcessIncarnationArgs(pid), {
    shell: false,
    windowsHide: true,
    timeout: boundedTimeoutMs,
    maxBuffer: boundedOutputBytes,
    encoding: "utf8",
  }, boundedTimeoutMs);
  if (result.error || typeof result.stderr !== "string" || result.stderr.length !== 0) return null;
  return parseWindowsProcessIncarnationOutput(result.stdout, { pid, maxOutputBytes: boundedOutputBytes });
}
