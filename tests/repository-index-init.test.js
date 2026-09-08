import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runInit } from "../src/commands/init.js";
import { packageRoot } from "./helpers/repository-index.js";

test("init reports an explicit non-Git Repository Index deferral without provisioning", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-repository-index-init-"));
  try {
    const result = await runInit({ target, packageRoot, packageVersion: "test", repositoryIndex: true });
    assert.deepEqual(result.repositoryIndex, {
      status: "DEFERRED",
      required: true,
      reason: "target is not a Git repository",
    });
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
