import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  getForgeLoopCapabilities,
  readForgeLoopIntegrationResource,
  repositoryIndexStatus,
  repositorySearch,
} from "../src/integration.js";

test("Integration API advertises provider-neutral repository search and status", async () => {
  const capabilities = getForgeLoopCapabilities();
  assert.deepEqual(capabilities.features.repositoryIndex.commands, ["search", "index-setup", "index-start", "index-stop", "index-status", "index-rebuild"]);
  assert.equal(capabilities.features.repositoryIndex.required, true);
  assert.ok(capabilities.resources.some((resource) => resource.name === "repository/index-status"));

  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-repository-index-api-"));
  try {
    const resource = await readForgeLoopIntegrationResource("repository/index-status", { projectPath: target, repositoryIndexOptions: { env: {} } });
    assert.equal(resource.data.health, "ENGINE_MISSING");
    const status = await repositoryIndexStatus({ projectPath: target, env: {} });
    assert.equal(status.health, "ENGINE_MISSING");
    await assert.rejects(
      () => repositorySearch({ projectPath: target, pattern: "" }),
      (error) => error.code === "E_REPOSITORY_INDEX_REQUEST_INVALID",
    );
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
