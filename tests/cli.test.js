import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { sha256 } from "../src/core/manifest.js";
import { readTemplateEntries } from "../src/core/templates.js";
import {
  contractFingerprint,
  createWorkState,
  writeWorkState,
} from "../src/core/work-state.js";
import { createContract, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { runPreflight } from "../src/commands/preflight.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute, readPersistedRoute } from "../src/core/route-artifact.js";
import { withProjectStorage } from "../src/storage/project-boundary.js";
import { readOperationalText } from "../src/storage/operational-context.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repositoryRoot, "src", "cli.js");
const currentPackageVersion = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")).version;

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-cli-"));
  try {
    await run(target);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

function runCliFrom(cwd, target, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args, "--path", target], {
    cwd,
    encoding: "utf8",
  });
}

function runCli(target, ...args) {
  return runCliFrom(repositoryRoot, target, ...args);
}

function runCliDirect(cwd, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
  });
}

async function setupExecutingTarget(target) {
  const created = runCli(target, "task-create", "--task", "task-cli-next", "--claim", "src/commands/next.js");
  assert.equal(created.status, 0, created.stderr);
  return withProjectStorage(target, async () => {
  const contract = createContract({
    taskId: "task-cli-next",
    objective: "Expose deterministic lifecycle navigation through the CLI",
    deliverables: ["src/commands/next.js"],
    constraints: ["offline"],
    risks: [],
    verification: ["node --test tests/cli.test.js"],
    successCriteria: ["tests"],
    stopConditions: ["missing protocol artifacts"],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const fingerprint = contractFingerprint(contract);
  await writeContract(target, contract, repositoryRoot, { taskId: contract.taskId });
  const route = await persistRoute(
    target,
    evaluateRoute({ workType: "code", behaviorChange: true }),
    repositoryRoot,
    { contractFingerprint: fingerprint, taskId: contract.taskId },
  );
  await writeWorkState(target, createWorkState({
    taskId: contract.taskId,
    contractFingerprint: fingerprint,
    routeFingerprint: route.fingerprint,
    repositoryFingerprint: { branch: null, head: null },
    phase: "EXECUTING",
    previousPhase: "PLANNED",
    selectedGuides: route.value.guides,
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: ["contract", "route"],
    pendingSteps: ["implementation", "verification"],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
  }), { packageRoot: repositoryRoot, taskId: contract.taskId });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "CONTRACT_VALIDATED" }, repositoryRoot, { taskId: contract.taskId });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "ROUTE_VALIDATED" }, repositoryRoot, { taskId: contract.taskId });
  await runPreflight({ target, packageRoot: repositoryRoot, taskId: contract.taskId });
  await appendProtocolEvent(target, { taskId: contract.taskId, event: "EXECUTION_STARTED" }, repositoryRoot, { taskId: contract.taskId });
  });
}

test("next renders shared lifecycle guidance in human and JSON formats", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    await setupExecutingTarget(target);

    const human = runCli(target, "next");
    assert.equal(human.status, 0, human.stderr);
    assert.match(human.stdout, /FORGELOOP NEXT: ENTER_VERIFYING/);
    assert.match(human.stdout, /advance --to VERIFYING/);

    const json = runCli(target, "next", "--json");
    assert.equal(json.status, 0, json.stderr);
    assert.equal(JSON.parse(json.stdout).nextAction, "ENTER_VERIFYING");
  });
});

test("init copies canonical files and creates a manifest", async () => {
  await withTarget(async (target) => {
    const result = runCli(target, "init");

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /created/i);
    assert.match(await readFile(path.join(target, "AGENTS.md"), "utf8"), /LOOP_ENGINEERING/);

    const manifest = JSON.parse(
      await readFile(path.join(target, ".forgeloop", "manifest.json"), "utf8"),
    );
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.packageVersion, currentPackageVersion);
    assert.equal(manifest.layoutVersion, 2);
    assert.equal(manifest.files[".forgeloop/kit/PROJECT_PROFILE.md"].preserve, true);
    assert.ok(manifest.files["AGENTS.md"].sha256);
    await assert.rejects(() => readFile(path.join(target, ".forgeloop/kit/LICENSE"), "utf8"));
    await assert.rejects(() => readFile(path.join(target, ".forgeloop/kit/LICENSE-DOCS.md"), "utf8"));
    assert.match(
      await readFile(path.join(target, ".forgeloop/kit/PROTOCOL_INTEGRATION.md"), "utf8"),
      /Protocol Integration/i,
    );
  });
});

