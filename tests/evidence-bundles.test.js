import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { runAdvance } from "../src/commands/advance.js";
import { runAttestationCreate } from "../src/commands/attestation-create.js";
import { runCheck } from "../src/commands/run-check.js";
import { runComplete } from "../src/commands/complete.js";
import { runEvidenceExport } from "../src/commands/evidence-export.js";
import { runPrepareCompletion } from "../src/commands/prepare-completion.js";
import { createConfig, writeConfig } from "../src/core/config.js";
import { assertEvidenceTaskId, evidenceBundleDigest, sealEvidenceBundle, serializeEvidenceBundle } from "../src/core/evidence/bundle-format.js";
import { formatEvidenceMarkdown } from "../src/core/evidence/markdown.js";
import { verifyEvidenceRange } from "../src/core/evidence/verify.js";
import { withSigningBundleFile } from "../src/core/signing/bundle-file.js";
import { taskAttestationBundlePath, taskAttestationStatementPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";
import { withTaskTransaction } from "../src/core/transaction.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.js");
const git = (target, ...args) => execFileSync("git", ["-C", target, ...args], { encoding: "utf8" }).trim();
const passingSigner = { name: "fixture-signer", async detect() { return true; }, async sign() { return { status: "VALID" }; }, async verify() { return { status: "VALID", signer: "fixture" }; } };

async function seedRepository() {
  const target = await createGitRepository("forgeloop-evidence-");
  await writeFile(path.join(target, ".gitignore"), ".forgeloop/\n", "utf8");
  git(target, "add", ".gitignore");
  git(target, "commit", "-qm", "ignore local state");
  await writeConfig(target, createConfig({
    attestation: { mode: "required", revisionProvider: "git", requireCompleteCoverage: true, signing: { provider: "none", required: false, policy: {} } },
  }), packageRoot);
  return { target, base: git(target, "rev-parse", "HEAD") };
}

async function completeAttestedTask(target, taskId, edit, { sign = false } = {}) {
  await setupVerifyingTask(target, packageRoot, { taskId, requirement: "tests" });
  await edit();
  await runPrepareCompletion({ target, packageRoot, taskId });
  for (const [id, requirement] of [[`${taskId}-check`, "tests"], [`${taskId}-completion`, "required action satisfies tests"]]) {
    const check = await runCheck({ target, packageRoot, taskId, id, requirement, argv: [process.execPath, "-e", "process.exit(0)"] });
    assert.equal(check.execution.status, "passed");
  }
  await runAdvance({ target, packageRoot, taskId, to: "REVIEWING" });
  assert.equal((await runComplete({ target, packageRoot, taskId })).status, "VALID");
  await runAttestationCreate({ target, packageRoot, taskId });
  if (sign) {
    await withTaskTransaction({ target, taskId, packageRoot, operation: "fixture-signature" }, () =>
      withSigningBundleFile(target, taskAttestationBundlePath(taskId), taskAttestationStatementPath(taskId), (filename) => writeFile(filename, "{\"fixture\":true}\n", "utf8")));
  }
  return runEvidenceExport({ target, packageRoot, taskId });
}

function commitAll(target, message) {
  git(target, "add", "-A", "--", "src", ".forgeloop-evidence");
  git(target, "commit", "-qm", message);
  return git(target, "rev-parse", "HEAD");
}

const verify = (target, base, head, options = {}) => verifyEvidenceRange({ target, packageRoot, revisionProvider: "git", baseRevision: base, headRevision: head, ...options });

async function withRepository(fn) {
  const { target, base } = await seedRepository();
  try { await fn(target, base); } finally { await removeTempTree(target); }
}

