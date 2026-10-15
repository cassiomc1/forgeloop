import { describe, expect, it, vi } from 'vitest';
import { createCanonicalAuditService } from '@main/core/audit/canonical-audit-service';
import type { ForgeLoopIntegrationAdapter } from '@main/core/integration/forgeloop-integration';

function adapter(result: Record<string, unknown>): ForgeLoopIntegrationAdapter {
  return {
    getPackageVersion: () => '1.10.0',
    getCapabilities: () => ({
      packageVersion: '1.10.0', protocolVersion: 1, integrationApiVersion: 1, executorParity: true,
      features: { taskClaimRecovery: { version: 1, durableRecoveryState: true, explicitResume: true, validatedClaimProjection: true } }, resources: [], commands: [],
    }),
    readProtocolInfo: vi.fn(),
    listTasks: vi.fn(),
    readTaskStatus: vi.fn(),
    readTaskOwnership: vi.fn(),
    readTaskContract: vi.fn(),
    readTaskContinuity: vi.fn(),
    executeReadOnly: vi.fn().mockResolvedValue({ ok: true, command: 'audit', exitCode: 7, result, error: null, metadata: null }),
  } as unknown as ForgeLoopIntegrationAdapter;
}

describe('CanonicalAuditService', () => {
  it('uses the bundled read-only command contract and preserves a non-zero domain exit code', async () => {
    const integration = adapter({ taskId: 'TASK-001', status: 'VALID', errors: [] });
    const service = createCanonicalAuditService({ projectRoot: '/project', integration });

    const result = await service.auditTask('TASK-001');

    expect(result.available).toBe(true);
    expect(result.exitCode).toBe(7);
    expect(integration.executeReadOnly).toHaveBeenCalledWith('/project', 'audit', { taskId: 'TASK-001' });
  });

  it('preserves canonical invocation failures as unavailable audit results', async () => {
    const integration = adapter({});
    vi.mocked(integration.executeReadOnly).mockResolvedValue({
      ok: false, command: 'audit', exitCode: -1, result: null, error: { code: 'E_CLI_UNAVAILABLE', message: 'ForgeLoop runtime unavailable.' }, metadata: null,
    });
    const result = await createCanonicalAuditService({ projectRoot: '/project', integration }).auditTask('TASK-001');

    expect(result).toMatchObject({ available: false, source: 'UNAVAILABLE', exitCode: -1, error: { code: 'E_CLI_UNAVAILABLE' } });
  });

  it('converts unexpected adapter errors into a bounded canonical error', async () => {
    const integration = adapter({});
    vi.mocked(integration.executeReadOnly).mockRejectedValue(new Error('adapter exploded'));
    const result = await createCanonicalAuditService({ projectRoot: '/project', integration }).auditTask('TASK-001');

    expect(result).toMatchObject({ available: false, exitCode: -1, error: { code: 'E_CANONICAL_AUDIT_UNAVAILABLE', message: 'adapter exploded' } });
  });
});
