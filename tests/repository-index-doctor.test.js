import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runDoctor } from "../src/commands/doctor.js";
import { packageRoot } from "./helpers/repository-index.js";

test("doctor defers Repository Index readiness for a non-repository target", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-repository-index-doctor-"));
  const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-repository-index-doctor-home-"));
  try {
    const result = await runDoctor({ target, packageRoot, repositoryIndex: true, repositoryIndexOptions: { env: {}, homeDirectory } });
    assert.equal(result.repositoryIndex.status, "DEFERRED");
  } finally {
    await rm(target, { recursive: true, force: true });
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("doctor treats the mandatory engine as unhealthy when a repository has no trusted binary", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-repository-index-doctor-git-"));
  const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-repository-index-doctor-git-home-"));
  try {
    await mkdir(path.join(target, ".git"));
    const result = await runDoctor({ target, packageRoot, repositoryIndex: true, repositoryIndexOptions: { env: {}, homeDirectory } });
    assert.equal(result.repositoryIndex.required, true);
    assert.equal(result.repositoryIndex.status, "ENGINE_MISSING");
    assert.equal(result.ok, false);
  } finally {
    await rm(target, { recursive: true, force: true });
    await rm(homeDirectory, { recursive: true, force: true });
  }
});
