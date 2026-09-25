import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { getPackageRoot, readTemplateEntries } from "../src/core/templates.js";
import { sha256 } from "../src/core/manifest.js";
import { NATIVE_ADAPTER_PATHS, isNativeAdapterPath } from "../src/core/target-layout.js";
import { runUpdate } from "../src/commands/update.js";

const packageRoot = getPackageRoot();
const cliPath = path.join(packageRoot, "src", "cli.js");
const realLegacyFixture = path.join(packageRoot, "tests", "fixtures", "legacy-0.1.6");
const currentPackageVersion = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).version;

function runCli(target, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: target,
    encoding: "utf8",
  });
}

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-hidden-layout-"));
  try {
    await run(target);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

const LEGACY_ADAPTER = "# ForgeLoop legacy adapter\n\nRead ./LOOP_ENGINEERING.md, ./PROJECT_PROFILE.md, and ./GUIDE_ROUTER.md.\n";

async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function writeTargetFile(target, relativePath, bytes) {
  const filePath = path.join(target, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
}

async function createLegacyFixture(target, { profileBytes = null, omitManaged = [], unmanaged = {} } = {}) {
  const entries = await readTemplateEntries(packageRoot);
  const files = {};
  for (const entry of entries) {
    const legacyPath = entry.legacyRelativePath;
    const isAdapter = NATIVE_ADAPTER_PATHS.includes(entry.sourcePath);
    const bytes = isAdapter
      ? Buffer.from(unmanaged[entry.sourcePath] ?? LEGACY_ADAPTER)
      : entry.sourcePath === "PROJECT_PROFILE.md" && profileBytes
        ? Buffer.from(profileBytes)
        : entry.bytes;
    await writeTargetFile(target, legacyPath, bytes);
    if (!omitManaged.includes(entry.sourcePath)) {
      files[legacyPath] = {
        sha256: sha256(bytes),
        preserve: entry.sourcePath === "PROJECT_PROFILE.md",
      };
    }
  }
  await writeFile(
    path.join(target, ".forgeloop/manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      packageName: "@cassiomc1/forgeloop",
      packageVersion: "0.1.6",
      files,
    }, null, 2)}\n`,
  );
}

test("init installs canonical kit under .forgeloop/kit and leaves only native shims at root", async () => {
  await withTarget(async (target) => {
    const result = runCli(target, "init");
    assert.equal(result.status, 0, result.stderr);

    const manifest = JSON.parse(await readFile(path.join(target, ".forgeloop/manifest.json"), "utf8"));
    assert.equal(manifest.layoutVersion, 2);
    assert.ok(await readFile(path.join(target, ".forgeloop/kit/LOOP_ENGINEERING.md"), "utf8"));
    assert.ok(await readFile(path.join(target, ".forgeloop/kit/ENG/taste-frontend-eng.md"), "utf8"));
    const profile = await readFile(path.join(target, ".forgeloop/kit/PROJECT_PROFILE.md"), "utf8");
    assert.match(profile, /planned/i);
    assert.match(profile, /present/i);
    assert.match(profile, /profile-status: uninitialized/);
    assert.equal(await readFile(path.join(target, "AGENTS.md"), "utf8").then((text) => text.includes(".forgeloop/kit")), true);
    await assert.rejects(() => readFile(path.join(target, "LOOP_ENGINEERING.md")));
    await assert.rejects(() => readFile(path.join(target, "ENG/clean-code-eng.md")));
    for (const entry of await readTemplateEntries(packageRoot)) {
      if (entry.relativePath !== entry.sourcePath) {
        await assert.rejects(() => readFile(path.join(target, entry.sourcePath)));
      }
    }
  });
});

test("init rejects a symlinked hidden kit before writing target files", async () => {
  await withTarget(async (target) => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "forgeloop-hidden-outside-"));
    try {
      await mkdir(path.join(target, ".forgeloop"), { recursive: true });
      await symlink(outside, path.join(target, ".forgeloop", "kit"));
      const result = runCli(target, "init");
      assert.notEqual(result.status, 0);
      await assert.rejects(() => lstat(path.join(target, "AGENTS.md")));
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("update migrates an unchanged legacy managed root file into the hidden kit", async () => {
  await withTarget(async (target) => {
    const legacyPath = path.join(target, "LOOP_ENGINEERING.md");
    const legacyBytes = await readFile(path.join(packageRoot, "LOOP_ENGINEERING.md"));
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await writeFile(legacyPath, legacyBytes);
    await writeFile(
      path.join(target, ".forgeloop/manifest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        packageName: "@cassiomc1/forgeloop",
        packageVersion: "0.1.6",
        files: { "LOOP_ENGINEERING.md": { sha256: sha256(legacyBytes), preserve: false } },
      }, null, 2)}\n`,
    );

    const result = runCli(target, "update");

    assert.equal(result.status, 0, result.stderr);
    assert.ok(await readFile(path.join(target, ".forgeloop/kit/LOOP_ENGINEERING.md"), "utf8"));
    await assert.rejects(() => readFile(legacyPath));
    assert.equal(JSON.parse(await readFile(path.join(target, ".forgeloop/manifest.json"), "utf8")).layoutVersion, 2);
  });
});

