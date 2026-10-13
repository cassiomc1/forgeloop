import { removeTempTree } from "./helpers/rm-safe.js";
import { ensureFixtureTask, readFixtureText } from "./helpers/native-storage-fixture.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { readGuideMetadata } from "../src/core/guide-metadata.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute, readPersistedRoute } from "../src/core/route-artifact.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("guide metadata declares gates and completion evidence", async () => {
  const metadata = await readGuideMetadata(repositoryRoot);
  assert.deepEqual(metadata.premium.requiresGates, ["design", "quality"]);
  assert.ok(metadata.premium.completionEvidence.includes("build"));
  assert.deepEqual(metadata.security.requiresGates, ["threat-boundary"]);
});

test("route results persist and round-trip through the canonical artifact", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-route-artifact-"));
  try {
    const taskId = "route-roundtrip";
    await ensureFixtureTask(target, taskId, repositoryRoot);
    const route = evaluateRoute({
      workType: "complete-website",
      surfaces: ["ui"],
      risks: [],
      platforms: ["web"],
      executableChange: true,
    });
    const written = await persistRoute(target, route, repositoryRoot, { taskId });
    const loaded = await readPersistedRoute(target, repositoryRoot, { taskId });
    assert.equal(written.fingerprint, loaded.fingerprint);
    assert.deepEqual(loaded.value, route);
    assert.match(await readFixtureText(target, taskArtifactPath(taskId, "route")), /complete-website/);
  } finally {
    await removeTempTree(target);
  }
});
