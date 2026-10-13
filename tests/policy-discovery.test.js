import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  CONFIDENCE_LEVELS,
  ENFORCEMENT_MODES,
  discoverPolicy,
} from "../src/core/policy-discovery.js";

async function withTarget(fn) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-policy-discovery-"));
  try {
    await fn(target);
  } finally {
    await removeTempTree(target);
  }
}

test("policy discovery identifies supported languages and high-confidence npm checks", async () => {
  await withTarget(async (target) => {
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: { test: "jest", lint: "eslint ." },
      devDependencies: { jest: "1.0.0" },
    }), "utf8");
    await writeFile(path.join(target, "tsconfig.json"), "{}", "utf8");
    await Promise.all([
      writeFile(path.join(target, "pyproject.toml"), "[project]\n", "utf8"),
      writeFile(path.join(target, "Cargo.toml"), "[package]\nname='fixture'\n", "utf8"),
      writeFile(path.join(target, "go.mod"), "module fixture\n", "utf8"),
      writeFile(path.join(target, "pom.xml"), "<project/>\n", "utf8"),
    ]);
    const result = await discoverPolicy({ target });
    assert.deepEqual(result.languages, ["go", "java", "python", "rust", "typescript"]);
    assert.equal(result.testing.detected, true);
    assert.deepEqual(result.testing.command, ["npm", "test"]);
    assert.equal(result.testing.framework, "jest");
    assert.equal(result.testing.confidence, CONFIDENCE_LEVELS.HIGH);
    assert.equal(result.linting.detected, true);
    assert.deepEqual(result.linting.command, ["npm", "run", "lint"]);
    assert.ok(result.discoveredRules.some((rule) => rule.id === "TEST.REQUIRED"));
  });
});

test("policy discovery selects native test and lint fallbacks", async () => {
  await withTarget(async (target) => {
    await mkdir(path.join(target, "tests"));
    await writeFile(path.join(target, "Cargo.toml"), "[package]\nname='fixture'\n", "utf8");
    await writeFile(path.join(target, ".eslintrc.json"), "{}", "utf8");
    const result = await discoverPolicy({ target });
    assert.equal(result.testing.framework, "cargo");
    assert.deepEqual(result.testing.command, ["cargo", "test"]);
    assert.equal(result.linting.tool, "eslint");
    assert.deepEqual(result.linting.command, ["npx", "eslint", "."]);
    assert.equal(result.linting.confidence, CONFIDENCE_LEVELS.MEDIUM);
  });

  await withTarget(async (target) => {
    await mkdir(path.join(target, "test"));
    const result = await discoverPolicy({ target });
    assert.equal(result.testing.framework, "pytest");
    assert.deepEqual(result.testing.command, ["pytest"]);
    assert.equal(result.testing.confidence, CONFIDENCE_LEVELS.MEDIUM);
  });
});

test("policy discovery recognizes layered architecture only with a domain and application or infrastructure layer", async () => {
  await withTarget(async (target) => {
    await mkdir(path.join(target, "src", "domain"), { recursive: true });
    await mkdir(path.join(target, "src", "infra"), { recursive: true });
    const layered = await discoverPolicy({ target });
    assert.equal(layered.architecture.value, "layered");
    assert.equal(layered.architecture.confidence, CONFIDENCE_LEVELS.HIGH);
    assert.equal(layered.architecture.enforcement, ENFORCEMENT_MODES.ADVISORY);
    assert.ok(layered.discoveredRules.some((rule) => rule.id === "ARCH.NO_DIRECT_DATABASE_ACCESS"));
  });

  await withTarget(async (target) => {
    await mkdir(path.join(target, "src"));
    const simple = await discoverPolicy({ target });
    assert.equal(simple.architecture.value, null);
    assert.equal(simple.architecture.confidence, CONFIDENCE_LEVELS.LOW);
    assert.equal(simple.architecture.enforcement, ENFORCEMENT_MODES.NONE);
  });
});

test("policy discovery fails closed to an empty, unknown policy when manifests are malformed or absent", async () => {
  await withTarget(async (target) => {
    await writeFile(path.join(target, "package.json"), "{not-json", "utf8");
    const result = await discoverPolicy({ target });
    assert.deepEqual(result.languages, []);
    assert.equal(result.testing.detected, false);
    assert.equal(result.testing.confidence, CONFIDENCE_LEVELS.UNKNOWN);
    assert.equal(result.linting.detected, false);
    assert.equal(result.architecture.enforcement, ENFORCEMENT_MODES.NONE);
    assert.deepEqual(result.discoveredRules, []);
  });

  const missing = path.join(os.tmpdir(), "forgeloop-policy-discovery-does-not-exist");
  const result = await discoverPolicy({ target: missing });
  assert.deepEqual(result.languages, []);
  assert.equal(result.testing.detected, false);
});
