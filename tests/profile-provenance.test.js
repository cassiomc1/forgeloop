import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { validateProfileSources } from "../src/core/profile.js";
import { createSourceRegistry } from "../src/core/sources.js";
import { writeJsonArtifact, ARTIFACT_PATHS } from "../src/core/artifacts.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

test("profile source references require a target-local registry", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-profile-"));
  try {
    await writeFile(path.join(target, "PROJECT_PROFILE.md"), "| Product | Example | USER-001 |\n");
    const result = await validateProfileSources(target, packageRoot);
    assert.equal(result.status, "invalid");
    assert.ok(result.errors.some((error) => error.code === "E_PROFILE_SOURCE_MISSING"));
  } finally {
    await removeTempTree(target);
  }
});

test("profile provenance rejects an agent decision labeled as a user fact", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-profile-"));
  try {
    await writeFile(path.join(target, "PROJECT_PROFILE.md"), "<!-- forgeloop-source: DECISION-001 kind=user-request -->\n");
    await writeJsonArtifact(target, ARTIFACT_PATHS.sources, createSourceRegistry({
      "DECISION-001": { kind: "agent-decision", summary: "Choose a local implementation" },
    }), "source-registry", packageRoot);
    const result = await validateProfileSources(target, packageRoot);
    assert.equal(result.status, "invalid");
    assert.ok(result.errors.some((error) => error.code === "E_PROFILE_SOURCE_MISCLASSIFIED"));
  } finally {
    await removeTempTree(target);
  }
});
