import { describe, expect, it, vi } from 'vitest';
import type { ForgeLoopIntegrationAdapter } from '@main/core/integration/forgeloop-integration';
import type { ForgeLoopReadOnlyResult } from '@main/core/integration/types';
import {
  createCanonicalContinuityLintService,
  normalizeContinuityLint,
} from '@main/core/integration/canonical-continuity-lint';

function adapterWith(result: Record<string, unknown>): ForgeLoopIntegrationAdapter {
  return {
    getPackageVersion: () => '1.10.0',
    getCapabilities: () => ({
      packageVersion: '1.10.0',
      protocolVersion: 1,
      integrationApiVersion: 1,
      executorParity: true,
      features: { taskClaimRecovery: { version: 1, durableRecoveryState: true, explicitResume: true, validatedClaimProjection: true } },
      resources: [],
    }),
    readProtocolInfo: vi.fn(),
    listTasks: vi.fn(),
    readTaskStatus: vi.fn(),
    readTaskOwnership: vi.fn(),
    readTaskContract: vi.fn(),
    readTaskContinuity: vi.fn(),
    executeReadOnly: vi.fn(async (_root: string, command: string) => ({
      ok: true,
      command,
      exitCode: 0,
      result,
      error: null,
      metadata: null,
    } as ForgeLoopReadOnlyResult<Record<string, unknown>>)) as unknown as ForgeLoopIntegrationAdapter['executeReadOnly'],
  };
}

describe('canonical continuity lint projection', () => {
  it('keeps canonical classification and lint findings operational-only', () => {
    expect(normalizeContinuityLint({
      classification: 'RECONCILIATION_REQUIRED',
      authority: 'OPERATIONAL_CONTEXT_ONLY',
      evidenceAuthority: 'NONE',
      lint: {
        status: 'WARN',
        findings: [{
          code: 'CONTINUITY_INSPECT_PATH_MISSING',
          severity: 'WARN',
          field: 'inspectFirst[0]',
          itemId: null,
        }],
      },
      reasonCodes: ['E_CONTINUITY_RECONCILIATION_REQUIRED'],
    })).toMatchObject({
      available: true,
      classification: 'RECONCILIATION_REQUIRED',
      status: 'WARN',
      authority: 'OPERATIONAL_CONTEXT_ONLY',
      evidenceAuthority: 'NONE',
      findings: [{ code: 'CONTINUITY_INSPECT_PATH_MISSING', severity: 'WARN', field: 'inspectFirst[0]', itemId: null }],
    });
  });

  it('rejects malformed authority values instead of inventing a trusted projection', () => {
    expect(normalizeContinuityLint({
      classification: 'FRESH',
      authority: 'FORGELOOP',
      evidenceAuthority: 'EVIDENCE',
      lint: { status: 'PASS', findings: [] },
    })).toMatchObject({
      available: false,
      source: 'UNAVAILABLE',
      error: { code: 'E_CANONICAL_CONTINUITY_LINT_INVALID' },
    });
  });

  it('invokes only the read-only canonical reconciliation command', async () => {
    const adapter = adapterWith({
      classification: 'FRESH',
      authority: 'OPERATIONAL_CONTEXT_ONLY',
      evidenceAuthority: 'NONE',
      lint: { status: 'PASS', findings: [] },
    });
    const service = createCanonicalContinuityLintService({ integration: adapter });
    const result = await service.getLint('/project', 'TASK-001');
    expect(result.status).toBe('PASS');
    expect(adapter.executeReadOnly).toHaveBeenCalledWith('/project', 'reconcile-continuity', { taskId: 'TASK-001' });
  });
});
