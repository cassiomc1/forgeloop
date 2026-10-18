import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createForgeLoopIntegration, FORGELOOP_PACKAGE_VERSION, FORGELOOP_UPSTREAM_COMMIT, hasRequiredResources } from '@main/core/integration/forgeloop-integration';
import { ForgeLoopAuditError } from '@shared/errors';

describe('core/integration/forgeloop-integration', () => {
  let adapter: Awaited<ReturnType<typeof createForgeLoopIntegration>>;
  let scratchDir: string;

  beforeEach(async () => {
    adapter = await createForgeLoopIntegration();
    scratchDir = mkdtempSync(join(tmpdir(), 'forgeloop-integration-test-'));
  });

  afterEach(() => {
    rmSync(scratchDir, { recursive: true, force: true });
  });

  describe('package identity', () => {
    it('exposes the bundled ForgeLoop package version', () => {
      expect(adapter.getPackageVersion()).toBe('2.0.0');
    });

    it('keeps the version constant synchronized with the installed dependency pin', () => {
      const installed = JSON.parse(
        readFileSync(join(process.cwd(), 'node_modules', '@cassiomc1', 'forgeloop', 'package.json'), 'utf8'),
      ) as { version: string };
      expect(installed.version).toBe(FORGELOOP_PACKAGE_VERSION);
      expect(FORGELOOP_UPSTREAM_COMMIT).toBe('4ff11bb4bc4be39b095a151a323f1388dad0d819');
      const dependencySpec = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).dependencies as Record<string, string>;
      expect(dependencySpec).toHaveProperty('@cassiomc1/forgeloop');
    });

    it('rejects an unresolved project root before touching the Integration API', async () => {
      await expect(adapter.readProtocolInfo('')).rejects.toMatchObject({ code: 'PATH_BOUNDARY_VIOLATION' });
    });
  });

  describe('capabilities', () => {
    it('reports Integration API v1 with protocol v1', () => {
      const capabilities = adapter.getCapabilities();
      expect(capabilities.integrationApiVersion).toBe(1);
      expect(capabilities.protocolVersion).toBe(1);
      expect(capabilities.executorParity).toBe(true);
    });

    it('declares durable recovery features required by the ForgeLoopAudit', () => {
      const recovery = adapter.getCapabilities().features.taskClaimRecovery;
      expect(recovery.version).toBe(1);
      expect(recovery.durableRecoveryState).toBe(true);
      expect(recovery.explicitResume).toBe(true);
      expect(recovery.validatedClaimProjection).toBe(true);
    });

    it('exposes every canonical resource the ForgeLoopAudit consumes', () => {
      const resources = adapter.getCapabilities().resources;
      for (const required of [
        'protocol/info',
        'project/tasks',
        'task/status',
        'task/ownership',
        'task/contract',
        'task/continuity',
        'task/context',
      ]) {
        expect(resources).toContain(required);
      }
      expect(resources).toEqual(expect.arrayContaining([
        'task/actions',
        'task/action',
        'task/approvals',
        'task/metrics',
        'task/evaluations',
        'project/capability-policy',
        'task/workspace-binding',
        'task/handoffs',
        'task/responsibility',
        'task/verification-scope',
        'task/attestation',
        'task/structural-quality',
      ]));
    });

    it('checks the core resource contract without treating optional resources as required', () => {
      const capabilities = adapter.getCapabilities();
      expect(hasRequiredResources(capabilities)).toBe(true);
      expect(hasRequiredResources({ ...capabilities, resources: ['protocol/info'] })).toBe(false);
    });

    it('advertises additive observability, durable-action and trajectory capabilities', () => {
      const capabilities = adapter.getCapabilities();
      expect(capabilities.features.durableActions).toMatchObject({
        version: 1,
        readOnlyResources: true,
        externalExecutionOverMcp: false,
      });
      expect(capabilities.features.trajectoryEvaluation).toMatchObject({
        version: 1,
        readOnlyMetrics: true,
        projectLocalReference: true,
      });
      expect(capabilities.features.verificationExecutionIsolation).toMatchObject({
        version: 1,
        supported: true,
        adapter: true,
        modes: ['NATIVE_PROJECT', 'PROJECT_ISOLATED', 'SYSTEM_ISOLATED'],
        protocolProjectRootSeparateFromExecutionCwd: true,
      });
      expect(capabilities.features.workspaceBinding).toMatchObject({ version: 1, supported: true, optional: true, explicitRebinding: false });
      expect(capabilities.features.canonicalHandoffs).toMatchObject({
        version: 2,
        supported: true,
        immutable: true,
        lifecycleAuthority: false,
        evidenceAuthority: false,
        exactlyOnceAcceptance: true,
        acceptanceLedgerBacked: true,
        acceptanceCommand: 'handoff-accept',
        acceptanceStatuses: ['OPEN', 'ACCEPTED', 'UNBOUND', 'INCONSISTENT'],
      });
      expect(capabilities.features.advisoryContextProviders).toEqual({
        version: 1,
        supported: true,
        providerNeutral: true,
        integrationApiOnly: true,
        lazy: true,
        optIn: true,
        persistedByForgeLoop: false,
        lifecycleAuthority: false,
        evidenceAuthority: false,
        executable: false,
      });
      expect(capabilities.features.responsibilityConstraints).toMatchObject({ version: 1, supported: true, immutableDuringPass: true, completionEnforced: true });
      expect(capabilities.features.differentialVerificationScope).toMatchObject({ version: 1, supported: true, modes: ['AUTO', 'CHANGED', 'CLAIMED', 'FULL'], impactedMode: false });
      expect(capabilities.features.codeAttestation).toMatchObject({ version: 1, supported: true, completionLedgerBound: true });
      expect(capabilities.features.structuralQuality).toMatchObject({
        version: 1,
        supported: true,
        schemaVersion: 1,
        providerNeutral: true,
        modes: ['off', 'observe', 'gate'],
        builtInProviders: ['sentrux'],
        commands: ['quality-baseline', 'quality-verify', 'quality-status'],
        baselineImmutableAfterExecution: true,
      });
      expect(capabilities.features.adaptiveExecutionProfiles).toMatchObject({
        version: 1,
        supported: true,
        deterministic: true,
        lifecycleFastPath: false,
      });
      expect(capabilities.features.executionProfileContext).toMatchObject({
        version: 1,
        supported: true,
        resource: 'task/context',
        resolvedProfileAuthoritative: true,
        compatibilityFallback: 'balanced',
        lifecycleFastPath: false,
      });
      for (const command of ['history', 'trace', 'reflect', 'inspect', 'metrics', 'action-show']) {
        expect(capabilities.commands).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: command, baseRiskClass: 'READ_ONLY', mutatesProtocol: false }),
        ]));
      }
    });
  });

  describe('readProtocolInfo', () => {
    it('observes stable SQLite capabilities without initializing an inspected directory', async () => {
      const before = readdirSync(scratchDir);
      const info = await adapter.readProtocolInfo(scratchDir);
      const features = info.features as Record<string, unknown>;
      expect(features.operationalStorage).toMatchObject({
        defaultBackend: 'sqlite',
        soleSQLiteWriter: true,
        sqlite: { schemaVersion: 5, minimumNode: '24.19.0' },
        migration: { explicit: true, requiresWritersQuiesced: true, automaticDowngrade: false },
      });
      expect(readdirSync(scratchDir)).toEqual(before);
    });

    it('reads compatibility.schemaVersion from the canonical resource', async () => {
      const protocolInfo = await adapter.readProtocolInfo(scratchDir);
      expect(protocolInfo.compatibility).toBeDefined();
      expect((protocolInfo.compatibility as Record<string, unknown>).schemaVersion).toBe(1);
    });

    it('never exposes a top-level schemaVersion field', async () => {
      const protocolInfo = await adapter.readProtocolInfo(scratchDir);
      expect(protocolInfo.schemaVersion).toBeUndefined();
    });
  });

  describe('read-only invocation guard', () => {
    async function expectRefusal(promise: Promise<unknown>): Promise<void> {
      const outcome = await promise.then(
        () => null,
        (error: unknown) => error,
      );
      expect(outcome).toBeInstanceOf(ForgeLoopAuditError);
      expect((outcome as ForgeLoopAuditError).details).toMatch(/refuses non-read-only ForgeLoop invocation/);
    }

    it('rejects claim reacquisition via task-resume', async () => {
      await expectRefusal(adapter.executeReadOnly(scratchDir, 'task-resume'));
    });

    it('rejects claim release recovery via task-recover', async () => {
      await expectRefusal(adapter.executeReadOnly(scratchDir, 'task-recover'));
    });

    it('rejects external execution via run-check', async () => {
      await expectRefusal(adapter.executeReadOnly(scratchDir, 'run-check'));
    });

    it('rejects loop mutation via advance', async () => {
      await expectRefusal(adapter.executeReadOnly(scratchDir, 'advance'));
    });

    it.each(['run-action', 'action-authorize', 'approval-resolve', 'action-reconcile', 'doctor'])('%s remains unavailable to ForgeLoopAudit', async (command) => {
      await expectRefusal(adapter.executeReadOnly(scratchDir, command));
    });

    it('rejects maintenance via init even with benign input', async () => {
      await expectRefusal(adapter.executeReadOnly(scratchDir, 'init', {}));
    });

    it('rejects unknown commands instead of forwarding them', async () => {
      await expect(adapter.executeReadOnly(scratchDir, 'totally-made-up-command')).rejects.toThrow(
        ForgeLoopAuditError,
      );
    });

    it('accepts the read-only next command and preserves canonical result shape', async () => {
      const result = await adapter.executeReadOnly<Record<string, unknown>>(scratchDir, 'next');
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.protocolVersion).toBe(1);
      expect(typeof result.ok).toBe('boolean');
    });

    it('accepts other allowlisted read-only commands', async () => {
      const result = await adapter.executeReadOnly<Record<string, unknown>>(scratchDir, 'validate-state');
      expect(result.metadata).toBeDefined();
    });

    it('accepts reconcile-continuity only when ForgeLoop classifies it as read-only', async () => {
      const result = await adapter.executeReadOnly<Record<string, unknown>>(
        scratchDir,
        'reconcile-continuity',
        { taskId: 'missing-task' },
      );
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.protocolVersion).toBe(1);
    });

    it('preserves canonical ForgeLoop error codes on unsupported programmatic commands', async () => {
      const result = await adapter.executeReadOnly<Record<string, unknown>>(scratchDir, 'protocol-info');
      expect(result.ok).toBe(true);
    });
  });

  describe('resource readers', () => {
    it('lists tasks through the canonical projection', async () => {
      const list = await adapter.listTasks(scratchDir);
      expect(list.count).toBe(0);
      expect(list.tasks).toEqual([]);
    });

    it('fails closed to INCONSISTENT ownership for unknown tasks', async () => {
      const ownership = await adapter.readTaskOwnership(scratchDir, 'missing-task');
      expect(ownership.claimState).toBe('INCONSISTENT');
      expect(ownership.ownershipValid).toBe(false);
      expect(ownership.mutationAllowed).toBe(false);
      expect(ownership.reasonCodes).toContain('E_TASK_NOT_FOUND');
      await expect(adapter.readTaskStatus(scratchDir, 'missing-task')).rejects.toThrow();
    });

    it('routes every current task/project resource through the canonical resource reader', async () => {
      const outcomes = await Promise.allSettled([
        adapter.readTaskContract(scratchDir, 'missing-task'),
        adapter.readTaskContinuity(scratchDir, 'missing-task'),
        adapter.readTaskActions!(scratchDir, 'missing-task'),
        adapter.readTaskAction!(scratchDir, 'missing-task', 'action-missing'),
        adapter.readTaskApprovals!(scratchDir, 'missing-task'),
        adapter.readTaskMetrics!(scratchDir, 'missing-task'),
        adapter.readTaskEvaluations!(scratchDir, 'missing-task'),
        adapter.readCapabilityPolicy!(scratchDir),
      ]);
      expect(outcomes.map((outcome) => outcome.status)).toEqual([
        'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'fulfilled', 'fulfilled',
      ]);
    });
  });
});