test("update migrates a realistic 0.1.6 installation into one healthy hidden layout", async () => {
  await withTarget(async (target) => {
    await createLegacyFixture(target);

    const result = runCli(target, "update");

    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(path.join(target, ".forgeloop/manifest.json"), "utf8"));
    assert.equal(manifest.layoutVersion, 2);
    for (const adapter of NATIVE_ADAPTER_PATHS) {
      const contents = await readFile(path.join(target, adapter), "utf8");
      assert.match(contents, /\.forgeloop\/kit\/LOOP_ENGINEERING\.md/);
    }
    for (const rootPath of [
      "LOOP_ENGINEERING.md",
      "GUIDE_ROUTER.md",
      "PROJECT_PROFILE.md",
      "LOOP_SYSTEM_DESIGN.md",
      "QUALITY_SCORECARD.md",
      "ENG",
      "schemas",
    ]) {
      assert.equal(await pathExists(path.join(target, rootPath)), false, rootPath);
    }
    for (const hiddenPath of [
      ".forgeloop/kit/LOOP_ENGINEERING.md",
      ".forgeloop/kit/GUIDE_ROUTER.md",
      ".forgeloop/kit/PROJECT_PROFILE.md",
      ".forgeloop/kit/ENG/clean-code-eng.md",
      ".forgeloop/kit/schemas/work-state.schema.json",
    ]) {
      assert.equal(await pathExists(path.join(target, hiddenPath)), true, hiddenPath);
    }

    const doctor = runCli(target, "doctor", "--json");
    const report = JSON.parse(doctor.stdout);
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.equal(report.ok, true);
    assert.equal(report.findings.some((finding) => [
      "E_NATIVE_ADAPTER_STALE",
      "E_NATIVE_ADAPTER_TARGET_MISSING",
      "E_DUPLICATE_PROFILE_SOURCE",
      "manifest-orphan",
    ].includes(finding.code)), false);
  });
});

test("update moves preserved legacy profile bytes and removes the managed root copy", async () => {
  await withTarget(async (target) => {
    const profile = "profile-mode: project\nprofile-status: verified\n\ncustom fact: retained byte-for-byte\n";
    await createLegacyFixture(target, { profileBytes: profile });

    const result = runCli(target, "update");

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      await readFile(path.join(target, ".forgeloop/kit/PROJECT_PROFILE.md"), "utf8"),
      profile,
    );
    assert.equal(await pathExists(path.join(target, "PROJECT_PROFILE.md")), false);
    const manifest = JSON.parse(await readFile(path.join(target, ".forgeloop/manifest.json"), "utf8"));
    assert.equal(manifest.files[".forgeloop/kit/PROJECT_PROFILE.md"].preserve, true);
    assert.equal(manifest.files[".forgeloop/kit/PROJECT_PROFILE.md"].sha256, sha256(Buffer.from(profile)));
    assert.equal(JSON.parse(runCli(target, "doctor", "--json").stdout).ok, true);
  });
});

test("update preserves an unowned legacy profile without adopting or deleting it", async () => {
  await withTarget(async (target) => {
    const profile = "# Team-owned profile\ncustom fact: keep this file at the root\n";
    await createLegacyFixture(target, { profileBytes: profile, omitManaged: ["PROJECT_PROFILE.md"] });

    const result = runCli(target, "update");
    const hiddenProfile = await readFile(path.join(target, ".forgeloop/kit/PROJECT_PROFILE.md"), "utf8");

    assert.equal(result.status, 1);
    assert.match(result.stdout, /E_PROFILE_MIGRATION_CONFLICT/);
    assert.equal(await readFile(path.join(target, "PROJECT_PROFILE.md"), "utf8"), profile);
    assert.notEqual(hiddenProfile, profile);
    assert.equal(JSON.parse(await readFile(path.join(target, ".forgeloop/manifest.json"), "utf8")).layoutVersion, 2);
    const doctor = runCli(target, "doctor", "--json");
    assert.equal(doctor.status, 1);
    assert.ok(JSON.parse(doctor.stdout).findings.some((finding) => finding.code === "E_DUPLICATE_PROFILE_SOURCE"));
  });
});

