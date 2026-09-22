import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createConfig } from "../src/core/config.js";
import { evaluateRoute } from "../src/core/router.js";
import {
  projectExecutionProfile,
  resolveExecutionProfile,
} from "../src/core/execution-profile.js";
import { assertSchema, readSchema } from "../src/core/schema-validation.js";

const fixtureRoot = path.resolve(import.meta.dirname, "fixtures", "execution-profiles");
const benchmarkRoot = path.resolve(import.meta.dirname, "..", "benchmarks", "execution-profiles");

async function readFixture(name) {
  return JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8"));
}

const scenarioFiles = (await readdir(fixtureRoot)).filter((name) => name.endsWith(".json") && name !== "legacy-route-without-profile.json").sort();

for (const filename of scenarioFiles) {
  test(`execution profile fixture ${filename} is exact and deterministic`, async () => {
    const fixture = await readFixture(filename);
    const first = evaluateRoute(fixture.input, fixture.profileOptions ?? {});
    const second = evaluateRoute(fixture.input, fixture.profileOptions ?? {});
    assert.deepEqual(first.executionProfile, fixture.expected);
    assert.deepEqual(first, second);
  });
}

test("profile precedence is CLI over project configuration, while safety floors still win", () => {
  const cliWins = resolveExecutionProfile({
    routeInput: { workType: "documentation" },
    configuredProfile: "full",
    requestedProfile: "light",
  });
  assert.equal(cliWins.requested, "light");
  assert.equal(cliWins.resolved, "light");
  assert.ok(cliWins.reasons.includes("PROFILE_EXPLICIT_REQUEST"));

  const safetyWins = resolveExecutionProfile({
    routeInput: { workType: "documentation", risks: ["publication"] },
    requestedProfile: "light",
  });
  assert.equal(safetyWins.resolved, "full");
  assert.equal(safetyWins.escalated, true);
  assert.ok(safetyWins.reasons.includes("PROFILE_ESCALATED_BY_SAFETY"));
});

test("execution profile is orthogonal to compliance mode", () => {
  const config = createConfig({ complianceMode: "strict", executionProfile: "light" });
  assert.equal(config.complianceMode, "strict");
  assert.equal(config.executionProfile, "light");
  assert.equal(resolveExecutionProfile({ routeInput: { workType: "documentation" }, configuredProfile: config.executionProfile }).resolved, "light");
});

test("scope thresholds produce stable balanced reasons without token estimation", () => {
  const profile = resolveExecutionProfile({
    routeInput: { workType: "documentation", behaviorChange: true, surfaces: ["ui", "config"] },
    contract: {
      deliverables: ["a", "b", "c", "d", "e"],
      successCriteria: [],
    },
    taskDescriptor: { writeClaims: ["a", "b", "c", "d", "e"] },
  });
  assert.equal(profile.floor, "balanced");
  assert.ok(profile.reasons.includes("SCOPE_MULTI_DELIVERABLE"));
  assert.ok(profile.reasons.includes("SCOPE_MULTI_CLAIM"));
  assert.ok(profile.reasons.includes("SCOPE_BROAD"));
});

test("legacy routes remain schema-valid and project to balanced compatibility", async () => {
  const fixture = await readFixture("legacy-route-without-profile.json");
  const schema = await readSchema("routing-result");
  assert.doesNotThrow(() => assertSchema(fixture.route, schema, "legacy route"));
  assert.equal(projectExecutionProfile(fixture.route), fixture.expectedProjectedProfile);
});

test("invalid requested profile fails with a stable error", () => {
  assert.throws(
    () => resolveExecutionProfile({ routeInput: { workType: "documentation" }, requestedProfile: "extreme" }),
    (error) => error.code === "E_EXECUTION_PROFILE_INVALID",
  );
});

test("benchmark scenarios resolve to their documented profiles without token estimation", async () => {
  const files = (await readdir(benchmarkRoot)).filter((name) => name.endsWith(".json")).sort();
  assert.equal(files.length, 7);
  for (const filename of files) {
    const scenario = JSON.parse(await readFile(path.join(benchmarkRoot, filename), "utf8"));
    const route = evaluateRoute(scenario.input);
    assert.equal(route.executionProfile.resolved, scenario.expectedProfile, filename);
    for (const mode of ["direct", "forgeloopBalanced", "forgeloopAdaptive"]) {
      const measurement = scenario.measurements[mode];
      assert.equal(measurement.totalTokens, null, `${filename}:${mode}`);
      assert.equal(measurement.wallClockMs, null, `${filename}:${mode}`);
    }
  }
});

test("semantic profile recommendation may raise but never lower the deterministic safety floor", () => {
  const raised = resolveExecutionProfile({
    routeInput: { workType: "documentation" },
    semanticRecommendation: "full",
  });
  assert.equal(raised.floor, "light");
  assert.equal(raised.resolved, "full");
  assert.ok(raised.reasons.includes("PROFILE_ESCALATED_BY_JEV"));

  const protectedFloor = resolveExecutionProfile({
    routeInput: { workType: "code", risks: ["secrets"], executableChange: true },
    requestedProfile: "light",
    semanticRecommendation: "light",
  });
  assert.equal(protectedFloor.floor, "full");
  assert.equal(protectedFloor.resolved, "full");
  assert.equal(protectedFloor.reasons.includes("PROFILE_ESCALATED_BY_JEV"), false);
});

test("Jev execution-profile recommendation raises depth without lowering the floor", () => {
  const raised = resolveExecutionProfile({
    routeInput: { workType: "documentation" },
    semanticRecommendation: { recommendedProfile: "full", confidence: 0.94 },
  });
  assert.equal(raised.resolved, "full");

  const protectedFloor = resolveExecutionProfile({
    routeInput: { workType: "code", risks: ["secrets"], executableChange: true },
    semanticRecommendation: { recommendedProfile: "light", confidence: 0.99 },
  });
  assert.equal(protectedFloor.floor, "full");
  assert.equal(protectedFloor.resolved, "full");
});

test("Jev guide exclusion affects non-mandatory route guides but cannot remove safety", () => {
  const route = evaluateRoute({
    workType: "code",
    risks: ["external-service"],
    behaviorChange: true,
  }, {
    semanticRecommendation: {
      guideRelevance: {
        rankedIds: ["test", "clean"],
        excludedIds: ["security"],
        confidenceById: { security: 0.95 },
      },
    },
  });
  assert.equal(route.guides.includes("security"), false);
  assert.equal(route.excluded.security[0], "JEV_EXCLUDED");

  const protectedRoute = evaluateRoute({
    workType: "code",
    risks: ["secrets"],
    behaviorChange: true,
  }, {
    semanticRecommendation: {
      guideRelevance: {
        rankedIds: ["test", "clean"],
        excludedIds: ["security"],
        confidenceById: { security: 0.99 },
      },
    },
  });
  assert.equal(protectedRoute.guides.includes("security"), true);
  assert.ok(protectedRoute.reasons.security.includes("MANDATORY_SAFETY_GUIDE"));
});
