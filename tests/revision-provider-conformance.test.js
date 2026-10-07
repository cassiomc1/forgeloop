import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { createGitRevisionProvider } from "../src/core/revision/git.js";
import {
  assertRevisionProvider,
  normalizeRevisionEntry,
  resolveRevisionProvider,
} from "../src/core/revision/provider.js";
import { createGitRepository } from "./helpers/git-fixture.js";

const execFileAsync = promisify(execFile);

async function withRepository(fn) {
  const target = await createGitRepository("forgeloop-revision-provider-");
  try {
    await fn(target);
  } finally {
    await removeTempTree(target);
  }
}

test("Git revision provider satisfies the transport-neutral contract and reads exact bytes", async () => {
  await withRepository(async (target) => {
    const provider = createGitRevisionProvider();
    assertRevisionProvider(provider);
    for (const method of ["detect", "getCurrentRevision", "getChangedEntries", "readContent", "getContentIdentity", "getRepositoryIdentity"]) {
      assert.equal(typeof provider[method], "function");
    }
    assert.equal(await provider.detect(target), true);
    const revision = await provider.getCurrentRevision(target);
    assert.match(revision, /^[a-f0-9]{40}$/);
    assert.deepEqual(
      await provider.readContent({ target, revision: "HEAD", path: "src/index.js" }),
      Buffer.from("export const fixture = true;\n"),
    );
    assert.match(await provider.getContentIdentity({ target, revision: "HEAD", path: "src/index.js" }), /^[a-f0-9]{40}$/);
    assert.match(await provider.getRepositoryIdentity(target), /^[a-f0-9]{64}$/);
  });
});

test("Git revision provider reports worktree modifications, additions, and deletions with normalized entries", async () => {
  await withRepository(async (target) => {
    const provider = createGitRevisionProvider();
    await appendFile(path.join(target, "src", "index.js"), "export const modified = true;\n", "utf8");
    await writeFile(path.join(target, "new file-ação.js"), "export const added = true;\n", "utf8");
    const entries = await provider.getChangedEntries({ target, headRevision: "WORKTREE" });
    const modified = entries.find((entry) => entry.path === "src/index.js");
    const added = entries.find((entry) => entry.path === "new file-ação.js");
    assert.equal(modified.operation, "MODIFIED");
    assert.deepEqual(modified.bytes, Buffer.from("export const fixture = true;\nexport const modified = true;\n"));
    assert.equal(added.operation, "ADDED");
    assert.deepEqual(added.bytes, Buffer.from("export const added = true;\n"));

    await rm(path.join(target, "src", "index.js"));
    const withDeletion = await provider.getChangedEntries({ target, headRevision: "WORKTREE" });
    assert.equal(withDeletion.find((entry) => entry.path === "src/index.js").kind, "DELETED");
  });
});

test("Git revision provider preserves both sides of staged renames with spaces and unicode", async () => {
  await withRepository(async (target) => {
    const provider = createGitRevisionProvider();
    const renamedPath = "src/renamed file-ação.js";
    await execFileAsync("git", ["-C", target, "mv", "src/index.js", renamedPath]);

    const entries = await provider.getChangedEntries({ target, headRevision: "WORKTREE" });
    const renamed = entries.find((entry) => entry.path === renamedPath);
    assert.equal(renamed.operation, "RENAMED");
    assert.equal(renamed.sourcePath, "src/index.js");
    assert.deepEqual(renamed.bytes, Buffer.from("export const fixture = true;\n"));
  });
});

test("revision-provider conformance rejects unsafe paths and exposes stable provider errors", async () => {
  assert.throws(
    () => normalizeRevisionEntry({ path: "../escape", operation: "ADDED", kind: "FILE" }),
    (error) => error.code === "E_REVISION_PROVIDER_INVALID",
  );
  assert.throws(
    () => normalizeRevisionEntry({ path: ".forgeloop/secret.json", operation: "ADDED", kind: "FILE" }),
    (error) => error.code === "E_REVISION_PROVIDER_INVALID",
  );
  assert.throws(
    () => assertRevisionProvider({}),
    (error) => error.code === "E_REVISION_PROVIDER_INVALID",
  );
  await assert.rejects(
    () => resolveRevisionProvider({ target: ".", providerName: "unknown", registry: {} }),
    (error) => error.code === "E_REVISION_PROVIDER_UNAVAILABLE",
  );
  await assert.rejects(
    () => resolveRevisionProvider({
      target: ".",
      registry: {
        first: async () => ({ detect: async () => true, getCurrentRevision() {}, getChangedEntries() {}, readContent() {}, getContentIdentity() {}, getRepositoryIdentity() {} }),
        second: async () => ({ detect: async () => true, getCurrentRevision() {}, getChangedEntries() {}, readContent() {}, getContentIdentity() {}, getRepositoryIdentity() {} }),
      },
    }),
    (error) => error.code === "E_REVISION_PROVIDER_AMBIGUOUS",
  );
});
