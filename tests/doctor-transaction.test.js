import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runDoctor } from "../src/commands/doctor.js";
import { getPackageRoot } from "../src/core/templates.js";

test("doctor diagnoses retired legacy repair and preserves interrupted transaction evidence", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-doctor-transaction-"));
  try {
    const root = path.join(target, ".forgeloop/.txn/txn-doctor");
    await mkdir(path.join(root, "backup"), { recursive: true });
    const bytes = `${JSON.stringify({ transactionId: "txn-doctor", status: "COMMITTING", writes: [] })}\n`;
    await writeFile(path.join(root, "manifest.json"), bytes);
    const detected = await runDoctor({ target, packageRoot: getPackageRoot() });
    assert.ok(detected.findings.some((finding) => finding.code === "E_TRANSACTION_INCOMPLETE"));
    const fixed = await runDoctor({ target, packageRoot: getPackageRoot(), fix: true });
    assert.ok(fixed.findings.some((finding) => finding.code === "E_STORAGE_OPERATION_UNSUPPORTED"));
    assert.ok(fixed.findings.some((finding) => finding.code === "E_TRANSACTION_INCOMPLETE"));
    assert.equal(await readFile(path.join(root, "manifest.json"), "utf8"), bytes);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