test("init preserves a pre-existing adapter", async () => {
  await withTarget(async (target) => {
    const existing = "# Local instructions\n";
    await writeFile(path.join(target, "AGENTS.md"), existing);

    const result = runCli(target, "init");

    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(path.join(target, "AGENTS.md"), "utf8"), existing);
  });
});

test("doctor returns healthy after init and explains profile initialization", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    const result = runCli(target, "doctor");

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /healthy/i);
    assert.match(result.stdout, /profile/i);
  });
});

test("update reports a local conflict without changing the file", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    const agentsPath = path.join(target, "AGENTS.md");
    await writeFile(agentsPath, "# Local change\n");

    const result = runCli(target, "update");

    assert.equal(result.status, 1);
    assert.match(result.stdout, /conflict/i);
    assert.equal(await readFile(agentsPath, "utf8"), "# Local change\n");
  });
});

test("update keeps the previous package version when a conflict remains", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    const manifestPath = path.join(target, ".forgeloop", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.packageVersion = "0.0.9";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(path.join(target, "AGENTS.md"), "# Local change\n");

    const result = runCli(target, "update");
    const after = JSON.parse(await readFile(manifestPath, "utf8"));

    assert.equal(result.status, 1);
    assert.match(result.stdout, /conflict/i);
    assert.equal(after.packageVersion, "0.0.9");
  });
});

test("update does not partially apply safe files when another file conflicts", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    const manifestPath = path.join(target, ".forgeloop", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const oldAgents = "# Previous managed version\n";
    await writeFile(path.join(target, "AGENTS.md"), oldAgents);
    manifest.files["AGENTS.md"].sha256 = sha256(Buffer.from(oldAgents));
    await writeFile(path.join(target, "CLAUDE.md"), "# Local conflict\n");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = runCli(target, "update");
    const after = JSON.parse(await readFile(manifestPath, "utf8"));

    assert.equal(result.status, 1);
    assert.equal(await readFile(path.join(target, "AGENTS.md"), "utf8"), oldAgents);
    assert.deepEqual(after, manifest);
  });
});

test("update always preserves the project profile", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    const profilePath = path.join(target, ".forgeloop/kit/PROJECT_PROFILE.md");
    const profile = await readFile(profilePath, "utf8");
    await writeFile(profilePath, `${profile}\n# Project-specific note\n`);

    const result = runCli(target, "update");

    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(profilePath, "utf8"), `${profile}\n# Project-specific note\n`);
  });
});

test("update refreshes package identity after a manual legacy directory move", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    const manifestPath = path.join(target, ".forgeloop", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.packageName = "@cassiomc1/mdfiles";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await rename(path.join(target, ".forgeloop"), path.join(target, ".mdfiles"));
    await rename(path.join(target, ".mdfiles"), path.join(target, ".forgeloop"));

    const result = runCli(target, "update");
    const after = JSON.parse(await readFile(manifestPath, "utf8"));

    assert.equal(result.status, 0, result.stderr);
    assert.equal(after.packageName, "@cassiomc1/forgeloop");
  });
});

test("init dry-run does not write files", async () => {
  await withTarget(async (target) => {
    const result = runCli(target, "init", "--dry-run");

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /would create|dry-run/i);
    assert.deepEqual(await readdir(target), []);
  });
});

