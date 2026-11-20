import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runAdvance } from "../src/commands/advance.js";
import { runAttestationCreate } from "../src/commands/attestation-create.js";
import { runCheck } from "../src/commands/run-check.js";
import { runComplete } from "../src/commands/complete.js";
import { runPrepareCompletion } from "../src/commands/prepare-completion.js";
import { PREDICATE_SCHEMA_VERSION, predicateChecks, validateAttestationPredicate } from "../src/core/attestation.js";
import { createConfig, writeConfig } from "../src/core/config.js";
import { predicateExecutionAssurance } from "../src/core/evidence/verify.js";
import { getPackageRoot } from "../src/core/templates.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";

// docs/PROTOCOL_SPEC.md Sections 5 and 7.2: predicate schema version 2 binds the
// recorded checks; execution assurance is derived from their provenance.

const hex = (character) => character.repeat(64);

function predicate(schemaVersion, checks) {
  return {
    schemaVersion,
    protocol: { name: "ForgeLoop", protocolVersion: 1 },
    task: { taskId: "predicate-v2", verificationCycle: 1 },
    content: { manifestFingerprint: hex("a"), contentDigest: hex("b"), coveredPaths: ["src/a.js"] },
    evidence: {
      contractFingerprint: hex("c"), routeFingerprint: hex("d"), stateFingerprint: hex("e"),
      receiptFingerprint: hex("f"), ledgerSeq: 3, ledgerHash: hex("1"),
    },
    verification: { completion: "VALID", audit: "VALID", ...(checks ? { checks } : {}) },
  };
}

const executed = { id: "tests", requirement: "tests", status: "passed", provenance: "FORGELOOP_EXECUTED", exitCode: 0, argvDigest: hex("2") };

test("new statements use predicate schema version 2", () => {
  assert.equal(PREDICATE_SCHEMA_VERSION, 2);
});

test("predicateChecks keeps the latest check per id and binds argv by digest only", () => {
  const argv = ["npm", "run", "verify:prepush"];
  const checks = predicateChecks({
    checks: [
      { id: "prepush", requirement: "verify:prepush passes", status: "failed", provenance: "FORGELOOP_EXECUTED", exitCode: 1, timestamp: "2026-11-20T00:00:00.000Z", details: { verificationCycle: 1, execution: { argv } } },
      { id: "prepush", requirement: "verify:prepush passes", status: "passed", provenance: "FORGELOOP_EXECUTED", exitCode: 0, timestamp: "2026-11-20T01:00:00.000Z", details: { verificationCycle: 2, execution: { argv } } },
      { id: "manual", requirement: "looked at the page", status: "passed", provenance: "MANUAL_OBSERVATION" },
      { id: "odd", requirement: "legacy check", status: "passed", provenance: "SOMETHING_ELSE", exitCode: "0" },
    ],
  });
  assert.deepEqual(checks.map((check) => check.id), ["manual", "odd", "prepush"]);
  const prepush = checks.find((check) => check.id === "prepush");
  assert.equal(prepush.status, "passed");
  assert.equal(prepush.exitCode, 0);
  assert.equal(prepush.argvDigest, createHash("sha256").update(JSON.stringify(argv)).digest("hex"));
  assert.ok(!JSON.stringify(checks).includes("verify:prepush\""), "argv itself is never bound");
  assert.equal(checks.find((check) => check.id === "manual").argvDigest, null);
  assert.equal(checks.find((check) => check.id === "odd").provenance, "UNKNOWN");
  assert.equal(checks.find((check) => check.id === "odd").exitCode, null);
});

test("version 2 requires checks and version 1 forbids them", async () => {
  await validateAttestationPredicate(predicate(2, [executed]));
  await validateAttestationPredicate(predicate(1));
  await assert.rejects(() => validateAttestationPredicate(predicate(2)), /requires verification\.checks/u);
  await assert.rejects(() => validateAttestationPredicate(predicate(1, [executed])), /must not carry verification\.checks/u);
  await assert.rejects(() => validateAttestationPredicate(predicate(3, [executed])), (error) => error.code === "E_ATTESTATION_STATEMENT_INVALID");
  await assert.rejects(() => validateAttestationPredicate(predicate(2, [{ ...executed, argvDigest: "npm test" }])), (error) => error.code === "E_ATTESTATION_STATEMENT_INVALID");
});

test("execution assurance follows check provenance", () => {
  assert.equal(predicateExecutionAssurance(predicate(1)), "UNKNOWN");
  assert.equal(predicateExecutionAssurance(predicate(2, [])), "UNKNOWN");
  assert.equal(predicateExecutionAssurance(predicate(2, [executed])), "EXECUTED");
  assert.equal(predicateExecutionAssurance(predicate(2, [executed, { ...executed, id: "eyes", provenance: "ACTOR_REPORTED" }])), "REPORTED");
});

test("attestation-create emits a version-2 predicate that binds the task's executed checks", async () => {
  const packageRoot = getPackageRoot();
  const target = await createGitRepository("forgeloop-predicate-v2-");
  const taskId = "predicate-v2-e2e";
  try {
    await setupVerifyingTask(target, packageRoot, { taskId, requirement: "tests" });
    await writeConfig(target, createConfig({
      attestation: { mode: "required", revisionProvider: "git", requireCompleteCoverage: true, signing: { provider: "none", required: false, policy: {} } },
    }), packageRoot);
    const sourcePath = path.join(target, "src", "index.js");
    await writeFile(sourcePath, `${await readFile(sourcePath, "utf8")}export const v2 = true;\n`, "utf8");
    await runPrepareCompletion({ target, packageRoot, taskId });
    const argv = [process.execPath, "-e", "process.exit(0)"];
    await runCheck({ target, packageRoot, taskId, id: "unit", requirement: "tests", argv });
    await runCheck({ target, packageRoot, taskId, id: "criterion", requirement: "required action satisfies tests", argv });
    await runAdvance({ target, packageRoot, taskId, to: "REVIEWING" });
    assert.equal((await runComplete({ target, packageRoot, taskId })).status, "VALID");

    const { statement } = await runAttestationCreate({ target, packageRoot, taskId });
    assert.equal(statement.predicate.schemaVersion, 2);
    const checks = statement.predicate.verification.checks;
    assert.deepEqual(checks.map((check) => check.id).sort(), ["criterion", "unit"]);
    for (const check of checks) {
      assert.equal(check.status, "passed");
      assert.equal(check.provenance, "FORGELOOP_EXECUTED");
      assert.equal(check.exitCode, 0);
      assert.match(check.argvDigest, /^[a-f0-9]{64}$/u);
    }
    assert.ok(!JSON.stringify(statement).includes(process.execPath), "the argv itself is not in the statement");
    assert.equal(predicateExecutionAssurance(statement.predicate), "EXECUTED");
  } finally {
    await removeTempTree(target);
  }
});