test("update preserves a modified managed adapter and reports an explicit migration conflict", async () => {
  await withTarget(async (target) => {
    await createLegacyFixture(target);
    const modified = "# Local ForgeLoop adapter\n\nRead ./LOOP_ENGINEERING.md before running the project.\n";
    await writeFile(path.join(target, "AGENTS.md"), modified);

    const result = runCli(target, "update");

    assert.equal(result.status, 1);
    assert.match(result.stdout, /E_NATIVE_ADAPTER_MIGRATION_CONFLICT/);
    assert.equal(await readFile(path.join(target, "AGENTS.md"), "utf8"), modified);
    assert.equal(await pathExists(path.join(target, ".forgeloop/kit/LOOP_ENGINEERING.md")), true);
    assert.equal(JSON.parse(await readFile(path.join(target, ".forgeloop/manifest.json"), "utf8")).layoutVersion, 2);
  });
});

test("update preserves an unowned adapter and reports the adoption requirement", async () => {
  await withTarget(async (target) => {
    const custom = "# Team instructions\nDo not replace this file.\n";
    await createLegacyFixture(target, { omitManaged: ["AGENTS.md"], unmanaged: { "AGENTS.md": custom } });

    const result = runCli(target, "update");
    const manifest = JSON.parse(await readFile(path.join(target, ".forgeloop/manifest.json"), "utf8"));

    assert.equal(result.status, 1);
    assert.match(result.stdout, /E_NATIVE_ADAPTER_MIGRATION_CONFLICT/);
    assert.match(result.stdout, /unmanaged|adopt/i);
    assert.equal(await readFile(path.join(target, "AGENTS.md"), "utf8"), custom);
    assert.equal(manifest.files["AGENTS.md"], undefined);
    assert.equal(manifest.layoutVersion, 2);
  });
});

test("update does not remove mixed legacy directories containing unowned files", async () => {
  await withTarget(async (target) => {
    await createLegacyFixture(target);
    await writeTargetFile(target, "ENG/custom-guide.md", Buffer.from("# User guide\n"));
    await writeTargetFile(target, "schemas/custom-schema.json", Buffer.from("{}\n"));

    const result = runCli(target, "update");

    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(path.join(target, "ENG/custom-guide.md"), "utf8"), "# User guide\n");
    assert.equal(await readFile(path.join(target, "schemas/custom-schema.json"), "utf8"), "{}\n");
    assert.equal(await pathExists(path.join(target, "ENG")), true);
    assert.equal(await pathExists(path.join(target, "schemas")), true);
    assert.equal(await pathExists(path.join(target, ".forgeloop/kit/ENG/clean-code-eng.md")), true);
  });
});

test("update validates legacy symlink paths before writing the hidden kit", async () => {
  await withTarget(async (target) => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "forgeloop-legacy-outside-"));
    try {
      await createLegacyFixture(target);
      await rm(path.join(target, "ENG"), { recursive: true, force: true });
      await symlink(outside, path.join(target, "ENG"));

      const result = runCli(target, "update");

      assert.equal(result.status, 1);
      assert.match(result.stderr, /symlink|inside target/i);
      assert.equal(await pathExists(path.join(target, ".forgeloop/kit/LOOP_ENGINEERING.md")), false);
      assert.equal(await pathExists(path.join(target, "LOOP_ENGINEERING.md")), true);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("update dry-run distinguishes migration actions and does not change the fixture", async () => {
  await withTarget(async (target) => {
    await createLegacyFixture(target);
    const manifestBefore = await readFile(path.join(target, ".forgeloop/manifest.json"));

    const result = runCli(target, "update", "--dry-run");

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /would update adapter/i);
    assert.match(result.stdout, /would move profile/i);
    assert.match(result.stdout, /would migrate/i);
    assert.equal(await readFile(path.join(target, ".forgeloop/manifest.json"), "utf8"), manifestBefore.toString("utf8"));
    assert.equal(await pathExists(path.join(target, "LOOP_ENGINEERING.md")), true);
    assert.equal(await pathExists(path.join(target, ".forgeloop/kit/LOOP_ENGINEERING.md")), false);
  });
});

test("native shims resolve their declared hidden-kit links from their own directories", async () => {
  const entries = await readTemplateEntries(packageRoot);
  for (const adapter of NATIVE_ADAPTER_PATHS) {
    const entry = entries.find((candidate) => candidate.sourcePath === adapter);
    const contents = entry.bytes.toString("utf8");
    const references = [...contents.matchAll(/(?:\.\.\/|\.\/)*\.forgeloop\/kit\/(?:LOOP_ENGINEERING|PROTOCOL_INTEGRATION)\.md/g)]
      .map((match) => match[0]);

    assert.equal(references.length, 2, adapter);
    for (const reference of references) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(adapter), reference));
      assert.match(resolved, /^\.forgeloop\/kit\/(?:LOOP_ENGINEERING|PROTOCOL_INTEGRATION)\.md$/, adapter);
    }
  }
});

