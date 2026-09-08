import { appendFile, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { searchRepository } from "../../src/repository-index/search.js";
import { createTgrepBinaryHandle, runTgrep } from "../../src/repository-index/process.js";
import { stopRepositoryIndexServer } from "../../src/repository-index/server.js";
import { getCanonicalRepositorySearchArgs, appendSearchFilters } from "../../src/repository-index/args.js";
import { getTgrepIndexPath } from "../../src/repository-index/paths.js";
import { searchViaPersistentTransport, shutdownPersistentSearchHost } from "../../src/persistent-transport/client.js";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(packageRoot, "tests", "fixtures", "repository-index", "sample-repo");
const cliPath = path.join(packageRoot, "src", "cli.js");
const binary = process.env.FORGELOOP_TGREP_BINARY;
const iterations = Number.parseInt(process.env.FORGELOOP_BENCHMARK_ITERATIONS ?? "100", 10);

if (!binary || !path.isAbsolute(binary)) throw new Error("Set FORGELOOP_TGREP_BINARY to the absolute path of the pinned native tgrep binary");
if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 1_000) throw new Error("FORGELOOP_BENCHMARK_ITERATIONS must be an integer from 1 to 1000");
const binaryHandle = createTgrepBinaryHandle(binary);

const fixture = await mkdtemp(path.join(os.tmpdir(), "forgeloop-persistent-transport-benchmark-"));
const persistentHome = await mkdtemp(path.join(os.tmpdir(), "forgeloop-persistent-transport-home-"));
const cliHome = await mkdtemp(path.join(os.tmpdir(), "forgeloop-persistent-transport-cli-home-"));
const options = {
  packageRoot,
  binaryPath: binary,
  startupTimeoutMs: 30_000,
  commandTimeoutMs: 60_000,
  requestTimeoutMs: 60_000,
};
const query = { pattern: "FORGELOOP_BENCHMARK_ABSENT", fixedStrings: true };
const agentQueries = [
  { pattern: "repositoryFingerprint", fixedStrings: true },
  { pattern: "E_[A-Z_]+" },
  { pattern: "executionreceipt", ignoreCase: true },
  { pattern: "receipt", wordRegexp: true },
  { pattern: "export", types: ["js"] },
  { pattern: "const", fixedStrings: true },
  { pattern: "FORGELOOP_BENCHMARK_ABSENT", fixedStrings: true },
  { pattern: "searchRepository", fixedStrings: true },
  { pattern: "forgeloop", ignoreCase: true },
  { pattern: "THREAT_MODEL", fixedStrings: true },
];

function summarize(durations) {
  const sorted = [...durations].sort((a, b) => a - b);
  const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
  const totalMs = durations.reduce((sum, value) => sum + value, 0);
  return {
    iterations: durations.length,
    totalMs: Math.round(totalMs),
    minMs: Math.round(sorted[0]),
    maxMs: Math.round(sorted.at(-1)),
    meanMs: Math.round(totalMs / durations.length),
    medianMs: Math.round(percentile(0.5)),
    p95Ms: Math.round(percentile(0.95)),
  };
}

async function repeated(callback) {
  const durations = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    await callback();
    durations.push(performance.now() - startedAt);
  }
  return summarize(durations);
}

async function rawTgrep(searchQuery = query) {
  const args = [...getCanonicalRepositorySearchArgs({ indexPath: getTgrepIndexPath(fixture), pattern: searchQuery.pattern, options: searchQuery })];
  appendSearchFilters(args, searchQuery);
  args.push(fixture);
  const result = await runTgrep({ binary: binaryHandle, repoRoot: fixture, args, timeoutMs: options.commandTimeoutMs, maxOutputBytes: 4 * 1024 * 1024 });
  if (![0, 1].includes(result.exitCode)) throw new Error(`raw tgrep failed: ${result.stderr}`);
}

