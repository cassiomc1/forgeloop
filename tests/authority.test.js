import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import { recordExecutedFakeCheck } from "./helpers/executed-fake-check.js";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  getInstallationAuthorityRef,
  validateAuthorityGrant,
  E_AUTHORITY_INVALID,
  E_AUTHORITY_UNTRUSTED_SOURCE,
  E_AUTHORITY_SCOPE_MISMATCH,
} from "../src/core/verification-capability.js";
import { evaluateCompletion } from "../src/core/completion.js";
import { evaluateAudit } from "../src/core/audit.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { appendProtocolEvent } from "../src/core/events.js";
import { runPreflight } from "../src/commands/preflight.js";
import { advanceWorkState } from "../src/core/phase.js";
import { prepareCompletion, recordCheck } from "../src/core/completion-artifacts.js";
import { removeTempTree } from "./helpers/rm-safe.js";


const packageRoot = getPackageRoot();

async function withTargetAndAuthority(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-auth-"));
  const authorityRoot = await mkdtemp(path.join(os.tmpdir(), "forgeloop-host-authority-"));
  const authorityFile = path.join(authorityRoot, "authorities.json");
  const previousAuthorityFile = process.env.FORGELOOP_AUTHORITY_FILE;
  process.env.FORGELOOP_AUTHORITY_FILE = authorityFile;
  try {
    await run(target, authorityFile);
  } finally {
    if (previousAuthorityFile === undefined) delete process.env.FORGELOOP_AUTHORITY_FILE;
    else process.env.FORGELOOP_AUTHORITY_FILE = previousAuthorityFile;
    await removeTempTree(target);
    await removeTempTree(authorityRoot);
  }
}

test("authority grant schema and validation rules", () => {
  // Missing authority
  assert.equal(validateAuthorityGrant({ authority: null }).valid, false);
  assert.equal(validateAuthorityGrant({ authority: null }).error.code, E_AUTHORITY_INVALID);

  // Invalid schema version
  const badVersion = {
    schemaVersion: 2,
    protocolVersion: 1,
    authorityId: "auth-1",
    taskId: "task-1",
    type: "SOFTWARE_INSTALLATION",
    status: "AUTHORIZED",
    scope: { tool: "jest" },
    source: "operator",
  };
  assert.equal(validateAuthorityGrant({ authority: badVersion }).valid, false);
  assert.equal(validateAuthorityGrant({ authority: badVersion }).error.code, E_AUTHORITY_INVALID);

  // Type mismatch
  const badType = {
    ...badVersion,
    schemaVersion: 1,
    type: "OTHER_TYPE",
  };
  assert.equal(validateAuthorityGrant({ authority: badType }).valid, false);
  assert.equal(validateAuthorityGrant({ authority: badType }).error.code, E_AUTHORITY_INVALID);

  // Status not AUTHORIZED (e.g. REVOKED or EXPIRED)
  const revoked = {
    ...badVersion,
    schemaVersion: 1,
    status: "REVOKED",
  };
  assert.equal(validateAuthorityGrant({ authority: revoked }).valid, false);
  assert.equal(validateAuthorityGrant({ authority: revoked }).error.code, E_AUTHORITY_INVALID);

  const expired = {
    ...badVersion,
    schemaVersion: 1,
    status: "EXPIRED",
  };
  assert.equal(validateAuthorityGrant({ authority: expired }).valid, false);
  assert.equal(validateAuthorityGrant({ authority: expired }).error.code, E_AUTHORITY_INVALID);

  // Source agent-self is prohibited
  const agentSelf = {
    ...badVersion,
    schemaVersion: 1,
    source: "agent-self",
  };
  assert.equal(validateAuthorityGrant({ authority: agentSelf }).valid, false);
  assert.equal(validateAuthorityGrant({ authority: agentSelf }).error.code, E_AUTHORITY_INVALID);

  // Unknown source
  const unknownSource = {
    ...badVersion,
    schemaVersion: 1,
    source: "unknown-source",
  };
  assert.equal(validateAuthorityGrant({ authority: unknownSource }).valid, false);
  assert.equal(validateAuthorityGrant({ authority: unknownSource }).error.code, E_AUTHORITY_INVALID);

  // Task mismatch
  const validGrant = {
    schemaVersion: 1,
    protocolVersion: 1,
    authorityId: "auth-jest",
    taskId: "task-A",
    type: "SOFTWARE_INSTALLATION",
    status: "AUTHORIZED",
    scope: { tool: "jest" },
    source: "operator",
  };
  assert.equal(validateAuthorityGrant({ authority: validGrant, taskId: "task-B" }).valid, false);
  assert.equal(validateAuthorityGrant({ authority: validGrant, taskId: "task-B" }).error.code, E_AUTHORITY_INVALID);

  // Scope tool mismatch
  assert.equal(validateAuthorityGrant({ authority: validGrant, taskId: "task-A", tool: "vitest" }).valid, false);
  assert.equal(validateAuthorityGrant({ authority: validGrant, taskId: "task-A", tool: "vitest" }).error.code, E_AUTHORITY_SCOPE_MISMATCH);

  // Valid grant with exact match
  assert.equal(validateAuthorityGrant({ authority: validGrant, taskId: "task-A", tool: "jest" }).valid, true);

  // Valid grant with wildcard tool
  const wildcardGrant = { ...validGrant, scope: { tool: "*" } };
  assert.equal(validateAuthorityGrant({ authority: wildcardGrant, taskId: "task-A", tool: "anything" }).valid, true);
});

