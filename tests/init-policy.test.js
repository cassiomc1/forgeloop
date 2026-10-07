import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runInit, E_INIT_KIT_CONFLICT, E_POLICY_INITIALIZATION_FAILED, POLICY_INIT_ARTIFACTS } from "../src/commands/init.js";
import { E_POLICY_INITIALIZATION_FAILED as CANONICAL_POLICY_INIT_ERROR } from "../src/core/error-codes.js";
import { readManifest, sha256 } from "../src/core/manifest.js";
import { detectPolicyCapability, verifyPolicyLock, readDiscoveryReport } from "../src/core/policy-engine.js";
import { readBaseline, createBaselineFromViolations } from "../src/core/policy-baseline.js";
import { getPackageRoot, readTemplateEntries } from "../src/core/templates.js";

const packageRoot = getPackageRoot();
const PACKAGE_VERSION = "1.2.1";

async function createTempTarget() {
  return mkdtemp(path.join(os.tmpdir(), "forgeloop-init-policy-"));
}

async function snapshotTree(root) {
  const result = {};
  async function walk(dir, prefix) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else {
        result[rel] = sha256(await readFile(full));
      }
    }
  }
  try {
    await walk(root, "");
  } catch {
    // Root may not exist yet.
  }
  return result;
}

async function assertInitialized(target) {
  assert.ok(await readManifest(target), "manifest must exist after successful init");
  assert.equal(await detectPolicyCapability(target, packageRoot), "AVAILABLE");
  const lock = await verifyPolicyLock(target, packageRoot);
  assert.equal(lock.status, "VALID", `policy.lock must verify: ${JSON.stringify(lock)}`);
}

const injectedFailure = async () => {
  throw new Error("injected deterministic failure");
};

test("INIT-POLICY-1: policy discovery failure fails init with no manifest", async () => {
  const target = await createTempTarget();
  try {
    await assert.rejects(
      () => runInit({
        target,
        dryRun: false,
        packageRoot,
        packageVersion: PACKAGE_VERSION,
        hooks: { afterPolicyDiscovery: injectedFailure },
      }),
      (error) => error.code === E_POLICY_INITIALIZATION_FAILED,
    );
    assert.equal(await readManifest(target), null, "no initialization authority may exist");
  } finally {
    await removeTempTree(target);
  }
});

test("INIT-POLICY-2: baseline write failure fails init and a retry succeeds", async () => {
  const target = await createTempTarget();
  try {
    await assert.rejects(
      () => runInit({
        target,
        dryRun: false,
        packageRoot,
        packageVersion: PACKAGE_VERSION,
        hooks: { beforeBaselineWrite: injectedFailure },
      }),
      (error) => error.code === E_POLICY_INITIALIZATION_FAILED,
    );
    assert.equal(await readManifest(target), null, "manifest must be absent after baseline failure");
    assert.ok(await readManifest(target) === null);

    // Retry without hooks must recover deterministically.
    await runInit({ target, dryRun: false, packageRoot, packageVersion: PACKAGE_VERSION });
    await assertInitialized(target);
  } finally {
    await removeTempTree(target);
  }
});

test("INIT-POLICY-3: policy lock write failure fails init and a retry succeeds", async () => {
  const target = await createTempTarget();
  try {
    await assert.rejects(
      () => runInit({
        target,
        dryRun: false,
        packageRoot,
        packageVersion: PACKAGE_VERSION,
        hooks: { beforePolicyLockWrite: injectedFailure },
      }),
      (error) => error.code === E_POLICY_INITIALIZATION_FAILED,
    );
    assert.equal(await readManifest(target), null);

    await runInit({ target, dryRun: false, packageRoot, packageVersion: PACKAGE_VERSION });
    await assertInitialized(target);
  } finally {
    await removeTempTree(target);
  }
});

test("INIT-POLICY-4: manifest write failure is retried without manual cleanup", async () => {
  const target = await createTempTarget();
  try {
    await assert.rejects(
      () => runInit({
        target,
        dryRun: false,
        packageRoot,
        packageVersion: PACKAGE_VERSION,
        hooks: { beforeManifestWrite: injectedFailure },
      }),
      (error) => error.code === E_POLICY_INITIALIZATION_FAILED,
    );
    assert.equal(await readManifest(target), null);

    // Retry recognizes already-correct kit and policy files and commits the manifest.
    const retry = await runInit({ target, dryRun: false, packageRoot, packageVersion: PACKAGE_VERSION });
    assert.ok(retry.actions.some((action) => action.action === "reuse"), "retry must reuse already-correct files");
    await assertInitialized(target);
  } finally {
    await removeTempTree(target);
  }
});

test("INIT-POLICY-5: unknown architecture succeeds autonomously with uncertainty", async () => {
  const target = await createTempTarget();
  try {
    // A bare src/ directory yields LOW/UNKNOWN architecture confidence, which
    // is legitimate autonomy, not an infrastructure failure.
    await mkdir(path.join(target, "src"), { recursive: true });
    await mkdir(path.join(target, "misc"), { recursive: true });

    await runInit({ target, dryRun: false, packageRoot, packageVersion: PACKAGE_VERSION });
    await assertInitialized(target);
    const discovery = await readDiscoveryReport(target, packageRoot);
    assert.ok(["LOW", "UNKNOWN"].includes(discovery.architecture.confidence));
  } finally {
    await removeTempTree(target);
  }
});