test("init installs all templates only in the selected target", async () => {
  const caller = await mkdtemp(path.join(os.tmpdir(), "forgeloop-caller-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-target-"));
  try {
    const result = runCliFrom(caller, target, "init");

    assert.equal(result.status, 0, result.stderr);
    for (const entry of await readTemplateEntries(repositoryRoot)) {
      await readFile(path.join(target, entry.relativePath), "utf8");
    }
    assert.deepEqual(await readdir(caller), []);
  } finally {
    await rm(caller, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test("doctor strict mode fails when a managed file drifts", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    await writeFile(path.join(target, "AGENTS.md"), "# Drifted local instructions\n");

    const result = runCli(target, "doctor", "--strict");

    assert.equal(result.status, 1);
    assert.match(result.stdout, /unhealthy/i);
    assert.match(result.stdout, /file-drift/i);
  });
});

test("doctor adopts a pre-existing adapter as preserved", async () => {
  await withTarget(async (target) => {
    await writeFile(path.join(target, "AGENTS.md"), "# Local instructions\n");
    assert.equal(runCli(target, "init").status, 0);

    const result = runCli(target, "doctor", "--adopt", "AGENTS.md", "--json");
    const report = JSON.parse(result.stdout);
    const manifest = JSON.parse(
      await readFile(path.join(target, ".forgeloop", "manifest.json"), "utf8"),
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.ok, true);
    assert.ok(report.findings.some((finding) => finding.code === "file-adopted"));
    assert.equal(manifest.files["AGENTS.md"].preserve, true);
  });
});

test("doctor --fix restores missing managed template files and updates manifest", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    const missingFile = path.join(target, ".forgeloop", "kit", "schemas", "authority.schema.json");
    await rm(missingFile, { force: true });

    const doctorBefore = runCli(target, "doctor", "--json");
    const reportBefore = JSON.parse(doctorBefore.stdout);
    assert.equal(reportBefore.ok, false);
    assert.ok(reportBefore.findings.some((f) => f.code === "file-missing"));

    const doctorFix = runCli(target, "doctor", "--fix", "--json");
    const reportFix = JSON.parse(doctorFix.stdout);
    assert.equal(doctorFix.status, 0, doctorFix.stderr);
    assert.equal(reportFix.ok, true);
    assert.ok(reportFix.findings.some((f) => f.code === "file-restored"));

    const doctorAfter = runCli(target, "doctor", "--json");
    const reportAfter = JSON.parse(doctorAfter.stdout);
    assert.equal(reportAfter.ok, true);
    assert.ok(!reportAfter.findings.some((f) => f.code === "file-missing"));
  });
});

test("doctor reports manifest entries for templates that are no longer shipped", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    const manifestPath = path.join(target, ".forgeloop", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files["obsolete-guide.md"] = { sha256: "a".repeat(64), preserve: false };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(path.join(target, "obsolete-guide.md"), "# Old guide\n");

    const result = runCli(target, "doctor", "--json");
    const report = JSON.parse(result.stdout);

    assert.equal(result.status, 0, result.stderr);
    assert.ok(
      report.findings.some(
        (finding) => finding.code === "manifest-orphan" && finding.path === "obsolete-guide.md",
      ),
    );
  });
});

test("update prunes removed template entries without deleting target files", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    const manifestPath = path.join(target, ".forgeloop", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files["obsolete-guide.md"] = { sha256: "a".repeat(64), preserve: false };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(path.join(target, "obsolete-guide.md"), "# Old guide\n");

    const result = runCli(target, "update");
    const after = JSON.parse(await readFile(manifestPath, "utf8"));

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /pruned/i);
    assert.equal(after.files["obsolete-guide.md"], undefined);
    assert.equal(await readFile(path.join(target, "obsolete-guide.md"), "utf8"), "# Old guide\n");
  });
});

test("top-level help succeeds without a command", async () => {
  await withTarget(async (target) => {
    const result = runCli(target, "--help");

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: forgeloop/);
  });
});

test("CLI supports version output and equals-form paths", async () => {
  const version = runCliDirect(repositoryRoot, "--version");
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), currentPackageVersion);

  await withTarget(async (target) => {
    const result = runCliDirect(repositoryRoot, "init", `--path=${target}`);
    assert.equal(result.status, 0, result.stderr);
    await readFile(path.join(target, "AGENTS.md"), "utf8");
  });
});

test("CLI accepts global options before the command", async () => {
  await withTarget(async (target) => {
    const result = runCliDirect(
      repositoryRoot,
      `--path=${target}`,
      "init",
      "--dry-run",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await readdir(target), []);
  });
});

test("importing the CLI module has no command-line side effect", () => {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", 'await import("./src/cli.js"); console.log("imported")'],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "imported");
});

