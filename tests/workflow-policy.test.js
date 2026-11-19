import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const pinnedAction = /uses:\s+[^\s]+@[0-9a-f]{40}\s+#/g;

test("RC3 documentation uses full validation and publication uses the runner-compatible link checker", async () => {
  const workflow = parse(await readWorkflow("docs.yml"));
  const selector = workflow.jobs.docs.steps.find(step => step.id === "release_mode");
  const script = /node --input-type=module <<'NODE'\n([\s\S]*?)\nNODE/u.exec(selector.run)?.[1];
  assert.ok(script, "documentation selector must use the shared Node release policy");
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-docs-release-policy-"));
  try {
    const output = path.join(directory, "github-output");
    execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, GITHUB_OUTPUT: output } });
    assert.match(await readFile(output, "utf8"), /^rc=false$/mu);
  } finally { await removeTempTree(directory); }
  const publication = parse(await readWorkflow("npm-publish.yml"));
  const links = publication.jobs.verify.steps.find(step => step.name === "Check links");
  assert.equal(links.uses, "./.github/actions/lychee");
  assert.equal(links.with.linuxTarget, "musl");
  assert.equal(links.with.fail, true);
});

test("the external link check runs only when publishing to npm", async () => {
  const usesLychee = (workflow) => Object.values(workflow.jobs).flatMap((job) => job.steps ?? []).filter((step) => step.uses === "./.github/actions/lychee");
  for (const name of await readdir(path.join(path.dirname(new URL(import.meta.url).pathname), "..", ".github", "workflows"))) {
    if (!name.endsWith(".yml")) continue;
    const steps = usesLychee(parse(await readWorkflow(name)));
    if (name === "npm-publish.yml") {
      assert.deepEqual(steps.map((step) => step.name), ["Check links"]);
      // The link check runs on the project's own Linux runner, not a GitHub-hosted one.
      const job = Object.values(parse(await readWorkflow(name)).jobs).find((candidate) => (candidate.steps ?? []).some((step) => step.name === "Check links"));
      assert.deepEqual(job["runs-on"], ["self-hosted", "Linux", "X64", "forgeloop-linux-remote"]);
    }
    else assert.deepEqual(steps, [], `${name} must not run the external link check`);
  }
});

test("core manual dispatch selects every gate without PR revision metadata and preserves PR path routing", { skip: process.platform === "win32" }, async () => {
  const workflow = parse(await readWorkflow("pr-core.yml"));
  const classify = workflow.jobs.classify.steps.find(step => step.id === "classify");
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-manual-classify-"));
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  try {
    for (const eventName of ["workflow_dispatch", "pull_request"]) {
      const eventPath = path.join(directory, `${eventName}.json`);
      const outputPath = path.join(directory, `${eventName}.output`);
      const event = eventName === "workflow_dispatch"
        ? { repository: { full_name: "cassiomc1/forgeloop" } }
        : { pull_request: { base: { sha: revision }, head: { sha: revision } } };
      await writeFile(eventPath, JSON.stringify(event));
      execFileSync("bash", ["-c", classify.run], { env: { ...process.env, EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath } });
      const outputs = Object.fromEntries((await readFile(outputPath, "utf8")).trim().split("\n").map(line => line.split("=")));
      for (const key of ["docs", "repository_index", "package", "audit", "node_compat", "source", "release"]) {
        assert.equal(outputs[key], String(eventName === "workflow_dispatch"), `${eventName}: ${key}`);
      }
      assert.equal(outputs.docs_only, "false");
    }
    assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"));
    assert.ok(workflow.jobs["repository-index"].needs.includes("core"));
    assert.ok(workflow.jobs["repository-index"].needs.includes("tarball-smoke"));
    assert.match(workflow.jobs["repository-index"].if, /always\(\)/);
    assert.equal(parse(await readWorkflow("repository-index.yml")).jobs.native.strategy["max-parallel"], 1);
    const compatibility = parse(await readWorkflow("node-compat.yml"));
    assert.equal(compatibility.jobs.expanded.needs, "minimum");
    assert.match(compatibility.jobs.expanded.if, /always\(\)/);
    assert.equal(compatibility.jobs.expanded.strategy["max-parallel"], 1);
  } finally { await removeTempTree(directory); }
});

async function readWorkflow(name) {
  return (await readFile(`.github/workflows/${name}`, "utf8")).replace(/\r\n/g, "\n");
}

