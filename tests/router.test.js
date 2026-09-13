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

test("confirmed .NET evidence selects one specialist plus clean and test", () => {
  const result = evaluateRoute({
    workType: "code",
    projectEvidence: {
      schemaVersion: 1,
      scope: "MATCH",
      frameworks: ["dotnet", "aspnetcore", "abp"],
      projectRoots: ["src/api"],
      primarySignals: ["src/api/api.csproj:project.sdk=Microsoft.NET.Sdk.Web"],
      supportingSignals: ["src/api/api.csproj:packageReference=Volo.Abp.AspNetCore.Mvc"],
    },
  });

  assert.deepEqual(result.guides, ["dotnet", "clean", "test"]);
  assert.equal(result.primary, "dotnet");
  assert.deepEqual(result.reasons.dotnet, [
    "PROJECT_DOTNET_SDK_PROJECT",
    "PROJECT_ASPNETCORE_CONFIRMED",
    "PROJECT_ABP_CONFIRMED",
  ]);
  assert.deepEqual(result.reasons.clean, ["PROJECT_DOTNET_BASELINE", "WORK_CODE"]);
  assert.deepEqual(result.reasons.test, ["PROJECT_DOTNET_BASELINE", "WORK_CODE"]);
  assert.deepEqual(result.excluded.flutter, ["NO_FLUTTER_PRIMARY_EVIDENCE"]);
});

test("confirmed public Node.js framework evidence is authoritative without private signals", () => {
  const result = evaluateRoute({
    workType: "code",
    projectEvidence: {
      schemaVersion: 1,
      scope: "MATCH",
      frameworks: ["nodejs"],
      projectRoots: ["services/api"],
      primarySignals: [],
      supportingSignals: [],
    },
  });

  assert.deepEqual(result.guides, ["nodejs", "clean", "test"]);
  assert.equal(result.primary, "nodejs");
  assert.deepEqual(result.reasons.nodejs, ["PROJECT_NODEJS_CONFIRMED"]);
  assert.deepEqual(result.reasons.clean, ["PROJECT_NODEJS_BASELINE", "WORK_CODE"]);
  assert.deepEqual(result.reasons.test, ["PROJECT_NODEJS_BASELINE", "WORK_CODE"]);
});

test("public multi-language framework evidence is authoritative without private signals", () => {
  for (const framework of ["c", "cpp", "java", "go", "typescript", "php", "swift", "sql"]) {
    const result = evaluateRoute({
      workType: "code",
      projectEvidence: {
        schemaVersion: 1,
        scope: "MATCH",
        frameworks: [framework],
        projectRoots: [],
        primarySignals: [],
        supportingSignals: [],
      },
    });
    assert.deepEqual(result.guides.slice(0, 3), [framework, "clean", "test"], framework);
    assert.equal(result.primary, framework, framework);
  }
});

test("Swift mobile UI work selects the authoritative Swift specialist", () => {
  const result = evaluateRoute({
    workType: "mobile-ui",
    projectEvidence: {
      schemaVersion: 1,
      scope: "MATCH",
      frameworks: ["swift"],
      projectRoots: ["apps/ios"],
      primarySignals: [],
      supportingSignals: [],
    },
  });
  assert.deepEqual(result.guides.slice(0, 3), ["swift", "clean", "test"]);
  assert.equal(result.excluded.swift, undefined);
});

test(".NET evidence is excluded from documentation-only work and no scope match", () => {
  const documentation = evaluateRoute({
    workType: "documentation",
    projectEvidence: {
      schemaVersion: 1,
      scope: "MATCH",
      frameworks: ["dotnet"],
      projectRoots: ["."],
      primarySignals: ["app.csproj:project.sdk=Microsoft.NET.Sdk"],
      supportingSignals: [],
    },
  });
  assert.deepEqual(documentation.guides, ["documentation"]);
  assert.deepEqual(documentation.excluded.dotnet, ["NO_DOTNET_EXECUTABLE_WORK"]);

  const noMatch = evaluateRoute({
    workType: "code",
    projectEvidence: {
      schemaVersion: 1,
      scope: "NO_MATCH",
      frameworks: [],
      projectRoots: [],
      primarySignals: [],
      supportingSignals: [],
    },
  });
  assert.deepEqual(noMatch.excluded.dotnet, ["NO_DOTNET_SCOPE_MATCH"]);
});

test("invalid project framework values remain rejected", () => {
  assert.throws(
    () => evaluateRoute({ workType: "code", projectEvidence: { frameworks: ["unknown-dotnet-framework"] } }),
    /unknown framework/i,
  );
});

test("ASP.NET Core and ABP project evidence overlays report only invalid frameworks", () => {
  const invalidCases = [
    [["aspnetcore"], 'projectEvidence framework "aspnetcore" requires "dotnet"'],
    [["abp"], 'projectEvidence framework "abp" requires "dotnet"'],
    [["aspnetcore", "abp"], 'projectEvidence frameworks "abp", "aspnetcore" require "dotnet"'],
  ];
  for (const [frameworks, message] of invalidCases) {
    assert.throws(
      () => evaluateRoute({ workType: "code", projectEvidence: { frameworks } }),
      (error) => error.message === message,
    );
  }
});

test("valid .NET framework overlays remain accepted", () => {
  for (const frameworks of [["dotnet", "aspnetcore"], ["dotnet", "abp"], ["dotnet", "aspnetcore", "abp"]]) {
    assert.doesNotThrow(() => evaluateRoute({
      workType: "code",
      projectEvidence: { frameworks },
    }));
  }
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