test("CLI runs when invoked through an npm-style symlink", async () => {
  const binDirectory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-bin-"));
  const linkedCli = path.join(
    binDirectory,
    process.platform === "win32" ? "forgeloop.cmd" : "forgeloop",
  );
  try {
    if (process.platform === "win32") {
      await writeFile(
        linkedCli,
        `@echo off\r\n"${process.execPath}" "${cliPath}" %*\r\n`,
      );
    } else {
      await symlink(cliPath, linkedCli);
    }
    const result = spawnSync(linkedCli, ["--version"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), currentPackageVersion);
  } finally {
    await rm(binDirectory, { recursive: true, force: true });
  }
});

test("command help lists only the selected command options", () => {
  const result = runCliDirect(repositoryRoot, "doctor", "--help");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--strict/);
  assert.match(result.stdout, /--adopt <path>/);
  assert.doesNotMatch(result.stdout, /--dry-run/);
});

test("rejects options that do not belong to the selected command", async () => {
  await withTarget(async (target) => {
    const initJson = runCli(target, "init", "--json");
    const doctorDryRun = runCli(target, "doctor", "--dry-run");

    assert.equal(initJson.status, 2);
    assert.match(initJson.stderr, /not valid for init/i);
    assert.equal(doctorDryRun.status, 2);
    assert.match(doctorDryRun.stderr, /not valid for doctor/i);
  });
});

test("reports an existing adapter that was not managed by init", async () => {
  await withTarget(async (target) => {
    await writeFile(path.join(target, "AGENTS.md"), "# Unrelated local instructions\n");
    assert.equal(runCli(target, "init").status, 0);

    const result = runCli(target, "doctor", "--json");
    const report = JSON.parse(result.stdout);

    assert.equal(result.status, 1);
    assert.equal(report.ok, false);
    assert.ok(
      report.findings.some(
        (finding) => finding.code === "unmanaged-file" && finding.path === "AGENTS.md",
      ),
    );
  });
});

test("route emits stable JSON and reason codes", async () => {
  await withTarget(async (target) => {
    const created = runCli(target, "task-create", "--task", "route-json", "--json");
    assert.equal(created.status, 0, created.stderr);
    const result = runCli(
      target,
      "route",
      "--task",
      "route-json",
      "--work",
      "api-auth",
      "--surface",
      "api",
      "--surface",
      "auth",
      "--json",
    );

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual([...report.guides].sort(), ["clean", "performance", "security", "test"]);
    assert.ok(report.reasons.security.includes("WORK_API_AUTH"));
    const repeated = runCli(target, "route", "--task", "route-json", "--work", "api-auth", "--surface", "api", "--surface", "auth", "--json");
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.deepEqual(JSON.parse(repeated.stdout).guides, report.guides);
    assert.deepEqual((await readPersistedRoute(target, repositoryRoot, { taskId: "route-json" })).value.guides, report.guides);
  });
});

test("route human output explains selected guides", async () => {
  await withTarget(async (target) => {
    const created = runCli(target, "task-create", "--task", "route-human", "--json");
    assert.equal(created.status, 0, created.stderr);
    const result = runCli(
      target,
      "route",
      "--task",
      "route-human",
      "--work",
      "complete-website",
      "--surface",
      "ui",
      "--risk",
      "untrusted-input",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Selected:/);
    assert.match(result.stdout, /premium/);
    assert.match(result.stdout, /RISK_UNTRUSTED_INPUT/);
  });
});

test("route rejects invalid signal values and unrelated flags", async () => {
  await withTarget(async (target) => {
    const unknown = runCli(target, "route", "--work", "unknown");
    const dryRun = runCli(target, "route", "--work", "code", "--dry-run");

    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /unknown work type/i);
    assert.equal(dryRun.status, 2);
    assert.match(dryRun.stderr, /not valid for route/i);
  });
});

test("route help exposes only routing options", () => {
  const result = runCliDirect(repositoryRoot, "route", "--help");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--work <type>/);
  assert.match(result.stdout, /--surface <value>/);
  assert.match(result.stdout, /--risk <value>/);
  assert.doesNotMatch(result.stdout, /--adopt <path>/);
});

test("inspect emits structured target health", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    const result = runCli(target, "inspect", "--json");

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.protocol.version, 1);
    assert.equal(report.state.status, "ABSENT");
    assert.ok(Array.isArray(report.findings));
  });
});

