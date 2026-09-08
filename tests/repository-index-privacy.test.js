import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { searchRepository } from "../src/repository-index/search.js";
import { sanitizeRepositoryIndexStatus } from "../src/repository-index/status.js";

function statusWithPaths(root, indexPath, binaryPath, statePath) {
  return {
    schemaVersion: 1,
    engine: "tgrep",
    engineVersion: "1.0.3",
    binaryPath,
    repositoryRoot: root,
    indexPath,
    statePath,
    index: { rootPath: root, present: true, complete: true, files: 1 },
    diagnostics: [{ code: "E_TEST", message: `diagnostic for ${root}`, path: binaryPath }],
    server: { running: false },
    health: "SERVER_DOWN",
  };
}

for (const [label, paths] of [
  ["POSIX", {
    root: "/Users/secret-user/private/forge-repo",
    indexPath: "/Users/secret-user/private/forge-repo/.forgeloop/repository-index/tgrep",
    binaryPath: "/Users/secret-user/.forgeloop/engines/tgrep/1.0.3/darwin-arm64/tgrep",
    statePath: "/Users/secret-user/private/forge-repo/.forgeloop/repository-index/engine-state.json",
  }],
  ["Windows", {
    root: "C:\\Users\\secret-user\\private\\forge-repo",
    indexPath: "C:\\Users\\secret-user\\private\\forge-repo\\.forgeloop\\repository-index\\tgrep",
    binaryPath: "C:\\Users\\secret-user\\.forgeloop\\engines\\tgrep\\1.0.3\\windows-x64\\tgrep.exe",
    statePath: "C:\\Users\\secret-user\\private\\forge-repo\\.forgeloop\\repository-index\\engine-state.json",
  }],
]) {
  test(`${label} public status omits host-local paths and redacts diagnostics`, () => {
    const sanitized = sanitizeRepositoryIndexStatus(statusWithPaths(paths.root, paths.indexPath, paths.binaryPath, paths.statePath));
    const serialized = JSON.stringify(sanitized);
    assert.doesNotMatch(serialized, /secret-user/u);
    assert.equal(Object.hasOwn(sanitized, "repositoryRoot"), false);
    assert.equal(Object.hasOwn(sanitized, "indexPath"), false);
    assert.equal(Object.hasOwn(sanitized, "binaryPath"), false);
    assert.equal(Object.hasOwn(sanitized, "statePath"), false);
    assert.equal(Object.hasOwn(sanitized.index, "rootPath"), false);
    assert.equal(Object.hasOwn(sanitized.diagnostics[0], "path"), false);
    assert.match(sanitized.diagnostics[0].message, /<local-path>/u);
  });
}

test("public search errors redact local paths while preserving the error code", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ForgeLoop Privacy Error Test "));
  try {
    const localBinary = path.join(root, ".forgeloop", "engines", "tgrep");
    await assert.rejects(
      () => searchRepository(root, {
        pattern: "needle",
        binaryPath: localBinary,
        setupRepositoryIndexImpl: async () => {
          const error = new Error(`managed binary failed at ${localBinary} for ${root}`);
          error.code = "E_REPOSITORY_INDEX_ENGINE_BINARY_CHECKSUM_MISMATCH";
          error.binaryPath = localBinary;
          throw error;
        },
      }),
      (error) => error.code === "E_REPOSITORY_INDEX_ENGINE_BINARY_CHECKSUM_MISMATCH"
        && !error.message.includes(root)
        && !Object.hasOwn(error, "binaryPath"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
