import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runDoctor } from "../src/commands/doctor.js";
import { createConfig } from "../src/core/config.js";
import { DECISION_DEFAULT_POLICY } from "../src/core/decision/constants.js";
import { getPackageRoot } from "../src/core/templates.js";

test("doctor reports the semantic decision plane from the live credential state", async () => {
  const prior = process.env.TYPESAFE_API_KEY;
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-doctor-semantic-plane-"));
  try {
    delete process.env.TYPESAFE_API_KEY;
    const missing = (await runDoctor({ target, packageRoot: getPackageRoot() }))
      .findings.find((item) => item.code === "semantic-decision-plane");
    assert.ok(missing, "expected a semantic-decision-plane finding");
    assert.match(missing.message, /credentials missing; pinned model jev-1\.13\.0/u);
    assert.equal(missing.severity, "info");
    process.env.TYPESAFE_API_KEY = "test-credential-value";
    const configured = (await runDoctor({ target, packageRoot: getPackageRoot() }))
      .findings.find((item) => item.code === "semantic-decision-plane");
    assert.match(configured.message, /credentials configured; pinned model jev-1\.13\.0/u);
  } finally {
    if (prior === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = prior;
    await rm(target, { recursive: true, force: true });
  }
});

test("createConfig keeps the pinned decision policy behavior unchanged", () => {
  assert.deepEqual(createConfig({ complianceMode: "advisory" }).decisionEngine, DECISION_DEFAULT_POLICY);
  assert.deepEqual(createConfig({ complianceMode: "advisory", decisionEngine: null }).decisionEngine, DECISION_DEFAULT_POLICY);
  assert.deepEqual(createConfig({
    complianceMode: "advisory",
    decisionEngine: { ...DECISION_DEFAULT_POLICY, requestTimeoutMs: 12_000 },
  }).decisionEngine, { ...DECISION_DEFAULT_POLICY, requestTimeoutMs: 12_000 });
  for (const invalid of [{ model: "jev-0.0.1" }, { required: false }, { provider: "other" }, { maxRetries: 9 }]) {
    assert.throws(
      () => createConfig({ complianceMode: "advisory", decisionEngine: invalid }),
      (error) => error.code === "E_DECISION_POLICY_INVALID",
    );
  }
});