function workflowJobBlocks(workflow) {
  const lines = workflow.split("\n");
  const jobsLine = lines.findIndex((line) => line === "jobs:");
  if (jobsLine < 0) return [];
  const headers = [];
  for (let index = jobsLine + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:$/u.test(lines[index])) headers.push(index);
  }
  return headers.map((start, index) => lines.slice(start, headers[index + 1] ?? lines.length).join("\n"));
}

test("PR and release quality workflows enforce the intended validation boundary", async () => {
  const core = await readWorkflow("pr-core.yml");
  const docs = await readWorkflow("docs.yml");
  const audit = await readWorkflow("forgeloop-audit.yml");
  const publish = await readWorkflow("npm-publish.yml");

  assert.match(core, /npm ci --ignore-scripts/);
  assert.match(core, /npm run dependency:policy/);
  assert.match(core, /npm run coverage:shard/);
  assert.match(core, /npm run coverage:report/);
  assert.match(core, /npm run critical-coverage:check/);
  assert.doesNotMatch(core, /name: Coverage \(Node 24\)/);
  assert.match(core, /coverage-shard-\$\{\{ matrix\.shard \}\}/);
  const coreJob = workflowJobBlocks(core).find((job) => job.startsWith("  core:"));
  assert.ok(coreJob, "PR core must define the unit-test job");
  assert.match(coreJob, /if: \$\{\{[^\n]*needs\.classify\.outputs\.source[^\n]*needs\.classify\.outputs\.node_compat[^\n]*\}\}/u);
  assert.match(core, /matrix\.node-version == '24\.19\.0'/);
  assert.match(core, /needs\.classify\.outputs\.source/);
  assert.match(core, /needs\.classify\.outputs\.node_compat/);
  assert.match(core, /name: Lint and dependency policy/);
  assert.match(core, /name: validate \(22\)/);
  assert.match(core, /name: Documentation validation/);
  assert.doesNotMatch(core, /Archify/u);
  assert.match(core, /name: tarball smoke \(ubuntu-latest\)/);
  assert.match(core, /steps\.classify\.outputs\.docs/);
  assert.match(core, /steps\.classify\.outputs\.audit/);
  assert.match(core, /steps\.classify\.outputs\.package/);
  assert.match(docs, /npm ci --ignore-scripts/);
  assert.match(docs, /npm run docs:check/);
  assert.match(docs, /paths:/);
  // The external link check runs only at npm publication, before npm ci, so
  // the PR documentation workflow has no Lychee exclusions to pin.
  assert.doesNotMatch(docs, /actions\/lychee/);
  assert.match(await readFile(".markdownlint-cli2.jsonc", "utf8"), /"ignores"/);
  assert.match(await readFile(".markdownlint-cli2.jsonc", "utf8"), /"\*\*\/node_modules\/\*\*"/);
  assert.match(audit, /npm ci --ignore-scripts/);
  assert.doesNotMatch(audit, /npx @cassiomc1\/forgeloop/);
  assert.match(publish, /npm ci --ignore-scripts/);
  assert.match(publish, /npm run dependency:policy/);

  for (const workflow of [core, docs, audit, publish]) {
    assert.ok((workflow.match(pinnedAction) ?? []).length > 0);
  }
});

test("Node compatibility uses targeted smoke instead of repeated full suites", async () => {
  const workflow = await readWorkflow("node-compat.yml");
  assert.match(workflow, /node-version: "24\.19\.0"/);
  assert.match(workflow, /test:quick/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /expanded:/);
  assert.doesNotMatch(workflow, /(?:^|\s)npm test(?:\s|$)/u);
});

test("security and release workflows are present and use pinned actions", async () => {
  const codeql = await readWorkflow("codeql.yml");
  const dependencyReview = await readWorkflow("dependency-review.yml");
  const releaseNotes = await readWorkflow("release-notes.yml");

  assert.match(codeql, /github\/codeql-action\/init@[0-9a-f]{40}/);
  assert.match(codeql, /github\/codeql-action\/analyze@[0-9a-f]{40}/);
  assert.match(dependencyReview, /actions\/dependency-review-action@[0-9a-f]{40}/);
  assert.match(releaseNotes, /gh release create/);
  assert.match(releaseNotes, /--generate-notes/);
  assert.match(releaseNotes, /npm pack --json/);
  assert.match(releaseNotes, /sha256sum/);

  for (const workflow of [codeql, dependencyReview, releaseNotes]) {
    assert.ok((workflow.match(pinnedAction) ?? []).length > 0);
  }
});