test("validate-receipt validates a target-local receipt without executing it", async () => {
  await withTarget(async (target) => {
    const receiptPath = path.join(target, "receipt.json");
    await writeFile(
      receiptPath,
      `${JSON.stringify({
        schemaVersion: 1,
        protocolVersion: 1,
        taskId: "cli-receipt",
        contractFingerprint: "a".repeat(64),
        selectedGuides: ["clean"],
        changedPaths: [],
        checks: [],
        review: { status: "not-run", independent: false },
        limitations: [],
        publication: { committed: false, pushed: false, pullRequest: null, deployed: false },
      })}\n`,
    );

    const result = runCli(target, "validate-receipt", "--file", "receipt.json", "--json");

    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).taskId, "cli-receipt");
  });
});

test("validate-receipt rejects a path outside the target", async () => {
  await withTarget(async (target) => {
    const result = runCli(target, "validate-receipt", "--file", "../receipt.json");

    assert.equal(result.status, 1);
    assert.match(result.stderr, /escapes target|inside target/i);
  });
});

function makeState(overrides = {}) {
  return createWorkState({
    taskId: "cli-state",
    contractFingerprint: contractFingerprint({ objective: "cli state" }),
    repositoryFingerprint: { branch: null, head: null },
    phase: "VERIFYING",
    selectedGuides: ["clean", "test"],
    completedSteps: ["implementation"],
    pendingSteps: ["verification"],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
    ...overrides,
  });
}

test("status reports absent and fresh work state", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    const absent = runCli(target, "status", "--json");
    assert.equal(absent.status, 0, absent.stderr);
    assert.equal(JSON.parse(absent.stdout).status, "ABSENT");

    assert.equal(runCli(target, "task-create", "--task", "cli-state", "--claim", "src").status, 0);
    await withProjectStorage(target, () => writeWorkState(target, makeState(), { taskId: "cli-state" }));
    await writeFile(
      path.join(target, "status-contract.json"),
      `${JSON.stringify({ objective: "cli state" })}\n`,
    );
    const fresh = runCli(target, "status", "--contract-file", "status-contract.json", "--json");
    assert.equal(fresh.status, 0, fresh.stderr);
    const report = JSON.parse(fresh.stdout);
    assert.equal(report.status, "FRESH");
    assert.equal(report.contractComparison, "MATCH");
  });
});

test("status refuses to claim freshness when the current contract is not verified", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    assert.equal(runCli(target, "task-create", "--task", "cli-state", "--claim", "src").status, 0);
    await writeWorkState(target, makeState());
    const result = runCli(target, "status", "--json");
    const report = JSON.parse(result.stdout);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.status, "REVALIDATION_REQUIRED");
    assert.equal(report.contractComparison, "NOT_VERIFIED");
    assert.ok(report.reasons.includes("CONTRACT_NOT_VERIFIED"));
  });
});

test("status reports repository revalidation when checkpoint fingerprint drifts", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    assert.equal(runCli(target, "task-create", "--task", "cli-state", "--claim", "src").status, 0);
    await writeWorkState(target, makeState({ repositoryFingerprint: { branch: "main", head: "old" } }));
    const result = runCli(target, "status", "--json");
    const report = JSON.parse(result.stdout);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.status, "REVALIDATION_REQUIRED");
    assert.ok(report.reasons.includes("REPOSITORY_CHANGED"));
  });
});

test("validate-state validates without mutation and clear-state removes only checkpoint", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    assert.equal(runCli(target, "task-create", "--task", "cli-state", "--claim", "src").status, 0);
    await withProjectStorage(target, () => writeWorkState(target, makeState(), { taskId: "cli-state" }));
    await mkdir(path.join(target, ".mdfiles"), { recursive: true });
    await writeFile(path.join(target, ".mdfiles", "legacy-marker.txt"), "preserve legacy data\n");

    const valid = runCli(target, "validate-state", "--json");
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(valid.stdout).ok, true);

    const cleared = runCli(target, "clear-state", "--json");
    assert.equal(cleared.status, 0, cleared.stderr);
    assert.equal(JSON.parse(cleared.stdout).removed, true);
    await readFile(path.join(target, ".forgeloop", "manifest.json"), "utf8");
    await assert.rejects(() => readFile(path.join(target, ".forgeloop", "work-state.json"), "utf8"));
    assert.equal(
      await readFile(path.join(target, ".mdfiles", "legacy-marker.txt"), "utf8"),
      "preserve legacy data\n",
    );
  });
});

