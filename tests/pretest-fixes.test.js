import { parse as parseYaml } from "yaml";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repositoryRoot = path.resolve(".");

test("ForgeLoop receipt discovery runs after checkout without skipping absent evidence", async () => {
  const workflow = parseYaml(await readFile(path.join(repositoryRoot, ".github/workflows/forgeloop-audit.yml"), "utf8"));
  const audit = workflow.jobs.audit;
  assert.equal(audit.if, undefined);
  const checkout = audit.steps.findIndex(step => step.uses?.startsWith("actions/checkout@"));
  const verify = audit.steps.findIndex(step => step.run === "node scripts/audit-receipts.mjs");
  assert.ok(checkout >= 0 && verify > checkout);
  assert.match(audit.steps[verify].if, /steps\.classify\.outputs\.audit/);
  const install = audit.steps.findIndex(step => step.run === "npm ci --ignore-scripts");
  assert.ok(install > checkout && install < verify);
  assert.match(audit.steps[install].if, /steps\.classify\.outputs\.audit/);
});

test("Lychee excludes only documented unavailable references", async () => {
  const config = (await readFile(path.join(repositoryRoot, ".lychee.toml"), "utf8"))
    .replaceAll("\r\n", "\n");

  assert.ok(config.includes("  '^https://fast-check\\.dev/$',"));
  assert.ok(config.includes("  '^https://gradientsaas\\.blogspot\\.com(?:/|$)',"));
  assert.ok(config.includes("  '^https://(?:www\\.)?testcontainers\\.com(?:/.*)?$',"));
  assert.ok(config.includes("  '^https://cheatsheetseries\\.owasp\\.org/cheatsheets/OAuth2_Cheat_Sheet\\.html$',"));
});

test("Lychee throttles the Ansible documentation host", async () => {
  const config = (await readFile(path.join(repositoryRoot, ".lychee.toml"), "utf8"))
    .replaceAll("\r\n", "\n");

  assert.match(config, /\[hosts\."docs\.ansible\.com"\]/);
  assert.match(config, /concurrency = 1/);
  assert.match(config, /request_interval = "5s"/);
});

test("Lychee fallback excludes only Ansible Molecule documentation paths", async () => {
  const config = (await readFile(path.join(repositoryRoot, ".lychee.toml"), "utf8"))
    .replaceAll("\r\n", "\n");

  assert.ok(config.includes("  '^https://docs\\.ansible\\.com/projects/molecule(?:/.*)?$',"));
});
