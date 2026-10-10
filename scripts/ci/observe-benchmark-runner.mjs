import { createHash } from "node:crypto";
import { mkdir, readFile, readlink, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_BENCHMARK_TEMP_PREFIX = "forgeloop-mcp-benchmark-";
const SCHEMA_VERSION = 1;
const NODE_NAME = /^(?:node|nodejs)(?:\.exe)?$/iu;
const WORKER_MARKER = "storage-mcp-benchmark-worker.mjs";
const BENCHMARK_MARKER = "benchmark-storage-mcp.mjs";

const failure = (code, message = code) => Object.assign(new Error(message), { code });
const absolute = (value, name) => {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw failure("E_ABSOLUTE_PATH_REQUIRED", `${name} must be absolute`);
  return value;
};
const sha256 = value => createHash("sha256").update(value).digest("hex");
const pidOf = name => /^\d+$/u.test(name) && Number.isSafeInteger(Number(name)) && Number(name) > 0 ? Number(name) : null;
const argvOf = bytes => bytes.toString("utf8").split("\0").filter(Boolean);
const nodeExecutable = (name, argv) => NODE_NAME.test(name) || NODE_NAME.test(path.basename(argv[0] ?? ""));

function validatePrefix(prefix) {
  if (typeof prefix !== "string" || !prefix || !/^[A-Za-z0-9._-]+$/u.test(prefix)) throw failure("E_TEMP_PREFIX_INVALID");
  return prefix;
}

async function readProcessRecord(procRoot, pid) {
  const directory = path.join(procRoot, String(pid));
  let cmdline;
  let status;
  try {
    [cmdline, status] = await Promise.all([
      readFile(path.join(directory, "cmdline")),
      readFile(path.join(directory, "status"), "utf8"),
    ]);
  } catch (error) {
    return error.code === "ENOENT" ? { gone: true } : { unreadable: { pid, code: error.code ?? error.name } };
  }
  const parent = Number(status.match(/^PPid:\s+(\d+)$/mu)?.[1]);
  if (!Number.isSafeInteger(parent)) return { unreadable: { pid, code: "PPID_UNAVAILABLE" } };
  const argv = argvOf(cmdline);
  let executablePath = "";
  try { executablePath = await readlink(path.join(directory, "exe")); } catch (error) {
    if (error.code !== "ENOENT") return { unreadable: { pid, code: error.code ?? error.name } };
  }
  const executable = path.basename(executablePath || argv[0] || "unknown") || "unknown";
  const node = nodeExecutable(executable, argv);
  const command = cmdline.toString("utf8");
  return {
    record: {
      pid,
      parentPid: parent,
      executable,
      commandHash: sha256(cmdline),
      node,
      role: node && command.includes(WORKER_MARKER) ? "worker" : node && command.includes(BENCHMARK_MARKER) ? "benchmark" : null,
    },
  };
}

/** Return only PID, executable basename and command hash; never retain cmdline text. */
export async function collectProcessInventory({ procRoot = "/proc", observerPid = process.pid } = {}) {
  absolute(procRoot, "procRoot");
  if (!Number.isSafeInteger(observerPid) || observerPid <= 0) throw failure("E_OBSERVER_PID_INVALID");
  let entries;
  try { entries = await readdir(procRoot, { withFileTypes: true }); } catch (error) {
    throw failure("E_PROC_UNAVAILABLE", `Unable to read /proc: ${error.code ?? error.name}`);
  }
  const records = [];
  const unreadable = [];
  for (const pid of entries.map(entry => pidOf(entry.name)).filter(pid => pid !== null).sort((a, b) => a - b)) {
    const result = await readProcessRecord(procRoot, pid);
    if (result.record) records.push(result.record);
    if (result.unreadable) unreadable.push(result.unreadable);
  }
  const byPid = new Map(records.map(record => [record.pid, record]));
  const ancestorPids = new Set([observerPid]);
  const ancestryErrors = [];
  const visited = new Set();
  let current = observerPid;
  while (current !== 1) {
    if (visited.has(current)) { ancestryErrors.push({ pid: current, code: "ANCESTRY_CYCLE" }); break; }
    visited.add(current);
    const record = byPid.get(current);
    if (!record) { ancestryErrors.push({ pid: current, code: "ANCESTOR_UNAVAILABLE" }); break; }
    if (record.parentPid === 0 || record.parentPid === current) break;
    ancestorPids.add(record.parentPid);
    current = record.parentPid;
  }
  const processes = records.map(record => ({ ...record, observerAncestor: ancestorPids.has(record.pid) }));
  const competingNodeProcesses = processes.filter(record => record.node && !record.observerAncestor);
  return {
    observerPid,
    ancestorPids: [...ancestorPids].sort((a, b) => a - b),
    processes,
    unreadable,
    ancestryErrors,
    nodeProcessCount: processes.filter(record => record.node).length,
    competingNodeProcesses,
    orphanWorkerProcesses: processes.filter(record => record.role === "worker" && !record.observerAncestor),
    orphanBenchmarkProcesses: processes.filter(record => record.role === "benchmark" && !record.observerAncestor),
  };
}

export async function snapshotBenchmarkTemporaryEntries({ tempRoot = os.tmpdir(), prefix = DEFAULT_BENCHMARK_TEMP_PREFIX } = {}) {
  absolute(tempRoot, "tempRoot");
  validatePrefix(prefix);
  let entries;
  try { entries = await readdir(tempRoot, { withFileTypes: true }); } catch (error) {
    throw failure("E_TEMP_ROOT_UNAVAILABLE", `Unable to read temporary directory: ${error.code ?? error.name}`);
  }
  return entries.filter(entry => entry.name.startsWith(prefix)).sort((a, b) => a.name.localeCompare(b.name)).map(entry => ({
    name: entry.name,
    kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other",
  }));
}

async function readBefore(filename) {
  let bytes;
  try { bytes = await readFile(filename); } catch (error) { throw failure("E_BEFORE_EVIDENCE_UNAVAILABLE", `Unable to read before evidence: ${error.code ?? error.name}`); }
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw failure("E_BEFORE_EVIDENCE_INVALID"); }
  if (value?.schemaVersion !== SCHEMA_VERSION || value.kind !== "BENCHMARK_RUNNER_OBSERVATION" || value.phase !== "before") throw failure("E_BEFORE_EVIDENCE_INVALID");
  return { value, sha256: sha256(bytes) };
}

