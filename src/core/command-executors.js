const runDoctor = async (...args) => (await import("../commands/doctor.js")).runDoctor(...args);
const runStatus = async (...args) => (await import("../commands/status.js")).runStatus(...args);
const runValidateState = async (...args) => (await import("../commands/validate-state.js")).runValidateState(...args);
const runClearState = async (...args) => (await import("../commands/clear-state.js")).runClearState(...args);
const runCheckpointRevalidate = async (...args) => (await import("../commands/checkpoint-revalidate.js")).runCheckpointRevalidate(...args);
const inspectTarget = async (...args) => (await import("../commands/inspect.js")).inspectTarget(...args);
const runInit = async (...args) => (await import("../commands/init.js")).runInit(...args);
const runRoute = async (...args) => (await import("../commands/route.js")).runRoute(...args);
const runValidateReceipt = async (...args) => (await import("../commands/validate-receipt.js")).runValidateReceipt(...args);
const runValidateProtocol = async (...args) => (await import("../commands/validate-protocol.js")).runValidateProtocol(...args);
const runUpdate = async (...args) => (await import("../commands/update.js")).runUpdate(...args);
const runActivate = async (...args) => (await import("../commands/activate.js")).runActivate(...args);
const runAdvance = async (...args) => (await import("../commands/advance.js")).runAdvance(...args);
const runPreflight = async (...args) => (await import("../commands/preflight.js")).runPreflight(...args);
const runQualityBaseline = async (...args) => (await import("../commands/quality-baseline.js")).runQualityBaseline(...args);
const runQualityVerify = async (...args) => (await import("../commands/quality-verify.js")).runQualityVerify(...args);
const runQualityStatus = async (...args) => (await import("../commands/quality-status.js")).runQualityStatus(...args);
const runComplete = async (...args) => (await import("../commands/complete.js")).runComplete(...args);
const runAudit = async (...args) => (await import("../commands/audit.js")).runAudit(...args);
const runReport = async (...args) => (await import("../commands/report.js")).runReport(...args);
const runPolicy = async (...args) => (await import("../commands/policy.js")).runPolicy(...args);
const runPolicyDiscover = async (...args) => (await import("../commands/policy-discover.js")).runPolicyDiscover(...args);
const runPolicyStatus = async (...args) => (await import("../commands/policy-status.js")).runPolicyStatus(...args);
const runPolicyDiff = async (...args) => (await import("../commands/policy-diff.js")).runPolicyDiff(...args);
const runRuleVerify = async (...args) => (await import("../commands/rule-verify.js")).runRuleVerify(...args);
const runBaseline = async (...args) => (await import("../commands/baseline.js")).runBaseline(...args);
const runProfileInterview = async (...args) => (await import("../commands/profile-interview.js")).runProfileInterview(...args);
const runBundle = async (...args) => (await import("../commands/bundle.js")).runBundle(...args);
const runPrepareCompletion = async (...args) => (await import("../commands/prepare-completion.js")).runPrepareCompletion(...args);
const runRecordCheck = async (...args) => (await import("../commands/record-check.js")).runRecordCheck(...args);
const runCheck = async (...args) => (await import("../commands/run-check.js")).runCheck(...args);
const runAction = async (...args) => (await import("../commands/run-action.js")).runAction(...args);
const runActionPropose = async (...args) => (await import("../commands/action-propose.js")).runActionPropose(...args);
const runActionRecord = async (...args) => (await import("../commands/action-record.js")).runActionRecord(...args);
const runActionShow = async (...args) => (await import("../commands/action-show.js")).runActionShow(...args);
const runActionAuthorize = async (...args) => (await import("../commands/action-authorize.js")).runActionAuthorize(...args);
const runActionVerify = async (...args) => (await import("../commands/action-verify.js")).runActionVerify(...args);
const runActionReconcile = async (...args) => (await import("../commands/action-reconcile.js")).runActionReconcile(...args);
const runMetrics = async (...args) => (await import("../commands/metrics.js")).runMetrics(...args);
const runUsageRecord = async (...args) => (await import("../commands/usage-record.js")).runUsageRecord(...args);
const runEfficiency = async (...args) => (await import("../commands/efficiency.js")).runEfficiency(...args);
const runEval = async (...args) => (await import("../commands/eval.js")).runEval(...args);
const runApprovalRequest = async (...args) => (await import("../commands/approval-request.js")).runApprovalRequest(...args);
const runApprovalResolve = async (...args) => (await import("../commands/approval-resolve.js")).runApprovalResolve(...args);
const reconcileClosure = async (...args) => (await import("../commands/reconcile-closure.js")).reconcileClosure(...args);
const runRecordTerminalResult = async (...args) => (await import("../commands/record-terminal-result.js")).runRecordTerminalResult(...args);
const runRecordDiagnosis = async (...args) => (await import("../commands/record-diagnosis.js")).runRecordDiagnosis(...args);
const runRecordIntervention = async (...args) => (await import("../commands/record-intervention.js")).runRecordIntervention(...args);
const runRecordHypothesisDisposition = async (...args) => (await import("../commands/record-hypothesis-disposition.js")).runRecordHypothesisDisposition(...args);
const runHistory = async (...args) => (await import("../commands/history.js")).runHistory(...args);
const runTrace = async (...args) => (await import("../commands/trace.js")).runTrace(...args);
const runReflect = async (...args) => (await import("../commands/reflect.js")).runReflect(...args);
const runProgress = async (...args) => (await import("../commands/progress.js")).runProgress(...args);
const runRecordDecisionCriterion = async (...args) => (await import("../commands/record-decision-criterion.js")).runRecordDecisionCriterion(...args);
const runNext = async (...args) => (await import("../commands/next.js")).runNext(...args);
const runContinuity = async (...args) => (await import("../commands/continuity.js")).runContinuity(...args);
const runRecordContinuity = async (...args) => (await import("../commands/record-continuity.js")).runRecordContinuity(...args);
const runReconcileContinuity = async (...args) => (await import("../commands/reconcile-continuity.js")).runReconcileContinuity(...args);
const runClearContinuity = async (...args) => (await import("../commands/clear-continuity.js")).runClearContinuity(...args);
const runTaskCreate = async (...args) => (await import("../commands/task-create.js")).runTaskCreate(...args);
const runDiscover = async (...args) => (await import("../commands/discover.js")).runDiscover(...args);
const runContractCreate = async (...args) => (await import("../commands/contract-create.js")).runContractCreate(...args);
const runContractRevise = async (...args) => (await import("../commands/contract-revise.js")).runContractRevise(...args);
const runGateRecord = async (...args) => (await import("../commands/gate-record.js")).runGateRecord(...args);
const runGateRevalidate = async (...args) => (await import("../commands/gate-revalidate.js")).runGateRevalidate(...args);
const runTaskList = async (...args) => (await import("../commands/task-list.js")).runTaskList(...args);
const runTaskShow = async (...args) => (await import("../commands/task-show.js")).runTaskShow(...args);
const runTaskScope = async (...args) => (await import("../commands/task-scope.js")).runTaskScope(...args);
const runTaskMigrate = async (...args) => (await import("../commands/task-migrate.js")).runTaskMigrate(...args);
const runMigrateProtocol = async (...args) => (await import("../commands/migrate-protocol.js")).runMigrateProtocol(...args);
const runTaskUnlock = async (...args) => (await import("../commands/task-unlock.js")).runTaskUnlock(...args);
const runTaskRecover = async (...args) => (await import("../commands/task-recover.js")).runTaskRecover(...args);
const runTaskAbandon = async (...args) => (await import("../commands/task-abandon.js")).runTaskAbandon(...args);
const runTaskResume = async (...args) => (await import("../commands/task-resume.js")).runTaskResume(...args);
const runTaskRepairLegacyRecovery = async (...args) => (await import("../commands/task-repair-legacy-recovery.js")).runTaskRepairLegacyRecovery(...args);
const runTaskRepairContractBootstrap = async (...args) => (await import("../commands/task-repair-contract-bootstrap.js")).runTaskRepairContractBootstrap(...args);
const runTaskMigrateContractBootstrapRepair = async (...args) => (await import("../commands/task-migrate-contract-bootstrap-repair.js")).runTaskMigrateContractBootstrapRepair(...args);
const runTaskLockStatus = async (...args) => (await import("../commands/task-lock-status.js")).runTaskLockStatus(...args);
const runProtocolInfo = async (...args) => (await import("../commands/protocol-info.js")).runProtocolInfo(...args);
const runDecisionStatus = async (...args) => (await import("../commands/decision-status.js")).runDecisionStatus(...args);
const runDecisionShow = async (...args) => (await import("../commands/decision-show.js")).runDecisionShow(...args);
const runContextPlan = async (...args) => (await import("../commands/context-plan.js")).runContextPlan(...args);
const runModelRoute = async (...args) => (await import("../commands/model-route.js")).runModelRoute(...args);
const runSemanticPlan = async (...args) => (await import("../commands/semantic-plan.js")).runSemanticPlan(...args);
const runTestInventory = async (...args) => (await import("../commands/test-inventory.js")).runTestInventory(...args);
const runTestUtility = async (...args) => (await import("../commands/test-utility.js")).runTestUtility(...args);
const runTestPrunePlan = async (...args) => (await import("../commands/test-prune-plan.js")).runTestPrunePlan(...args);
const runTestPruneProbe = async (...args) => (await import("../commands/test-prune-probe.js")).runTestPruneProbe(...args);
const runWorkspaceBind = async (...args) => (await import("../commands/workspace-bind.js")).runWorkspaceBind(...args);
const runWorkspaceStatus = async (...args) => (await import("../commands/workspace-status.js")).runWorkspaceStatus(...args);
const runHandoffCreate = async (...args) => (await import("../commands/handoff-create.js")).runHandoffCreate(...args);
const runHandoffList = async (...args) => (await import("../commands/handoff-list.js")).runHandoffList(...args);
const runHandoffShow = async (...args) => (await import("../commands/handoff-show.js")).runHandoffShow(...args);
const runHandoffAccept = async (...args) => (await import("../commands/handoff-accept.js")).runHandoffAccept(...args);
const runResponsibilitySet = async (...args) => (await import("../commands/responsibility-set.js")).runResponsibilitySet(...args);
const runResponsibilityStatus = async (...args) => (await import("../commands/responsibility-status.js")).runResponsibilityStatus(...args);
const runVerifyScope = async (...args) => (await import("../commands/verify-scope.js")).runVerifyScope(...args);
const runAttestationCreate = async (...args) => (await import("../commands/attestation-create.js")).runAttestationCreate(...args);
const runAttestationVerify = async (...args) => (await import("../commands/attestation-verify.js")).runAttestationVerify(...args);
const runAttestationStatus = async (...args) => (await import("../commands/attestation-status.js")).runAttestationStatus(...args);
const runAttestationVerifyRange = async (...args) => (await import("../commands/attestation-verify-range.js")).runAttestationVerifyRange(...args);
import { exitCodeForAttestationResult } from "./exit-codes.js";
const runRepositoryIndexRebuild = async (...args) => (await import("../commands/repository-index.js")).runRepositoryIndexRebuild(...args);
const runRepositoryIndexSetup = async (...args) => (await import("../commands/repository-index.js")).runRepositoryIndexSetup(...args);
const runRepositoryIndexStart = async (...args) => (await import("../commands/repository-index.js")).runRepositoryIndexStart(...args);
const runRepositoryIndexStatus = async (...args) => (await import("../commands/repository-index.js")).runRepositoryIndexStatus(...args);
const runRepositoryIndexStop = async (...args) => (await import("../commands/repository-index.js")).runRepositoryIndexStop(...args);
const runSearch = async (...args) => (await import("../commands/repository-index.js")).runSearch(...args);

