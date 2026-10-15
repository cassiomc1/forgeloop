import { describe, expect, it, vi } from 'vitest';
import type { ForgeLoopIntegrationAdapter } from '@main/core/integration/forgeloop-integration';
import { createStructuralQualityAuditService } from '@main/core/audit/structural-quality-service';

function adapter(projection?: Record<string, unknown>): ForgeLoopIntegrationAdapter {
  return {
    getPackageVersion: () => '1.10.0',
    getCapabilities: () => ({ packageVersion: '1.10.0', protocolVersion: 1, integrationApiVersion: 1, executorParity: true, features: { taskClaimRecovery: { version: 1, durableRecoveryState: true, explicitResume: true, validatedClaimProjection: true } }, resources: [], commands: [] }),
    readProtocolInfo: vi.fn(),
    listTasks: vi.fn(),
    readTaskStatus: vi.fn(),
    readTaskOwnership: vi.fn(),
    readTaskContract: vi.fn(),
    readTaskContinuity: vi.fn(),
    readTaskStructuralQuality: projection === undefined
      ? vi.fn().mockRejectedValue(new Error('quality resource failed'))
      : vi.fn().mockResolvedValue(projection),
    executeReadOnly: vi.fn(),
  };
}

describe('StructuralQualityAuditService', () => {
  it('returns an honest unavailable view when the capability is not advertised', async () => {
    const integration = adapter();
    const service = createStructuralQualityAuditService({ projectRoot: '/project', integration, featureSupport: { structuralQuality: false } as never });

    const result = await service.readTask('TASK-001');

    expect(result).toMatchObject({ available: false, taskId: 'TASK-001', error: { code: 'E_STRUCTURAL_QUALITY_UNAVAILABLE' } });
    expect(integration.readTaskStructuralQuality).not.toHaveBeenCalled();
  });

  it('normalizes the canonical resource and never invokes a provider', async () => {
    const integration = adapter({
      data: {
        taskId: 'TASK-001',
        mode: 'observe',
        provider: 'sentrux',
        baseline: { status: 'PASS', score: 0.8 },
        current: { status: 'FAIL', cycle: 2, score: 0.5, delta: -0.3, artifact: 'quality.json' },
        comparable: true,
        completionRequired: false,
      },
    });
    const service = createStructuralQualityAuditService({ projectRoot: '/project', integration, featureSupport: { structuralQuality: true } as never });

    const result = await service.readTask('TASK-001');

    expect(result).toMatchObject({ available: true, source: 'FORGELOOP_INTEGRATION', mode: 'observe', provider: 'sentrux', current: { status: 'FAIL', qualitySignal: 0.5, artifactRef: 'quality.json' } });
    expect(integration.readTaskStructuralQuality).toHaveBeenCalledWith('/project', 'TASK-001');
  });

  it('converts canonical resource failures into unavailable state', async () => {
    const integration = adapter();
    const service = createStructuralQualityAuditService({ projectRoot: '/project', integration, featureSupport: { structuralQuality: true } as never });

    const result = await service.readTask('TASK-001');

    expect(result).toMatchObject({ available: false, error: { message: 'quality resource failed' } });
  });
});