test("authority extraction helper getInstallationAuthorityRef", () => {
  assert.equal(getInstallationAuthorityRef({ details: { installationAuthorityRef: "auth-1" } }), "auth-1");
  assert.equal(getInstallationAuthorityRef({ details: { authorityRef: "auth-2" } }), "auth-2");
  assert.equal(getInstallationAuthorityRef({ installationAuthorityRef: "auth-3" }), "auth-3");
  assert.equal(getInstallationAuthorityRef({ authorityRef: "auth-4" }), "auth-4");
  assert.equal(getInstallationAuthorityRef({ details: { installationAuthorized: true } }), null);
  assert.equal(getInstallationAuthorityRef(null), null);
});

test("audit and complete revalidate installation authority from the external host source", async () => {
  await withTargetAndAuthority(async (target, authFile) => {
    const contract = createContract({
      taskId: "task-audit-authority",
      objective: "Verify audit and complete enforce authority from target artifacts",
      deliverables: ["src/app.js"],
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

    // Write valid authority grant
    await writeFile(
      authFile,
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

    const authorityContext = {
      trustMode: "HOST_ATTESTED",
      trustedAuthorityFile: authFile,
    };
    delete process.env.FORGELOOP_AUTHORITY_FILE;

    const prepared = await prepareCompletion({ target, packageRoot, taskId: contract.taskId, authorityContext });

    // Record check for visual-check with authorityRef
    await recordExecutedFakeCheck(recordCheck, {
      target,
      packageRoot,
      taskId: contract.taskId,
      id: "check-visual",
      kind: "command",
      requirement: "visual-check",
      status: "passed",
      evidenceKind: "OBSERVED",
      command: "npx @liustack/modlens --spec=app.json",
      details: {
        installationAuthorityRef: "auth-modlens",
      },
      authorityContext,
    });

    // Record checks for remaining guide requirements
    for (const req of prepared.requiredEvidence.filter((r) => r !== "visual-check")) {
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
        authorityContext,
      });
    }

    await advanceWorkState(target, "REVIEWING", { packageRoot, taskId: contract.taskId, authorityContext });

    // Audit and complete should be VALID
    const auditBefore = await evaluateAudit({ target, packageRoot, taskId: contract.taskId, authorityContext });
    assert.equal(auditBefore.status, "VALID", JSON.stringify(auditBefore.errors));

    const completeBefore = await evaluateCompletion({ target, packageRoot, taskId: contract.taskId, authorityContext });
    assert.equal(completeBefore.status, "VALID", JSON.stringify(completeBefore.errors));

    const actorFakeFile = path.join(path.dirname(authFile), "actor-fake.json");
    await writeFile(actorFakeFile, JSON.stringify({
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
    }), "utf8");
    process.env.FORGELOOP_AUTHORITY_FILE = actorFakeFile;
    const standaloneAudit = await evaluateAudit({ target, packageRoot, taskId: contract.taskId });
    assert.equal(standaloneAudit.status, "INVALID");
    assert.ok(standaloneAudit.errors.some((e) => e.code === E_AUTHORITY_UNTRUSTED_SOURCE));
    const standaloneComplete = await evaluateCompletion({ target, packageRoot, taskId: contract.taskId });
    assert.equal(standaloneComplete.status, "REJECTED");
    assert.ok(standaloneComplete.errors.some((e) => e.code === E_AUTHORITY_UNTRUSTED_SOURCE));
    delete process.env.FORGELOOP_AUTHORITY_FILE;

    // Removing the trusted source after recording invalidates both validators.
    await rm(authFile, { force: true });
    const auditAfterRemoval = await evaluateAudit({ target, packageRoot, taskId: contract.taskId, authorityContext });
    assert.equal(auditAfterRemoval.status, "INVALID");
    assert.ok(auditAfterRemoval.errors.some((e) => e.code === E_AUTHORITY_INVALID));
    const completeAfterRemoval = await evaluateCompletion({ target, packageRoot, taskId: contract.taskId, authorityContext });
    assert.equal(completeAfterRemoval.status, "REJECTED");
    assert.ok(completeAfterRemoval.errors.some((e) => e.code === E_AUTHORITY_INVALID));

    // Now tamper with authority artifact: revoke it
    await writeFile(
      authFile,
      JSON.stringify({
        schemaVersion: 1,
        protocolVersion: 1,
        authorities: [{
          authorityId: "auth-modlens",
          taskId: contract.taskId,
          type: "SOFTWARE_INSTALLATION",
          status: "REVOKED",
          scope: { tool: "@liustack/modlens" },
          source: "operator",
        }],
      }),
      "utf8",
    );

    // Audit and complete MUST REJECT due to revoked authority
    const auditAfterRevoke = await evaluateAudit({ target, packageRoot, taskId: contract.taskId, authorityContext });
    assert.equal(auditAfterRevoke.status, "INVALID");
    assert.ok(auditAfterRevoke.errors.some((e) => e.code === E_AUTHORITY_INVALID));

    const completeAfterRevoke = await evaluateCompletion({ target, packageRoot, taskId: contract.taskId, authorityContext });
    assert.equal(completeAfterRevoke.status, "REJECTED");
    assert.ok(completeAfterRevoke.errors.some((e) => e.code === E_AUTHORITY_INVALID));
  });
});
