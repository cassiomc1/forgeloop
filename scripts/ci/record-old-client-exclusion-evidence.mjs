import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const packageRoot = process.cwd();
const args = process.argv.slice(2);
if (args.length !== 2) throw new Error("Expected exactly --legacy-root=... and --output=...");

function readArgument(name) {
  const prefix = `--${name}=`;
  const matches = args.filter(argument => argument.startsWith(prefix));
  if (matches.length !== 1) throw new Error(`Expected exactly one --${name}=... argument`);
  const value = matches[0].slice(prefix.length);
  if (!value) throw new Error(`--${name} must not be empty`);
  return value;
}

const legacyRoot = path.resolve(readArgument("legacy-root"));
const output = path.resolve(readArgument("output"));
const outputRelative = path.relative(packageRoot, output);
if (!(outputRelative === ".." || outputRelative.startsWith(`..${path.sep}`) || path.isAbsolute(outputRelative))) {
  throw new Error("Keep evidence outside the checked source tree");
}
const temporaryPrefix = "forgeloop-old-client-drill-";
const drill = path.join(packageRoot, "scripts/drill-storage-old-client-exclusion.mjs");
await mkdir(output, { recursive: true });

function git(args) {
  return execFileSync("git", args, {
    cwd: packageRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function trackedManifest() {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: packageRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).split("\0").filter(Boolean).sort();
  return files.map(file => ({
    path: file,
    sha256: createHash("sha256").update(readFileSync(path.join(packageRoot, file))).digest("hex"),
  }));
}

function sourceSnapshot() {
  const diff = spawnSync("git", ["diff", "--quiet", "HEAD"], { cwd: packageRoot });
  const cached = spawnSync("git", ["diff", "--cached", "--quiet", "HEAD"], { cwd: packageRoot });
  return {
    revision: git(["rev-parse", "HEAD"]),
    files: trackedManifest(),
    trackedSourceUnchanged: diff.status === 0 && cached.status === 0,
  };
}

async function temporaryEntries() {
  return (await readdir(os.tmpdir(), { withFileTypes: true }))
    .filter(entry => entry.name.startsWith(temporaryPrefix))
    .map(entry => entry.name)
    .sort();
}

async function writeJson(filename, value) {
  await writeFile(path.join(output, filename), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

const startedAt = new Date().toISOString();
const before = sourceSnapshot();
const temporaryBefore = await temporaryEntries();
await writeJson("source-before.json", before);
await writeJson("runner-before.json", {
  startedAt,
  platform: process.platform,
  architecture: process.arch,
  runtime: process.version,
  hostname: os.hostname(),
  runnerOs: process.env.RUNNER_OS ?? null,
  runnerName: process.env.RUNNER_NAME ?? null,
  workflowRun: process.env.GITHUB_RUN_ID ?? null,
  workflowAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  sourceRevision: before.revision,
});

let child = null;
let preflightError = null;
if (before.trackedSourceUnchanged) {
  child = spawnSync(process.execPath, [drill, `--legacy-root=${legacyRoot}`], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "" },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
    killSignal: "SIGKILL",
  });
} else {
  preflightError = {
    code: "E_SOURCE_DIRTY",
    message: "Refusing to run the old-client drill with tracked source changes already present",
  };
}
const endedAt = new Date().toISOString();
const childStdout = child?.stdout ?? "";
await writeFile(path.join(output, "stdout.json"), childStdout, { flag: "wx" });
await writeFile(path.join(output, "stderr.log"), child?.stderr ?? "", { flag: "wx" });
await writeJson("parent-exit.json", {
  startedAt,
  endedAt,
  status: child?.status ?? null,
  signal: child?.signal ?? null,
  error: child?.error ? { code: child.error.code ?? null, message: child.error.message } : preflightError,
  spawnSkipped: child === null,
  timedOut: child?.error?.code === "ETIMEDOUT",
  directChildTerminated: child !== null && (child.status !== null || child.signal !== null),
});

const rawStdout = childStdout;
let parsedStdout = null;
let stdoutError = null;
let strictStdoutJson = false;
try {
  const trimmed = rawStdout.trim();
  parsedStdout = JSON.parse(trimmed);
  const canonical = JSON.stringify(parsedStdout);
  strictStdoutJson = rawStdout === canonical || rawStdout === `${canonical}\n` || rawStdout === `${canonical}\r\n`;
  if (!strictStdoutJson) throw new Error("stdout contained more than one canonical JSON document");
} catch (error) {
  stdoutError = { name: error.name, message: error.message };
}
await writeJson("stdout-validation.json", {
  strictStdoutJson,
  status: parsedStdout?.status ?? null,
  error: stdoutError,
});

const after = sourceSnapshot();
const sourceUnchanged = before.trackedSourceUnchanged
  && after.trackedSourceUnchanged
  && before.revision === after.revision
  && JSON.stringify(before.files) === JSON.stringify(after.files);
await writeJson("source-after.json", after);
await writeJson("source-comparison.json", {
  unchanged: sourceUnchanged,
  beforeRevision: before.revision,
  afterRevision: after.revision,
  beforeFileCount: before.files.length,
  afterFileCount: after.files.length,
});

const temporaryAfter = await temporaryEntries();
const leakedTemporaryEntries = temporaryAfter.filter(entry => !temporaryBefore.includes(entry));
const directChildTerminated = child !== null && (child.status !== null || child.signal !== null);
const cleanup = {
  status: leakedTemporaryEntries.length === 0 ? "PASS" : "FAILED",
  scope: ["temporary entries matching the drill prefix", "direct old-client drill process termination"],
  temporaryPrefix,
  temporaryBefore,
  temporaryAfter,
  leakedTemporaryEntries,
  directChildTerminated,
  notMeasured: ["descendant process reaping", "runner-wide quiescence"],
  note: "The old-client drill owns a finally cleanup for its disposable workspace; this checks only whether its prefixed temporary entry remained and whether the direct drill process terminated.",
};
await writeJson("cleanup.json", cleanup);

const passed = child?.status === 0 && strictStdoutJson && parsedStdout?.status === "PASS"
  && sourceUnchanged && cleanup.status === "PASS";
await writeJson("summary.json", {
  status: passed ? "PASS" : "FAILED",
  sourceRevision: before.revision,
  parentExit: child?.status ?? null,
  preflightError,
  strictStdoutJson,
  sourceUnchanged,
  cleanup: cleanup.status,
  cleanupScope: cleanup.scope,
  rawFiles: ["stdout.json", "stderr.log", "parent-exit.json", "source-before.json", "source-after.json", "cleanup.json"],
});
if (!passed) process.exitCode = 1;