test("INIT-POLICY-6: successful initialization produces valid manifest and verified policy state", async () => {
  const target = await createTempTarget();
  try {
    await runInit({ target, dryRun: false, packageRoot, packageVersion: PACKAGE_VERSION });
    await assertInitialized(target);
    assert.ok((await readBaseline(target, packageRoot)).schemaVersion === 1);
    for (const artifact of POLICY_INIT_ARTIFACTS) {
      await readFile(path.join(target, artifact), "utf8");
    }
  } finally {
    await removeTempTree(target);
  }
});

test("INIT-POLICY-7: dry-run performs zero writes", async () => {
  const target = await createTempTarget();
  try {
    const before = await snapshotTree(target);
    await runInit({ target, dryRun: true, packageRoot, packageVersion: PACKAGE_VERSION });
    const after = await snapshotTree(target);
    assert.deepEqual(after, before, "dry-run must not write any files");
    assert.equal(await readManifest(target), null);
  } finally {
    await removeTempTree(target);
  }
});

test("INIT-KIT-1: a matching canonical kit file is reusable resumable output", async () => {
  const target = await createTempTarget();
  try {
    const entries = await readTemplateEntries(packageRoot);
    const loop = entries.find((entry) => entry.relativePath === ".forgeloop/kit/LOOP_ENGINEERING.md");
    assert.ok(loop, "template must ship .forgeloop/kit/LOOP_ENGINEERING.md");
    await mkdir(path.dirname(path.join(target, loop.relativePath)), { recursive: true });
    await writeFile(path.join(target, loop.relativePath), loop.bytes);

    const result = await runInit({ target, dryRun: false, packageRoot, packageVersion: PACKAGE_VERSION });
    assert.ok(result.actions.some((action) => action.action === "reuse" && action.path === loop.relativePath));
    await assertInitialized(target);
  } finally {
    await removeTempTree(target);
  }
});

test("INIT-KIT-2: a divergent canonical kit file blocks init without overwrite", async () => {
  const target = await createTempTarget();
  try {
    const kitPath = ".forgeloop/kit/LOOP_ENGINEERING.md";
    const conflicting = "tampered kit content\n";
    await mkdir(path.dirname(path.join(target, kitPath)), { recursive: true });
    await writeFile(path.join(target, kitPath), conflicting);

    await assert.rejects(
      () => runInit({ target, dryRun: false, packageRoot, packageVersion: PACKAGE_VERSION }),
      (error) => error.code === E_INIT_KIT_CONFLICT,
    );
    assert.equal(await readManifest(target), null, "manifest must remain absent");
    assert.equal(await readFile(path.join(target, kitPath), "utf8"), conflicting, "conflicting file must be unchanged");
  } finally {
    await removeTempTree(target);
  }
});

test("INIT-KIT-3: a divergent canonical kit schema blocks init", async () => {
  const target = await createTempTarget();
  try {
    const kitPath = ".forgeloop/kit/schemas/work-state.schema.json";
    const conflicting = "{ \"not\": \"a schema\" }\n";
    await mkdir(path.dirname(path.join(target, kitPath)), { recursive: true });
    await writeFile(path.join(target, kitPath), conflicting);

    await assert.rejects(
      () => runInit({ target, dryRun: false, packageRoot, packageVersion: PACKAGE_VERSION }),
      (error) => error.code === E_INIT_KIT_CONFLICT,
    );
    assert.equal(await readManifest(target), null);
    assert.equal(await readFile(path.join(target, kitPath), "utf8"), conflicting);
  } finally {
    await removeTempTree(target);
  }
});

test("INIT-KIT-4: a custom PROJECT_PROFILE.md remains preserved with preserve=true", async () => {
  const target = await createTempTarget();
  try {
    const profilePath = ".forgeloop/kit/PROJECT_PROFILE.md";
    const customProfile = "# My custom profile\ncustom content\n";
    await mkdir(path.dirname(path.join(target, profilePath)), { recursive: true });
    await writeFile(path.join(target, profilePath), customProfile);

    await runInit({ target, dryRun: false, packageRoot, packageVersion: PACKAGE_VERSION });
    assert.equal(await readFile(path.join(target, profilePath), "utf8"), customProfile);
    const manifest = await readManifest(target);
    assert.equal(manifest.files[profilePath].preserve, true);
    await assertInitialized(target);
  } finally {
    await removeTempTree(target);
  }
});

test("INIT-KIT-5: a pre-existing root native adapter remains preserved, not a kit conflict", async () => {
  const target = await createTempTarget();
  try {
    const customAgents = "# Local harness instructions\ncustom adapter\n";
    await writeFile(path.join(target, "AGENTS.md"), customAgents);

    await runInit({ target, dryRun: false, packageRoot, packageVersion: PACKAGE_VERSION });
    assert.equal(await readFile(path.join(target, "AGENTS.md"), "utf8"), customAgents);
    await assertInitialized(target);
  } finally {
    await removeTempTree(target);
  }
});