function violations({ phase, inventory, temporaryEntries, before }) {
  const result = [];
  if (inventory.unreadable.length || inventory.ancestryErrors.length) result.push({ code: "E_PROCESS_INVENTORY_INCOMPLETE", unreadableCount: inventory.unreadable.length, ancestryErrorCount: inventory.ancestryErrors.length });
  if (phase === "after" && inventory.orphanWorkerProcesses.length) result.push({ code: "E_ORPHAN_BENCHMARK_WORKER", count: inventory.orphanWorkerProcesses.length });
  if (phase === "after" && inventory.orphanBenchmarkProcesses.length) result.push({ code: "E_ORPHAN_BENCHMARK_PROCESS", count: inventory.orphanBenchmarkProcesses.length });
  if (inventory.competingNodeProcesses.length) result.push({ code: "E_COMPETING_NODE_PROCESS", count: inventory.competingNodeProcesses.length });
  if (phase === "before" && temporaryEntries.length) result.push({ code: "E_BENCHMARK_TEMP_PREEXISTS", count: temporaryEntries.length });
  if (phase === "after" && before.status !== "PASS") result.push({ code: "E_BEFORE_OBSERVATION_FAILED" });
  if (phase === "after" && temporaryEntries.length) result.push({ code: "E_BENCHMARK_TEMP_REMAINS", count: temporaryEntries.length });
  return result;
}

function validateRequest({ phase, output, beforePath, tempRoot, tempPrefix, procRoot, platform }) {
  if (!new Set(["before", "after"]).has(phase)) throw failure("E_PHASE_INVALID");
  absolute(output, "output");
  if (phase === "after") absolute(beforePath, "beforePath");
  absolute(tempRoot, "tempRoot");
  absolute(procRoot, "procRoot");
  validatePrefix(tempPrefix);
  if (platform !== "linux") throw failure("E_LINUX_REQUIRED", "The observer requires Linux /proc");
}

async function beforeEvidenceFor(phase, beforePath) {
  return phase === "after" ? readBefore(beforePath) : { value: null, sha256: null };
}

function addedTemporaryEntries(phase, before, current) {
  if (phase !== "after") return [];
  const previous = before.value.temporaryEntries ?? [];
  return current.filter(entry => !previous.some(oldEntry => oldEntry.name === entry.name));
}