test("an exported bundle verifies the committed change at INTEGRITY_ONLY and is redacted", async () => {
  await withRepository(async (target, base) => {
    const exported = await completeAttestedTask(target, "evidence-a", () => writeFile(path.join(target, "src", "index.js"), "export const fixture = 2;\n"));
    assert.equal(exported.path, ".forgeloop-evidence/evidence-a.json");
    assert.equal(exported.signed, false);
    const text = await readFile(path.join(target, exported.path), "utf8");
    assert.equal(text.includes(target), false, "bundle must not contain the absolute project path");
    assert.equal(/"argv"|"stdout"|"stderr"|events\.ndjson/u.test(text), false);
    const metrics = JSON.parse(text).metrics;
    assert.equal(metrics.bound, false);
    assert.equal(metrics.verificationCycles >= 1, true);
    assert.equal(metrics.checksPassed, 2);
    assert.equal(metrics.checksFailed, 0);
    assert.ok(Number.isInteger(metrics.durationMs) && metrics.durationMs >= 0);
    assert.ok(["planning", "executing", "verifying", "reviewing"].every((phase) => Number.isInteger(metrics.phaseDurationsMs[phase])));
    const head = commitAll(target, "change with evidence");
    const result = await verify(target, base, head);
    assert.equal(result.status, "VALID");
    assert.equal(result.level, "INTEGRITY_ONLY");
    assert.equal(result.warnings.length, 1);
    assert.deepEqual(result.uncoveredPaths, []);
    assert.match(formatEvidenceMarkdown(result), /ForgeLoop evidence: Consistent, unsigned/);
  });
});

test("verification fails closed for uncovered paths, tampering, stale content and missing signatures", async () => {
  await withRepository(async (target, base) => {
    await completeAttestedTask(target, "evidence-b", () => writeFile(path.join(target, "src", "index.js"), "export const fixture = 3;\n"));
    await writeFile(path.join(target, "src", "extra.js"), "export const extra = true;\n");
    const uncoveredHead = commitAll(target, "uncovered extra file");
    const uncovered = await verify(target, base, uncoveredHead);
    assert.equal(uncovered.status, "INVALID");
    assert.deepEqual(uncovered.uncoveredPaths, ["src/extra.js"]);
    assert.equal((await verify(target, base, uncoveredHead, { requireCompleteCoverage: false })).status, "VALID");

    const unsigned = await verify(target, base, uncoveredHead, { requireCompleteCoverage: false, requireSignature: true, signingProvider: passingSigner });
    assert.ok(unsigned.errors.some((error) => error.code === "E_ATTESTATION_UNSIGNED"));

    await writeFile(path.join(target, "src", "index.js"), "export const fixture = 'edited later';\n");
    const staleHead = commitAll(target, "edit after evidence");
    const stale = await verify(target, base, staleHead, { requireCompleteCoverage: false });
    assert.ok(stale.errors.some((error) => error.code === "E_ATTESTATION_CONTENT_MISMATCH" && error.path === "src/index.js"));

    const bundlePath = path.join(target, ".forgeloop-evidence", "evidence-b.json");
    const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
    bundle.manifest.entries[0].sha256 = "0".repeat(64);
    await writeFile(bundlePath, serializeEvidenceBundle(bundle));
    const tamperedHead = commitAll(target, "tamper with evidence");
    const tampered = await verify(target, base, tamperedHead, { requireCompleteCoverage: false });
    assert.ok(tampered.errors.some((error) => error.code === "E_EVIDENCE_BUNDLE_INVALID"));
    assert.equal(tampered.bundles[0].integrity, "INVALID");
  });
});

test("task IDs with dots export and verify; unsafe IDs stay rejected", async () => {
  await withRepository(async (target, base) => {
    const exported = await completeAttestedTask(target, "release-2.2.0-final", () => writeFile(path.join(target, "src", "index.js"), "export const fixture = 3;\n"));
    assert.equal(exported.path, ".forgeloop-evidence/release-2.2.0-final.json");
    const head = commitAll(target, "dotted task id");
    assert.equal((await verify(target, base, head)).status, "VALID");
  });
  for (const unsafe of [".hidden", "../escape", "a/b", "a\\b", "", "x".repeat(201), "with space"]) {
    assert.throws(() => assertEvidenceTaskId(unsafe), { code: "E_EVIDENCE_BUNDLE_INVALID" }, unsafe);
  }
  assert.equal(assertEvidenceTaskId("a.b_c-1"), "a.b_c-1");
});

