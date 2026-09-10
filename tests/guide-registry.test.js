import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
  GUIDE_FILES,
  GUIDE_IDS,
  GUIDE_REGISTRY,
  GUIDE_TEMPLATE_PATHS,
} from "../src/core/guide-registry.js";
import { TEMPLATE_PATHS, getPackageRoot } from "../src/core/templates.js";
import { readGuideMetadata } from "../src/core/guide-metadata.js";
import { evaluateRoute, ROUTING_SIGNALS } from "../src/core/router.js";

const packageRoot = getPackageRoot();

test("guide registry keys match definitions and use canonical format", () => {
  for (const [guideId, definition] of Object.entries(GUIDE_REGISTRY)) {
    assert.equal(definition.id, guideId);
    assert.match(guideId, /^[a-z][a-z0-9-]*$/);
    assert.ok(definition.path.startsWith("ENG/"));
    assert.ok(definition.path.endsWith(".md"));
    assert.equal(typeof definition.install, "boolean");
  }
});

test("guide registry paths and IDs are unique", () => {
  const paths = Object.values(GUIDE_REGISTRY).map((def) => def.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(new Set(GUIDE_IDS).size, GUIDE_IDS.length);
});

test("GUIDE_IDS and GUIDE_FILES are derived from GUIDE_REGISTRY", () => {
  assert.deepEqual(GUIDE_IDS, Object.keys(GUIDE_REGISTRY));
  for (const [id, def] of Object.entries(GUIDE_REGISTRY)) {
    assert.equal(GUIDE_FILES[id], def.path);
  }
});

test("every registered guide file exists on disk (bidirectional: registry -> disk)", async () => {
  for (const definition of Object.values(GUIDE_REGISTRY)) {
    const fullPath = path.join(packageRoot, definition.path);
    await assert.doesNotReject(async () => {
      await access(fullPath);
    }, `Guide file missing: ${definition.path}`);
  }
});

test("every guide file on disk is registered (bidirectional: disk -> registry)", async () => {
  const engDir = path.join(packageRoot, "ENG");
  const filesOnDisk = (await readdir(engDir))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `ENG/${f}`)
    .sort();

  const registryPaths = Object.values(GUIDE_REGISTRY)
    .map((d) => d.path)
    .sort();

  assert.deepEqual(filesOnDisk, registryPaths, "Discrepancy between ENG/*.md on disk and registry");
});

test("all installable guides are included in TEMPLATE_PATHS", () => {
  for (const definition of Object.values(GUIDE_REGISTRY)) {
    if (definition.install) {
      assert.ok(
        TEMPLATE_PATHS.includes(definition.path),
        `Template paths missing: ${definition.path}`,
      );
      assert.ok(
        GUIDE_TEMPLATE_PATHS.includes(definition.path),
        `Guide template paths missing: ${definition.path}`,
      );
    }
  }
});

test("guide frontmatter guide-id matches registry key", async () => {
  const metadata = await readGuideMetadata(packageRoot);
  for (const guideId of GUIDE_IDS) {
    assert.ok(metadata[guideId], `Metadata missing for: ${guideId}`);
    assert.equal(metadata[guideId].guideId, guideId);
    assert.equal(metadata[guideId].path, GUIDE_REGISTRY[guideId].path);
    assert.match(metadata[guideId].lastReviewed, /^\d{4}-\d{2}-\d{2}$/);
    const reviewDate = new Date(`${metadata[guideId].lastReviewed}T00:00:00Z`);
    assert.ok(!Number.isNaN(reviewDate.getTime()), `Invalid last-reviewed date for: ${guideId}`);
    assert.ok(reviewDate.getTime() <= Date.now() + 86400000, `Future last-reviewed date for: ${guideId}`);
  }
});

test("router only emits registered guide IDs across all work types", () => {
  const knownGuides = new Set(GUIDE_IDS);
  for (const workType of ROUTING_SIGNALS.workTypes) {
    const result = evaluateRoute({ workType });
    for (const guide of result.guides) {
      assert.ok(knownGuides.has(guide), `Router emitted unknown guide ${guide} for workType ${workType}`);
    }
  }
});

test("Flutter specialist is registered with the canonical guide path", () => {
  assert.equal(GUIDE_REGISTRY.flutter.path, "ENG/flutter-development-eng.md");
  assert.equal(GUIDE_REGISTRY.flutter.install, true);
  assert.ok(GUIDE_IDS.includes("flutter"));
});

test("ui-copy routes to design and accessibility, never documentation", () => {
  const result = evaluateRoute({
    workType: "ui-copy",
    surfaces: ["ui"],
    platforms: ["web"],
  });
  assert.equal(result.primary, "design");
  assert.ok(result.guides.includes("design"));
  assert.ok(result.guides.includes("accessibility"));
  assert.ok(!result.guides.includes("documentation"), "ui-copy must not select documentation guide");
});
