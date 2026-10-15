import type { ForgeLoopCompatibilityMode } from './domain';

export interface AuditRuntimeDiagnostics {
  auditVersion: string;
  runtime: 'web-local';
  nodeVersion: string;
  platform: string;
  arch: string;
  forgeLoopCompatibilityMode: ForgeLoopCompatibilityMode;
  protocolVersion?: number;
  watcherStatus: string;
  lastReconcileDurationMs?: number;
  lastErrorCode?: string;
}
