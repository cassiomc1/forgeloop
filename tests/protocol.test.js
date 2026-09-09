import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  FAILURE_CODES,
  FAILURE_CLASSES,
  GUIDE_IDS,
  PROTOCOL_VERSION,
  WORK_PHASES,
  assertFailureClass,
  isValidTransition,
} from "../src/core/protocol.js";
import { assertSchema } from "../src/core/schema-validation.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaNames = [
  "routing-input",
  "routing-result",
  "work-state",
  "execution-receipt",
  "task-brief",
  "delegated-result",
  "evidence",
  "current-contract",
  "gate",
  "source-registry",
  "config",
  "preflight",
  "check",
  "execution",
  "evidence-coverage",
  "event",
  "activation",
  "policy",
  "task-bundle",
];

test("protocol exposes stable versions, failure classes, phases, and guides", () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.equal(new Set(FAILURE_CLASSES).size, 13);
  assert.equal(new Set(WORK_PHASES).size, 13);
  assert.equal(new Set(GUIDE_IDS).size, 11);
});

test("protocol exposes the unresolved-decision preflight failure code", () => {
  assert.ok(FAILURE_CODES.includes("E_CONTRACT_UNRESOLVED_DECISION"));
});

test("protocol accepts valid transitions and rejects terminal regressions", () => {
  assert.equal(isValidTransition("VERIFYING", "DIAGNOSING"), true);
  assert.equal(isValidTransition("VERIFYING", "REVIEWING"), true);
  assert.equal(isValidTransition("ROUTED", "PLANNED"), true);
  assert.equal(isValidTransition("COMPLETE", "EXECUTING"), false);
  assert.equal(isValidTransition("BLOCKED", "VERIFYING"), false);
});

test("protocol rejects unknown failure classes", () => {
  assert.throws(
    () => assertFailureClass("UNKNOWN_FAILURE"),
    /unknown failure class/i,
  );
});

test("shipped protocol schemas are object schemas with version metadata", async () => {
  for (const name of schemaNames) {
    const schema = JSON.parse(
      await readFile(path.join(repositoryRoot, "schemas", `${name}.schema.json`), "utf8"),
    );
    assert.equal(schema.type, "object", name);
    assert.equal(schema.properties.schemaVersion.const, 1, name);
    assert.ok(Array.isArray(schema.required), name);
    assert.doesNotThrow(() => assertSchema({}, { type: "object" }, name));
  }
});
