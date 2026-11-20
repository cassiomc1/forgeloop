import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runEvidenceVerify } from "../src/commands/evidence-verify.js";
import { delegationErrors } from "../src/core/evidence/verify.js";
import { getPackageRoot } from "../src/core/templates.js";
import { removeTempTree } from "./helpers/rm-safe.js";

// docs/PROTOCOL_SPEC.md Section 8: a delegator accepts a delegate's work only
// when the delegate's evidence covers the brief.

const brief = {
  taskId: "delegate",
  allowedPaths: ["src/feature"],
  readOnlyPaths: ["src/feature/fixtures"],
  verification: ["unit tests pass"],
};

function bundle(overrides = {}) {
  return {
    taskId: "delegate",
    integrity: "VALID",
    coveredPaths: ["src/feature/index.js", "src/feature/util.js"],
    checks: [{ id: "unit", requirement: "unit tests pass", status: "passed", provenance: "FORGELOOP_EXECUTED", exitCode: 0, argvDigest: null }],
    ...overrides,
  };
}

const codes = (errors) => errors.map((error) => error.code);

test("work inside the brief with its verification passing is accepted", () => {
  assert.deepEqual(delegationErrors(brief, [bundle()]), []);
  assert.deepEqual(delegationErrors(brief, [bundle({ coveredPaths: ["src/feature"] })]), [], "an allowed path covers itself");
});

test("missing or broken evidence for the delegated task is rejected", () => {
  assert.deepEqual(codes(delegationErrors(brief, [])), ["E_DELEGATION_EVIDENCE_MISSING"]);
  assert.deepEqual(codes(delegationErrors(brief, [bundle({ integrity: "INVALID" })])), ["E_DELEGATION_EVIDENCE_MISSING"]);
  assert.deepEqual(codes(delegationErrors(brief, [bundle({ taskId: "someone-else" })])), ["E_DELEGATION_EVIDENCE_MISSING"]);
});

test("paths outside allowedPaths or inside readOnlyPaths are a scope violation", () => {
  const errors = delegationErrors(brief, [bundle({ coveredPaths: ["src/feature/index.js", "src/featurex.js", "src/feature/fixtures/a.json"] })]);
  assert.deepEqual(codes(errors), ["E_DELEGATION_SCOPE_VIOLATION"]);
  assert.deepEqual(errors[0].paths, ["src/feature/fixtures/a.json", "src/featurex.js"]);
});

test("brief verification needs a passing bound check; version-1 predicates bind none", () => {
  assert.deepEqual(codes(delegationErrors(brief, [bundle({ checks: [{ ...bundle().checks[0], status: "failed" }] })])), ["E_DELEGATION_VERIFICATION_UNMET"]);
  assert.deepEqual(codes(delegationErrors({ ...brief, verification: ["unit"] }, [bundle()])), [], "a check id also satisfies an item");
  const v1 = delegationErrors(brief, [bundle({ checks: null })]);
  assert.deepEqual(codes(v1), ["E_DELEGATION_VERIFICATION_UNMET"]);
  assert.match(v1[0].message, /version-1 predicate/u);
});

test("evidence-verify --brief rejects an invalid task brief before verifying", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-delegation-brief-"));
  try {
    await writeFile(path.join(target, "brief.json"), JSON.stringify({ taskId: "delegate", allowedPaths: ["../outside"] }));
    await assert.rejects(
      () => runEvidenceVerify({ target, packageRoot: getPackageRoot(), baseRevision: "HEAD", headRevision: "HEAD", delegationBrief: "brief.json" }),
      (error) => error.code === "E_DELEGATION_BRIEF_INVALID",
    );
  } finally {
    await removeTempTree(target);
  }
});
