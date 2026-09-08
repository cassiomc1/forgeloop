import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runInit } from "../src/commands/init.js";
import { runUpdate } from "../src/commands/update.js";
import { stopRepositoryIndexServer } from "../src/repository-index/server.js";
import { explicitNativeBinary, nativeOptions, packageRoot } from "./helpers/repository-index.js";

test("pre-Repository-Index projects migrate through update without rewriting task state", async (t) => {
  const binary = await (async () => {
    const value = explicitNativeBinary();
    if (!value) { t.skip("native migration test requires FORGELOOP_TGREP_BINARY"); return null; }
    return value;
  })();
  if (!binary) return;
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-repository-index-migration-"));
  try {
    await runInit({ target, packageRoot, packageVersion: "test", repositoryIndex: false });
    await mkdir(path.join(target, ".git"));
    const result = await runUpdate({
      target,
      packageRoot,
      packageVersion: "test",
      repositoryIndex: true,
      repositoryIndexOptions: nativeOptions(binary),
    });
    assert.equal(result.repositoryIndex.status, "READY");
    await stopRepositoryIndexServer(target, nativeOptions(binary));
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