/**
 * Canonical transport-neutral command executors.
 *
 * Every entry executes exactly one ForgeLoop command and returns a
 * structured `{ result, exitCode }` envelope without any terminal output.
 * Exit codes preserve CLI-equivalent semantics: a non-zero exit code is a
 * deterministic protocol/domain outcome, not an invocation failure.
 *
 * The CLI renders these results; MCP and other integrations consume them
 * directly. No ownership, recovery, or lifecycle logic may live here.
 */
const RAW_COMMAND_EXECUTORS = {
  "storage-restore-resume": async ({ target, packageRoot, options }) => {
    const { runStorageRestoreResume } = await import("../commands/storage-restore-resume.js");
    return { result: await runStorageRestoreResume({ target, packageRoot, operationId: options.operationId, expectedOwnerId: options.expectedOwnerId, writersQuiesced: options.writersQuiesced, replaceActive: options.replaceActive }), exitCode: 0 };
  },
  "storage-restore": async ({ target, packageRoot, options }) => {
    const { runStorageRestore } = await import("../commands/storage-restore.js");
    return { result: await runStorageRestore({ target, packageRoot, source: options.source, writersQuiesced: options.writersQuiesced, replaceActive: options.replaceActive }), exitCode: 0 };
  },
  "storage-migration-status": async ({ target }) => {
    const { runStorageMigrationStatus } = await import("../commands/storage-migration-status.js");
    return { result: await runStorageMigrationStatus({ target }), exitCode: 0 };
  },
  "storage-migration-resume": async ({ target, packageRoot, options }) => {
    const { runStorageMigrationResume } = await import("../commands/storage-migration-resume.js");
    return { result: await runStorageMigrationResume({ target, packageRoot, destination: options.destination, expectedOwnerId: options.expectedOwnerId, writersQuiesced: options.writersQuiesced }), exitCode: 0 };
  },
  "storage-rollback-resume": async ({ target, packageRoot, options }) => {
    const { resumeProjectStorageRollback } = await import("../storage/migration-rollback.js");
    return { result: await resumeProjectStorageRollback(target, { packageRoot, destination: options.destination, legacyRoot: options.legacyRoot, expectedOwnerId: options.expectedOwnerId, writersQuiesced: options.writersQuiesced, nativeWritesExcluded: options.nativeWritesExcluded }), exitCode: 0 };
  },
  "storage-rollback": async ({ target, packageRoot, options }) => {
    const { rollbackProjectStorage } = await import("../storage/migration-rollback.js");
    return { result: await rollbackProjectStorage(target, { packageRoot, destination: options.destination, legacyRoot: options.legacyRoot, writersQuiesced: options.writersQuiesced, nativeWritesExcluded: options.nativeWritesExcluded }), exitCode: 0 };
  },
  "storage-migrate": async ({ target, packageRoot, options }) => {
    const { runStorageMigrate } = await import("../commands/storage-migrate.js");
    return { result: await runStorageMigrate({ target, packageRoot, destination: options.destination, writersQuiesced: options.writersQuiesced }), exitCode: 0 };
  },
  "storage-backup": async ({ target, options }) => {
    const { runStorageBackup } = await import("../commands/storage-backup.js");
    return { result: await runStorageBackup({ target, destination: options.destination, includeAttachments: options.includeAttachments }), exitCode: 0 };
  },
  discover: async ({ target, packageRoot, options }) => ({
    result: await runDiscover({ target, packageRoot, taskId: options.taskId }),
    exitCode: 0,
  }),
  "contract-create": async ({ target, packageRoot, options }) => ({
    result: await runContractCreate({ target, packageRoot, taskId: options.taskId, preset: options.preset, contractFile: options.contractFile }),
    exitCode: 0,
  }),
  "contract-revise": async ({ target, packageRoot, options }) => ({
    result: await runContractRevise({ target, packageRoot, taskId: options.taskId, preset: options.preset, contractFile: options.contractFile }),
    exitCode: 0,
  }),
  "gate-record": async ({ target, packageRoot, options }) => ({
    result: await runGateRecord({ target, packageRoot, taskId: options.taskId, gate: options.gate, status: options.gateStatus, artifacts: options.gateArtifacts, decisions: options.gateDecisions, unknowns: options.gateUnknowns, assumptions: options.gateAssumptions, evidenceFile: options.gateEvidenceFile }),
    exitCode: 0,
  }),
  "gate-revalidate": async ({ target, packageRoot, options }) => ({
    result: await runGateRevalidate({ target, packageRoot, taskId: options.taskId, gate: options.gate, acknowledgeStale: options.acknowledgeStale }),
    exitCode: 0,
  }),
  "protocol-info": async ({ packageVersion }) => ({
    result: await runProtocolInfo({ packageVersion }),
    exitCode: 0,
  }),
  "decision-status": async ({ target, packageRoot, options }) => ({
    result: await runDecisionStatus({ target, packageRoot, health: options.health }),
    exitCode: 0,
  }),
  "decision-show": async ({ target, packageRoot, options }) => ({
    result: await runDecisionShow({ target, packageRoot, taskId: options.taskId, decisionId: options.decisionId }),
    exitCode: 0,
  }),
  "context-plan": async ({ target, packageRoot, options }) => ({
    result: await runContextPlan({ target, packageRoot, taskId: options.taskId, decisionId: options.decisionId, profile: options.profile ?? "balanced" }),
    exitCode: 0,
  }),
  "model-route": async ({ target, packageRoot, options }) => ({
    result: await runModelRoute({
      target, packageRoot, taskId: options.taskId, decisionId: options.decisionId,
      workType: options.workType,
      surfaces: options.surfaces,
      risks: options.risks,
      platforms: options.platforms,
      behaviorChange: options.behaviorChange,
      executableChange: options.executableChange,
      generationRequired: options.generationRequired,
      architectureChange: options.architectureChange,
      ambiguity: options.ambiguity,
    }),
    exitCode: 0,
  }),
  "semantic-plan": async ({ target, packageRoot, options }) => ({
    result: await runSemanticPlan({
      target, packageRoot, taskId: options.taskId, decisionId: options.decisionId,
      kind: options.semanticPlanKind,
      input: options.semanticPlanInput ?? {},
    }),
    exitCode: 0,
  }),
  "test-inventory": async ({ target }) => ({
    result: await runTestInventory({ target }),
    exitCode: 0,
  }),
  "test-utility": async ({ target, packageRoot, options }) => ({
    result: await runTestUtility({ target, packageRoot, taskId: options.taskId }),
    exitCode: 0,
  }),
  "test-prune-plan": async ({ target, packageRoot, options }) => ({
    result: await runTestPrunePlan({ target, packageRoot, taskId: options.taskId }),
    exitCode: 0,
  }),
  "test-prune-probe": async ({ target, packageRoot, options }) => ({
    result: await runTestPruneProbe({ target, packageRoot, taskId: options.taskId, testId: options.testId }),
    exitCode: 0,
  }),
  init: async ({ target, packageRoot, packageVersion, options }) => ({
    result: await runInit({ target, dryRun: options.dryRun, packageRoot, packageVersion, repositoryIndex: true }),
    exitCode: 0,
  }),
  doctor: async ({ target, packageRoot, options }) => {
    const result = await runDoctor({
      target,
      packageRoot,
      adoptPaths: options.adopt,
      strict: options.strict,
      fix: options.fix,
      repositoryIndex: true,
    });
    return { result, exitCode: result.ok ? 0 : 1 };
  },
  route: async ({ target, packageRoot, options }) => ({
    result: await runRoute({
      target,
      packageRoot,
      workType: options.workType,
      surfaces: options.surfaces,
      risks: options.risks,
      platforms: options.platforms,
      behaviorChange: options.behaviorChange,
      executableChange: options.executableChange,
      executionProfile: options.executionProfile,
      taskId: options.taskId,
    }),
    exitCode: 0,
  }),
  activate: async ({ target, packageRoot }) => ({
    result: await runActivate({ target, packageRoot }),
    exitCode: 0,
  }),
  preflight: async ({ target, packageRoot, options }) => {
    const result = await runPreflight({ target, packageRoot, strict: options.strict, taskId: options.taskId });
    return { result, exitCode: result.status === "READY" ? 0 : 1 };
  },
  "quality-baseline": async ({ target, packageRoot, options, runtimeContext }) => {
    const result = await runQualityBaseline({ target, packageRoot, taskId: options.taskId, replace: options.replace, timeoutMs: options.timeoutMs, runtimeContext });
    return { result, exitCode: ["CAPTURED", "EXISTING", "REPLACED", "NOT_REQUESTED"].includes(result.status) ? 0 : 1 };
  },
  "quality-verify": async ({ target, packageRoot, options, authorityContext, runtimeContext }) => {
    const result = await runQualityVerify({ target, packageRoot, taskId: options.taskId, timeoutMs: options.timeoutMs, authorityContext, runtimeContext });
    const status = result.evaluation?.status ?? result.status;
    return { result, exitCode: ["PASS", "NOT_OBSERVED", "CONVERGED", "NOT_REQUESTED"].includes(status) ? 0 : 1 };
  },
  "quality-status": async ({ target, packageRoot, options }) => ({
    result: await runQualityStatus({ target, packageRoot, taskId: options.taskId }),
    exitCode: 0,
  }),
  advance: async ({ target, packageRoot, options, authorityContext, runtimeContext }) => ({
    result: await runAdvance({
      target,
      packageRoot,
      to: options.to,
      persistence: runtimeContext?.forgeloopPersistence ?? null,
      taskId: options.taskId,
      authorityContext,
      runtimeContext,
    }),
    exitCode: 0,
  }),
  next: async ({ target, packageRoot, options, authorityContext, runtimeContext }) => ({
    result: await runNext({ target, packageRoot, taskId: options.taskId, authorityContext, runtimeContext, compact: options.compact, explain: options.explain }),
    exitCode: 0,
  }),
  continuity: async ({ target, packageRoot, options }) => ({
    result: await runContinuity({ target, packageRoot, taskId: options.taskId }),
    exitCode: 0,
  }),
  "record-continuity": async ({ target, packageRoot, options }) => ({
    result: await runRecordContinuity({
      target,
      packageRoot,
      focusId: options.continuityFocusId,
      focusSummary: options.continuityFocusSummary,
      remaining: options.continuityRemaining,
      knownIssues: options.continuityKnownIssues,
      changedAreas: options.continuityChangedAreas,
      inspectFirst: options.continuityInspectFirst,
      resumeNote: options.continuityResumeNote,
      taskId: options.taskId,
    }),
    exitCode: 0,
  }),
  "reconcile-continuity": async ({ target, packageRoot, options }) => ({
    result: await runReconcileContinuity({ target, packageRoot, taskId: options.taskId }),
    exitCode: 0,
  }),
  "clear-continuity": async ({ target, options }) => ({
    result: await runClearContinuity({ target, taskId: options.taskId }),
    exitCode: 0,
  }),
  "prepare-completion": async ({ target, packageRoot, options, authorityContext, runtimeContext }) => ({
    result: await runPrepareCompletion({ target, packageRoot, taskId: options.taskId, authorityContext, runtimeContext }),
    exitCode: 0,
  }),
  "run-check": async ({ target, packageRoot, options, authorityContext, runtimeContext }) => {
    const result = await runCheck({
      target,
      packageRoot,
      id: options.checkId,
      requirement: options.checkRequirement,
      argv: options.commandArgv,
      details: options.checkDetails ?? undefined,
      timeoutMs: options.timeoutMs ?? undefined,
      scopeRef: options.scopeRef ?? undefined,
      taskId: options.taskId,
      authorityContext,
      runtimeContext,
    });
    return { result, exitCode: result.check.status === "passed" ? 0 : 1 };
  },
  "workspace-bind": async ({ target, packageRoot, options }) => ({
    result: await runWorkspaceBind({ target, packageRoot, taskId: options.taskId }),
    exitCode: 0,
  }),
  "workspace-status": async ({ target, packageRoot, options }) => {
    const result = await runWorkspaceStatus({ target, packageRoot, taskId: options.taskId });
    return { result, exitCode: ["UNBOUND", "MATCH"].includes(result.status) ? 0 : 1 };
  },
  "handoff-create": async ({ target, packageRoot, options }) => ({
    result: await runHandoffCreate({
      target,
      packageRoot,
      taskId: options.taskId,
      recipientHint: options.recipientHint,
      handoffNote: options.handoffNote,
    }),
    exitCode: 0,
  }),
  "handoff-list": async ({ target, packageRoot, options }) => ({
    result: await runHandoffList({ target, packageRoot, taskId: options.taskId }),
    exitCode: 0,
  }),
  "handoff-show": async ({ target, packageRoot, options }) => ({
    result: await runHandoffShow({ target, packageRoot, taskId: options.taskId, handoffId: options.handoffId }),
    exitCode: 0,
  }),
  "handoff-accept": async ({ target, packageRoot, options }) => ({
    result: await runHandoffAccept({
      target,
      packageRoot,
      taskId: options.taskId,
      handoffId: options.handoffId,
      consumerId: options.consumerId,
      harness: options.harness,
    }),
    exitCode: 0,
  }),
  "responsibility-set": async ({ target, packageRoot, options }) => ({
    result: await runResponsibilitySet({
      target,
      packageRoot,
      taskId: options.taskId,
      responsibilityLabel: options.responsibilityLabel,
      responsibilityAllowedPaths: options.responsibilityAllowedPaths,
      responsibilityReadOnlyPaths: options.responsibilityReadOnlyPaths,
      responsibilityRequiredChecks: options.responsibilityRequiredChecks,
      responsibilityFreezeContract: options.responsibilityFreezeContract,
      responsibilityFreezeRoute: options.responsibilityFreezeRoute,
      responsibilityFreezeClaims: options.responsibilityFreezeClaims,
    }),
    exitCode: 0,
  }),
  "responsibility-status": async ({ target, packageRoot, options }) => {
    const result = await runResponsibilityStatus({ target, packageRoot, taskId: options.taskId });
    return { result, exitCode: ["NOT_APPLICABLE", "VALID"].includes(result.status) ? 0 : 1 };
  },
  "verify-scope": async ({ target, packageRoot, options }) => ({
    result: await runVerifyScope({ target, packageRoot, taskId: options.taskId, verificationScopeMode: options.verificationScopeMode }),
    exitCode: 0,
  }),
  "attestation-create": async ({ target, packageRoot, options }) => ({
    result: await runAttestationCreate({ target, packageRoot, taskId: options.taskId }),
    exitCode: 0,
  }),
  "attestation-verify": async ({ target, packageRoot, options }) => {
    const result = await runAttestationVerify({ target, packageRoot, taskId: options.taskId, ...options });
    return { result, exitCode: exitCodeForAttestationResult(result) };
  },
  "attestation-status": async ({ target, packageRoot, options }) => {
    const result = await runAttestationStatus({ target, packageRoot, taskId: options.taskId });
    return { result, exitCode: exitCodeForAttestationResult(result) };
  },
  "attestation-verify-range": async ({ target, packageRoot, options }) => {
    const result = await runAttestationVerifyRange({ target, packageRoot, ...options });
    return { result, exitCode: exitCodeForAttestationResult(result) };
  },
  "run-action": async ({ target, packageRoot, options, authorityContext, runtimeContext }) => {
    const result = await runAction({ target, packageRoot, taskId: options.taskId,
      actionId: options.actionId, capability: options.actionCapability,
      effectClass: options.actionEffectClass, actionTarget: options.actionTarget,
      idempotencyKey: options.actionIdempotencyKey, requirement: options.actionRequirement,
      requiredForCompletion: options.actionRequiredForCompletion, argv: options.commandArgv,
      approvalId: options.approvalId, timeoutMs: options.timeoutMs,
      authorityContext, runtimeContext });
    return { result, exitCode: result.action.state === "COMMITTED" ? 0 : 1 };
  },
  "action-propose": async ({ target, packageRoot, options }) => ({ result: await runActionPropose({
    target, packageRoot, taskId: options.taskId, input: { actionId: options.actionId,
      capability: options.actionCapability, effectClass: options.actionEffectClass,
      target: options.actionTarget, operation: options.actionOperation,
      idempotencyKey: options.actionIdempotencyKey, requirement: options.actionRequirement,
      requiredForCompletion: options.actionRequiredForCompletion },
  }), exitCode: 0 }),
  "action-record": async ({ target, packageRoot, options }) => ({ result: await runActionRecord({
    target, packageRoot, taskId: options.taskId, actionId: options.actionId,
    state: options.actionState, provenance: options.actionProvenance,
    evidenceRef: options.actionEvidenceRef,
  }), exitCode: 0 }),
  "action-show": async ({ target, packageRoot, options }) => ({ result: await runActionShow({
    target, packageRoot, taskId: options.taskId, actionId: options.actionId,
  }), exitCode: 0 }),
  "action-authorize": async ({ target, packageRoot, options, authorityContext }) => ({
    result: await runActionAuthorize({
      target,
      packageRoot,
      taskId: options.taskId,
      actionId: options.actionId,
      approvalId: options.approvalId,
      // Trusted authority arrives out-of-band only; never from actor input.
      authorityContext,
    }),
    exitCode: 0,
  }),
  "action-verify": async ({ target, packageRoot, options }) => ({ result: await runActionVerify({
    target, packageRoot, taskId: options.taskId, actionId: options.actionId,
    evidenceRef: options.actionEvidenceRef,
  }), exitCode: 0 }),
  "action-reconcile": async ({ target, packageRoot, options, authorityContext }) => ({ result: await runActionReconcile({
    target, packageRoot, taskId: options.taskId, actionId: options.actionId,
    outcome: options.reconciliationOutcome, evidenceRefs: options.evidenceRefs ?? [],
    observedAt: options.observedAt,
    // Trusted settlement authority travels only through the out-of-band
    // executor parameter; actor input can never supply it.
    authorityContext,
  }), exitCode: 0 }),
  metrics: async ({ target, packageRoot, options, runtimeContext }) => ({ result: await runMetrics({ target, packageRoot, taskId: options.taskId, runtimeContext }), exitCode: 0 }),
  "usage-record": async ({ target, packageRoot, options }) => ({
    result: await runUsageRecord({
      target,
      packageRoot,
      taskId: options.taskId,
      provider: options.usageProvider,
      model: options.usageModel,
      inputTokens: options.usageInputTokens,
      outputTokens: options.usageOutputTokens,
      cacheReadTokens: options.usageCacheReadTokens,
      cacheWriteTokens: options.usageCacheWriteTokens,
      totalTokens: options.usageTotalTokens,
      costUsd: options.usageCostUsd,
      source: options.usageSource ?? "ACTOR_REPORTED",
    }),
    exitCode: 0,
  }),
  efficiency: async ({ target, packageRoot, options, runtimeContext }) => ({
    result: await runEfficiency({ target, packageRoot, taskId: options.taskId, baselinePath: options.baselinePath, runtimeContext }),
    exitCode: 0,
  }),
  eval: async ({ target, packageRoot, options, runtimeContext }) => {
    const result = await runEval({ target, packageRoot, taskId: options.taskId, scenarioPath: options.scenarioPath, runtimeContext });
    return { result, exitCode: result.result === "PASS" ? 0 : 1 };
  },
  "approval-request": async ({ target, packageRoot, options }) => ({ result: await runApprovalRequest({ target, packageRoot, taskId: options.taskId, approvalId: options.approvalId, actionId: options.actionId, reason: options.reason }), exitCode: 0 }),
  "approval-resolve": async ({ target, packageRoot, options, authorityContext }) => ({ result: await runApprovalResolve({ target, packageRoot, taskId: options.taskId, approvalId: options.approvalId, decision: options.approvalDecision, authorityKind: options.approvalAuthorityKind, hostGrantRef: options.hostGrantRef, reason: options.reason, authorityContext }), exitCode: 0 }),
  "record-check": async ({ target, packageRoot, options }) => ({
    result: await runRecordCheck({
      target,
      packageRoot,
      id: options.checkId,
      kind: options.checkKind ?? "command",
      requirement: options.checkRequirement,
      status: options.checkStatus,
      evidenceKind: options.checkEvidenceKind,
      command: options.checkCommand ?? undefined,
      result: options.checkResult ?? undefined,
      ...(options.checkExitCode === null ? {} : { exitCode: options.checkExitCode }),
      details: options.checkDetails ?? undefined,
      executionRef: options.checkExecutionRef ?? undefined,
      provenance: options.checkProvenance ?? undefined,
      taskId: options.taskId,
    }),
    exitCode: 0,
  }),
  "record-terminal-result": async ({ target, packageRoot, options }) => ({
    result: await runRecordTerminalResult({
      target,
      packageRoot,
      requirement: options.checkRequirement,
      type: options.checkType,
      status: options.checkStatus,
      source: options.checkSource ?? options.checkCommand,
      result: options.checkResult,
      details: options.checkDetails ?? undefined,
      taskId: options.taskId,
    }),
    exitCode: 0,
  }),
  "record-diagnosis": async ({ target, packageRoot, options, runtimeContext }) => {
    const persistence = runtimeContext?.forgeloopPersistence ?? null;
    return {
      result: await runRecordDiagnosis({
        target,
        packageRoot,
        file: options.file ?? null,
        hypothesis: options.hypothesis,
        failureClass: options.failureClass,
        evidenceRefs: options.evidenceRefs,
        settledBy: options.settledBy,
        nextSafeAction: options.nextSafeAction,
        taskId: options.taskId,
        persistence,
      }),
      exitCode: 0,
    };
  },
  "record-intervention": async ({ target, packageRoot, options }) => ({
    result: await runRecordIntervention({
      target,
      packageRoot,
      file: options.file ?? null,
      taskId: options.taskId,
    }),
    exitCode: 0,
  }),
  "record-hypothesis-disposition": async ({ target, packageRoot, options }) => ({
    result: await runRecordHypothesisDisposition({
      target,
      packageRoot,
      hypothesis: options.hypothesis,
      status: options.dispositionStatus,
      evidenceRefs: options.evidenceRefs,
      reason: options.reason,
      taskId: options.taskId,
    }),
    exitCode: 0,
  }),
  history: async ({ target, packageRoot, options }) => {
    const result = await runHistory({
      target,
      packageRoot,
      taskId: options.taskId,
      filters: {
        type: options.historyType ?? null,
        phase: options.historyPhase ?? null,
        failures: Boolean(options.historyFailures),
        checks: Boolean(options.historyChecks),
        since: options.historySince ?? null,
        until: options.historyUntil ?? null,
        limit: Number.isInteger(options.historyLimit) ? options.historyLimit : null,
      },
    });
    return { result, exitCode: result.integrity.valid ? 0 : 1 };
  },
  trace: async ({ target, packageRoot, options }) => {
    const result = await runTrace({ target, packageRoot, taskId: options.taskId });
    return { result, exitCode: result.integrity.valid ? 0 : 1 };
  },
  reflect: async ({ target, packageRoot, options }) => {
    const result = await runReflect({ target, packageRoot, taskId: options.taskId });
    return { result, exitCode: result.status === "STALLED" ? 1 : 0 };
  },
  progress: async ({ target, packageRoot, options }) => {
    const result = await runProgress({ target, packageRoot, taskId: options.taskId });
    return { result, exitCode: result.status === "STALLED" ? 1 : 0 };
  },
  "record-decision-criterion": async ({ target, packageRoot, options }) => ({
    result: await runRecordDecisionCriterion({
      target,
      packageRoot,
      decision: options.decision,
      settledBy: options.settledBy,
      taskId: options.taskId,
    }),
    exitCode: 0,
  }),
  complete: async ({ target, packageRoot, options, authorityContext, runtimeContext }) => {
    const result = await runComplete({
      target,
      packageRoot,
      strict: options.strict,
      taskId: options.taskId,
      authorityContext,
      runtimeContext,
    });
    return { result, exitCode: result.status === "VALID" ? 0 : 1 };
  },
  audit: async ({ target, packageRoot, options, authorityContext, runtimeContext }) => {
    const result = await runAudit({
      target,
      packageRoot,
      strict: options.strict,
      taskId: options.taskId,
      authorityContext,
      runtimeContext,
    });
    return { result, exitCode: result.status === "VALID" ? 0 : 1 };
  },
  report: async ({ target, packageRoot, options, authorityContext, runtimeContext }) => {
    const result = await runReport({
      target,
      packageRoot,
      strict: options.strict,
      taskId: options.taskId,
      authorityContext,
      runtimeContext,
    });
    return { result, exitCode: result.verdict === "VALID" ? 0 : 1 };
  },
  policy: async ({ target, packageRoot, options }) => ({
    result: await runPolicy({ target, packageRoot, name: options.policy, taskId: options.taskId }),
    exitCode: 0,
  }),
  "policy-discover": async ({ target, packageRoot, options }) => ({
    result: await runPolicyDiscover({ target, packageRoot, write: options.write }),
    exitCode: 0,
  }),
  "policy-status": async ({ target, packageRoot, options }) => {
    const result = await runPolicyStatus({ target, packageRoot, taskId: options.taskId });
    return { result, exitCode: result.status === "VALID" ? 0 : 1 };
  },
  "policy-diff": async ({ target, packageRoot, options }) => ({
    result: await runPolicyDiff({ target, packageRoot, taskId: options.taskId, before: options.before, after: options.after }),
    exitCode: 0,
  }),
  "rule-verify": async ({ target, packageRoot, options }) => {
    const result = await runRuleVerify({ target, packageRoot, rule: options.rule });
    return { result, exitCode: result.status === "VALID" ? 0 : 1 };
  },
  baseline: async ({ target, packageRoot, options }) => ({
    result: await runBaseline({
      target,
      packageRoot,
      record: options.record,
      update: options.update,
      policyResetAuthorized: options.policyResetAuthorized,
    }),
    exitCode: 0,
  }),
  "profile-interview": async ({ target, packageRoot, options }) => ({
    result: await runProfileInterview({ target, packageRoot, dryRun: options.dryRun }),
    exitCode: 0,
  }),
  bundle: async ({ target, packageRoot, options }) => ({
    result: await runBundle({ target, packageRoot, taskId: options.taskId }),
    exitCode: 0,
  }),
  inspect: async ({ target, packageRoot, options, authorityContext, runtimeContext }) => {
    const result = await inspectTarget({
      target,
      packageRoot,
      contractFile: options.contractFile,
      taskId: options.taskId,
      authorityContext,
      runtimeContext,
    });
    return { result, exitCode: result.ok ? 0 : 1 };
  },
  "validate-receipt": async ({ target, packageRoot, options }) => ({
    result: await runValidateReceipt({ target, packageRoot, file: options.file, taskId: options.taskId }),
    exitCode: 0,
  }),
  "validate-protocol": async ({ target, packageRoot, options }) => {
    const result = await runValidateProtocol({
      target,
      packageRoot,
      stateFile: options.stateFile,
      receiptFile: options.receiptFile,
      routeFile: options.routeFile,
      contractFile: options.contractFile,
      continuityFile: options.continuityFile,
      taskBriefFiles: options.taskBriefFiles,
      delegatedResultFiles: options.delegatedResultFiles,
      taskId: options.taskId,
    });
    return { result, exitCode: result.status === "VALID" ? 0 : 1 };
  },
  status: async ({ target, packageRoot, options }) => ({
    result: await runStatus({ target, packageRoot, contractFile: options.contractFile, taskId: options.taskId }),
    exitCode: 0,
  }),
  "validate-state": async ({ target, packageRoot, options }) => {
    const result = await runValidateState({ target, packageRoot, taskId: options.taskId });
    return { result, exitCode: result.ok ? 0 : 1 };
  },
  "clear-state": async ({ target, options }) => ({
    result: await runClearState({ target, taskId: options.taskId }),
    exitCode: 0,
  }),
  "checkpoint-revalidate": async ({ target, packageRoot, options }) => ({
    result: await runCheckpointRevalidate({ target, packageRoot, taskId: options.taskId }),
    exitCode: 0,
  }),
  "task-create": async ({ target, packageRoot, options }) => ({
    result: await runTaskCreate({
      target,
      packageRoot,
      taskId: options.taskId,
      claims: options.claims,
      contractFile: options.contractFile,
      preset: options.preset,
      preview: options.preview,
    }),
    exitCode: 0,
  }),
  "task-list": async ({ target, packageRoot, options }) => ({
    result: await runTaskList({ target, packageRoot, phase: options.phase, active: options.active, limit: options.limit, offset: options.offset }),
    exitCode: 0,
  }),
  "task-show": async ({ target, packageRoot, options }) => ({
    result: await runTaskShow({ target, packageRoot, taskId: options.taskId, compact: options.compact }),
    exitCode: 0,
  }),
  "task-lock-status": async ({ target, packageRoot, options }) => ({
    result: await runTaskLockStatus({ target, packageRoot, taskId: options.taskId }),
    exitCode: 0,
  }),
  "task-scope": async ({ target, packageRoot, options }) => ({
    result: await runTaskScope({
      target,
      packageRoot,
      taskId: options.taskId,
      claims: options.claims,
    }),
    exitCode: 0,
  }),
  "task-migrate": async ({ target, packageRoot, options }) => ({
    result: await runTaskMigrate({ target, packageRoot, dryRun: options.dryRun, destination: options.destination, writersQuiesced: options.writersQuiesced }),
    exitCode: 0,
  }),
  "migrate-protocol": async ({ target, packageRoot, options }) => ({
    result: await runMigrateProtocol({ target, packageRoot, to: options.to, dryRun: options.dryRun, destination: options.destination, writersQuiesced: options.writersQuiesced }),
    exitCode: 0,
  }),
  "task-unlock": async ({ target, packageRoot, options }) => ({
    result: await runTaskUnlock({ target, packageRoot, taskId: options.taskId, force: options.force, staleOnly: options.staleOnly }),
    exitCode: 0,
  }),
  "task-recover": async ({ target, packageRoot, options }) => ({
    result: await runTaskRecover({
      target,
      packageRoot,
      taskId: options.taskId,
      acknowledgeRecovery: options.acknowledgeRecovery,
      operatorAuthorized: options.operatorAuthorized,
    }),
    exitCode: 0,
  }),
  "task-abandon": async ({ target, packageRoot, options }) => ({
    result: await runTaskAbandon({
      target,
      packageRoot,
      taskId: options.taskId,
      acknowledgeAbandonment: options.acknowledgeAbandonment,
    }),
    exitCode: 0,
  }),
  "task-resume": async ({ target, packageRoot, options }) => ({
    result: await runTaskResume({ target, packageRoot, taskId: options.taskId, claims: options.claims }),
    exitCode: 0,
  }),
  "task-repair-contract-bootstrap": async ({ target, packageRoot, options }) => ({
    result: await runTaskRepairContractBootstrap({ target, packageRoot, taskId: options.taskId, acknowledgeRepair: options.acknowledgeRepair }),
    exitCode: 0,
  }),
  "task-migrate-contract-bootstrap-repair": async ({ target, packageRoot, options }) => ({
    result: await runTaskMigrateContractBootstrapRepair({ target, packageRoot, taskId: options.taskId, acknowledgeMigration: options.acknowledgeMigration }),
    exitCode: 0,
  }),
  "task-repair-legacy-recovery": async ({ target, packageRoot, options }) => ({
    result: await runTaskRepairLegacyRecovery({
      target,
      packageRoot,
      taskId: options.taskId,
      acknowledgeRecovery: options.acknowledgeRecovery,
    }),
    exitCode: 0,
  }),
  "reconcile-closure": async ({ target, packageRoot, options }) => ({
    result: await reconcileClosure({
      target,
      packageRoot,
      taskId: options.taskId,
      checkId: options.checkId,
      checkRequirement: options.checkRequirement,
      checkDetails: options.checkDetails,
      commandArgv: options.commandArgv,
    }),
    exitCode: 0,
  }),
  update: async ({ target, packageRoot, packageVersion, options }) => {
    const result = await runUpdate({ target, dryRun: options.dryRun, packageRoot, packageVersion, repositoryIndex: true });
    return { result, exitCode: result.conflicts.length === 0 ? 0 : 1 };
  },
  "index-setup": async ({ target, packageRoot, options }) => ({
    result: await runRepositoryIndexSetup({ target, packageRoot, options }),
    exitCode: 0,
  }),
  "index-start": async ({ target, packageRoot, options }) => ({
    result: await runRepositoryIndexStart({ target, packageRoot, options }),
    exitCode: 0,
  }),
  "index-stop": async ({ target, packageRoot, options }) => ({
    result: await runRepositoryIndexStop({ target, packageRoot, options }),
    exitCode: 0,
  }),
  "index-status": async ({ target, packageRoot, options }) => ({
    result: await runRepositoryIndexStatus({ target, packageRoot, options }),
    exitCode: 0,
  }),
  "index-rebuild": async ({ target, packageRoot, options }) => ({
    result: await runRepositoryIndexRebuild({ target, packageRoot, options }),
    exitCode: 0,
  }),
  search: async ({ target, packageRoot, options, transport = "integration" }) => ({
    result: await runSearch({ target, packageRoot, options, transport }),
    exitCode: 0,
  }),
};

