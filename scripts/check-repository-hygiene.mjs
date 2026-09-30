#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VISUAL_EXTENSIONS = new Set([".gif", ".html", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
export const ROOT_MARKDOWN = new Set([
  "AGENTS.md", "AGENT_COMPATIBILITY.md", "CHANGELOG.md", "CLAUDE.md", "CODE_OF_CONDUCT.md",
  "CONTRACT_COVERAGE.md", "CONTRIBUTING.md", "DELEGATION_PROTOCOL.md", "DOCS_INDEX.md", "EXECUTION_STATE.md",
  "GUIDE_ROUTER.md", "LOOP_ENGINEERING.md", "LOOP_SYSTEM_DESIGN.md", "ORCHESTRATOR_INTEGRATION.md",
  "PROJECT_PROFILE.md", "PROTOCOL_INTEGRATION.md", "QUALITY_SCORECARD.md", "README.md", "SECURITY.md",
  "TERMINOLOGY.md", "THIRD_PARTY_NOTICES.md", "THREAT_MODEL.md",
]);
export const REPOSITORY_ONLY_VISUALS = new Set([
  "docs/assets/forgeloop-architecture.svg",
  "docs/assets/forgeloop-lifecycle-animated.svg",
]);
export const BENCHMARK_RUN_SETS = new Set([
  "codex-quality-repeat5-20260831",
  "codex-repeat5-20260831",
  "codex-tail-repeat20-20260831",
]);
export const OBSOLETE_LICENSE_PATHS = Object.freeze([
  "LICENSE-DOCS.md",
]);
export const REQUIRED_THIRD_PARTY_PATHS = Object.freeze([
  "THIRD_PARTY_NOTICES.md",
  "vendor/archify/v2.15.0/archify/LICENSE",
]);
export const IGNORE_SENTINELS = [
  "coverage-data/example.json",
  "package-dry-run.json",
  "example.tgz",
  ".mcp-smoke-example/file",
  "integrations/mcp/.core-tarball-example/file",
  "example.forgeloop-tmp-file",
  "docs/assets/diagrams/.archify-render-example/file",
  "benchmarks/execution-profiles/results/raw/scratch/run.json",
];
const SCRATCH_PATTERNS = [
  /^coverage-data\//u,
  /^package-dry-run\.json$/u,
  /\.tgz$/u,
  /^\.mcp-smoke-/u,
  /^integrations\/mcp\/\.core-tarball-/u,
  /\.forgeloop-tmp-/u,
  /^docs\/assets\/diagrams\/\.archify-/u,
  /\/results\/(?:raw|aggregate)\/(?:scratch|tmp|temp)(?:\/|$)/u,
];

function trackedFiles(rootDir) {
  const output = execFileSync("git", ["ls-files", "-z"], { cwd: rootDir, encoding: "utf8" });
  return output.split("\0").filter(Boolean);
}

function manifestVisuals(manifest) {
  const paths = new Set();
  for (const diagram of manifest?.diagrams ?? []) {
    for (const field of ["html", "svg"]) paths.add(diagram[field]);
  }
  return paths;
}

export function validateRepositoryHygiene({ trackedPaths, manifest, ignoredSentinels = [] } = {}) {
  const errors = [];
  const tracked = new Set(trackedPaths ?? []);
  const declaredVisuals = manifestVisuals(manifest);
  const ignored = new Set(ignoredSentinels);

  for (const trackedPath of tracked) {
    if (OBSOLETE_LICENSE_PATHS.includes(trackedPath)) {
      errors.push(`REPOSITORY_HYGIENE_OBSOLETE_LICENSE_PRESENT: ${trackedPath}`);
    }
    if (trackedPath.startsWith(".forgeloop/")) {
      errors.push(`REPOSITORY_HYGIENE_TRACKED_FORGELOOP_STATE: ${trackedPath}`);
    }
    if (trackedPath.endsWith(".md") && !trackedPath.includes("/") && !ROOT_MARKDOWN.has(trackedPath)) {
      errors.push(`REPOSITORY_HYGIENE_UNEXPECTED_ROOT_DOCUMENT: ${trackedPath}`);
    }
    if (SCRATCH_PATTERNS.some((pattern) => pattern.test(trackedPath))) {
      errors.push(`REPOSITORY_HYGIENE_TRACKED_SCRATCH_PATH: ${trackedPath}`);
    }
    if (trackedPath.startsWith("docs/assets/") && VISUAL_EXTENSIONS.has(path.posix.extname(trackedPath).toLowerCase())
      && !declaredVisuals.has(trackedPath) && !REPOSITORY_ONLY_VISUALS.has(trackedPath)) {
      errors.push(`REPOSITORY_HYGIENE_UNOWNED_VISUAL_ASSET: ${trackedPath}`);
    }
    const benchmarkMatch = trackedPath.match(/^benchmarks\/execution-profiles\/results\/(?:raw|aggregate)\/([^/]+)(?:\/|$)/u);
    if (benchmarkMatch && !BENCHMARK_RUN_SETS.has(benchmarkMatch[1])) {
      errors.push(`REPOSITORY_HYGIENE_UNAPPROVED_BENCHMARK_RUN: ${benchmarkMatch[1]}`);
    }
  }
  for (const sentinel of IGNORE_SENTINELS) {
    if (!ignored.has(sentinel)) errors.push(`REPOSITORY_HYGIENE_IGNORE_RULE_MISSING: ${sentinel}`);
  }
  return { valid: errors.length === 0, errors };
}

function ignoredSentinels(rootDir) {
  const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], {
    cwd: rootDir,
    input: `${IGNORE_SENTINELS.join("\n")}\n`,
    encoding: "utf8",
  });
  if (result.error) return [];
  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

export async function checkRepositoryHygiene({ rootDir = repositoryRoot } = {}) {
  const errors = [];
  const root = path.resolve(rootDir);
  const manifest = JSON.parse(await readFile(path.join(root, "docs", "diagrams", "manifest.json"), "utf8"));
  for (const requiredPath of REQUIRED_THIRD_PARTY_PATHS) {
    try {
      await access(path.join(root, requiredPath));
    } catch {
      errors.push(`REPOSITORY_HYGIENE_REQUIRED_THIRD_PARTY_PATH_MISSING: ${requiredPath}`);
    }
  }
  for (const forbiddenPath of OBSOLETE_LICENSE_PATHS) {
    try {
      await access(path.join(root, forbiddenPath));
      errors.push(`REPOSITORY_HYGIENE_OBSOLETE_LICENSE_PRESENT: ${forbiddenPath}`);
    } catch {
      continue;
    }
  }
  const result = validateRepositoryHygiene({
    trackedPaths: trackedFiles(root),
    manifest,
    ignoredSentinels: ignoredSentinels(root),
  });
  errors.push(...result.errors);
  return { valid: errors.length === 0, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkRepositoryHygiene();
  if (!result.valid) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log("Repository hygiene valid: tracked state, root documents, visual ownership, benchmark evidence, and scratch-output policy.");
  }
}
