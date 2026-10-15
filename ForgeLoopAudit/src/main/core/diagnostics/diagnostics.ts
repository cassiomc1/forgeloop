import type { AuditRuntimeDiagnostics } from '@shared/diagnostics';

export function buildAuditRuntimeDiagnostics(input: Partial<AuditRuntimeDiagnostics> = {}): AuditRuntimeDiagnostics {
  return {
    auditVersion: input.auditVersion || 'unknown',
    runtime: 'web-local',
    nodeVersion: input.nodeVersion || process.versions.node || 'unknown',
    platform: input.platform || process.platform,
    arch: input.arch || process.arch,
    forgeLoopCompatibilityMode: input.forgeLoopCompatibilityMode || 'ARTIFACT_ONLY',
    protocolVersion: input.protocolVersion,
    watcherStatus: input.watcherStatus || 'unknown',
    lastReconcileDurationMs: input.lastReconcileDurationMs,
    lastErrorCode: input.lastErrorCode,
  };
}