export const EXECUTOR_EXCEPTIONS = Object.freeze([
  // Bootstrap/presentation-only behaviors intentionally without executors:
  // none currently. Every canonical command definition must have an executor.
]);

export const COMMAND_EXECUTORS = Object.fromEntries(Object.entries(RAW_COMMAND_EXECUTORS).map(([name, executor]) => [name, async context => {
  // Reject unsupported migration targets before fresh-project storage admission
  // can allocate a database or obscure the protocol error with a storage error.
  if (name === "migrate-protocol") {
    const { assertSupportedProtocolMigrationTarget } = await import("./protocol-migration.js");
    assertSupportedProtocolMigrationTarget(context.options?.to);
  }
  if (name === "advance" || name === "record-diagnosis") {
    const { assertCanonicalPersistence } = await import("../storage/operational-context.js");
    assertCanonicalPersistence(context.runtimeContext?.forgeloopPersistence);
  }
  if (!context.target || name === "task-migrate" || name === "migrate-protocol" || name === "storage-migration-status" || name === "storage-rollback-resume" || name === "storage-rollback" || name === "storage-migrate" || name === "storage-migration-resume" || name === "storage-restore" || name === "storage-restore-resume") return executor(context);
  const { withProjectStorage } = await import("../storage/project-boundary.js");
  const { CLI_COMMAND_DEFINITIONS } = await import("./cli-command-definitions.js");
  // Backup writes its destination, not the source store. Doctor repairs only
  // when explicitly requested; inspecting either must not migrate the source.
  const readOnly = CLI_COMMAND_DEFINITIONS[name]?.mutation === "READ_ONLY"
    || context.options?.dryRun === true || name === "storage-backup" || (name === "doctor" && context.options?.fix !== true);
  return withProjectStorage(context.target, () => executor(context), { readOnly, runtimeContext: context.runtimeContext });
}]));