test("INIT-ERR-2: E_POLICY_INITIALIZATION_FAILED has a single canonical source", () => {
  assert.equal(E_POLICY_INITIALIZATION_FAILED, CANONICAL_POLICY_INIT_ERROR);
  assert.equal(CANONICAL_POLICY_INIT_ERROR, "E_POLICY_INITIALIZATION_FAILED");
});

test("INIT-KIT-6: canonical kit conflict is detected before any initialization write", async () => {
  const target = await createTempTarget();
  try {
    const conflictPath = ".forgeloop/kit/LOOP_ENGINEERING.md";
    await mkdir(path.dirname(path.join(target, conflictPath)), { recursive: true });
    await writeFile(path.join(target, conflictPath), "tampered canonical kit\n", "utf8");

    const before = await snapshotTree(target);

    await assert.rejects(
      () => runInit({ target, dryRun: false, packageRoot, packageVersion: PACKAGE_VERSION }),
      (error) => error.code === E_INIT_KIT_CONFLICT,
    );

    const after = await snapshotTree(target);
    assert.deepEqual(
      after,
      before,
      "pre-existing deterministic init conflict must be side-effect free",
    );
    assert.equal(await readManifest(target), null);
    assert.equal(await readFile(path.join(target, conflictPath), "utf8"), "tampered canonical kit\n");
  } finally {
    await removeTempTree(target);
  }
});

test("INIT-POLICY-8: dry-run detects a deterministic existing policy conflict and performs zero writes", async () => {
  const target = await createTempTarget();
  try {
    // A schema-valid but noncanonical baseline: semantically conflicting
    // existing authority, not malformed JSON.
    const conflictingBaseline = createBaselineFromViolations([
      { ruleId: "SECURITY.NO_HARDCODED_SECRET", file: "legacy.js", snippet: "legacy-secret" },
    ]);
    const baselinePath = ".forgeloop/policy/baseline.json";
    await mkdir(path.dirname(path.join(target, baselinePath)), { recursive: true });
    await writeFile(
      path.join(target, baselinePath),
      `${JSON.stringify(conflictingBaseline, null, 2)}\n`,
      "utf8",
    );

    const before = await snapshotTree(target);

    await assert.rejects(
      () => runInit({ target, dryRun: true, packageRoot, packageVersion: PACKAGE_VERSION }),
      (error) => error.code === E_POLICY_INITIALIZATION_FAILED,
    );

    const after = await snapshotTree(target);
    assert.deepEqual(after, before, "dry-run must not write any files");
    assert.equal(await readManifest(target), null);
    assert.equal(
      await readFile(path.join(target, baselinePath), "utf8"),
      `${JSON.stringify(conflictingBaseline, null, 2)}\n`,
      "conflicting baseline must remain unchanged",
    );
  } finally {
    await removeTempTree(target);
  }
});

test("INIT-POLICY-9: dry-run reports reuse for canonical policy artifacts left by an interrupted init", async () => {
  const target = await createTempTarget();
  try {
    // Real init fails deterministically before the manifest is committed.
    await assert.rejects(
      () => runInit({
        target,
        dryRun: false,
        packageRoot,
        packageVersion: PACKAGE_VERSION,
        hooks: { beforeManifestWrite: injectedFailure },
      }),
      (error) => error.code === E_POLICY_INITIALIZATION_FAILED,
    );
    assert.equal(await readManifest(target), null);

    const before = await snapshotTree(target);

    const dryRunResult = await runInit({ target, dryRun: true, packageRoot, packageVersion: PACKAGE_VERSION });
    for (const artifact of POLICY_INIT_ARTIFACTS) {
      assert.ok(
        dryRunResult.actions.some((action) => action.action === "reuse" && action.path === artifact),
        `dry-run must report reuse for ${artifact}`,
      );
    }

    const after = await snapshotTree(target);
    assert.deepEqual(after, before, "dry-run must not write any files");
    assert.equal(await readManifest(target), null);
  } finally {
    await removeTempTree(target);
  }
});


test("init excludes native SQLite runtime files from Git while retaining reviewable policy inputs", async () => {
  const { createGitRepository } = await import("./helpers/git-fixture.js");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execute = promisify(execFile);
  const target = await createGitRepository("forgeloop-init-native-ignore-");
  try {
    await runInit({ target, packageRoot, packageVersion: PACKAGE_VERSION });
    const ignored = ["state.sqlite", "state.sqlite-wal", "state.sqlite-shm", "storage-version.json"].map(name => `.forgeloop/${name}`);
    const result = await execute("git", ["-C", target, "check-ignore", "--no-index", ...ignored]);
    assert.deepEqual(result.stdout.trim().split(/\r?\n/), ignored);
    await assert.rejects(execute("git", ["-C", target, "check-ignore", "--no-index", ".forgeloop/policy/baseline.json", ".forgeloop/policy/policy.lock", ".forgeloop/manifest.json"]), error => error.code === 1 && error.stdout === "");
  } finally { await removeTempTree(target); }
});
