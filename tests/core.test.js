import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { resolveTarget, ensureWithin, isPathWithin } from "../src/core/filesystem.js";
import {
  createManifest,
  readManifest,
  writeManifest,
} from "../src/core/manifest.js";
import { getPackageRoot, readTemplateEntries, TEMPLATE_PATHS } from "../src/core/templates.js";

test("rejects a target path that escapes the requested root", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-core-"));
  try {
    await assert.rejects(resolveTarget(target, "../outside"), /inside|directory|not found/i);
    assert.throws(() => ensureWithin(target, "../outside"), /outside|escape/i);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("round-trips a versioned manifest", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-core-"));
  try {
    const manifest = createManifest("0.1.0");
    manifest.files["AGENTS.md"] = { sha256: "a".repeat(64), preserve: false };
    await writeManifest(target, manifest);
    assert.deepEqual(await readManifest(target), manifest);
    assert.match(await readFile(path.join(target, ".forgeloop", "manifest.json"), "utf8"), /schemaVersion/);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("template entries use safe relative paths", async () => {
  const entries = await readTemplateEntries();
  assert.equal(entries.length, TEMPLATE_PATHS.length);
  assert.equal(TEMPLATE_PATHS.length, 82);
  assert.ok(entries.some((entry) => entry.relativePath === ".forgeloop/kit/LICENSE"));
  assert.ok(entries.some((entry) => entry.relativePath === ".forgeloop/kit/LICENSE-DOCS.md"));
  for (const entry of entries) {
    assert.equal(path.isAbsolute(entry.relativePath), false);
    assert.equal(entry.relativePath.startsWith(".."), false);
    assert.ok(entry.bytes.length > 0);
  }
});

test("template entries use an npm-safe source for the .gitignore target", async () => {
  const packageRoot = await mkdtemp(path.join(os.tmpdir(), "forgeloop-npm-package-"));
  try {
    await cp(getPackageRoot(), packageRoot, { recursive: true });

    const entries = await readTemplateEntries(packageRoot);
    const ignoredTemplate = entries.find(
      (entry) => entry.relativePath === ".forgeloop/.gitignore",
    );

    assert.ok(ignoredTemplate);
    assert.match(ignoredTemplate.bytes.toString("utf8"), /work-state\.json/);
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});

test("rejects a destination whose existing parent is a symlink", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-core-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "forgeloop-outside-"));
  try {
    await symlink(outside, path.join(target, ".github"));
    await assert.rejects(
      import("../src/core/filesystem.js").then(({ assertSafePath }) =>
        assertSafePath(target, ".github/copilot-instructions.md"),
      ),
      /symlink|target directory/i,
    );
  } finally {
    await rm(target, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("path containment is case-insensitive for Windows realpath results", () => {
  const root = "C:\\Users\\RunnerAdmin\\AppData\\Local\\Temp\\forgeloop-test";
  const inside = "c:\\users\\runneradmin\\appdata\\local\\temp\\forgeloop-test\\.forgeloop\\locks\\task.lock";
  const outside = "c:\\users\\runneradmin\\appdata\\local\\temp\\other\\task.lock";
  assert.equal(isPathWithin(root, inside, { platform: "win32" }), true);
  assert.equal(isPathWithin(root, outside, { platform: "win32" }), false);
});

test("path containment normalizes Windows extended-length realpath prefixes", () => {
  const root = "C:\\Users\\RunnerAdmin\\AppData\\Local\\Temp\\forgeloop-test";
  const inside = "\\\\?\\C:\\Users\\RunnerAdmin\\AppData\\Local\\Temp\\forgeloop-test\\.forgeloop\\locks\\task.lock";
  const outside = "\\\\?\\C:\\Users\\RunnerAdmin\\AppData\\Local\\Temp\\other\\task.lock";
  assert.equal(isPathWithin(root, inside, { platform: "win32" }), true);
  assert.equal(isPathWithin(root, outside, { platform: "win32" }), false);
});

test("path containment normalizes Windows extended-length UNC realpath prefixes", () => {
  const root = "\\\\server\\share\\forgeloop-test";
  const inside = "\\\\?\\UNC\\server\\share\\forgeloop-test\\.forgeloop\\locks\\task.lock";
  const outside = "\\\\?\\UNC\\server\\share\\other\\task.lock";
  assert.equal(isPathWithin(root, inside, { platform: "win32" }), true);
  assert.equal(isPathWithin(root, outside, { platform: "win32" }), false);
});
