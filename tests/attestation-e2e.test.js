import { withTaskTransaction } from "../src/core/transaction.js";
import { withSigningBundleFile } from "../src/core/signing/bundle-file.js";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { runAdvance } from "../src/commands/advance.js";
import { runAttestationCreate } from "../src/commands/attestation-create.js";
import { runAttestationVerify } from "../src/commands/attestation-verify.js";
import { runAttestationVerifyRange } from "../src/commands/attestation-verify-range.js";
import { runCheck } from "../src/commands/run-check.js";
import { runPrepareCompletion } from "../src/commands/prepare-completion.js";
import { createConfig, writeConfig } from "../src/core/config.js";
import { currentRepositoryFingerprint } from "../src/core/repository.js";
import { taskAttestationBundlePath, taskAttestationStatementPath } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";
import { runComplete } from "../src/commands/complete.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { createGitRepository } from "./helpers/git-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";

const packageRoot = getPackageRoot();

test("completion, statement creation, content verification, and range coverage form one end-to-end chain", async () => {
  const target = await createGitRepository("forgeloop-attestation-e2e-");
  const taskId = "attestation-e2e-001";
  const baseRevision = (await currentRepositoryFingerprint(target)).head;
  const sourcePath = path.join(target, "src", "index.js");
  const originalSource = await readFile(sourcePath, "utf8");
  try {
    await setupVerifyingTask(target, packageRoot, { taskId, requirement: "tests" });
    await writeConfig(target, createConfig({
      attestation: {
        mode: "required",
        revisionProvider: "git",
        requireCompleteCoverage: true,
        signing: { provider: "none", required: false, policy: {} },
      },
    }), packageRoot);
    await writeFile(sourcePath, `${originalSource}export const attested = true;\n`, "utf8");
    await runPrepareCompletion({ target, packageRoot, taskId });

    const check = await runCheck({
      target,
      packageRoot,
      taskId,
      id: "attestation-e2e-check",
      requirement: "tests",
      argv: [process.execPath, "-e", "process.exit(0)"],
    });
    assert.equal(check.execution.status, "passed");
    const completionCheck = await runCheck({
      target,
      packageRoot,
      taskId,
      id: "attestation-e2e-completion-check",
      requirement: "required action satisfies tests",
      argv: [process.execPath, "-e", "process.exit(0)"],
    });
    assert.equal(completionCheck.execution.status, "passed");
    await runAdvance({ target, packageRoot, taskId, to: "REVIEWING" });

    const completed = await runComplete({ target, packageRoot, taskId });
    assert.equal(completed.status, "VALID");
    assert.equal(completed.attestation.status, "CAPTURED");

    const created = await runAttestationCreate({ target, packageRoot, taskId });
    assert.equal(created.statement.predicate.task.taskId, taskId);

    const verified = await runAttestationVerify({
      target,
      packageRoot,
      taskId,
      attestationRef: "WORKTREE",
    });
    assert.equal(verified.status, "VALID");
    assert.equal(verified.level, "VERIFIED");

    const covered = await runAttestationVerifyRange({
      target,
      packageRoot,
      revisionProvider: "git",
      baseRevision,
      headRevision: "WORKTREE",
      requireCompleteCoverage: true,
    });
    assert.equal(covered.status, "VALID");
    assert.deepEqual(covered.uncoveredPaths, []);

    await writeFile(sourcePath, `${originalSource}export const attested = false;\n`, "utf8");
    const mutated = await runAttestationVerify({
      target,
      packageRoot,
      taskId,
      attestationRef: "WORKTREE",
    });
    assert.equal(mutated.status, "INVALID");
    assert.equal(mutated.errors[0].code, "E_ATTESTATION_CONTENT_MISMATCH");

    await writeFile(sourcePath, `${originalSource}export const attested = true;\n`, "utf8");
    await writeFile(path.join(target, "src", "uncovered.js"), "export const uncovered = true;\n", "utf8");
    const gap = await runAttestationVerifyRange({
      target,
      packageRoot,
      revisionProvider: "git",
      baseRevision,
      headRevision: "WORKTREE",
      requireCompleteCoverage: true,
    });
    assert.equal(gap.status, "INVALID");
    assert.deepEqual(gap.uncoveredPaths, ["src/uncovered.js"]);
    assert.ok(gap.errors.some((error) => error.code === "E_ATTESTATION_COVERAGE_GAP"));

    await withTaskTransaction({ target, taskId, packageRoot, operation: "fixture-signature" }, () =>
      withSigningBundleFile(target, taskAttestationBundlePath(taskId), taskAttestationStatementPath(taskId), filename => writeFile(filename, "{}\n", "utf8")));
    const signed = await runAttestationVerify({
      target,
      packageRoot,
      taskId,
      attestationRef: "WORKTREE",
      requireSignature: true,
      signingProvider: {
        name: "fixture-signer",
        async detect() { return true; },
        async sign() { return { status: "VALID" }; },
        async verify() { return { status: "VALID", signer: "fixture" }; },
      },
    });
    assert.equal(signed.status, "VALID");
    assert.equal(signed.level, "ATTESTED");
  } finally {
    await removeTempTree(target);
  }
});
