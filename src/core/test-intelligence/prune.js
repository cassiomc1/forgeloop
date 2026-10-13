import { readTestUtility } from "./service.js";
import { assertSafePath } from "../filesystem.js";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROTECTED_CLASSES = new Set([
  "KEEP_REQUIRED", "KEEP_RISK_GUARD", "KEEP_UNIQUE", "KEEP_AUTHORITY_BOUNDARY",
  "KEEP_RECOVERY_INVARIANT", "KEEP_RELEASE_SMOKE", "KEEP_MIGRATION_COMPATIBILITY",
  "KEEP_PLATFORM_BEHAVIOR",
]);

function planFor(test) {
  if (test.protected || PROTECTED_CLASSES.has(test.classification)) return { action: "KEEP", reason: "PROTECTED_TEST" };
  if (test.classification === "REDUNDANT_CANDIDATE" && test.recommendation === "PROBE_REMOVAL") return { action: "PROBE_REMOVAL", reason: "SEMANTIC_AND_DETERMINISTIC_EVIDENCE_REQUIRED" };
  if (test.classification === "KEEP_DOCUMENTATION_VALUE") return { action: "KEEP", reason: "DOCUMENTATION_VALUE" };
  return { action: "BLOCKED", reason: "INSUFFICIENT_PROVENANCE" };
}

export async function buildPrunePlan({ target, packageRoot, taskId } = {}) {
  const utility = await readTestUtility({ target, packageRoot, taskId });
  const items = utility.value.tests.map((test) => ({ testId: test.testId, file: test.file, name: test.name, ...planFor(test) }));
  return { schemaVersion: 1, taskId, semanticStatus: utility.value.semanticStatus, items, deletionAuthority: false };
}

export async function runPruneProbe({ target, packageRoot, taskId, testId } = {}) {
  const plan = await buildPrunePlan({ target, packageRoot, taskId });
  const item = plan.items.find((candidate) => candidate.testId === testId);
  if (!item) {
    const error = new Error(`Unknown test ID: ${testId}`); error.code = "E_TEST_ID_UNKNOWN"; throw error;
  }
  if (item.action !== "PROBE_REMOVAL") {
    const error = new Error(`Test prune probe blocked for ${testId}: ${item.reason}`);
    error.code = "E_TEST_PRUNE_BLOCKED";
    throw error;
  }
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "forgeloop-prune-probe-"));
  try {
    // Persisted utility records do not grant access outside the project or
    // through symlinks copied into the disposable workspace.
    await assertSafePath(target, item.file);
    await cp(target, temporaryRoot, {
      recursive: true,
      dereference: false,
      filter(source) {
        const relative = path.relative(target, source);
        return relative !== ".forgeloop" && relative !== ".git" && !relative.startsWith(`${path.sep}.forgeloop${path.sep}`) && !relative.startsWith(`${path.sep}.git${path.sep}`) && relative !== "node_modules";
      },
    });
    const dependencies = path.join(target, "node_modules");
    try { await symlink(dependencies, path.join(temporaryRoot, "node_modules"), "junction"); } catch { /* dependencies are optional for static probes */ }
    if (item.file.endsWith(".mjs") || item.file.endsWith(".js")) {
      const candidatePath = await assertSafePath(temporaryRoot, item.file);
      const source = await readFile(candidatePath, "utf8");
      const escapedName = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`\\b(test|it)\\s*\\(\\s*([\\"'])${escapedName}\\2`);
      if (!pattern.test(source)) {
        return { status: "INCONCLUSIVE", reason: "TEST_UNIT_NOT_LOCATED", testId, liveWorktreeModified: false, temporaryWorkspaceCleaned: true };
      }
      const disabled = source.replace(pattern, (_, keyword, quote) => `${keyword}.skip(${quote}${item.name}${quote}`);
      await writeFile(candidatePath, disabled, "utf8");
      const result = await execFileAsync(process.execPath, ["--test", item.file], {
        cwd: temporaryRoot,
        timeout: 120_000,
        maxBuffer: 2_000_000,
        windowsHide: true,
      });
      return {
        status: "INCONCLUSIVE",
        reason: "COVERAGE_OR_MUTATION_EVIDENCE_UNAVAILABLE",
        testId,
        affectedTestExitCode: 0,
        affectedTestOutput: `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-8_000),
        liveWorktreeModified: false,
        temporaryWorkspaceCleaned: true,
      };
    }
    return { status: "INCONCLUSIVE", reason: "FRAMEWORK_PROBE_UNSUPPORTED", testId, liveWorktreeModified: false, temporaryWorkspaceCleaned: true };
  } catch (error) {
    return {
      status: "BLOCKED",
      reason: error.code === "ETIMEDOUT" ? "AFFECTED_TEST_TIMEOUT" : "AFFECTED_TEST_FAILED",
      testId,
      error: error.message,
      liveWorktreeModified: false,
      temporaryWorkspaceCleaned: true,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