test("doctor rejects stale adapters, missing hidden targets, and duplicate root profiles", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    await writeFile(path.join(target, "AGENTS.md"), LEGACY_ADAPTER);
    await writeFile(path.join(target, "PROJECT_PROFILE.md"), "# duplicate legacy profile\n");

    const stale = runCli(target, "doctor", "--json");
    const staleReport = JSON.parse(stale.stdout);
    assert.equal(stale.status, 1);
    assert.ok(staleReport.findings.some((finding) => finding.code === "E_NATIVE_ADAPTER_STALE"));
    assert.ok(staleReport.findings.some((finding) => finding.code === "E_DUPLICATE_PROFILE_SOURCE"));

    await unlink(path.join(target, ".forgeloop/kit/LOOP_ENGINEERING.md"));
    const missing = runCli(target, "doctor", "--json");
    const missingReport = JSON.parse(missing.stdout);
    assert.equal(missing.status, 1);
    assert.ok(missingReport.findings.some((finding) => finding.code === "E_NATIVE_ADAPTER_TARGET_MISSING"));
  });
});

for (const stage of ["HIDDEN_WRITTEN", "HIDDEN_VERIFIED", "MANIFEST_SWITCHED"]) {
  test(`interrupted migration at ${stage} is diagnosed and recovered by the next update`, async () => {
    await withTarget(async (target) => {
      await createLegacyFixture(target);

      await assert.rejects(
        () => runUpdate({
          target,
          dryRun: false,
          packageRoot,
          packageVersion: "0.1.9",
          hooks: {
            afterStage(currentStage) {
              if (currentStage === stage) {
                const error = new Error(`injected migration failure at ${stage}`);
                error.code = "E_INJECTED_MIGRATION_FAILURE";
                throw error;
              }
            },
          },
        }),
        (error) => error.code === "E_INJECTED_MIGRATION_FAILURE",
      );

      const interruptedDoctor = runCli(target, "doctor", "--json");
      assert.equal(interruptedDoctor.status, 1, interruptedDoctor.stderr);
      assert.ok(JSON.parse(interruptedDoctor.stdout).findings.some((finding) => finding.code === "E_MIGRATION_INCOMPLETE"));

      const recovered = runCli(target, "update");
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(JSON.parse(await readFile(path.join(target, ".forgeloop/manifest.json"), "utf8")).layoutVersion, 2);
      assert.equal((await runCli(target, "doctor", "--json")).status, 0);
      assert.equal(await pathExists(path.join(target, "LOOP_ENGINEERING.md")), false);
    });
  });
}

test("cleanup interruption leaves a recoverable authority record and does not lose legacy data", async () => {
  await withTarget(async (target) => {
    await createLegacyFixture(target);

    await assert.rejects(
      () => runUpdate({
        target,
        dryRun: false,
        packageRoot,
        packageVersion: "0.1.9",
        hooks: {
          beforeCleanup(relativePath) {
            if (relativePath === "GUIDE_ROUTER.md") {
              const error = new Error("injected migration cleanup failure");
              error.code = "E_INJECTED_MIGRATION_FAILURE";
              throw error;
            }
          },
        },
      }),
      (error) => error.code === "E_INJECTED_MIGRATION_FAILURE",
    );

    assert.equal(await pathExists(path.join(target, "LOOP_ENGINEERING.md")), false);
    assert.equal(await pathExists(path.join(target, "GUIDE_ROUTER.md")), true);
    const manifest = JSON.parse(await readFile(path.join(target, ".forgeloop/manifest.json"), "utf8"));
    assert.equal(manifest.layoutVersion, 2);
    assert.equal(typeof manifest.files[".forgeloop/kit/LOOP_ENGINEERING.md"].legacySha256, "string");

    const doctor = runCli(target, "doctor", "--json");
    assert.equal(doctor.status, 1);
    assert.ok(JSON.parse(doctor.stdout).findings.some((finding) => finding.code === "E_MIGRATION_INCOMPLETE"));

    const recovered = runCli(target, "update");
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(await pathExists(path.join(target, "GUIDE_ROUTER.md")), false);
    assert.equal((await runCli(target, "doctor", "--json")).status, 0);
  });
});

