import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { detectProjectEvidence, readBounded } from "../project-detection.js";
import { discoverPolicy } from "../policy-discovery.js";
import { runTestInventory } from "../test-intelligence/service.js";

// Deterministic, read-only repository facts for `forgeloop assess`. Nothing here
// executes target repository code, writes files, or consults the decision plane.

export const ASSESSMENT_AREAS = Object.freeze(["backend", "database", "frontend", "infrastructure", "mobile"]);

const MAX_MANIFEST_BYTES = 1024 * 1024;

const FRONTEND_DEPENDENCIES = new Set([
  "@angular/core", "@remix-run/react", "@sveltejs/kit", "astro", "jquery", "lit", "next", "nuxt",
  "preact", "react", "react-dom", "solid-js", "svelte", "vue",
]);
const BACKEND_DEPENDENCIES = new Set([
  "@apollo/server", "@hapi/hapi", "@nestjs/core", "@trpc/server", "apollo-server", "express",
  "fastify", "graphql-yoga", "hono", "koa", "restify",
]);
const DATABASE_DEPENDENCIES = new Set([
  "@prisma/client", "better-sqlite3", "drizzle-orm", "knex", "mongodb", "mongoose", "mysql2", "pg",
  "prisma", "sequelize", "sqlite3", "typeorm",
]);
const BACKEND_FRAMEWORKS = new Set(["dotnet", "go", "java", "php", "python", "rust"]);
const MOBILE_FRAMEWORKS = new Set(["flutter", "swift"]);

const CI_PATHS = Object.freeze([".circleci/config.yml", ".gitlab-ci.yml", "Jenkinsfile", "azure-pipelines.yml", "bitbucket-pipelines.yml"]);
const CONTAINER_PATHS = Object.freeze(["Dockerfile", "compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"]);
const NODE_LOCKFILES = Object.freeze(["bun.lockb", "bun.lock", "npm-shrinkwrap.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
const WEB_ENTRY_PATHS = Object.freeze(["index.html", "public/index.html", "src/index.html"]);

const sorted = (values) => [...new Set(values)].sort();
const toPosix = (value) => value.split(path.sep).join("/");

async function exists(target, relative) {
  try { await access(path.join(target, relative)); return true; } catch { return false; }
}

async function existingPaths(target, candidates) {
  const found = [];
  for (const candidate of candidates) if (await exists(target, candidate)) found.push(candidate);
  return found;
}

async function ciWorkflows(target) {
  let entries = [];
  try { entries = await readdir(path.join(target, ".github/workflows")); } catch { entries = []; }
  const workflows = entries.filter((name) => /\.ya?ml$/u.test(name)).map((name) => `.github/workflows/${name}`);
  return sorted([...workflows, ...await existingPaths(target, CI_PATHS)]);
}

async function readManifest(target, root) {
  const relative = toPosix(path.join(root, "package.json"));
  const text = await readBounded(path.join(target, relative), MAX_MANIFEST_BYTES);
  if (text === null) return null;
  try {
    const manifest = JSON.parse(text);
    return manifest && typeof manifest === "object" && !Array.isArray(manifest) ? { relative, manifest } : null;
  } catch {
    return null;
  }
}

async function packageManifests(target, projectRoots) {
  const manifests = [];
  for (const root of sorted([".", ...projectRoots])) {
    const entry = await readManifest(target, root);
    if (entry) manifests.push(entry);
  }
  return manifests;
}

function dependencyNames(manifest) {
  return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies });
}

function matchDependencies(manifests, names) {
  const signals = [];
  for (const { relative, manifest } of manifests) {
    for (const name of dependencyNames(manifest)) if (names.has(name)) signals.push(`${relative}:dependency=${name}`);
  }
  return signals;
}

function addArea(areas, area, signals) {
  if (signals.length === 0) return;
  areas[area] = sorted([...(areas[area] ?? []), ...signals]);
}

function classifyAreas({ manifests, frameworks, webEntries, sqlProjects, infrastructure }) {
  const areas = {};
  addArea(areas, "frontend", [...matchDependencies(manifests, FRONTEND_DEPENDENCIES), ...webEntries.map((entry) => `${entry}:web-entry`)]);
  addArea(areas, "backend", [
    ...matchDependencies(manifests, BACKEND_DEPENDENCIES),
    ...frameworks.filter((name) => BACKEND_FRAMEWORKS.has(name)).map((name) => `framework=${name}`),
  ]);
  addArea(areas, "database", [
    ...matchDependencies(manifests, DATABASE_DEPENDENCIES),
    ...(sqlProjects ? ["framework=sql"] : []),
  ]);
  addArea(areas, "mobile", frameworks.filter((name) => MOBILE_FRAMEWORKS.has(name)).map((name) => `framework=${name}`));
  addArea(areas, "infrastructure", [...infrastructure.ci, ...infrastructure.containers].map((entry) => `${entry}:present`));
  return Object.fromEntries(ASSESSMENT_AREAS.filter((area) => areas[area]).map((area) => [area, areas[area]]));
}

function summarizeTests(inventory) {
  const tests = Array.isArray(inventory?.tests) ? inventory.tests : [];
  const byFramework = {};
  for (const entry of tests) byFramework[entry.framework] = (byFramework[entry.framework] ?? 0) + 1;
  return {
    total: tests.length,
    files: sorted(tests.map((entry) => entry.file)).length,
    byFramework: Object.fromEntries(Object.keys(byFramework).sort().map((key) => [key, byFramework[key]])),
  };
}

function stackFacts(evidence) {
  if (!evidence) return { status: "NOT_DETERMINED", frameworks: [], projectRoots: [], evidence: null };
  return { status: "DETECTED", frameworks: sorted(evidence.frameworks), projectRoots: sorted(evidence.projectRoots), evidence };
}

export async function collectAssessmentFacts(target) {
  const evidence = await detectProjectEvidence(target);
  const stack = stackFacts(evidence);
  const [policy, inventory, manifests, ci, containers, lockfiles, webEntries] = await Promise.all([
    discoverPolicy({ target }),
    runTestInventory({ projectRoot: target }),
    packageManifests(target, stack.projectRoots),
    ciWorkflows(target),
    existingPaths(target, CONTAINER_PATHS),
    existingPaths(target, NODE_LOCKFILES),
    existingPaths(target, WEB_ENTRY_PATHS),
  ]);
  const infrastructure = { ci, containers };
  const areas = classifyAreas({ manifests, frameworks: stack.frameworks, webEntries, sqlProjects: stack.frameworks.includes("sql"), infrastructure });
  return {
    stack,
    areas,
    policy: { languages: sorted(policy.languages ?? []), testing: policy.testing, linting: policy.linting },
    tests: summarizeTests(inventory),
    manifests: manifests.map(({ relative, manifest }) => ({ path: relative, scripts: sorted(Object.keys(manifest.scripts ?? {})), dependencyCount: dependencyNames(manifest).length })),
    repository: { ci, containers, lockfiles },
  };
}
