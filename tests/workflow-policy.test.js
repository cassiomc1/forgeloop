import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const pinnedAction = /uses:\s+[^\s]+@[0-9a-f]{40}\s+#/g;

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
  assert.match(core, /npm run coverage/);
  assert.match(core, /npm run critical-coverage:check/);
  assert.doesNotMatch(core, /(?:^|\s)npm test(?:\s|$)/u);
  assert.match(core, /name: validate \(22\)/);
  assert.match(core, /name: Verify generated Archify diagram/);
  assert.match(core, /name: tarball smoke \(ubuntu-latest\)/);
  assert.match(core, /steps\.classify\.outputs\.docs/);
  assert.match(core, /steps\.classify\.outputs\.audit/);
  assert.match(core, /steps\.classify\.outputs\.package/);
  assert.match(docs, /npm ci --ignore-scripts/);
  assert.match(docs, /npm run docs:check/);
  assert.match(docs, /paths:/);
  assert.match(docs, /--exclude-path '\(\^\|\/\)node_modules\(\/\|\$\)'/);
  assert.match(docs, /--exclude-path '\(\^\|\/\)coverage\(\/\|\$\)'/);
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
  assert.match(workflow, /node-version: 20/);
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