test("a failed empty-directory cleanup is retried by the next update", async () => {
  await withTarget(async (target) => {
    await createLegacyFixture(target);

    await assert.rejects(
      () => runUpdate({
        target,
        dryRun: false,
        packageRoot,
        packageVersion: "0.1.9",
        hooks: {
          beforeCleanupDirectory(relativePath) {
            if (relativePath === "ENG") {
              const error = new Error("injected empty-directory cleanup failure");
              error.code = "E_INJECTED_MIGRATION_FAILURE";
              throw error;
            }
          },
        },
      }),
      (error) => error.code === "E_INJECTED_MIGRATION_FAILURE",
    );

    assert.equal(await pathExists(path.join(target, "ENG")), true);
    const recovered = runCli(target, "update");
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(await pathExists(path.join(target, "ENG")), false);
    assert.equal((await runCli(target, "doctor", "--json")).status, 0);
  });
});

test("a legacy file modified after the authority switch is preserved during recovery", async () => {
  await withTarget(async (target) => {
    await createLegacyFixture(target);

    await assert.rejects(
      () => runUpdate({
        target,
        dryRun: false,
        packageRoot,
        packageVersion: "0.1.9",
        hooks: {
          afterStage(stage) {
            if (stage === "MANIFEST_SWITCHED") {
              const error = new Error("stop before cleanup");
              error.code = "E_INJECTED_MIGRATION_FAILURE";
              throw error;
            }
          },
        },
      }),
      (error) => error.code === "E_INJECTED_MIGRATION_FAILURE",
    );
    const modified = "# User-owned legacy copy\n";
    await writeFile(path.join(target, "LOOP_ENGINEERING.md"), modified);

    const recovered = runCli(target, "update");
    assert.equal(recovered.status, 1);
    assert.match(recovered.stdout, /E_LEGACY_FILE_MIGRATION_CONFLICT/);
    assert.equal(await readFile(path.join(target, "LOOP_ENGINEERING.md"), "utf8"), modified);
    assert.equal((await runCli(target, "doctor", "--json")).status, 1);
  });
});

test("same-update cleanup preserves a managed legacy file changed after the authority switch", async () => {
  await withTarget(async (target) => {
    await createLegacyFixture(target);
    const modified = "# Changed during active cleanup\n";

    const result = await runUpdate({
      target,
      dryRun: false,
      packageRoot,
      packageVersion: "0.1.9",
      hooks: {
        async afterStage(stage) {
          if (stage === "MANIFEST_SWITCHED") {
            await writeFile(path.join(target, "LOOP_ENGINEERING.md"), modified);
          }
        },
      },
    });

    assert.ok(result.conflicts.some((conflict) => (
      conflict.code === "E_LEGACY_FILE_MIGRATION_CONFLICT"
      && conflict.path === "LOOP_ENGINEERING.md"
    )));
    assert.ok(result.actions.some((action) => (
      action.action === "preserve-conflict"
      && action.path === "LOOP_ENGINEERING.md"
      && action.reason === "changed-before-cleanup"
    )));
    assert.equal(
      await readFile(path.join(target, "LOOP_ENGINEERING.md"), "utf8"),
      modified,
    );
    assert.equal(
      JSON.parse(await readFile(path.join(target, ".forgeloop/manifest.json"), "utf8")).layoutVersion,
      2,
    );
    assert.equal((await runCli(target, "doctor", "--json")).status, 1);
  });
});

