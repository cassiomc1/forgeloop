import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  expectedGitBlobOid,
  currentChangedPaths,
  currentRepositoryFingerprint,
  repositoryBlobAtRef,
  repositoryBlobOidAtRef,
  repositoryDiffEntries,
  repositoryHasUnstagedChanges,
  repositoryIndexEntries,
  repositoryObjectFormat,
  repositoryRemoteUrl,
  repositoryStatusEntries,
  repositoryTree,
  repositoryTreeEntry,
  repositoryWorktreeMetadata,
  parsePorcelainV1Z,
} from "../src/core/repository.js";
import { createGitRepository } from "./helpers/git-fixture.js";

function git(target, ...args) {
  return execFileSync("git", ["-C", target, ...args], { encoding: "utf8" }).trim();
}

async function withRepository(fn) {
  const target = await createGitRepository("forgeloop-repository-coverage-");
  try {
    await fn(target);
  } finally {
    await removeTempTree(target);
  }
}

test("repository helpers return exact bytes, object IDs, and worktree identity", async () => {
  await withRepository(async (target) => {
    const bytes = Buffer.from([0, 1, 2, 10, 13, 255]);
    await writeFile(path.join(target, "binary.bin"), bytes);
    git(target, "add", "binary.bin");
    git(target, "commit", "-qm", "add binary fixture");

    assert.deepEqual(await repositoryBlobAtRef(target, { ref: "HEAD", path: "binary.bin" }), bytes);
    assert.match(await repositoryBlobOidAtRef(target, { ref: "HEAD", path: "binary.bin" }), /^[a-f0-9]{40}$/);
    assert.equal(await repositoryObjectFormat(target), "sha1");
    assert.equal(await repositoryTree(target, { revision: "HEAD" }), git(target, "rev-parse", "HEAD^{tree}"));
    const metadata = await repositoryWorktreeMetadata(target);
    assert.equal(metadata.objectFormat, "sha1");
    assert.ok(metadata.commonDirectory);
    assert.ok(metadata.gitDirectory);
    assert.ok(metadata.topLevel);
    assert.match(await expectedGitBlobOid(target, { path: "binary.bin" }), /^[a-f0-9]{40}$/);
  });
});

test("repository diff and status parsing preserves renames, deletions, and literal Unicode paths", async () => {
  await withRepository(async (target) => {
    const base = git(target, "rev-parse", "HEAD");
    const renamed = "src/name with spaces-ação.js";
    git(target, "mv", "src/index.js", renamed);
    await writeFile(path.join(target, "src", "new-file.js"), "export const newFile = true;\n", "utf8");
    await writeFile(path.join(target, "deleted.txt"), "delete me\n", "utf8");
    git(target, "add", "src/new-file.js", "deleted.txt");
    git(target, "commit", "-qm", "rename and add paths");
    const head = git(target, "rev-parse", "HEAD");

    const entries = await repositoryDiffEntries(target, { baseRevision: base, headRevision: head });
    assert.ok(entries.some((entry) => entry.status.startsWith("R") && entry.path === renamed && entry.sourcePath === "src/index.js"));
    assert.ok(entries.some((entry) => entry.status === "A" && entry.path === "src/new-file.js"));

    await unlink(path.join(target, "deleted.txt"));
    const status = await repositoryStatusEntries(target);
    assert.ok(status.some((entry) => entry.path === "deleted.txt" && entry.status === " D"));
    assert.ok(status.every((entry) => !entry.path.includes("\\")));
  });
});

test("repository index and unstaged-change helpers distinguish staged and unstaged content", async () => {
  await withRepository(async (target) => {
    await appendFile(path.join(target, "src", "index.js"), "export const changed = true;\n", "utf8");
    assert.equal(await repositoryHasUnstagedChanges(target), true);
    const unstaged = await repositoryStatusEntries(target);
    assert.ok(unstaged.some((entry) => entry.path === "src/index.js"));

    git(target, "add", "src/index.js");
    assert.equal(await repositoryHasUnstagedChanges(target), false);
    const index = await repositoryIndexEntries(target);
    assert.ok(index.some((entry) => entry.path === "src/index.js" && entry.stage === 0));
  });
});

test("repository tree entries expose file modes and literal path filtering", async () => {
  await withRepository(async (target) => {
    const entry = await repositoryTreeEntry(target, { revision: "HEAD", path: "src/index.js" });
    assert.equal(entry.type, "blob");
    assert.equal(entry.mode, "100644");
    assert.equal(entry.path, "src/index.js");
    assert.match(entry.objectId, /^[a-f0-9]{40}$/);
  });
});

test("repository identity, remote metadata, and missing tree entries remain explicit", async () => {
  await withRepository(async (target) => {
    const fingerprint = await currentRepositoryFingerprint(target);
    assert.equal(typeof fingerprint.branch, "string");
    assert.match(fingerprint.head, /^[a-f0-9]{40}$/);
    assert.equal(await repositoryRemoteUrl(target), null);
    assert.deepEqual(await currentChangedPaths(target), []);

    await appendFile(path.join(target, "src", "index.js"), "export const identityCheck = true;\n", "utf8");
    assert.deepEqual(await currentChangedPaths(target, { paths: ["src/index.js"] }), ["src/index.js"]);
    await assert.rejects(
      () => repositoryTreeEntry(target, { revision: "HEAD", path: "missing.js" }),
      (error) => error.code === "E_REVISION_CONTENT_UNAVAILABLE" && error.notFound === true,
    );
  });

  assert.deepEqual(await currentChangedPaths(os.tmpdir()), null);
});

test("repository paths and revisions fail closed without shell interpretation", async () => {
  await withRepository(async (target) => {
    await assert.rejects(
      () => repositoryBlobAtRef(target, { ref: "HEAD", path: "../outside" }),
      (error) => error.code === "E_REVISION_CONTENT_UNAVAILABLE",
    );
    await assert.rejects(
      () => repositoryBlobAtRef(target, { ref: "HEAD;touch compromised", path: "src/index.js" }),
      (error) => error.code === "E_REVISION_NOT_FOUND",
    );
    await assert.rejects(
      () => repositoryDiffEntries(target, { baseRevision: "HEAD", headRevision: "HEAD", paths: ["src/../outside"] }),
      (error) => error.code === "E_REVISION_CONTENT_UNAVAILABLE",
    );
  });

  const nonRepository = os.tmpdir();
  await assert.rejects(
    () => repositoryObjectFormat(nonRepository),
    (error) => error.code === "E_REPOSITORY_GIT_COMMAND_FAILED",
  );
});

test("porcelain status parsing handles empty, rename, copy, and protocol metadata records", () => {
  assert.deepEqual(parsePorcelainV1Z(""), []);
  assert.deepEqual(
    parsePorcelainV1Z("R  src/renamed.js\0src/original.js\0C  src/copied.js\0src/original.js\0 M .forgeloop/state.json\0 M ./src/changed.js\0"),
    ["src/changed.js", "src/copied.js", "src/original.js", "src/renamed.js"],
  );
});
