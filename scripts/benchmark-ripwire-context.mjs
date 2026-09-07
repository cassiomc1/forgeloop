#!/usr/bin/env node

import { execFile as nodeExecFile } from "node:child_process";
import { open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { createRipwireAdvisoryContextProvider } from "../src/adapters/ripwire/provider.js";
import { createForgeLoopContext } from "../src/core/runtime-context.js";
import { recallAdvisoryContext } from "../src/core/advisory-context/service.js";

const execFile = promisify(nodeExecFile);
const DEFAULT_CASES = "benchmarks/ripwire-context/cases.json";

function usage() {
  return [
    "Usage: node scripts/benchmark-ripwire-context.mjs --project PATH --ripwire-path PATH --version VERSION [options]",
    "Options: --cases PATH --runs N --json --output PATH",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { cases: DEFAULT_CASES, runs: 5, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
    } else if (["--project", "--ripwire-path", "--version", "--cases", "--runs", "--output"].includes(argument)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${argument}`);
      options[argument.slice(2).replaceAll("-", "_")] = value;
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option ${argument}`);
    }
  }
  options.runs = Number(options.runs);
  if (!Number.isSafeInteger(options.runs) || options.runs < 1 || options.runs > 20) {
    throw new Error("--runs must be an integer between 1 and 20");
  }
  return options;
}

function notVerified(reason, options) {
  return {
    schemaVersion: 1,
    status: "NOT_VERIFIED",
    reason,
    project: options.project ?? null,
    ripwirePath: options.ripwire_path ?? null,
    expectedVersion: options.version ?? null,
    cases: [],
  };
}

async function gitOutput(project, args) {
  const result = await execFile("git", ["-C", project, ...args], {
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return result.stdout.trim();
}

async function boundedFileBytes(filePath, maxBytes) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return bytesRead;
  } finally {
    await handle.close();
  }
}

