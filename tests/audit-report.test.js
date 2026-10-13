import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runAudit } from "../src/commands/audit.js";
import { runReport } from "../src/commands/report.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

test("audit reports exact invalid protocol findings without executing project commands", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-audit-"));
  try {
    const result = await runAudit({ target, packageRoot });
    assert.equal(result.status, "INVALID");
    assert.ok(result.errors.some((error) => error.code === "E_CONTRACT_MISSING"));
    assert.ok(result.errors.some((error) => error.code === "E_ROUTE_MISSING"));
  } finally {
    await removeTempTree(target);
  }
});

test("report exposes independent completion, publication, and readiness dimensions", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-report-"));
  try {
    const first = await runReport({ target, packageRoot });
    const second = await runReport({ target, packageRoot });
    assert.deepEqual(first, second);
    assert.equal(first.publicationStatus, "not-published");
    assert.equal(first.productionReadiness, "not-verified");
    assert.ok(first.sections.some((section) => section.id === "evidence-coverage"));
  } finally {
    await removeTempTree(target);
  }
});
