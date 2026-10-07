import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { BUILTIN_ADAPTERS, getPolicyAdapter } from "../src/core/policy-adapters.js";

async function withTarget(fn) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-policy-adapters-"));
  try {
    await fn(target);
  } finally {
    await removeTempTree(target);
  }
}

test("secret detection scans text, ignores approved lock and protocol files, and reports stable violations", async () => {
  await withTarget(async (target) => {
    await mkdir(path.join(target, ".forgeloop", "policy"), { recursive: true });
    await writeFile(path.join(target, "safe.js"), "export const safe = true;\n", "utf8");
    const adapter = getPolicyAdapter("secret-detection");
    const result = await adapter.check({
      target,
      files: [
        "safe.js",
        "unsafe.js",
        "image.png",
        "package-lock.json",
        ".forgeloop/policy/baseline.json",
        "missing.js",
      ],
      contentOverrides: {
        "unsafe.js": "const api_key = \"12345678901234567890\";\n",
        "package-lock.json": "const api_key = \"12345678901234567890\";\n",
      },
    });
    assert.equal(result.passed, false);
    assert.equal(result.scannedFiles, 2);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0].file, "unsafe.js");
    assert.match(result.violations[0].fingerprint, /^sha256:[a-f0-9]{64}$/);
  });
});

test("all built-in adapters expose deterministic pass, inert, and fail-closed branches", async () => {
  await withTarget(async (target) => {
    const grain = BUILTIN_ADAPTERS["grain-complexity"];
    const shallow = await grain.check({ target, files: ["src.js"], contentOverrides: { "src.js": "export const value = 1;\n" } });
    assert.equal(shallow.passed, true);
    assert.equal(shallow.isInert, false);
    const deep = await grain.check({ target, rule: { check: { threshold: 0 } }, files: ["src.js"], contentOverrides: { "src.js": "if (true) {\n  if (true) {\n    value();\n  }\n}\n" } });
    assert.equal(deep.passed, false);
    assert.equal(deep.violations[0].ruleId, "GRAIN.MAX_COMPLEXITY");
    const empty = await grain.check({ target, files: ["image.png"] });
    assert.equal(empty.isInert, true);

    const layers = BUILTIN_ADAPTERS["architecture-layers"];
    const violation = await layers.check({
      target,
      files: ["src/domain/service.js"],
      contentOverrides: { "src/domain/service.js": "import db from '../infrastructure';\n" },
    });
    assert.equal(violation.passed, false);
    const noDomain = await layers.check({ target, files: ["src/app.js"] });
    assert.equal(noDomain.isInert, true);

    const structure = BUILTIN_ADAPTERS["repo-structure"];
    const structureResult = await structure.check({
      target,
      rule: { parameters: { requiredFiles: ["safe.js", "missing.js"] } },
    });
    assert.equal(structureResult.passed, false);
    assert.equal(structureResult.violations.find((violation) => violation.file === "missing.js").file, "missing.js");
    assert.equal((await structure.check({ target })).isInert, true);

    const runner = await BUILTIN_ADAPTERS["test-runner"].check({ rule: { check: { command: ["node", "--test"] } } });
    assert.equal(runner.passed, true);
    assert.deepEqual(runner.candidateCommand, ["node", "--test"]);
  });
});

test("unknown policy adapters are unavailable instead of becoming implicit pass results", () => {
  assert.equal(getPolicyAdapter("not-a-real-adapter"), null);
});
