import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateRoute } from "../src/core/router.js";
import { assertSchema } from "../src/core/schema-validation.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function fixture(name) {
  return JSON.parse(
    await readFile(path.join(repositoryRoot, "tests", "fixtures", "routes", `${name}.json`), "utf8"),
  );
}

async function routeSchema() {
  return JSON.parse(
    await readFile(path.join(repositoryRoot, "schemas", "routing-result.schema.json"), "utf8"),
  );
}

for (const name of ["complete-website", "api-auth", "backend-refactor", "static-ui-copy", "documentation"]) {
  test(`route fixture ${name} has deterministic guide output`, async () => {
    const expected = await fixture(name);
    const result = evaluateRoute(expected.input);

    assert.deepEqual(result.guides, expected.guides);
    assert.equal(result.primary, expected.primary);
    assert.equal(new Set(result.guides).size, result.guides.length);
    for (const guide of result.guides) {
      assert.ok(result.reasons[guide]?.length > 0, `${guide} has no reason code`);
    }
    for (const guide of expected.forbidden ?? []) {
      assert.equal(result.guides.includes(guide), false, `${guide} was selected unexpectedly`);
    }
    assertSchema(result, await routeSchema(), "route result");
  });
}

test("unknown routing signals fail before evaluation", async () => {
  const expected = await fixture("invalid-signal");
  assert.throws(
    () => evaluateRoute(expected.input),
    new RegExp(expected.error, "i"),
  );
});

test("explicit executable change adds clean and test to documentation work", () => {
  const result = evaluateRoute({
    workType: "documentation",
    executableChange: true,
    surfaces: [],
    risks: [],
    platforms: [],
  });

  assert.deepEqual(result.guides, ["documentation", "clean", "test"]);
  assert.deepEqual(result.reasons.documentation, ["WORK_DOCUMENTATION"]);
  assert.deepEqual(result.reasons.clean, ["CHANGE_EXECUTABLE_CONFIG"]);
  assert.deepEqual(result.reasons.test, ["CHANGE_EXECUTABLE_CONFIG"]);
});

test("documentation surface adds documentation guide to code work", () => {
  const result = evaluateRoute({
    workType: "code",
    surfaces: ["documentation"],
    risks: [],
    platforms: [],
  });

  assert.deepEqual(result.guides, ["clean", "test", "documentation"]);
  assert.deepEqual(result.reasons.documentation, ["SURFACE_DOCUMENTATION"]);
});

test("documentation work selects documentation as its primary guide", () => {
  const result = evaluateRoute({
    workType: "documentation",
    surfaces: [],
    risks: [],
    platforms: [],
  });

  assert.equal(result.primary, "documentation");
  assert.deepEqual(result.guides, ["documentation"]);
  assert.deepEqual(result.reasons.documentation, ["WORK_DOCUMENTATION"]);
});

test("confirmed Flutter project evidence adds the specialist and baseline checks", () => {
  const result = evaluateRoute({
    workType: "code",
    projectEvidence: {
      schemaVersion: 1,
      scope: "MATCH",
      frameworks: ["flutter"],
      projectRoots: ["apps/mobile"],
      primarySignals: ["apps/mobile/pubspec.yaml:dependencies.flutter.sdk"],
      supportingSignals: [],
    },
  });

  assert.deepEqual(result.guides, ["flutter", "clean", "test"]);
  assert.equal(result.primary, "flutter");
  assert.equal(result.excluded.flutter, undefined);
});

test("Flutter evidence does not activate for documentation-only work", () => {
  const result = evaluateRoute({
    workType: "documentation",
    projectEvidence: {
      schemaVersion: 1,
      scope: "MATCH",
      frameworks: ["flutter"],
      projectRoots: ["."],
      primarySignals: ["pubspec.yaml:dependencies.flutter.sdk"],
      supportingSignals: [],
    },
  });

  assert.deepEqual(result.guides, ["documentation"]);
  assert.deepEqual(result.excluded.flutter, ["NO_FLUTTER_EXECUTABLE_WORK"]);
});

test("duplicate selection of documentation work and surface is deduplicated and retains both reasons", () => {
  const result = evaluateRoute({
    workType: "documentation",
    surfaces: ["documentation"],
    risks: [],
    platforms: [],
  });

  assert.deepEqual(result.guides, ["documentation"]);
  assert.deepEqual(result.reasons.documentation, ["WORK_DOCUMENTATION", "SURFACE_DOCUMENTATION"]);
});

test("ui-copy work type routes to design and accessibility", () => {
  const result = evaluateRoute({
    workType: "ui-copy",
    surfaces: ["ui"],
    platforms: ["web"],
  });

  assert.equal(result.primary, "design");
  assert.deepEqual(result.guides, ["design", "accessibility"]);
  assert.deepEqual(result.reasons.design, ["WORK_UI_COPY", "SURFACE_UI"]);
  assert.deepEqual(result.reasons.accessibility, ["WORK_UI_COPY", "SURFACE_UI"]);
});

test("duplicate signals and non-boolean change flags are rejected", () => {
  assert.throws(
    () => evaluateRoute({ workType: "code", surfaces: ["ui", "ui"] }),
    /duplicate surface/i,
  );
  assert.throws(
    () => evaluateRoute({ workType: "code", behaviorChange: "yes" }),
    /behaviorChange must be boolean/i,
  );
});
