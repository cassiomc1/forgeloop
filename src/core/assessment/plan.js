import { evaluateRoute } from "../router.js";
import { GUIDE_FILES } from "../guide-registry.js";

// Review plan for `forgeloop assess`. The plan routes guides and lists
// candidate checks; it never executes them and carries no evidence authority.

const AREA_ROUTES = Object.freeze({
  backend: Object.freeze({ surfaces: ["api"], platforms: ["server"], risks: ["untrusted-input"] }),
  database: Object.freeze({ surfaces: ["database"], platforms: ["server"], risks: [] }),
  frontend: Object.freeze({ surfaces: ["ui"], platforms: ["web"], risks: [] }),
  infrastructure: Object.freeze({ surfaces: ["ci"], platforms: ["ci"], risks: [] }),
  mobile: Object.freeze({ surfaces: ["mobile"], platforms: ["mobile"], risks: [] }),
});

const SCRIPT_PURPOSES = Object.freeze({
  build: "build", check: "check", lint: "lint", test: "test", typecheck: "typecheck", "type-check": "typecheck",
});

const FRAMEWORK_CHECKS = Object.freeze({
  dotnet: [["dotnet", "test"]],
  flutter: [["flutter", "analyze"], ["flutter", "test"]],
  go: [["go", "test", "./..."], ["go", "vet", "./..."]],
  rust: [["cargo", "clippy"], ["cargo", "test"]],
});

export const FINDING_CATEGORIES = Object.freeze([
  "accessibility", "bug", "design", "maintainability", "performance", "security", "test-gap",
]);
export const FINDING_SEVERITIES = Object.freeze(["critical", "high", "medium", "low"]);

export const FINDING_CONTRACT = Object.freeze({
  schemaVersion: 1,
  required: Object.freeze(["id", "area", "category", "severity", "title", "location", "evidence", "guide", "recommendation", "suggestedClaims", "suggestedVerification"]),
  categories: FINDING_CATEGORIES,
  severities: FINDING_SEVERITIES,
  evidenceKinds: Object.freeze(["OBSERVED", "INFERRED"]),
  rules: Object.freeze([
    "location cites a repository-relative POSIX file and a 1-based line",
    "OBSERVED evidence names a reproducible source: a quoted code excerpt or the argv and output of an executed check",
    "INFERRED findings rank below OBSERVED findings of the same severity and never use severity critical",
    "guide is the routed guide ID whose rule the finding applies",
    "each accepted finding becomes its own ForgeLoop task with suggestedClaims as write claims",
  ]),
});

function routeArea(area, evidence) {
  const route = AREA_ROUTES[area];
  const result = evaluateRoute({
    workType: "code",
    executableChange: true,
    surfaces: route.surfaces,
    platforms: route.platforms,
    risks: route.risks,
    ...(evidence ? { projectEvidence: evidence } : {}),
  });
  return { area, signals: route, guides: [...result.guides].sort() };
}

function guideEntries(ids) {
  return [...new Set(ids)].sort().map((id) => ({ id, path: GUIDE_FILES[id] }));
}

function scriptArgv(name) {
  return name === "test" ? ["npm", "test"] : ["npm", "run", name];
}

function manifestChecks(manifests) {
  const checks = [];
  for (const { path: manifestPath, scripts } of manifests) {
    if (manifestPath !== "package.json") continue;
    for (const name of scripts) {
      if (SCRIPT_PURPOSES[name]) checks.push({ argv: scriptArgv(name), purpose: SCRIPT_PURPOSES[name], source: `package.json:scripts.${name}` });
    }
  }
  return checks;
}

function policyChecks(policy) {
  const checks = [];
  if (policy.testing?.detected && policy.testing.command) checks.push({ argv: policy.testing.command, purpose: "test", source: "policy-discovery:testing" });
  if (policy.linting?.detected && policy.linting.command) checks.push({ argv: policy.linting.command, purpose: "lint", source: "policy-discovery:linting" });
  return checks;
}

function frameworkChecks(frameworks) {
  return frameworks.flatMap((name) => (FRAMEWORK_CHECKS[name] ?? []).map((argv) => ({
    argv, purpose: argv[1] === "test" ? "test" : "lint", source: `framework-convention:${name}`,
  })));
}

export function candidateChecks(facts) {
  const unique = new Map();
  for (const check of [...policyChecks(facts.policy), ...manifestChecks(facts.manifests), ...frameworkChecks(facts.stack.frameworks)]) {
    const key = check.argv.join("\u0000");
    if (!unique.has(key)) unique.set(key, { ...check, argv: [...check.argv], status: "NOT_EXECUTED" });
  }
  return [...unique.values()].sort((a, b) => a.argv.join(" ").localeCompare(b.argv.join(" ")));
}

function gap(code, message, source) {
  return { code, severity: "advisory", evidenceKind: "OBSERVED", source, message };
}

export function observedGaps(facts, checks) {
  const purposes = new Set(checks.map((check) => check.purpose));
  const gaps = [];
  if (facts.stack.status === "NOT_DETERMINED") gaps.push(gap("STACK_NOT_DETERMINED", "Project detection could not determine the stack within its traversal budget; review areas may be incomplete.", "project-detection"));
  if (facts.tests.total === 0) gaps.push(gap("TESTS_NOT_DETECTED", "No automated tests were discovered.", "test-inventory"));
  if (!purposes.has("test")) gaps.push(gap("TEST_COMMAND_NOT_DETECTED", "No test command was discovered.", "candidate-checks"));
  if (!purposes.has("lint")) gaps.push(gap("LINT_COMMAND_NOT_DETECTED", "No lint command was discovered.", "candidate-checks"));
  if (facts.stack.frameworks.includes("typescript") && !purposes.has("typecheck")) gaps.push(gap("TYPECHECK_COMMAND_NOT_DETECTED", "TypeScript was detected without a typecheck script.", "package.json:scripts"));
  if (facts.repository.ci.length === 0) gaps.push(gap("CI_NOT_DETECTED", "No continuous integration configuration was discovered.", "repository-files"));
  if (facts.manifests.some((manifest) => manifest.dependencyCount > 0) && facts.repository.lockfiles.length === 0) gaps.push(gap("LOCKFILE_NOT_DETECTED", "package.json declares dependencies without a lockfile.", "repository-files"));
  return gaps;
}

export function buildReviewPlan(facts) {
  const areas = Object.keys(facts.areas).map((area) => routeArea(area, facts.stack.evidence));
  const checks = candidateChecks(facts);
  return {
    areas: areas.map((entry) => ({ ...entry, guides: guideEntries(entry.guides), detectedBy: facts.areas[entry.area] })),
    guides: guideEntries(areas.flatMap((entry) => entry.guides)),
    candidateChecks: checks,
    gaps: observedGaps(facts, checks),
    findingContract: FINDING_CONTRACT,
    nextSteps: [
      "Read each routed guide before reviewing its area.",
      "Review each area read-only and record findings that satisfy findingContract.",
      "Run candidate checks only inside a ForgeLoop task with `forgeloop run-check`; they are NOT_EXECUTED here.",
      "Create one ForgeLoop task per accepted finding with `forgeloop task-create --claim <path>`.",
    ],
  };
}
