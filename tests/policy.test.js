import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runPolicy } from "../src/commands/policy.js";
import { getPolicy } from "../src/core/policies.js";
import { ARTIFACT_PATHS } from "../src/core/artifacts.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

test("policy packs are local, versioned, and configure strictness", async () => {
  const policy = getPolicy("web-premium");
  assert.equal(policy.name, "web-premium");
  assert.equal(policy.complianceMode, "strict");
  assert.ok(policy.requiredGates.includes("design"));

  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-policy-"));
  try {
    const selected = await runPolicy({ target, packageRoot, name: "web-premium" });
    assert.equal(selected.policy.name, "web-premium");
    const config = JSON.parse(await readFile(path.join(target, ARTIFACT_PATHS.config), "utf8"));
    assert.equal(config.policy, "web-premium");
    assert.equal(config.complianceMode, "strict");
  } finally {
    await removeTempTree(target);
  }
});

test("unknown policy packs fail with a stable code", () => {
  assert.throws(() => getPolicy("does-not-exist"), (error) => error.code === "E_POLICY_UNKNOWN");
});
