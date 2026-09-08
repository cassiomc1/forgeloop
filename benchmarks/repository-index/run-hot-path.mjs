import { appendFile, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { searchRepository } from "../../src/repository-index/search.js";
import { stopRepositoryIndexServer } from "../../src/repository-index/server.js";
import { getCanonicalRepositorySearchArgs, appendSearchFilters } from "../../src/repository-index/args.js";
import { getTgrepIndexPath } from "../../src/repository-index/paths.js";
import { runTgrep } from "../../src/repository-index/process.js";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(packageRoot, "tests", "fixtures", "repository-index", "sample-repo");
const binary = process.env.FORGELOOP_TGREP_BINARY;

if (!binary || !path.isAbsolute(binary)) {
  throw new Error("Set FORGELOOP_TGREP_BINARY to the absolute path of the pinned native tgrep binary");
}

const fixture = await mkdtemp(path.join(os.tmpdir(), "forgeloop-repository-index-benchmark-"));
const queries = JSON.parse(await readFile(path.join(packageRoot, "benchmarks/repository-index/queries.json"), "utf8")).queries;
const options = { packageRoot, binaryPath: binary, startupTimeoutMs: 30_000, commandTimeoutMs: 60_000 };
const results = [];
const repeatedIterations = Number.parseInt(process.env.FORGELOOP_BENCHMARK_ITERATIONS ?? "100", 10);
if (!Number.isSafeInteger(repeatedIterations) || repeatedIterations < 1 || repeatedIterations > 1_000) {
  throw new Error("FORGELOOP_BENCHMARK_ITERATIONS must be an integer from 1 to 1000");
}

const measure = async (query, mode, { record = true } = {}) => {
  const startedAt = performance.now();
  const result = await searchRepository(fixture, { ...options, ...query });
  const durationMs = performance.now() - startedAt;
  if (record) {
    results.push({
      query: query.id,
      mode,
      durationMs: Math.round(durationMs),
      matches: result.matches.length,
      nativeDurationMs: result.metrics.nativeDurationMs,
      exitCode: result.metrics.exitCode,
    });
  }
  return durationMs;
};

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function summarize(durations) {
  return {
    iterations: durations.length,
    totalMs: Math.round(durations.reduce((sum, value) => sum + value, 0)),
    meanMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    medianMs: Math.round(percentile(durations, 0.5)),
    p95Ms: Math.round(percentile(durations, 0.95)),
  };
}

async function measureRawTgrep(query) {
  const args = [...getCanonicalRepositorySearchArgs({
    indexPath: getTgrepIndexPath(fixture),
    pattern: query.pattern,
    options: query,
  })];
  appendSearchFilters(args, query);
  args.push(fixture);
  const startedAt = performance.now();
  const result = await runTgrep({
    binaryPath: binary,
    repoRoot: fixture,
    args,
    timeoutMs: options.commandTimeoutMs,
    maxOutputBytes: 4 * 1024 * 1024,
  });
  if (![0, 1].includes(result.exitCode)) {
    throw new Error(`raw tgrep benchmark query failed with exit code ${result.exitCode}: ${result.stderr}`);
  }
  return performance.now() - startedAt;
}

async function measureRipgrep(query) {
  const startedAt = performance.now();
  let result;
  try {
    result = await execFileAsync("rg", [
      "--fixed-strings",
      "--color", "never",
      "--glob", "!.forgeloop/repository-index/**",
      query.pattern,
      fixture,
    ], { maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    if (error.code !== 1) throw error;
  }
  void result;
  return performance.now() - startedAt;
}

async function measureRepeated(label, callback) {
  const durations = [];
  for (let index = 0; index < repeatedIterations; index += 1) durations.push(await callback());
  return { label, ...summarize(durations) };
}

try {
  await cp(fixtureRoot, fixture, { recursive: true });
  await execFileAsync("git", ["init", "--quiet", fixture]);
  await execFileAsync("git", ["-C", fixture, "add", "."]);
  await measure({ id: "first-use", pattern: "alphaNeedle", fixedStrings: true }, "first-use");
  for (const query of queries) await measure(query, "warm");
  await appendFile(path.join(fixture, "src", "alpha.js"), "\nexport const benchmarkMutationNeedle = true;\n");
  await measure({ id: "post-mutation", pattern: "benchmarkMutationNeedle", fixedStrings: true }, "post-mutation");
  const lowMatchQuery = { id: "repeated-low-match", pattern: "FORGELOOP_BENCHMARK_ABSENT", fixedStrings: true };
  const repeated = {
    query: lowMatchQuery,
    iterations: repeatedIterations,
    rawTgrep: await measureRepeated("raw-tgrep", () => measureRawTgrep(lowMatchQuery)),
    forgeloopSearch: await measureRepeated("forgeloop-search", () => measure(lowMatchQuery, "warm-repeated", { record: false })),
    ripgrep: await measureRepeated("ripgrep", () => measureRipgrep(lowMatchQuery)),
  };
  console.log(JSON.stringify({
    schemaVersion: 1,
    repository: "repository-index-sample-fixture",
    commit: "working-tree",
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    tgrepVersion: "1.0.3",
    measurements: results,
    repeatedLowMatch: repeated,
  }, null, 2));
} finally {
  await stopRepositoryIndexServer(fixture, options).catch(() => {});
  await rm(fixture, { recursive: true, force: true });
}