test("same-update cleanup preserves a managed project profile changed after the authority switch", async () => {
  await withTarget(async (target) => {
    await createLegacyFixture(target, { profileBytes: "# Managed legacy profile\n" });
    const modified = "# Profile changed during active cleanup\n";

    const result = await runUpdate({
      target,
      dryRun: false,
      packageRoot,
      packageVersion: "0.1.9",
      hooks: {
        async afterStage(stage) {
          if (stage === "MANIFEST_SWITCHED") {
            await writeFile(path.join(target, "PROJECT_PROFILE.md"), modified);
          }
        },
      },
    });

    assert.ok(result.conflicts.some((conflict) => (
      conflict.code === "E_LEGACY_FILE_MIGRATION_CONFLICT"
      && conflict.path === "PROJECT_PROFILE.md"
    )));
    assert.ok(result.actions.some((action) => (
      action.action === "preserve-conflict"
      && action.path === "PROJECT_PROFILE.md"
      && action.reason === "changed-before-cleanup"
    )));
    assert.equal(await readFile(path.join(target, "PROJECT_PROFILE.md"), "utf8"), modified);
    assert.equal(
      await readFile(path.join(target, ".forgeloop/kit/PROJECT_PROFILE.md"), "utf8"),
      "# Managed legacy profile\n",
    );
    assert.equal((await runCli(target, "doctor", "--json")).status, 1);
  });
});

test("same-update cleanup preserves a managed ENG file changed after the authority switch", async () => {
  await withTarget(async (target) => {
    await createLegacyFixture(target);
    const relativePath = "ENG/design-code-eng.md";
    const hiddenBefore = (await readTemplateEntries(packageRoot))
      .find((entry) => entry.sourcePath === relativePath).bytes;
    const modified = "# Guide changed during active cleanup\n";

    const result = await runUpdate({
      target,
      dryRun: false,
      packageRoot,
      packageVersion: "0.1.9",
      hooks: {
        async afterStage(stage) {
          if (stage === "MANIFEST_SWITCHED") {
            await writeFile(path.join(target, relativePath), modified);
          }
        },
      },
    });

    assert.ok(result.conflicts.some((conflict) => (
      conflict.code === "E_LEGACY_FILE_MIGRATION_CONFLICT"
      && conflict.path === relativePath
    )));
    assert.ok(result.actions.some((action) => (
      action.action === "preserve-conflict"
      && action.path === relativePath
      && action.reason === "changed-before-cleanup"
    )));
    assert.equal(await readFile(path.join(target, relativePath), "utf8"), modified);
    assert.deepEqual(
      await readFile(path.join(target, ".forgeloop/kit", relativePath)),
      hiddenBefore,
    );
    assert.equal(await pathExists(path.join(target, "ENG")), true);
    assert.equal((await runCli(target, "doctor", "--json")).status, 1);
  });
});

test("the frozen published 0.1.6 installation migrates without network access", async () => {
  await withTarget(async (target) => {
    await cp(realLegacyFixture, target, { recursive: true });
    await rm(path.join(target, "PROVENANCE.json"));
    const profileBefore = await readFile(path.join(target, "PROJECT_PROFILE.md"));
    const legacyManifest = JSON.parse(await readFile(path.join(target, ".forgeloop/manifest.json"), "utf8"));
    assert.equal(legacyManifest.packageVersion, "0.1.6");
    assert.equal(legacyManifest.layoutVersion, undefined);

    const result = runCli(target, "update");
    assert.equal(
      result.status,
      0,
      JSON.stringify({ status: result.status, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }),
    );
    const manifest = JSON.parse(await readFile(path.join(target, ".forgeloop/manifest.json"), "utf8"));
    assert.equal(manifest.layoutVersion, 2);
    assert.equal(manifest.packageVersion, currentPackageVersion);
    assert.deepEqual(await readFile(path.join(target, ".forgeloop/kit/PROJECT_PROFILE.md")), profileBefore);

    for (const entry of await readTemplateEntries(packageRoot)) {
      if (entry.legacyRelativePath !== entry.relativePath && !isNativeAdapterPath(entry.relativePath)) {
        assert.equal(await pathExists(path.join(target, entry.legacyRelativePath)), false, entry.legacyRelativePath);
      }
    }
    for (const relativePath of [
      ".forgeloop/kit/LOOP_ENGINEERING.md",
      ".forgeloop/kit/PROJECT_PROFILE.md",
      ".forgeloop/kit/ENG/sec-code-eng.md",
      ".forgeloop/kit/schemas/work-state.schema.json",
    ]) {
      assert.equal(await pathExists(path.join(target, relativePath)), true, relativePath);
    }
    const doctor = runCli(target, "doctor", "--json");
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.equal(JSON.parse(doctor.stdout).ok, true);
  });
});