async function ripgrep(searchQuery = query) {
  try {
    await execFileAsync("rg", ["--fixed-strings", "--color", "never", "--glob", "!.forgeloop/repository-index/**", searchQuery.pattern, fixture], { maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    if (error.code === "ENOENT") return false;
    if (error.code !== 1) throw error;
  }
  return true;
}

async function cliSearch(homeDirectory, searchQuery = query) {
  const fixed = searchQuery.fixedStrings ? ["--fixed-strings"] : [];
  const ignoreCase = searchQuery.ignoreCase ? ["--ignore-case"] : [];
  const word = searchQuery.wordRegexp ? ["--word-regexp"] : [];
  const type = searchQuery.types?.flatMap((value) => ["--type", value]) ?? [];
  const result = await execFileAsync(process.execPath, [cliPath, "search", searchQuery.pattern, ...fixed, ...ignoreCase, ...word, ...type, "--json", "--path", fixture], {
    cwd: packageRoot,
    env: { ...process.env, HOME: homeDirectory, USERPROFILE: homeDirectory, FORGELOOP_TGREP_BINARY: binary },
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(result.stdout);
}

async function measureAgentWorkload(callback) {
  const startedAt = performance.now();
  const results = [];
  for (const searchQuery of agentQueries) results.push(await callback(searchQuery));
  const totalMs = performance.now() - startedAt;
  return {
    queries: agentQueries.length,
    totalMs: Math.round(totalMs),
    meanMs: Math.round(totalMs / agentQueries.length),
    matchCounts: results.map((result) => result?.matches?.length ?? null),
  };
}

try {
  await cp(fixtureRoot, fixture, { recursive: true });
  await execFileAsync("git", ["init", "--quiet", fixture]);
  await execFileAsync("git", ["-C", fixture, "add", "."]);
  await searchRepository(fixture, { ...options, ...query, homeDirectory: persistentHome });
  const persistentColdStartedAt = performance.now();
  await searchViaPersistentTransport(fixture, query, { ...options, homeDirectory: persistentHome, env: { FORGELOOP_TGREP_BINARY: binary } });
  const persistentColdMs = performance.now() - persistentColdStartedAt;
  const persistentWarm = await repeated(() => searchViaPersistentTransport(fixture, query, { ...options, homeDirectory: persistentHome, env: { FORGELOOP_TGREP_BINARY: binary } }));
  const apiWarm = await repeated(() => searchRepository(fixture, { ...options, ...query, homeDirectory: persistentHome }));
  const raw = await repeated(rawTgrep);
  const rgAvailable = await ripgrep();
  const rgWarm = rgAvailable ? await repeated(ripgrep) : null;
  const cliColdStartedAt = performance.now();
  await cliSearch(cliHome);
  const cliColdMs = performance.now() - cliColdStartedAt;
  const cliWarm = await repeated(() => cliSearch(cliHome));
  const agentWorkload = {
    api: await measureAgentWorkload((searchQuery) => searchRepository(fixture, { ...options, ...searchQuery, homeDirectory: persistentHome })),
    persistentTransport: await measureAgentWorkload((searchQuery) => searchViaPersistentTransport(fixture, searchQuery, { ...options, homeDirectory: persistentHome, env: { FORGELOOP_TGREP_BINARY: binary } })),
    cli: await measureAgentWorkload((searchQuery) => cliSearch(cliHome, searchQuery)),
  };
  const nodeStartupStartedAt = performance.now();
  await execFileAsync(process.execPath, ["-e", "void 0"], { cwd: packageRoot });
  const nodeStartupMs = performance.now() - nodeStartupStartedAt;
  await appendFile(path.join(fixture, "src", "benchmark.js"), "\nexport const transportBenchmarkMutation = true;\n");
  await searchViaPersistentTransport(fixture, { pattern: "transportBenchmarkMutation", fixedStrings: true }, { ...options, homeDirectory: persistentHome, env: { FORGELOOP_TGREP_BINARY: binary } });
  console.log(JSON.stringify({
    schemaVersion: 1,
    repository: "repository-index-sample-fixture",
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    tgrepVersion: "1.0.3",
    iterations,
    cold: { persistentTransportMs: Math.round(persistentColdMs), cliMs: Math.round(cliColdMs) },
    warm: { api: apiWarm, persistentTransport: persistentWarm, cli: cliWarm, rawTgrep: raw, ripgrep: rgWarm },
    agentWorkload,
    criticalPath: { nodeProcessStartupMs: Math.round(nodeStartupMs), note: "CLI timings include Node process startup and argument parsing." },
    mutation: "verified through persistent transport",
  }, null, 2));
} finally {
  await shutdownPersistentSearchHost({ homeDirectory: persistentHome, timeoutMs: 2_000 }).catch(() => {});
  await shutdownPersistentSearchHost({ homeDirectory: cliHome, timeoutMs: 2_000 }).catch(() => {});
  await stopRepositoryIndexServer(fixture, { ...options, homeDirectory: persistentHome }).catch(() => {});
  await rm(fixture, { recursive: true, force: true });
  await rm(persistentHome, { recursive: true, force: true });
  await rm(cliHome, { recursive: true, force: true });
}