test("every tracked workflow job has a bounded timeout and read-only checkouts", async () => {
  const names = (await readdir(".github/workflows")).filter((name) => /\.ya?ml$/u.test(name));
  assert.ok(names.length > 0, "at least one workflow must be present");
  for (const name of names) {
    const workflow = await readWorkflow(name);
    const jobs = workflowJobBlocks(workflow);
    assert.ok(jobs.length > 0, `${name} must declare jobs`);
    for (const job of jobs) {
      if (job.includes("\n    uses: ./.github/workflows/")) {
        continue;
      }
      const timeout = Number(job.match(/^    timeout-minutes:\s*(\d+)\s*$/mu)?.[1]);
      assert.ok(Number.isInteger(timeout) && timeout > 0 && timeout < 360, `${name} has an unbounded job timeout`);
      if (job.includes("actions/checkout@")) {
        assert.match(job, /persist-credentials:\s*false/u, `${name} checkout must not persist credentials`);
      }
    }
    for (const match of workflow.matchAll(/^\s+-?\s*uses:\s+[^\s@]+@([^\s#]+)(?:\s+#.*)?$/gmu)) {
      assert.match(match[1], /^[0-9a-f]{40}$/u, `${name} contains a non-immutable action reference`);
    }
  }
});

test("hosted MCP acceptance exposes only the measured 1,000-task profile", async () => {
  const hosted = parse(await readWorkflow("mcp-resources-hosted.yml"));
  const dispatch = hosted.on.workflow_dispatch.inputs;
  assert.deepEqual(dispatch.events.options, ["10"]);
  assert.deepEqual(dispatch.selected_events.options, ["1000"]);
  assert.equal(hosted.jobs["mcp-resources"]["timeout-minutes"], 90);
  assert.deepEqual(hosted.jobs["mcp-resources"].strategy.matrix.include.map(row => row.case), ["tasks-1000-both"]);

  const windows = parse(await readWorkflow("windows-full-suite.yml"));
  assert.ok(!windows.on.workflow_dispatch.inputs.suite.options.includes("mcp-resources"));
  assert.ok(!Object.hasOwn(windows.jobs, "mcp-resources"));
});

test("Node test jobs use the requested hosts and preserve the platform matrices", async () => {
  const labels = {
    Linux: ["self-hosted", "Linux", "X64", "forgeloop-linux-remote"],
    macOS: ["self-hosted", "macOS", "ARM64", "forgeloop-macos-local"],
    Windows: ["self-hosted", "Windows", "X64", "forgeloop-windows-remote"],
  };
  const names = (await readdir(".github/workflows")).filter(name => /\.ya?ml$/u.test(name));
  for (const name of names) {
    const workflow = parse(await readWorkflow(name));
    for (const [id, job] of Object.entries(workflow.jobs)) {
      if (!job.steps?.some(step => /(?:npm (?:test|run (?:test(?::\w+)?|coverage(?::\w+)?|mcp:test|mcp:pack:check|pack:smoke|pack:check|docs:check|repository:hygiene))|node --test)/u.test(step.run ?? ""))) continue;
      if (job["runs-on"] === "${{ matrix.runner }}") {
        for (const entry of job.strategy.matrix.include) assert.deepEqual(entry.runner, labels[entry.os], `${name}/${id} platform routing`);
      } else {
        assert.deepEqual(job["runs-on"], labels[id === "test" && name === "windows-full-suite.yml" ? "Windows" : "Linux"], `${name}/${id} test location`);
      }
      assert.match(job.if, /github\.event_name != 'pull_request'|inputs\.confirm == 'PUBLISH (?:PRIVATE|PUBLIC) PACKAGE'/u, `${name}/${id} admission`);
    }
  }
  const compatibility = parse(await readWorkflow("node-compat.yml"));
  const prCore = parse(await readWorkflow("pr-core.yml"));
  assert.ok(!prCore.jobs.classify.steps.some(step => step.run?.includes("repository:hygiene")));
  const hygiene = prCore.jobs.lint.steps.find(step => step.run === "npm run repository:hygiene");
  assert.ok(hygiene, "repository hygiene must run on guarded remote Linux");
  assert.equal(hygiene.if, undefined, "documentation-only own-repository PRs must retain hygiene validation");
  for (const step of prCore.jobs.lint.steps.filter(step => step.uses?.startsWith("actions/checkout@") || step.uses?.startsWith("actions/setup-node@"))) {
    assert.equal(step.if, undefined, "hygiene prerequisites must run for every admitted PR");
  }
  assert.deepEqual(compatibility.jobs.expanded.strategy.matrix.include.map(row => [row.os, String(row["node-version"])]), [
    ["Linux", "24.19.0"], ["Linux", "26"], ["macOS", "24.19.0"], ["macOS", "24"], ["Windows", "24.19.0"], ["Windows", "24"],
  ]);
  assert.deepEqual(parse(await readWorkflow("package-smoke.yml")).jobs["release-tarball-smoke"].strategy.matrix.include.map(row => [row.os, String(row["node-version"])]), [
    ["macOS", "24"], ["Windows", "24.19.0"], ["Windows", "24"],
  ]);
  assert.equal(parse(await readWorkflow("repository-index.yml")).jobs.native.strategy.matrix.include.length, 3);
  for (const name of ["npm-publish.yml", "mcp-publish.yml"]) {
    const jobs = parse(await readWorkflow(name)).jobs;
    assert.equal(jobs.publish.needs, "verify", `${name} must wait for remote validation`);
    assert.equal(jobs.publish["runs-on"], "ubuntu-latest");
    assert.equal(jobs.verify.permissions["id-token"], undefined);
    assert.equal(jobs.publish.permissions["id-token"], "write");
    const publishCommand = name === "npm-publish.yml"
      ? "npm publish --provenance --access public --tag \"$NPM_DIST_TAG\""
      : "npm publish --provenance --access restricted";
    assert.ok(jobs.publish.steps.some(step => step.run === publishCommand));
    assert.ok(!jobs.verify.steps.some(step => step.run?.includes("npm publish")));
  }
});

test("evidence signing runs only from main with the OIDC permission confined to its job", async () => {
  const text = await readWorkflow("evidence-sign.yml");
  const workflow = parse(text);
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const job = workflow.jobs.sign;
  assert.equal(job.if, "${{ github.ref == 'refs/heads/main' }}");
  assert.deepEqual(job.permissions, { contents: "read", "id-token": "write" });
  assert.equal(job.env.TASK_ID, "${{ inputs.task }}");
  for (const step of job.steps.filter((candidate) => candidate.run)) {
    assert.doesNotMatch(step.run, /\$\{\{\s*inputs\./u, `${step.name} must read the task through TASK_ID`);
  }
  assert.ok(job.steps.some((step) => /node src\/cli\.js evidence-verify/u.test(step.run ?? "")), "the evidence must be verified before signing");
  assert.ok(job.steps.some((step) => step.run === "cosign attest-blob --statement statement.json --bundle statement.sigstore.json --yes"), "signing must use the core Sigstore provider arguments");
  assert.match(text, /--certificate-identity "https:\/\/github\.com\/\$\{GITHUB_REPOSITORY\}\/\.github\/workflows\/evidence-sign\.yml@refs\/heads\/main"/u);
  assert.match(text, /--certificate-oidc-issuer https:\/\/token\.actions\.githubusercontent\.com/u);
  const verifyStep = job.steps.find((step) => step.name === "Verify the signature against this workflow identity");
  assert.doesNotMatch(verifyStep.run, /--statement/u, "cosign 3 verify-blob-attestation has no --statement flag");
  assert.match(verifyStep.run, /--digest "\$subject_digest"/u);
  assert.match(verifyStep.run, /payload\.equals/u, "the signed payload must be compared with the statement");
  const names = job.steps.map((step) => step.name);
  const upload = job.steps.find((step) => step.name === "Upload the signature to ForgeLoop Cloud");
  assert.ok(names.indexOf("Upload the signature to ForgeLoop Cloud") > names.indexOf("Verify the signature against this workflow identity"), "only a verified signature is uploaded");
  assert.equal(upload.if, "${{ steps.cloud.outputs.enabled == 'true' }}", "the upload is skipped without the secret");
  assert.equal(upload.env.FORGELOOP_SYNC_TOKEN, "${{ secrets.FORGELOOP_SYNC_TOKEN }}");
  assert.equal(job.env.FORGELOOP_SYNC_TOKEN, undefined, "the token is scoped to the steps that need it");
  assert.match(upload.run, /--data-binary @statement\.sigstore\.json/u);
  assert.match(upload.run, /https:\/\/forgeloop\.monster\/api\/signatures\?repo=\$\{GITHUB_REPOSITORY\}/u);
  assert.doesNotMatch(upload.run, /echo[^\n]*FORGELOOP_SYNC_TOKEN/u, "the token is never echoed");
});
