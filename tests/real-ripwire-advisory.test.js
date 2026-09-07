import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readlink, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRipwireAdvisoryContextProvider } from "../src/adapters/ripwire/provider.js";
import { createForgeLoopContext } from "../src/core/runtime-context.js";
import { recallAdvisoryContext } from "../src/core/advisory-context/service.js";

const executablePath = process.env.FORGELOOP_TEST_RIPWIRE_PATH;
const expectedVersion = process.env.FORGELOOP_TEST_RIPWIRE_VERSION;
const smokeConfigured = Boolean(executablePath && expectedVersion);

async function snapshotTree(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const snapshot = [];
  for (const entry of entries) {
    const childRelative = path.join(relative, entry.name).replaceAll(path.sep, "/");
    const childPath = path.join(root, childRelative);
    if (entry.isDirectory()) {
      snapshot.push([`${childRelative}/`, "directory"]);
      snapshot.push(...await snapshotTree(root, childRelative));
    } else if (entry.isFile()) {
      snapshot.push([childRelative, (await readFile(childPath)).toString("base64")]);
    } else if (entry.isSymbolicLink()) {
      snapshot.push([childRelative, `symlink:${await readlink(childPath)}`]);
    } else {
      snapshot.push([childRelative, `special:${entry.mode ?? "unknown"}`]);
    }
  }
  return snapshot;
}

function assertQualifiedSmokeResult(result, before, after, expectedVersionValue) {
  assert.deepEqual(after, before);
  assert.equal(result.provider.id, "ripwire");
  assert.equal(result.provider.version, expectedVersionValue);
  assert.equal(result.items[0].title, "Ripwire advisory status");
  assert.ok(
    result.items.some((item) => item.sourceRef?.startsWith("src/example.js:")),
    "qualified Ripwire output must identify the known example source",
  );
}

test("real smoke assertions reject incomplete retrieval and content mutation", () => {
  const incomplete = {
    provider: { id: "ripwire", version: "0.3.8" },
    items: [{ title: "Ripwire advisory status" }],
  };
  const before = [["src/example.js", "before"]];
  assert.throws(
    () => assertQualifiedSmokeResult(incomplete, before, before, "0.3.8"),
    /known example source/u,
  );
  const complete = {
    provider: { id: "ripwire", version: "0.3.8" },
    items: [{ title: "Ripwire advisory status" }, { sourceRef: "src/example.js:1" }],
  };
  assert.throws(
    () => assertQualifiedSmokeResult(complete, before, [["src/example.js", "after"]], "0.3.8"),
    /deep-equal/u,
  );
});

test("real smoke snapshots include empty directories", async () => {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "forgeloop-ripwire-snapshot-"));
  try {
    await mkdir(path.join(projectPath, ".forgeloop"));
    const snapshot = await snapshotTree(projectPath);
    assert.ok(snapshot.some(([relativePath, kind]) => relativePath === ".forgeloop/" && kind === "directory"));
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("real smoke assertions reject directory-only mutations", () => {
  const before = [["src/", "directory"], ["src/example.js", "before"]];
  const after = [[".forgeloop/", "directory"], ...before];
  const complete = {
    provider: { id: "ripwire", version: "0.3.8" },
    items: [{ title: "Ripwire advisory status" }, { sourceRef: "src/example.js:1" }],
  };
  assert.throws(
    () => assertQualifiedSmokeResult(complete, before, after, "0.3.8"),
    /deep-equal/u,
  );
});

test("qualified Ripwire binary interoperates through the advisory API", { skip: smokeConfigured ? false : "Set FORGELOOP_TEST_RIPWIRE_PATH and FORGELOOP_TEST_RIPWIRE_VERSION" }, async () => {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "forgeloop-ripwire-real-"));
  await mkdir(path.join(projectPath, "src"));
  await writeFile(path.join(projectPath, "src/example.js"), "export function example() { return true; }\n");
  try {
    const provider = createRipwireAdvisoryContextProvider({ executablePath, expectedVersion });
    const runtimeContext = createForgeLoopContext({ advisoryContextProviders: { ripwire: provider } });
    const before = await snapshotTree(projectPath);
    const result = await recallAdvisoryContext({
      target: projectPath,
      taskId: "ripwire-real-smoke",
      providerName: "ripwire",
      query: "example function",
      runtimeContext,
    });
    const after = await snapshotTree(projectPath);
    assertQualifiedSmokeResult(result, before, after, expectedVersion);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});