async function baselineForCase(project, terms) {
  const files = new Set();
  let bytes = 0;
  for (const term of terms) {
    let output;
    try {
      output = await execFile("rg", [
        "--files-with-matches",
        "--hidden",
        "--glob",
        "!.git",
        "--glob",
        "!.git/**",
        "--glob",
        "!.forgeloop",
        "--glob",
        "!.forgeloop/**",
        "--",
        term,
        ".",
      ], { cwd: project, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    } catch (error) {
      if (error?.code === 1) continue;
      throw error;
    }
    for (const line of output.stdout.split("\n").map((entry) => entry.trim()).filter(Boolean)) {
      const absolute = path.isAbsolute(line) ? line : path.resolve(project, line);
      const relative = path.relative(project, absolute).replaceAll(path.sep, "/");
      if (
        relative.startsWith("../")
        || relative === "."
        || relative === ".git"
        || relative.startsWith(".git/")
        || relative === ".forgeloop"
        || relative.startsWith(".forgeloop/")
      ) continue;
      files.add(relative);
    }
  }
  for (const relative of [...files].sort()) {
    bytes += await boundedFileBytes(path.join(project, relative), 32 * 1024);
  }
  return { files: [...files].sort(), bytes };
}

function sourceFile(sourceRef) {
  return typeof sourceRef === "string" ? sourceRef.replace(/:\d+$/u, "") : null;
}

function adapterBytes(result) {
  return Buffer.byteLength(JSON.stringify(result.items), "utf8");
}

function scoreBenchmarkRuns(runResults, expectedFiles) {
  const perRun = runResults.map((run) => {
    const expectedFound = expectedFiles.filter((file) => run.files.includes(file));
    const expectedMissing = expectedFiles.filter((file) => !run.files.includes(file));
    const irrelevantFiles = run.files.filter((file) => !expectedFiles.includes(file)).sort();
    return {
      ...run,
      expectedFound,
      expectedMissing,
      irrelevantFiles,
      everyExpectedFileFound: expectedMissing.length === 0,
    };
  });
  const observedAcrossRuns = [...new Set(perRun.flatMap((run) => run.expectedFound))].sort();
  const expectedFound = expectedFiles.filter((file) => perRun.every((run) => run.expectedFound.includes(file)));
  const expectedMissing = expectedFiles.filter((file) => perRun.some((run) => run.expectedMissing.includes(file)));
  const irrelevantFiles = [...new Set(perRun.flatMap((run) => run.irrelevantFiles))].sort();
  return {
    perRun,
    expectedFound,
    expectedMissing,
    observedAcrossRuns,
    irrelevantFiles,
    everyExpectedFileFound: perRun.every((run) => run.everyExpectedFileFound),
  };
}

async function runCase({ project, executablePath, expectedVersion, testCase, runs }) {
  const baseline = await baselineForCase(project, testCase.baselineTerms);
  const runResults = [];
  for (let index = 0; index < runs; index += 1) {
    const transport = [];
    const measuredProvider = createRipwireAdvisoryContextProvider({
      executablePath,
      expectedVersion,
      onTransport: (event) => transport.push(event),
    });
    const startedAt = performance.now();
    const result = await recallAdvisoryContext({
      target: project,
      taskId: `ripwire-benchmark-${testCase.id}`,
      providerName: "ripwire",
      query: testCase.query,
      limit: 6,
      runtimeContext: createForgeLoopContext({ advisoryContextProviders: { ripwire: measuredProvider } }),
    });
    const durationMs = performance.now() - startedAt;
    const files = [...new Set(result.items.map((item) => sourceFile(item.sourceRef)).filter(Boolean))];
    runResults.push({
      durationMs,
      files,
      adapterBytes: adapterBytes(result),
      transportBytes: transport.reduce((sum, event) => sum + event.stdoutBytes + event.stderrBytes, 0),
    });
  }

  const expectedFiles = testCase.expectedFiles;
  const score = scoreBenchmarkRuns(runResults, expectedFiles);
  const durations = runResults.map((run) => run.durationMs).sort((a, b) => a - b);
  const median = durations[Math.floor(durations.length / 2)];
  return {
    id: testCase.id,
    query: testCase.query,
    expectedFiles,
    expectedFound: score.expectedFound,
    expectedMissing: score.expectedMissing,
    observedAcrossRuns: score.observedAcrossRuns,
    everyExpectedFileFound: score.everyExpectedFileFound,
    irrelevantFiles: score.irrelevantFiles,
    perRun: score.perRun,
    baselineFiles: baseline.files,
    baselineBytes: baseline.bytes,
    adapterBytes: { min: Math.min(...runResults.map((run) => run.adapterBytes)), max: Math.max(...runResults.map((run) => run.adapterBytes)) },
    transportBytes: { min: Math.min(...runResults.map((run) => run.transportBytes)), max: Math.max(...runResults.map((run) => run.transportBytes)) },
    durationMs: { min: durations[0], median, max: durations.at(-1) },
    runs,
  };
}

function printReport(report, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${report.status}: ${report.reason ?? `${report.cases.length} cases measured`}\n`);
  for (const item of report.cases) {
    process.stdout.write(`- ${item.id}: ${item.expectedFound.length}/${item.expectedFiles.length} expected files; median ${item.durationMs.median.toFixed(1)}ms\n`);
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.project || !options.ripwire_path || !options.version) {
    const report = notVerified("A project path, Ripwire path, and exact version are required; no binary discovery is performed", options);
    printReport(report, options.json);
    return;
  }

  let report;
  try {
    const project = path.resolve(options.project);
    const casesPath = path.resolve(options.cases);
    const casesDocument = JSON.parse(await readFile(casesPath, "utf8"));
    const actualCommit = await gitOutput(project, ["rev-parse", "HEAD"]);
    if (actualCommit !== casesDocument.commit) {
      report = notVerified(`Repository HEAD ${actualCommit} does not match frozen benchmark commit ${casesDocument.commit}`, options);
    } else if (await gitOutput(project, ["status", "--porcelain"])) {
      report = notVerified("Benchmark requires a clean checkout so retrieval bytes and files are comparable", options);
    } else {
      const results = [];
      for (const testCase of casesDocument.cases) {
        results.push(await runCase({
          project,
          executablePath: path.resolve(options.ripwire_path),
          expectedVersion: options.version,
          testCase,
          runs: options.runs,
        }));
      }
      report = {
        schemaVersion: 1,
        status: "OBSERVED",
        measurementOrder: ["baseline", "adapter"],
        project,
        ripwirePath: path.resolve(options.ripwire_path),
        expectedVersion: options.version,
        commit: actualCommit,
        cases: results,
      };
    }
  } catch (error) {
    report = notVerified(`Benchmark could not be completed: ${error.message}`, options);
  }

  if (options.output) await writeFile(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
  printReport(report, options.json);
}

const invokedScript = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedScript && import.meta.url === invokedScript) await main();

export { baselineForCase, scoreBenchmarkRuns };
