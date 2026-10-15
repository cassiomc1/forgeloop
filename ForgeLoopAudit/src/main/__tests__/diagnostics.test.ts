import { describe, expect, it } from 'vitest';
import { buildAuditRuntimeDiagnostics } from '@main/core/diagnostics/diagnostics';
import type { ForgeLoopCompatibilityMode } from '@shared/domain';

describe('local diagnostics', () => {
  it('returns an allowlisted, environment-independent view', () => {
    const diagnostics = buildAuditRuntimeDiagnostics({ auditVersion: 'test', watcherStatus: 'active' });
    expect(diagnostics).toMatchObject({ auditVersion: 'test', watcherStatus: 'active' });
    expect(JSON.stringify(diagnostics)).not.toContain('SECRET');
    expect(diagnostics).not.toHaveProperty('env');
    expect(diagnostics).not.toHaveProperty('projectPath');
  });
});

describe('compatibility mode reporting', () => {
  it.each([
    ['INTEGRATION_V1', 'INTEGRATION_V1'],
    ['ARTIFACT_ONLY', 'ARTIFACT_ONLY'],
    ['INCOMPATIBLE', 'INCOMPATIBLE'],
  ] as const)('reports %s verbatim as the compatibility mode', (mode, expected) => {
    const diagnostics = buildAuditRuntimeDiagnostics({ auditVersion: 'test', watcherStatus: 'active', forgeLoopCompatibilityMode: mode });
    expect(diagnostics.forgeLoopCompatibilityMode).toBe(expected);
  });

  it('offers no legacy CLI compatibility mode at all', () => {
    // There is no reliable explicit signal distinguishing a ForgeLoop 1.3
    // project from a 1.5 project at the artifact level, so the ForgeLoopAudit must
    // never infer (and silently downgrade into) a legacy semantic mode.
    const modes: ForgeLoopCompatibilityMode[] = ['INTEGRATION_V1', 'ARTIFACT_ONLY', 'INCOMPATIBLE'];
    expect(modes).not.toContain('LEGACY_CLI_READ_ONLY');
  });

  it('defaults to ARTIFACT_ONLY when no mode was negotiated', () => {
    const diagnostics = buildAuditRuntimeDiagnostics({ auditVersion: 'test', watcherStatus: 'active' });
    expect(diagnostics.forgeLoopCompatibilityMode).toBe('ARTIFACT_ONLY');
  });
});
