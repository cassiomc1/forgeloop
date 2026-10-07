import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import { recordExecutedFakeCheck } from "./helpers/executed-fake-check.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTempTree } from "./helpers/rm-safe.js";
import { prepareCompletion, recordCheck } from "../src/core/completion-artifacts.js";

import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { advanceWorkState } from "../src/core/phase.js";
import { NEXT_ACTIONS, getNextAction } from "../src/core/next-action.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, readWorkState, writeWorkState } from "../src/core/work-state.js";
import { runPreflight } from "../src/commands/preflight.js";
import { E_INSTALLATION_AUTHORITY_REQUIRED } from "../src/core/verification-capability.js";

const packageRoot = getPackageRoot();

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-stale-receipt-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

async function withTargetAndAuthority(run, { configure = true } = {}) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-stale-receipt-"));
  const authorityRoot = await mkdtemp(path.join(os.tmpdir(), "forgeloop-host-authority-"));
  const authorityFile = path.join(authorityRoot, "authorities.json");
  const previousAuthorityFile = process.env.FORGELOOP_AUTHORITY_FILE;
  if (configure) process.env.FORGELOOP_AUTHORITY_FILE = authorityFile;
  else delete process.env.FORGELOOP_AUTHORITY_FILE;
  try {
    await run(target, authorityFile);
  } finally {
    if (previousAuthorityFile === undefined) delete process.env.FORGELOOP_AUTHORITY_FILE;
    else process.env.FORGELOOP_AUTHORITY_FILE = previousAuthorityFile;
    await removeTempTree(target);
    await removeTempTree(authorityRoot);
  }
}

test("stale receipt recovery: prepare-completion is recoverable and next returns executable recovery", async () => {
  await withTarget(async (target) => {
    const contract = createContract({
      taskId: "task-stale-recovery",
      objective: "Verify stale receipt recovery without manual rm",
      deliverables: ["src/index.js"],
      constraints: [],
      risks: [],
      verification: ["unit-tests"],
      successCriteria: ["unit-tests"],
      stopConditions: [],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await ensureFixtureTask(target, contract.taskId, packageRoot);
    const contractHash = contractFingerprint(contract);
    await writeContract(target, contract, packageRoot, { taskId: contract.taskId });

    const route = evaluateRoute({ workType: "code", surfaces: ["config"], platforms: [] });
    const persistedRoute = await persistRoute(target, route, packageRoot, {
      contractFingerprint: contractHash,
      taskId: contract.taskId,
    });

    const state = createWorkState({
      taskId: contract.taskId,
      contractFingerprint: contractHash,
      routeFingerprint: persistedRoute.fingerprint,
      selectedGuides: persistedRoute.value.guides,
      phase: "ROUTED",
    });
    await writeWorkState(target, state, { packageRoot, taskId: contract.taskId });

    await appendProtocolEvent(target, { taskId: contract.taskId, event: "TASK_RECEIVED" }, packageRoot, { taskId: contract.taskId });
    await appendProtocolEvent(target, { taskId: contract.taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId: contract.taskId });
    await appendProtocolEvent(target, { taskId: contract.taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId: contract.taskId });

    await runPreflight({ target, packageRoot, taskId: contract.taskId });

    await advanceWorkState(target, "PLANNED", { packageRoot, taskId: contract.taskId });
    await advanceWorkState(target, "EXECUTING", { packageRoot, taskId: contract.taskId });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: contract.taskId });

    // Prepare receipt in VERIFYING phase
    const prepared1 = await prepareCompletion({ target, packageRoot, taskId: contract.taskId });
    assert.ok(prepared1.receipt);
    assert.equal(prepared1.receipt.taskId, contract.taskId);

    // Record valid checks for all required evidence
    for (const req of prepared1.requiredEvidence) {
      await recordCheck({
        target,
        packageRoot,
        taskId: contract.taskId,
        id: `check-${req}`,
        kind: "manual-review",
        requirement: req,
        status: "passed",
        evidenceKind: "OBSERVED",
        command: "npm test",
      });
    }

    // Now mutate state (e.g. adding a completed step or updating lastUpdated)
    const currentState = await readWorkState(target, { packageRoot, taskId: contract.taskId });
    const mutatedState = {
      ...currentState,
      completedSteps: [...currentState.completedSteps, "extra-step"],
      lastUpdated: new Date(Date.now() + 1000).toISOString(),
    };
    await writeWorkState(target, mutatedState, { packageRoot, taskId: contract.taskId });

    // next should recommend PREPARE_COMPLETION to refresh the stale receipt
    const nextResult = await getNextAction({ target, packageRoot, taskId: contract.taskId });
    assert.equal(nextResult.nextAction, NEXT_ACTIONS.PREPARE_COMPLETION);

    // prepareCompletion must succeed cleanly on the stale receipt without throwing E_RECEIPT_STATE_MISMATCH
    const refreshed = await prepareCompletion({ target, packageRoot, taskId: contract.taskId });
    assert.ok(refreshed.receipt);
    assert.equal(refreshed.receipt.taskId, contract.taskId);

    // Now next should be able to enter REVIEWING or proceed
    const nextAfterRefresh = await getNextAction({ target, packageRoot, taskId: contract.taskId });
    assert.equal(nextAfterRefresh.nextAction, NEXT_ACTIONS.ENTER_REVIEWING);
  });
});

