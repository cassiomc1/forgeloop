import { parse as parseYaml } from "yaml";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { TEMPLATE_PATHS } from "../src/core/templates.js";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const RETIRED_RUNTIME_SOURCES = new Set([
  "src/core/cli-metadata.js",
  "src/core/decision-classification.js",
  "src/core/gates.js",
  "src/core/workflow-compatibility.js",
]);

async function runtimeSourcePaths(directory = "src") {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await runtimeSourcePaths(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      paths.push(fullPath.split(path.sep).join("/"));
    }
  }
  return paths.sort();
}

let cachedListing;
function packageListing() {
  cachedListing ??= JSON.parse(execFileSync(npmCommand, ["pack", "--dry-run", "--json"], {
    encoding: "utf8", shell: process.platform === "win32",
  }))[0].files.map((entry) => entry.path);
  return cachedListing;
}

test("npm tarball contains the CLI, templates, published scenarios, and license notices", () => {
  const listing = packageListing();

  for (const expected of [
    "src/cli.js",
    "src/integration.js",
    "src/integration.d.ts",
    "src/core/command-runtime.js",
    "src/core/command-executors.js",
    "src/core/command-input.js",
    "src/core/integration-invocation-policy.js",
    "src/core/integration-resources.js",
    "src/core/integration-limits.js",
    "src/core/project-root.js",
    "src/core/structural-quality/artifacts.js",
    "src/core/structural-quality/constants.js",
    "src/core/structural-quality/policy.js",
    "src/core/structural-quality/provider.js",
    "src/core/structural-quality/sentrux-mcp.js",
    "src/core/structural-quality/service.js",
    "src/core/structural-quality/source-fingerprint.js",
    "src/core/structural-quality/status.js",
    "src/config/guides.json",
    "src/core/discovery-surfaces.js",
    "src/core/verification-capability.js",
    "src/core/task-claim-state.js",
    "src/core/recovery-history.js",
    "benchmarks/execution-profiles/api-feature.json",
    "benchmarks/execution-profiles/authentication-change.json",
    "benchmarks/execution-profiles/documentation-correction.json",
    "benchmarks/execution-profiles/infrastructure-release.json",
    "benchmarks/execution-profiles/small-bug-fix.json",
    "benchmarks/execution-profiles/static-landing-page.json",
    "benchmarks/execution-profiles/novatask-saas-landing-page.json",
    "docs/EXECUTION_PROFILE_BENCHMARKS.md",
    "benchmarks/repository-index/queries.json",
    "benchmarks/repository-index/README.md",
    "benchmarks/repository-index/run-persistent-transport.mjs",
    "src/repository-index/constants.js",
    "src/repository-index/manifest.js",
    "src/repository-index/platform.js",
    "src/repository-index/paths.js",
    "src/repository-index/binary-manager.js",
    "src/repository-index/process.js",
    "src/repository-index/server.js",
    "src/repository-index/search.js",
    "src/repository-index/normalize-json.js",
    "src/repository-index/status.js",
    "src/repository-index/metrics.js",
    "src/repository-index/errors.js",
    "src/repository-index/args.js",
    "src/repository-index/lock.js",
    "src/repository-index/lifecycle.js",
    "src/repository-index/tgrep-manifest.json",
    "src/persistent-transport/constants.js",
    "src/persistent-transport/errors.js",
    "src/persistent-transport/paths.js",
    "src/persistent-transport/framing.js",
    "src/persistent-transport/protocol.js",
    "src/persistent-transport/state.js",
    "src/persistent-transport/ownership.js",
    "src/persistent-transport/lifecycle.js",
    "src/persistent-transport/client.js",
    "src/persistent-transport/server.js",
    "docs/REPOSITORY_INDEX.md",
    "scripts/verify-tgrep-manifest.mjs",
    "scripts/update-tgrep-manifest.mjs",
    "scripts/run-execution-profile-benchmarks.mjs",
    "scripts/summarize-execution-profile-benchmarks.mjs",
    "scripts/validate-execution-profile-benchmarks.mjs",
    "scripts/check-efficiency-regression.mjs",
    "scripts/lib/execution-profile-benchmark-io.mjs",
    ...TEMPLATE_PATHS.filter((relativePath) => relativePath !== ".forgeloop/.gitignore"),
    ".forgeloop/forgeloop.gitignore",
    "QUALITY_SCORECARD.md",
    "TERMINOLOGY.md",
    "EXECUTION_STATE.md",
    "DELEGATION_PROTOCOL.md",
    "ORCHESTRATOR_INTEGRATION.md",
    "schemas/routing-input.schema.json",
    "schemas/routing-result.schema.json",
    "schemas/work-state.schema.json",
    "schemas/execution-receipt.schema.json",
    "schemas/task-brief.schema.json",
    "schemas/delegated-result.schema.json",
    "schemas/task-recovery.schema.json",
    "schemas/evidence.schema.json",
    "schemas/action.schema.json",
    "schemas/approval.schema.json",
    "schemas/capability-policy.schema.json",
    "schemas/trajectory-evaluation.schema.json",
    "schemas/trajectory-scenario.schema.json",
    "THREAT_MODEL.md",
    "CONTRACT_COVERAGE.md",
    "PROTOCOL_INTEGRATION.md",
    "DOCS_INDEX.md",
    "docs/STRUCTURAL_QUALITY.md",
    "docs/ADVISORY_CONTEXT.md",
    "docs/RELEASE_CHECKLIST.md",
    "docs/MCP.md",
    "docs/UNIVERSAL_INTEGRATION.md",
    "docs/CODE_ATTESTATION.md",
    "docs/REVISION_PROVIDERS.md",
    "docs/SIGNING_PROVIDERS.md",
    "docs/PLATFORM_ADAPTERS.md",
    "docs/RIPWIRE_ADAPTER.md",
    "docs/AGENT_PROTOCOL_SUMMARY.md",
    "docs/diagrams/README.md",
    "docs/diagrams/manifest.json",
    "docs/diagrams/forgeloop-code-attestation-flow.workflow.json",
    "docs/diagrams/forgeloop-engineering-flow.workflow.json",
    "docs/diagrams/forgeloop-verification-trust-flow.workflow.json",
    "docs/assets/diagrams/forgeloop-code-attestation-flow.html",
    "docs/assets/diagrams/forgeloop-code-attestation-flow.svg",
    "docs/assets/diagrams/forgeloop-code-attestation-flow.receipt.json",
    "docs/assets/diagrams/forgeloop-engineering-flow.html",
    "docs/assets/diagrams/forgeloop-engineering-flow.svg",
    "docs/assets/diagrams/forgeloop-engineering-flow.receipt.json",
    "docs/assets/diagrams/forgeloop-verification-trust-flow.html",
    "docs/assets/diagrams/forgeloop-verification-trust-flow.svg",
    "docs/assets/diagrams/forgeloop-verification-trust-flow.receipt.json",
    "scripts/CI_VALIDATORS.md",
    "LICENSE",
    "LICENSE-DOCS.md",
    "completions/forgeloop.bash",
    "completions/_forgeloop",
    "completions/forgeloop.fish",
    "integrations/generic-ci/verify.sh",
  ]) {
    assert.ok(listing.includes(expected), `missing ${expected}`);
  }
  for (const excluded of [
    "src/core/agent-support.js",
    "src/core/gates.js",
    "src/core/decision-classification.js",
    "src/core/workflow-compatibility.js",
    "src/core/cli-metadata.js",

    "tests/cli.test.js",
    "scripts/scan_secrets.py",
    ".forgeloop/work-state.json",
    "docs/assets/eng_readme_forgeloop.png",
    "docs/superpowers/plans/2026-08-11-10-of-10-roadmap-implementation.md",
    "docs/RELEASE_CHECKLIST_1_4.md",
    "docs/RELEASE_CHECKLIST_1_5_MCP.md",
    "docs/RELEASE_CHECKLIST_1_6_1.md",
    "FORGELOOP_ECOSYSTEM_DOCUMENTATION_NPM_RELEASE_COMPATIBILITY_PLAN.md",
    "release-train-contract.json",
    "release-train-contract-v2.json",
    // Benchmark scenarios are public package inputs; historical measurements
    // remain repository evidence and must never inflate the core tarball.
    ...listing.filter((entry) => entry.startsWith("benchmarks/execution-profiles/results")),
    ...listing.filter((entry) => entry.startsWith("benchmarks/ripwire-context/")),
    ...listing.filter((entry) => entry === "scripts/benchmark-ripwire-context.mjs"),
    ...listing.filter((entry) => entry.startsWith(".forgeloop/") && entry !== ".forgeloop/forgeloop.gitignore"),
    // The MCP package ships separately, never inside the core tarball.
    ...listing.filter((entry) => entry.startsWith("integrations/mcp/")),
    ...listing.filter((entry) => entry.includes("package-dry-run")),
    ...listing.filter((entry) => entry.endsWith(".tgz")),
  ]) {
    assert.equal(listing.includes(excluded), false, `unexpected ${excluded}`);
  }

  const forbiddenOraclePatterns = [
    /EXPECTED_ROUTE/i,
    /REQUIRED_EVIDENCE/i,
    /REQUIRED_GATES/i,
    /blind-premium-website/i,
    /^conformance\//i,
  ];

  for (const packagedPath of listing) {
    for (const pattern of forbiddenOraclePatterns) {
      assert.equal(pattern.test(packagedPath), false, `oracle leakage in tarball: ${packagedPath}`);
    }
  }
});

