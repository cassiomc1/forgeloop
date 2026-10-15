import type { ProjectReader } from '@main/core/project/project-reader';
import type { ForgeLoopIntegrationAdapter } from '@main/core/integration/forgeloop-integration';
import { runAuditReadCommand } from '@main/core/integration/audit-read-commands';
import { buildTaskSummary, buildRecoverySummary } from './task-reader';
import { normalizeOwnership } from './ownership-projection';
import { resolveOperationalState } from './operational-state';
import { compareAuthoritativeFacts } from '@main/core/protocol/semantic-parity';
import type { CanonicalTaskStatusSummary, TaskSummary } from '@shared/domain';
import { PHASE_ORDER } from '@shared/domain';

export interface CanonicalTaskReadResult {
  taskId: string;
  taskKey: string;
  summary: TaskSummary;
  status?: Record<string, unknown>;
  artifacts: Record<string, unknown>;
}

export interface CanonicalTaskReadService {
  readTask(taskId: string, taskKey: string): Promise<CanonicalTaskReadResult>;
}

export function extractCanonicalPhase(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const phase = (value as Record<string, unknown>).phase;
  return typeof phase === 'string' ? phase.toUpperCase() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function summarizeCanonicalTaskStatus(value: unknown): CanonicalTaskStatusSummary | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.status !== 'string') return undefined;
  return {
    status: record.status.toUpperCase(),
    reasons: stringArray(record.reasons),
    warnings: stringArray(record.warnings),
    repositoryComparison: typeof record.repositoryComparison === 'string' ? record.repositoryComparison : undefined,
    contractComparison: typeof record.contractComparison === 'string' ? record.contractComparison : undefined,
    artifactComparison: typeof record.artifactComparison === 'string' ? record.artifactComparison : undefined,
  };
}

/**
 * Single canonical semantic projection for one task.
 *
 * Both the project snapshot and the typed task endpoint read tasks through
 * this service, so overview and inspector can never present conflicting
 * ownership/recovery facts. Everything canonical comes from the bundled
 * Integration API (`task/status`, `task/ownership`, canonical `next`); raw
 * artifacts contribute display data only. There is no external CLI here.
 */
export function createCanonicalTaskReadService(options: {
  projectRoot: string;
  projectReader: ProjectReader;
  integration: ForgeLoopIntegrationAdapter;
}): CanonicalTaskReadService {
  const { projectRoot, projectReader, integration } = options;

  return {
    async readTask(taskId: string, taskKey: string): Promise<CanonicalTaskReadResult> {
      const artifacts = projectReader.readTaskSummaryArtifacts(taskKey);
      const nativeStorage = projectReader.hasNativeStorage?.() ?? false;

      const [rawCanonicalStatus, canonicalOwnership, canonicalContinuity] = await Promise.all([
        integration.readTaskStatus(projectRoot, taskId).catch(() => null),
        integration.readTaskOwnership(projectRoot, taskId).catch(() => null),
        integration.readTaskContinuity(projectRoot, taskId).catch(() => null),
      ]);

      const nextOutcome = await runAuditReadCommand<Record<string, unknown>>(
        integration,
        projectRoot,
        'next',
        { taskId },
      ).catch(() => null);
      const nextData = nextOutcome?.kind === 'DOMAIN_OUTCOME' ? nextOutcome.data ?? undefined : undefined;

      if (nativeStorage) {
        if (!rawCanonicalStatus || typeof rawCanonicalStatus.taskKey !== 'string' || !rawCanonicalStatus.taskKey) {
          throw new Error(`Canonical SQLite task status unavailable for ${taskId}`);
        }
        if (typeof rawCanonicalStatus.phase !== 'string' || !Object.hasOwn(PHASE_ORDER, rawCanonicalStatus.phase)) {
          throw new Error(`Canonical SQLite task phase unavailable for ${taskId}`);
        }
        taskKey = rawCanonicalStatus.taskKey;
        artifacts['task.json'] = { taskId };
        if (rawCanonicalStatus.state && typeof rawCanonicalStatus.state === 'object') {
          artifacts['work-state.json'] = rawCanonicalStatus.state;
        } else if (typeof rawCanonicalStatus.phase === 'string') {
          artifacts['work-state.json'] = { phase: rawCanonicalStatus.phase };
        }
        artifacts['contract.json'] = await integration.readTaskContract(projectRoot, taskId).catch(() => undefined);
        if (rawCanonicalStatus.recovery && typeof rawCanonicalStatus.recovery === 'object') {
          artifacts['recovery.json'] = rawCanonicalStatus.recovery;
        }
      }

      const summary = buildTaskSummary(taskKey, artifacts, nextData, canonicalContinuity ?? undefined);

      const canonicalStatus = summarizeCanonicalTaskStatus(rawCanonicalStatus);
      if (canonicalStatus) summary.canonicalStatus = canonicalStatus;

      const ownershipSummary = normalizeOwnership(canonicalOwnership);
      summary.ownership = ownershipSummary;
      summary.historicalWriteClaims = ownershipSummary.historicalWriteClaims;
      summary.effectiveWriteClaims = ownershipSummary.effectiveWriteClaims;

      summary.recovery = buildRecoverySummary(
        artifacts['recovery.json'] as Record<string, unknown> | undefined,
        ownershipSummary,
      );

      summary.operationalState = resolveOperationalState({
        phase: summary.phase,
        ownership: ownershipSummary,
      });

      if (rawCanonicalStatus) {
        const parity = compareAuthoritativeFacts(
          { phase: summary.phase },
          { phase: extractCanonicalPhase(rawCanonicalStatus) },
        );
        if (!parity.consistent) {
          summary.protocolConflicts = parity.differences;
        }
      }

      return { taskId, taskKey, summary, status: rawCanonicalStatus ?? undefined, artifacts };
    },
  };
}
