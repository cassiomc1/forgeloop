import test from "node:test";
import assert from "node:assert/strict";

import { ARTIFACT_REGISTRY } from "../src/core/artifact-registry.js";
import { SHIPPED_SCHEMA_NAMES, readSchema, validateSchema } from "../src/core/schema-validation.js";

test("registry declares durable action artifacts with protocol ownership", () => {
  const expected = {
    actions: {
      scope: "TASK",
      owner: "PROTOCOL_MANAGED",
      mutability: "STATE_MACHINE_TRANSITIONS",
      trustRole: "EXTERNAL_ACTION_PROVENANCE",
      schema: "action",
    },
    approvals: {
      scope: "TASK",
      owner: "PROTOCOL_MANAGED",
      mutability: "APPEND_DECISION_ONCE",
      trustRole: "ACTION_APPROVAL_ATTESTATION",
      schema: "approval",
    },
    capabilityPolicy: {
      scope: "PROJECT",
      owner: "OPERATOR_OR_AGENT",
      mutability: "MUTABLE_CONFIGURATION",
      trustRole: "CAPABILITY_POLICY_SPECIFICATION",
      schema: "capability-policy",
    },
    evaluations: {
      scope: "TASK",
      owner: "PROTOCOL_COMPILED",
      mutability: "IMMUTABLE_ONCE_WRITTEN",
      trustRole: "TRAJECTORY_EVALUATION",
      schema: "trajectory-evaluation",
    },
  };

  for (const [key, meta] of Object.entries(expected)) {
    assert.ok(ARTIFACT_REGISTRY[key], `${key} registered`);
    for (const [field, value] of Object.entries(meta)) {
      assert.equal(ARTIFACT_REGISTRY[key][field], value, `${key}.${field}`);
    }
    assert.equal(ARTIFACT_REGISTRY[key].isPublic, true);
    assert.equal(ARTIFACT_REGISTRY[key].isPersisted, true);
  }
});

test("capability policy is classified as policy specification, not host authority", () => {
  const entry = ARTIFACT_REGISTRY.capabilityPolicy;
  assert.notEqual(entry.trustRole, "HOST_AUTHORITY");
  assert.match(entry.description ?? "", /.*/);
});

test("new schemas ship in the shipped-schema registry and validate fixtures", async () => {
  for (const name of [
    "action",
    "approval",
    "capability-policy",
    "trajectory-evaluation",
    "trajectory-scenario",
  ]) {
    assert.ok(SHIPPED_SCHEMA_NAMES.includes(name), `${name} in SHIPPED_SCHEMA_NAMES`);
    const schema = await readSchema(name);
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  }

  const actionSchema = await readSchema("action");
  assert.deepEqual(
    validateSchema({ schemaVersion: 2 }, actionSchema).length > 0,
    true,
    "schema rejects wrong schemaVersion",
  );
});


test("logical artifact identities resolve to real canonical storage while exports stay explicit", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { openStorageDatabase } = await import("../src/storage/connection.js");
  const directory = await mkdtemp(path.join(tmpdir(), "forgeloop-registry-storage-"));
  let db;
  try {
    db = openStorageDatabase(path.join(directory, "state.sqlite"));
    for (const artifact of Object.values(ARTIFACT_REGISTRY)) {
      assert.equal(artifact.path, artifact.logicalPath, "historical aliases remain unchanged");
      const storage = artifact.canonicalStorage;
      if (storage.backend === "FILE") {
        assert.equal(storage.path, artifact.logicalPath);
        assert.equal(artifact.exportPath, null, "database export does not claim configuration copies");
        continue;
      }
      assert.equal(storage.path, ".forgeloop/state.sqlite");
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(storage.table), `${artifact.key} names a real table`);
      if (storage.column) {
        assert.match(storage.table, /^[a-z_]+$/u);
        assert.ok(db.prepare(`PRAGMA table_info(${storage.table})`).all().some(column => column.name === storage.column), `${artifact.key} names a real payload column`);
      }
      assert.ok(Object.isFrozen(storage));
    }
    assert.equal(ARTIFACT_REGISTRY.state.canonicalStorage.column, "state_json");
    assert.equal(ARTIFACT_REGISTRY.approvals.canonicalStorage.table, "approvals");
    assert.equal(ARTIFACT_REGISTRY.semanticDecisions.canonicalStorage.kind, "decision");
    assert.equal(ARTIFACT_REGISTRY.attestationBundle.canonicalStorage.backend, "SQLITE_REFERENCED_FILE");
    assert.equal(ARTIFACT_REGISTRY.attestationBundle.exportPath, ".forgeloop/attachments/objects/<sha256>");
    assert.equal(ARTIFACT_REGISTRY.attestationBundle.exportBindingPath, "export-index.json#attachments");
    assert.notEqual(ARTIFACT_REGISTRY.attestationBundle.exportPath, ARTIFACT_REGISTRY.attestationBundle.logicalPath);
  } finally {
    db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
