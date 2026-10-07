import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runDoctor } from "../src/commands/doctor.js";
import { createReceipt, validateReceipt } from "../src/core/receipt.js";
import { inspectTarget } from "../src/core/inspect.js";
import { formatInspectResult } from "../src/commands/inspect.js";
import { runInit } from "../src/commands/init.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

const receiptInput = {
  taskId: "task-observe-1",
  contractFingerprint: "a".repeat(64),
  selectedGuides: ["clean", "test"],
  changedPaths: ["src/example.js"],
  checks: [{ name: "npm test", status: "passed" }],
  review: { status: "self-review", independent: false },
  limitations: ["Windows not verified locally"],
  publication: { committed: false, pushed: false, pullRequest: null, deployed: false },
};

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-observe-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

test("receipt creation returns a versioned explicit publication state", async () => {
  const receipt = await createReceipt(receiptInput, packageRoot);

  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.protocolVersion, 1);
  assert.deepEqual(receipt.publication, receiptInput.publication);
  await assert.doesNotReject(() => validateReceipt(receipt, packageRoot));
});

test("receipt validation rejects ambiguous publication fields", async () => {
  await assert.rejects(
    () => validateReceipt({ ...receiptInput, publication: { committed: true } }, packageRoot),
    /required|publication/i,
  );
});

test("receipt validation rejects secret-like fields and values", async () => {
  const marker = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
  await assert.rejects(
    () => validateReceipt({ ...receiptInput, apiKey: "not-for-receipts" }, packageRoot),
    /secret|credential|additional property/i,
  );
  await assert.rejects(
    () => validateReceipt({ ...receiptInput, limitations: [marker] }, packageRoot),
    /secret|private key/i,
  );
});

test("doctor findings include remediation and evidence", async () => {
  await withTarget(async (target) => {
    await runInit({ target, dryRun: false, packageRoot, packageVersion: "0.1.0" });
    const result = await runDoctor({ target, packageRoot });

    assert.ok(result.findings.length > 0);
    for (const finding of result.findings) {
      assert.equal(typeof finding.remediation, "string");
      assert.equal(finding.evidence.kind, "OBSERVED");
      assert.equal(typeof finding.evidence.source, "string");
      assert.equal(typeof finding.evidence.result, "string");
    }
    assert.equal(result.evidence[0].kind, "OBSERVED");
  });
});

test("inspect exposes target, protocol, compatibility, state, and findings", async () => {
  await withTarget(async (target) => {
    await runInit({ target, dryRun: false, packageRoot, packageVersion: "0.1.0" });
    const report = await inspectTarget({ target, packageRoot });

    assert.equal(report.target.path, target);
    assert.equal(report.protocol.version, 1);
    assert.equal(report.protocol.schemaStatus, "valid");
    assert.deepEqual(report.authority, {
      sourceConfigured: false,
      sourceType: null,
      trustMode: "NONE",
      trusted: false,
    });
    assert.ok(report.protocol.schemas.every((schema) => schema.status === "valid"));
    assert.equal(Array.isArray(report.compatibility.agents), true);
    assert.equal(typeof report.state.status, "string");
    assert.equal(Array.isArray(report.findings), true);
  });
});

test("inspect labels environment configuration as NONE and untrusted", async () => {
  await withTarget(async (target) => {
    await runInit({ target, dryRun: false, packageRoot, packageVersion: "0.1.0" });
    const previousFile = process.env.FORGELOOP_AUTHORITY_FILE;
    try {
      process.env.FORGELOOP_AUTHORITY_FILE = "/tmp/actor-selected-authority.json";
      const report = await inspectTarget({ target, packageRoot });

      assert.deepEqual(report.authority, {
        sourceConfigured: true,
        sourceType: "external-file",
        trustMode: "NONE",
        trusted: false,
      });
      assert.match(formatInspectResult(report), /external-file \/ UNATTESTED/);
    } finally {
      if (previousFile === undefined) delete process.env.FORGELOOP_AUTHORITY_FILE;
      else process.env.FORGELOOP_AUTHORITY_FILE = previousFile;
    }
  });
});

test("inspect reports a host-attested authority context as trusted", async () => {
  await withTarget(async (target) => {
    await runInit({ target, dryRun: false, packageRoot, packageVersion: "0.1.0" });
    const report = await inspectTarget({
      target,
      packageRoot,
      authorityContext: {
        trustMode: "HOST_ATTESTED",
        trustedAuthorityFile: "/trusted/host/authority.json",
      },
    });

    assert.deepEqual(report.authority, {
      sourceConfigured: true,
      sourceType: "external-file",
      trustMode: "HOST_ATTESTED",
      trusted: true,
    });
    assert.match(formatInspectResult(report), /external-file \/ TRUSTED/);
  });
});