test("npm tarball ships every maintained runtime module", async () => {
  const listing = packageListing();
  const runtimeSources = await runtimeSourcePaths();

  assert.ok(runtimeSources.length > 0, "src must contain runtime JavaScript modules");
  for (const sourcePath of runtimeSources) {
    const retired = RETIRED_RUNTIME_SOURCES.has(sourcePath);
    assert.equal(
      listing.includes(sourcePath),
      !retired,
      retired
        ? `retired runtime module was unexpectedly packaged: ${sourcePath}`
        : `maintained runtime module is missing from the package: ${sourcePath}`,
    );
  }
});

test("CLI package entry is executable by Node-compatible shells", async () => {
  const cli = (await readFile("src/cli.js", "utf8")).replace(/\r\n/g, "\n");
  const metadata = await stat("src/cli.js");
  assert.match(cli, /^#!\/usr\/bin\/env node\n/);
  assert.ok(metadata.isFile());
  if (process.platform !== "win32") {
    assert.notEqual(metadata.mode & 0o111, 0);
  }
});

test("release workflow requires an OIDC-compatible provenance publishing step", async () => {
  const workflow = parseYaml(await readFile(".github/workflows/npm-publish.yml", "utf8"));
  const publishingJobs = Object.values(workflow.jobs).filter(job => job.steps.some(step => step.run?.includes("npm publish")));
  assert.equal(publishingJobs.length, 1);
  const job = publishingJobs[0];
  assert.equal(job.permissions?.["id-token"] ?? workflow.permissions?.["id-token"], "write");
  const setup = job.steps.find(step => step.uses?.startsWith("actions/setup-node@"));
  assert.match(setup.uses, /@[a-f0-9]{40}$/u);
  assert.ok(Number(setup.with["node-version"]) >= 24);
  const publish = job.steps.find(step => step.run?.includes("npm publish"));
  assert.match(publish.run, /npm publish[^\n]*--provenance/u);
  assert.match(publish.run, /--access public/u);
  const smoke = job.steps.find(step => step.run?.includes("npm run pack:smoke"));
  assert.ok(smoke, "publication must smoke-test the packed package before publishing");
  assert.ok(job.steps.indexOf(smoke) < job.steps.indexOf(publish), "package smoke must run before npm publish");
});

test("PR CI has one full Node execution and targeted Node compatibility", async () => {
  const core = parseYaml(await readFile(".github/workflows/pr-core.yml", "utf8"));
  const coreJob = core.jobs.core;
  assert.deepEqual(coreJob.strategy.matrix["node-version"], [20, 24]);
  assert.match(coreJob.steps.find(step => step.name.includes("single full")).run, /npm run coverage/);
  assert.doesNotMatch(coreJob.steps.find(step => step.name.includes("single full")).run, /npm test/u);
  const compatibility = parseYaml(await readFile(".github/workflows/node-compat.yml", "utf8"));
  assert.match(compatibility.jobs.minimum.steps.at(-1).run, /test:quick/);
  assert.doesNotMatch(JSON.stringify(compatibility.jobs), /npm test/u);
});

test("required validation context rejects failed, unexpected, or missing prerequisites", async () => {
  const workflow = parseYaml(await readFile(".github/workflows/pr-core.yml", "utf8"));
  const gate = workflow.jobs["required-validation"];
  assert.equal(gate.name, "validate (22)");
  assert.equal(gate.if, "${{ always() }}");
  assert.deepEqual(gate.needs, ["classify", "core", "docs-diagram", "audit", "tarball-smoke", "repository-index"]);
  const script = /node --input-type=module <<'NODE'\n([\s\S]+?)\nNODE/u.exec(gate.steps[0].run)?.[1];
  assert.ok(script);
  const runGate = results => execFileSync(process.execPath, ["-e", script], {
    env: { ...process.env, REQUIRED_RESULTS: JSON.stringify(results), REPOSITORY_INDEX_APPLICABLE: "false" }, stdio: "pipe",
  });
  const passed = Object.fromEntries(gate.needs.map(name => [name, { result: name === "repository-index" ? "skipped" : "success" }]));
  assert.doesNotThrow(() => runGate(passed));
  for (const name of gate.needs.filter(name => name !== "repository-index")) {
    for (const result of ["failure", "cancelled", "skipped"]) {
      assert.throws(() => runGate({ ...passed, [name]: { result } }));
    }
    const missing = { ...passed };
    delete missing[name];
    assert.throws(() => runGate(missing));
  }
  assert.throws(() => runGate({ ...passed, ["repository-index"]: { result: "failure" } }));
  assert.doesNotThrow(() => execFileSync(process.execPath, ["-e", script], {
    env: { ...process.env, REQUIRED_RESULTS: JSON.stringify({ ...passed, ["repository-index"]: { result: "success" } }), REPOSITORY_INDEX_APPLICABLE: "true" }, stdio: "pipe",
  }));
});

test("published package metadata declares the repository license and integration types", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const mcpPackageJson = JSON.parse(await readFile("integrations/mcp/package.json", "utf8"));
  assert.equal(packageJson.license, "MIT");
  assert.equal(mcpPackageJson.license, "MIT");
  assert.equal(packageJson.exports?.["./integration"]?.types, "./src/integration.d.ts");
  assert.ok(packageJson.files.includes("src"));
});

test("documentation manifest packaged:true entries always ship in the core tarball", async () => {
  const manifest = JSON.parse(await readFile("docs/documentation-manifest.json", "utf8"));
  const expectedDocs = manifest.documents
    .filter((entry) => entry.packaged === true)
    .map((entry) => entry.path)
    .sort();

  const listing = packageListing();

  assert.ok(expectedDocs.length > 0, "manifest must declare at least one packaged document");
  for (const docPath of expectedDocs) {
    assert.ok(
      listing.includes(docPath),
      `documentation manifest marks ${docPath} packaged:true but the core tarball omits it`,
    );
  }
});

test("public integration exports include advisory context, portable context, and handoff acceptance", async () => {
  const integration = await import("../src/integration.js");
  const expectedExports = [
    "recallAdvisoryContext",
    "acceptCanonicalHandoff",
    "resolveHandoffAcceptance",
    "ADVISORY_CONTEXT_LIMITS",
    "ADVISORY_CONTEXT_TRUST",
    "assertAdvisoryContextProvider",
    "normalizeAdvisoryContextResult",
    "normalizePortableText",
    "assertPortableContextSafe",
  ];

  for (const exp of expectedExports) {
    assert.ok(exp in integration, `missing public integration export: ${exp}`);
  }
});
