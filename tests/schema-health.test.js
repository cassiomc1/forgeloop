import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { readdir } from "node:fs/promises";
import { assertSchema, clearSchemaCache, inspectSchemaHealth, readSchema, SHIPPED_SCHEMA_NAMES } from "../src/core/schema-validation.js";
import { getPackageRoot, TEMPLATE_PATHS } from "../src/core/templates.js";

test("schema inventory is fully synchronized with SHIPPED_SCHEMA_NAMES and TEMPLATE_PATHS", async () => {
  const schemaDir = path.join(getPackageRoot(), "schemas");
  const files = await readdir(schemaDir);
  const diskSchemaNames = files
    .filter((file) => file.endsWith(".schema.json"))
    .map((file) => file.replace(/\.schema\.json$/, ""))
    .sort();

  const shippedSorted = [...SHIPPED_SCHEMA_NAMES].sort();
  assert.deepEqual(shippedSorted, diskSchemaNames, "SHIPPED_SCHEMA_NAMES must match disk schemas exactly");

  for (const name of diskSchemaNames) {
    const templateEntry = `schemas/${name}.schema.json`;
    assert.ok(
      TEMPLATE_PATHS.includes(templateEntry),
      `TEMPLATE_PATHS must include ${templateEntry}`,
    );
  }
});

test("schema health parses every shipped schema and reports valid status", async () => {
  const report = await inspectSchemaHealth(getPackageRoot());
  assert.equal(report.status, "valid");
  assert.equal(report.schemas.length, SHIPPED_SCHEMA_NAMES.length);
  for (const schema of report.schemas) {
    assert.equal(schema.status, "valid", schema.name);
    assert.equal(schema.version, schema.name === "task-bundle" ? 2 : 1, schema.name);
  }
});

test("version two task bundles require byte bindings while legacy bundles remain valid", async () => {
  const schema = await readSchema("task-bundle", getPackageRoot());
  const legacy = { schemaVersion: 1, protocolVersion: 1, taskId: "portable", artifacts: [] };
  assert.doesNotThrow(() => assertSchema(legacy, schema));
  assert.throws(() => assertSchema({ ...legacy, schemaVersion: 2 }, schema));
  assert.doesNotThrow(() => assertSchema({ ...legacy, schemaVersion: 2, files: [] }, schema));
});

test("oneOf does not bypass sibling required fields or object boundaries", () => {
  const schema = {
    type: "object",
    required: ["value", "mode"],
    properties: { value: { type: "string" }, mode: { enum: ["A", "B"] } },
    additionalProperties: false,
    oneOf: [{ properties: { mode: { const: "A" } } }, { properties: { mode: { const: "B" } } }],
  };
  assert.doesNotThrow(() => assertSchema({ value: "accepted", mode: "A" }, schema));
  assert.throws(() => assertSchema({ mode: "A" }, schema));
  assert.throws(() => assertSchema({ value: 42, mode: "A" }, schema));
  assert.throws(() => assertSchema({ value: "accepted", mode: "A", unexpected: true }, schema));
});

test("readSchema caches parsed schemas in memory and clearSchemaCache resets the cache", async () => {
  clearSchemaCache();
  const first = await readSchema("authority", getPackageRoot());
  const second = await readSchema("authority", getPackageRoot());
  assert.equal(first, second, "readSchema should return cached object instance");

  clearSchemaCache();
  const third = await readSchema("authority", getPackageRoot());
  assert.notEqual(first, third, "readSchema should return fresh object after clearSchemaCache");
  assert.deepEqual(first, third);
});

test("execution schema accepts a ForgeLoop-owned command execution artifact", async () => {
  const schema = await readSchema("execution", getPackageRoot());
  assertSchema({
    schemaVersion: 1,
    protocolVersion: 1,
    executionId: "exec-001",
    taskId: "task-1",
    checkId: "tests",
    requirement: "tests",
    verificationCycle: 1,
    kind: "COMMAND_EXECUTION",
    argv: ["npm", "test"],
    cwd: "/target/project",
    resolution: {
      resolutionMode: "LOCAL_PACKAGE_BINARY",
      mayInstall: false,
      installer: null,
      tool: null,
    },
    startedAt: "2026-08-14T19:00:00.000Z",
    finishedAt: "2026-08-14T19:00:03.000Z",
    status: "passed",
    exitCode: 0,
  }, schema, "execution artifact");
});

test("schema health distinguishes invalid and unsupported schema versions", async () => {
  const packageRoot = await mkdtemp(path.join(os.tmpdir(), "forgeloop-schema-"));
  try {
    await cp(path.join(getPackageRoot(), "schemas"), path.join(packageRoot, "schemas"), { recursive: true });
    await writeFile(path.join(packageRoot, "schemas", "routing-input.schema.json"), "{\n", "utf8");
    let report = await inspectSchemaHealth(packageRoot);
    assert.equal(report.status, "invalid");
    assert.equal(report.schemas.find((item) => item.name === "routing-input").status, "invalid");

    await writeFile(
      path.join(packageRoot, "schemas", "routing-input.schema.json"),
      JSON.stringify({ type: "object", properties: { schemaVersion: { const: 99 } } }),
      "utf8",
    );
    report = await inspectSchemaHealth(packageRoot);
    assert.equal(report.status, "unsupported-version");
    assert.equal(report.schemas.find((item) => item.name === "routing-input").status, "unsupported-version");
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});