test("a later task supersedes an earlier task's entry for the same path", async () => {
  await withRepository(async (target, base) => {
    await completeAttestedTask(target, "evidence-first", () => writeFile(path.join(target, "src", "index.js"), "export const fixture = 'first';\n"));
    commitAll(target, "first task");
    await completeAttestedTask(target, "evidence-second", () => writeFile(path.join(target, "src", "index.js"), "export const fixture = 'second';\n"));
    const head = commitAll(target, "two tasks touch one file");
    const result = await verify(target, base, head);
    assert.equal(result.status, "VALID");
    assert.deepEqual(result.superseded.map((item) => [item.path, item.taskId, item.supersededBy]), [["src/index.js", "evidence-first", ["evidence-second"]]]);
  });
});

test("signed bundles reach ATTESTED only under the verifier's signer and policy", async () => {
  await withRepository(async (target, base) => {
    const exported = await completeAttestedTask(target, "evidence-signed", () => writeFile(path.join(target, "src", "index.js"), "export const fixture = 'signed';\n"), { sign: true });
    assert.equal(exported.signed, true);
    const head = commitAll(target, "signed evidence");
    const attested = await verify(target, base, head, { requireSignature: true, signingProvider: passingSigner, signerPolicy: { identity: "ci@example.invalid", issuer: "https://issuer.example.invalid" } });
    assert.equal(attested.status, "VALID");
    assert.equal(attested.level, "ATTESTED");
    const rejecting = { ...passingSigner, async verify() { return { status: "INVALID", code: "E_ATTESTATION_IDENTITY_UNTRUSTED", message: "untrusted" }; } };
    const rejected = await verify(target, base, head, { requireSignature: true, signingProvider: rejecting });
    assert.equal(rejected.status, "INVALID");
    assert.ok(rejected.errors.some((error) => error.code === "E_ATTESTATION_IDENTITY_UNTRUSTED"));
  });
});

test("export refuses tasks without a valid attestation", async () => {
  await withRepository(async (target) => {
    await setupVerifyingTask(target, packageRoot, { taskId: "evidence-incomplete", requirement: "tests" });
    await assert.rejects(runEvidenceExport({ target, packageRoot, taskId: "evidence-incomplete" }), (error) => error.code === "E_EVIDENCE_EXPORT_UNAVAILABLE");
  });
});

test("bundle digests cover every field and the CLI verifies a clean clone without .forgeloop", async () => {
  const body = { schemaVersion: 1, kind: "forgeloop-evidence-bundle", taskId: "x", value: 1 };
  const sealed = sealEvidenceBundle(body);
  assert.notEqual(evidenceBundleDigest({ ...sealed, value: 2 }), sealed.digest);

  await withRepository(async (target, base) => {
    await completeAttestedTask(target, "evidence-cli", () => writeFile(path.join(target, "src", "index.js"), "export const fixture = 'cli';\n"));
    const head = commitAll(target, "cli evidence");
    const clone = await mkdtemp(path.join(os.tmpdir(), "forgeloop-evidence-clone-"));
    try {
      execFileSync("git", ["clone", "-q", target, clone]);
      const run = (...args) => spawnSync(process.execPath, [cli, "evidence-verify", "--path", clone, "--base", base, "--head", head, ...args], { encoding: "utf8" });
      const markdown = run("--format", "markdown");
      assert.equal(markdown.status, 0, markdown.stderr);
      assert.match(markdown.stdout, /ForgeLoop evidence/);
      const json = JSON.parse(run("--json").stdout);
      assert.equal(json.level, "INTEGRITY_ONLY");
      const strict = run("--require-signature", "--json");
      assert.equal(strict.status, 1);
    } finally {
      await removeTempTree(clone);
    }
  });
});
