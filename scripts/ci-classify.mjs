#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";

const DOCS_SCRIPT_PATH = /^scripts\/(?:check-documentation|generate-documentation|documentation-diagram|generate_documentation_reference|validate_documentation|run-docs-check|validate_markdown|CI_VALIDATORS)/u;
const DOCS_PATHS = [
  /\.(?:md|markdown)$/u,
  /^docs\//u,
  /^\.lychee\.toml$/u,
  /^\.markdownlint/u,
  /^\.github\/copilot-instructions\.md$/u,
];
const PACKAGE_PATHS = [
  /^package\.json$/u,
  /^package-lock\.json$/u,
  /^src\//u,
  /^integrations\//u,
  /^schemas\//u,
  /^bin\//u,
  /^scripts\/(?:package_smoke|mcp-package-smoke|mcp-setup|mcp-locked-install)\.mjs$/u,
  /^tests\/(?:package|package-smoke|mcp)/u,
];
const REPOSITORY_INDEX_PATHS = [
  /^src\/repository-index\//u,
  /^src\/persistent-transport\//u,
  /^src\/integration\.js$/u,
  /^src\/commands\/(?:repository-index|search|doctor|index-(?:setup|start|stop|status|rebuild)|init|update)\.js$/u,
  /^src\/core\/command-executors\.js$/u,
  /^tests\/(?:repository-index|persistent-transport)/u,
  /^scripts\/(?:verify-tgrep-manifest|update-tgrep-manifest)\.mjs$/u,
  /^benchmarks\/repository-index\//u,
  /^\.github\/workflows\/repository-index\.yml$/u,
];
const AUDIT_PATHS = [
  /^\.forgeloop\//u,
  /^evidence\//u,
  /^poc\//u,
  /^schemas\//u,
  /^src\/core\//u,
  /^src\/commands\/(?:task|complete|preflight|advance|next|record|validate|audit|route|activate|prepare-completion|reconcile)/u,
  /^scripts\/(?:audit-receipts|verify_poc_evidence)\.mjs$/u,
];
const RELEASE_PATHS = [
  /^CHANGELOG\.md$/u,
  /^docs\/RELEASE_CHECKLIST\.md$/u,
  /^scripts\/verify_release_identity\.mjs$/u,
  /^\.github\/workflows\/(?:npm-publish|mcp-publish|release-notes)\.yml$/u,
];

function normalizePath(value) {
  return String(value).trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

function isDocumentationPath(filePath) {
  return DOCS_PATHS.some((pattern) => pattern.test(filePath))
    || DOCS_SCRIPT_PATH.test(filePath);
}

function isSourcePath(filePath) {
  if (isDocumentationPath(filePath)) return false;
  return /^(?:src|integrations|tests|poc|schemas|benchmarks)\//u.test(filePath)
    || /^package(?:-lock)?\.json$/u.test(filePath)
    || /^\.github\/workflows\//u.test(filePath)
    || /^scripts\//u.test(filePath)
    || /^(?:\.eslintrc|eslint\.config|tsconfig|\.npmrc|\.nvmrc)/u.test(filePath);
}

function matchesAny(paths, patterns) {
  return paths.some((filePath) => patterns.some((pattern) => pattern.test(filePath)));
}

export function classifyPaths(inputPaths = [], { forceAll = false } = {}) {
  const paths = [...new Set(inputPaths.map(normalizePath).filter(Boolean))].sort();
  if (forceAll) {
    return {
      paths,
      forcedAll: true,
      docs: true,
      docs_only: false,
      repository_index: true,
      package: true,
      audit: true,
      node_compat: true,
      source: true,
      release: true,
    };
  }

  const docs = matchesAny(paths, [DOCS_PATHS[0], DOCS_PATHS[1], DOCS_PATHS[2], DOCS_PATHS[3], DOCS_PATHS[4]])
    || paths.some((filePath) => DOCS_SCRIPT_PATH.test(filePath));
  const packageImpact = matchesAny(paths, PACKAGE_PATHS);
  const repositoryIndex = matchesAny(paths, REPOSITORY_INDEX_PATHS);
  const audit = matchesAny(paths, AUDIT_PATHS);
  const release = matchesAny(paths, RELEASE_PATHS);
  const source = paths.some(isSourcePath) || packageImpact || repositoryIndex || audit || release;
  const docsOnly = paths.length > 0 && docs && !source && !packageImpact && !repositoryIndex && !audit && !release;
  const nodeCompat = packageImpact || paths.some((filePath) => /^src\//u.test(filePath) || /^integrations\//u.test(filePath) || /^tests\//u.test(filePath));

  return {
    paths,
    forcedAll: false,
    docs,
    docs_only: docsOnly,
    repository_index: repositoryIndex,
    package: packageImpact,
    audit,
    node_compat: nodeCompat,
    source,
    release,
  };
}

function changedPathsFromGit(base, head) {
  const range = base ? [`${base}...${head}`] : [head];
  const args = base
    ? ["diff", "--name-only", "--diff-filter=ACDMRTUXB", ...range]
    : ["show", "--format=", "--name-only", head];
  const output = execFileSync("git", args, { encoding: "utf8" });
  return output.split(/\r?\n/u).filter(Boolean);
}

async function changedPathsFromEvent(eventPath = process.env.GITHUB_EVENT_PATH) {
  if (!eventPath) {
    throw new Error("No GitHub event payload is available; pass --paths or run inside GitHub Actions.");
  }
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  const pullRequest = event.pull_request;
  if (pullRequest?.base?.sha && pullRequest?.head?.sha) {
    return changedPathsFromGit(pullRequest.base.sha, pullRequest.head.sha);
  }
  if (event.before && event.after && !/^0{40}$/u.test(event.before)) {
    return changedPathsFromGit(event.before, event.after);
  }
  if (event.after) return changedPathsFromGit(null, event.after);
  throw new Error("GitHub event payload does not contain a comparable revision range.");
}

function parseArguments(argv) {
  const options = { paths: [], forceAll: false, json: false, githubOutput: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--paths") {
      const value = argv[++index];
      if (!value) throw new Error("--paths requires a path");
      options.paths.push(value);
    } else if (argument === "--all") {
      options.forceAll = true;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--github-output") {
      options.githubOutput = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

async function writeGitHubOutputs(result) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error("--github-output requires GITHUB_OUTPUT");
  const values = [
    ["docs", result.docs],
    ["docs_only", result.docs_only],
    ["repository_index", result.repository_index],
    ["package", result.package],
    ["audit", result.audit],
    ["node_compat", result.node_compat],
    ["source", result.source],
    ["release", result.release],
  ];
  await appendFile(outputPath, values.map(([key, value]) => `${key}=${value}\n`).join(""), "utf8");
}

export async function classifyFromArguments(argv = process.argv.slice(2), { eventPath } = {}) {
  const options = parseArguments(argv);
  const paths = options.paths.length > 0
    ? options.paths
    : options.forceAll
      ? []
      : await changedPathsFromEvent(eventPath);
  const result = classifyPaths(paths, { forceAll: options.forceAll });
  if (options.githubOutput) await writeGitHubOutputs(result);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1]?.endsWith("/ci-classify.mjs")) {
  try {
    await classifyFromArguments();
  } catch (error) {
    console.error(`CI classification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