function makeObservation({ phase, platform, architecture, hostname, environment, sourceRevision, observerPid, tempRoot, tempPrefix, temporaryEntries, newTemporaryEntries, inventory, errors, before }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "BENCHMARK_RUNNER_OBSERVATION",
    phase,
    status: errors.length ? "FAILED" : "PASS",
    failureCode: errors[0]?.code ?? null,
    observedAt: new Date().toISOString(),
    platform,
    architecture,
    hostname,
    runnerOs: environment.RUNNER_OS ?? null,
    runnerName: environment.RUNNER_NAME ?? null,
    workflowRun: environment.GITHUB_RUN_ID ?? null,
    workflowAttempt: environment.GITHUB_RUN_ATTEMPT ?? null,
    sourceRevision,
    observerPid,
    tempRoot,
    tempPrefix,
    temporaryEntries,
    newTemporaryEntries,
    processInventory: inventory,
    violations: errors,
    beforeObservation: before.value ? { sha256: before.sha256, status: before.value.status } : null,
    policy: {
      automaticTemporaryDeletion: false,
      allowedNodeProcesses: "observer and its visible /proc ancestors only",
      physicalWindowsHostQuiescence: "NOT_PROVEN",
      limitation: "Local Linux /proc cannot prove physical Windows-host quiescence, Docker-sibling activity, or processes outside this PID namespace.",
    },
  };
}

export async function observeBenchmarkRunner({
  phase,
  output,
  beforePath = null,
  tempRoot = os.tmpdir(),
  tempPrefix = DEFAULT_BENCHMARK_TEMP_PREFIX,
  procRoot = "/proc",
  observerPid = process.pid,
  platform = process.platform,
  architecture = process.arch,
  hostname = os.hostname(),
  environment = process.env,
  sourceRevision = environment.EXPECTED_BENCHMARK_SHA ?? environment.GITHUB_SHA ?? null,
} = {}) {
  validateRequest({ phase, output, beforePath, tempRoot, tempPrefix, procRoot, platform });
  const before = await beforeEvidenceFor(phase, beforePath);
  const inventory = await collectProcessInventory({ procRoot, observerPid });
  const temporaryEntries = await snapshotBenchmarkTemporaryEntries({ tempRoot, prefix: tempPrefix });
  const errors = violations({ phase, inventory, temporaryEntries, before: before.value ?? { status: "PASS" } });
  if (phase === "after") {
    const scope = { platform, architecture, hostname, sourceRevision, tempRoot, tempPrefix,
      runnerName: environment.RUNNER_NAME ?? null, workflowRun: environment.GITHUB_RUN_ID ?? null,
      workflowAttempt: environment.GITHUB_RUN_ATTEMPT ?? null };
    const mismatches = Object.keys(scope).filter(key => before.value[key] !== scope[key]);
    if (mismatches.length) errors.push({ code: "E_BEFORE_SCOPE_MISMATCH", fields: mismatches });
  }
  const newTemporaryEntries = addedTemporaryEntries(phase, before, temporaryEntries);
  const observation = makeObservation({ phase, platform, architecture, hostname, environment, sourceRevision, observerPid, tempRoot, tempPrefix, temporaryEntries, newTemporaryEntries, inventory, errors, before });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(observation, null, 2)}\n`, { flag: "wx" });
  return observation;
}

function argumentsOf(argv) {
  const values = new Map();
  for (const argument of argv) {
    const match = argument.match(/^--([^=]+)=(.*)$/u);
    if (!match || values.has(match[1])) throw failure("E_ARGUMENTS_INVALID");
    values.set(match[1], match[2]);
  }
  const phase = values.get("phase");
  if (!phase || !values.get("output") || (phase === "after" && !values.get("before"))) throw failure("E_ARGUMENTS_INVALID");
  const allowed = new Set(["phase", "output", "before", "temp-root", "temp-prefix"]);
  if ([...values.keys()].some(key => !allowed.has(key))) throw failure("E_ARGUMENTS_INVALID");
  return { phase, output: values.get("output"), beforePath: values.get("before") ?? null, tempRoot: values.get("temp-root") ?? os.tmpdir(), tempPrefix: values.get("temp-prefix") ?? DEFAULT_BENCHMARK_TEMP_PREFIX };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await observeBenchmarkRunner(argumentsOf(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ phase: result.phase, status: result.status, failureCode: result.failureCode })}\n`);
    if (result.status !== "PASS") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Benchmark runner observation failed: ${error.code ?? "E_OBSERVATION_FAILED"}\n`);
    process.exitCode = 1;
  }
}