test("installation authority enforcement: recordCheck, evaluateCompletion, and evaluateAudit reject unauthorized install-capable commands", async () => {
  await withTargetAndAuthority(async (target, authorityFile) => {
    const contract = createContract({
      taskId: "task-auth-enforcement",
      objective: "Verify installation authority enforcement across validators",
      deliverables: ["src/ui.js"],
      constraints: [],
      risks: [],
      verification: ["visual-check"],
      successCriteria: ["visual-check"],
      stopConditions: [],
      unresolvedDecisions: [],
      sourceRefs: [],
    });
    await ensureFixtureTask(target, contract.taskId, packageRoot);
    const contractHash = contractFingerprint(contract);
    await writeContract(target, contract, packageRoot, { taskId: contract.taskId });

    const route = evaluateRoute({ workType: "code", surfaces: ["config"], platforms: [] });
    const persistedRoute = await persistRoute(target, route, packageRoot, {
      contractFingerprint: contractHash,
      taskId: contract.taskId,
    });

    const state = createWorkState({
      taskId: contract.taskId,
      contractFingerprint: contractHash,
      routeFingerprint: persistedRoute.fingerprint,
      selectedGuides: persistedRoute.value.guides,
      phase: "ROUTED",
    });
    await writeWorkState(target, state, { packageRoot, taskId: contract.taskId });

    await appendProtocolEvent(target, { taskId: contract.taskId, event: "TASK_RECEIVED" }, packageRoot, { taskId: contract.taskId });
    await appendProtocolEvent(target, { taskId: contract.taskId, event: "CONTRACT_VALIDATED" }, packageRoot, { taskId: contract.taskId });
    await appendProtocolEvent(target, { taskId: contract.taskId, event: "ROUTE_VALIDATED" }, packageRoot, { taskId: contract.taskId });

    await runPreflight({ target, packageRoot, taskId: contract.taskId });

    await advanceWorkState(target, "PLANNED", { packageRoot, taskId: contract.taskId });
    await advanceWorkState(target, "EXECUTING", { packageRoot, taskId: contract.taskId });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: contract.taskId });

    await prepareCompletion({ target, packageRoot, taskId: contract.taskId });

    // Attempting to record an unauthorized install-capable command must throw E_INSTALLATION_AUTHORITY_REQUIRED
    await assert.rejects(
      async () => {
        await recordExecutedFakeCheck(recordCheck, {
          target,
          packageRoot,
          taskId: contract.taskId,
          id: "modlens-check",
          kind: "command",
          requirement: "visual-check",
          status: "passed",
          evidenceKind: "OBSERVED",
          command: "npx @liustack/modlens --spec=ui.json",
        });
      },
      (error) => error.code === E_INSTALLATION_AUTHORITY_REQUIRED,
    );

    // Self-asserted boolean alone without canonical authority grant must be REJECTED
    await assert.rejects(
      async () => {
        await recordExecutedFakeCheck(recordCheck, {
          target,
          packageRoot,
          taskId: contract.taskId,
          id: "modlens-check-self-assert",
          kind: "command",
          requirement: "visual-check",
          status: "passed",
          evidenceKind: "OBSERVED",
          command: "npx @liustack/modlens --spec=ui.json",
          details: {
            installationAuthorized: true,
          },
        });
      },
      (error) => error.code === E_INSTALLATION_AUTHORITY_REQUIRED,
    );

    // Missing authority reference without a host context must request authority.
    await assert.rejects(
      async () => {
        await recordExecutedFakeCheck(recordCheck, {
          target,
          packageRoot,
          taskId: contract.taskId,
          id: "modlens-check-missing-auth",
          kind: "command",
          requirement: "visual-check",
          status: "passed",
          evidenceKind: "OBSERVED",
          command: "npx @liustack/modlens --spec=ui.json",
          details: {
            installationAuthorityRef: "auth-nonexistent",
          },
        });
      },
      (error) => error.code === E_INSTALLATION_AUTHORITY_REQUIRED,
    );

    // A project-local authority artifact is only an untrusted reference.
    const localAuthDir = path.join(target, ".forgeloop", "authorities");
    await mkdir(localAuthDir, { recursive: true });
    await writeFile(
      path.join(localAuthDir, "auth-local-fake.json"),
      JSON.stringify({
        schemaVersion: 1,
        protocolVersion: 1,
        authorityId: "auth-local-fake",
        taskId: contract.taskId,
        type: "SOFTWARE_INSTALLATION",
        status: "AUTHORIZED",
        scope: { tool: "@liustack/modlens" },
        source: "operator",
      }),
      "utf8",
    );
    await assert.rejects(
      async () => {
        await recordExecutedFakeCheck(recordCheck, {
          target,
          packageRoot,
          taskId: contract.taskId,
          id: "modlens-check-local-fake",
          kind: "command",
          requirement: "visual-check",
          status: "passed",
          evidenceKind: "OBSERVED",
          command: "npx @liustack/modlens --spec=ui.json",
          details: {
            installationAuthorityRef: "auth-local-fake",
          },
        });
      },
      (error) => error.code === "E_AUTHORITY_UNTRUSTED_SOURCE",
    );

    // Configure the host-supplied authority file and create a grant with wrong scope.
    await writeFile(
      authorityFile,
      JSON.stringify({
        schemaVersion: 1,
        protocolVersion: 1,
        authorities: [{
          authorityId: "auth-wrong-scope",
          taskId: contract.taskId,
          type: "SOFTWARE_INSTALLATION",
          status: "AUTHORIZED",
          scope: { tool: "playwright" },
          source: "operator",
        }],
      }),
      "utf8",
    );
    const authorityContext = {
      trustMode: "HOST_ATTESTED",
      trustedAuthorityFile: authorityFile,
    };

    // Attempting to record with wrong tool scope must throw E_AUTHORITY_SCOPE_MISMATCH
    await assert.rejects(
      async () => {
        await recordExecutedFakeCheck(recordCheck, {
          target,
          packageRoot,
          taskId: contract.taskId,
          id: "modlens-check-wrong-scope",
          kind: "command",
          requirement: "visual-check",
          status: "passed",
          evidenceKind: "OBSERVED",
          command: "npx @liustack/modlens --spec=ui.json",
          details: {
          installationAuthorityRef: "auth-wrong-scope",
        },
        authorityContext,
      });
      },
      (error) => error.code === "E_AUTHORITY_SCOPE_MISMATCH",
    );

    // Replace the trusted external source with a valid authority grant.
    await writeFile(
      authorityFile,
      JSON.stringify({
        schemaVersion: 1,
        protocolVersion: 1,
        authorities: [{
          authorityId: "auth-modlens",
          taskId: contract.taskId,
          type: "SOFTWARE_INSTALLATION",
          status: "AUTHORIZED",
          scope: { tool: "@liustack/modlens" },
          source: "operator",
        }],
      }),
      "utf8",
    );

    // If recorded with canonical authority reference, it succeeds
    const authorizedRecord = await recordExecutedFakeCheck(recordCheck, {
      target,
      packageRoot,
      taskId: contract.taskId,
      id: "modlens-check-auth",
      kind: "command",
      requirement: "visual-check",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npx @liustack/modlens --spec=ui.json",
      details: {
        installationAuthorityRef: "auth-modlens",
      },
      authorityContext,
    });
    assert.ok(authorizedRecord.check);
    assert.equal(authorizedRecord.check.status, "passed");

    // Non-installing resolution succeeds without special authorization
    const nonInstallingRecord = await recordExecutedFakeCheck(recordCheck, {
      target,
      packageRoot,
      taskId: contract.taskId,
      id: "modlens-check-no-install",
      kind: "command",
      requirement: "visual-check",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npx --no-install @liustack/modlens --spec=ui.json",
      authorityContext,
    });
    assert.ok(nonInstallingRecord.check);
    assert.equal(nonInstallingRecord.check.status, "passed");
  }, { configure: false });
});