test("validate-state rejects truncated checkpoint data", async () => {
  await withTarget(async (target) => {
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    await writeFile(path.join(target, ".forgeloop", "work-state.json"), "{\"schemaVersion\":");
    const result = runCli(target, "validate-state", "--json");

    assert.equal(result.status, 1);
    assert.match(result.stdout, /parse|invalid|error/i);
  });
});

test("does not relabel an existing installation when init is rerun", async () => {
  await withTarget(async (target) => {
    assert.equal(runCli(target, "init").status, 0);
    const manifestPath = path.join(target, ".forgeloop", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.packageVersion = "0.0.9";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = runCli(target, "init");
    const after = JSON.parse(await readFile(manifestPath, "utf8"));

    assert.equal(result.status, 1);
    assert.match(result.stderr, /already initialized|update/i);
    assert.equal(after.packageVersion, "0.0.9");
  });
});

test("usage-record persists actor telemetry and metrics preserve its provenance", async () => {
  await withTarget(async (target) => {
    const created = runCli(target, "task-create", "--task", "usage-cli", "--claim", "notes.md", "--json");
    assert.equal(created.status, 0, created.stderr);

    const recorded = runCli(
      target,
      "usage-record",
      "--task", "usage-cli",
      "--provider", "openrouter",
      "--model", "example/model",
      "--input-tokens", "10",
      "--output-tokens", "4",
      "--cache-write-tokens", "2",
      "--total-tokens", "16",
      "--source", "ACTOR_REPORTED",
      "--json",
    );
    assert.equal(recorded.status, 0, recorded.stderr);
    const usageResult = JSON.parse(recorded.stdout);
    assert.equal(usageResult.usage.source, "ACTOR_REPORTED");
    assert.equal(usageResult.usage.totalTokens, 16);
    const retainedUsage = await withProjectStorage(target, () => readOperationalText(target, usageResult.path), { readOnly: true });
    assert.equal(retainedUsage.selected, true);
    assert.equal(JSON.parse(retainedUsage.text).usage.totalTokens, 16);

    const metrics = runCli(target, "metrics", "--task", "usage-cli", "--json");
    assert.equal(metrics.status, 0, metrics.stderr);
    assert.equal(JSON.parse(metrics.stdout).usage.source, "ACTOR_REPORTED");

    const efficiency = runCli(target, "efficiency", "--task", "usage-cli", "--json");
    assert.equal(efficiency.status, 0, efficiency.stderr);
    const efficiencyResult = JSON.parse(efficiency.stdout);
    assert.equal(efficiencyResult.comparison.status, "NOT_COMPARABLE");
    assert.equal(efficiencyResult.comparison.tokenOverheadPercent, null);

    const promoted = runCli(target, "usage-record", "--task", "usage-cli", "--source", "HOST_REPORTED", "--json");
    assert.notEqual(promoted.status, 0);
    assert.match(promoted.stderr, /ACTOR_REPORTED/);
  });
});

test("route CLI persists the resolved execution profile and compact reads stay minimal", async () => {
  await withTarget(async (target) => {
    const created = runCli(target, "task-create", "--task", "compact-cli", "--claim", "notes.md", "--json");
    assert.equal(created.status, 0, created.stderr);
    const routed = runCli(target, "route", "--task", "compact-cli", "--work", "documentation", "--json");
    assert.equal(routed.status, 0, routed.stderr);
    assert.equal(JSON.parse(routed.stdout).executionProfile.resolved, "light");

    const shown = runCli(target, "task-show", "--task", "compact-cli", "--compact", "--json");
    assert.equal(shown.status, 0, shown.stderr);
    const shownResult = JSON.parse(shown.stdout);
    assert.equal(shownResult.profile, "light");
    assert.equal(shownResult.taskId, "compact-cli");
    assert.equal(shownResult.errors.length, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(shownResult, "contract"), false);

    const next = runCli(target, "next", "--task", "compact-cli", "--compact", "--json");
    assert.equal(next.status, 0, next.stderr);
    const nextResult = JSON.parse(next.stdout);
    assert.equal(nextResult.taskId, "compact-cli");
    assert.equal(nextResult.profile, "light");
    assert.equal(typeof nextResult.terminal, "boolean");
    assert.ok(Array.isArray(nextResult.errors));
  });
});
