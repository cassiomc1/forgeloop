import { describe, expect, it } from 'vitest';
import type { AuditFinding, CanonicalAuditError, CanonicalTaskAudit } from '@shared/audit';
import type { ProjectSummary, ProtocolSummary } from '@shared/domain';
import { mapCanonicalError } from '@main/core/audit/canonical-error-mapping';
import { canonicalErrorToFinding } from '@main/core/audit/finding-factory';
import { aggregateProjectAudit } from '@main/core/audit/audit-aggregator';
import { normalizeCanonicalTaskAudit } from '@main/core/audit/audit-normalizer';

const project: ProjectSummary = { name: 'Demo', rootPath: '/tmp/demo', head: 'abc123' };
const protocol: ProtocolSummary = {
  protocolVersion: 1,
  schemaVersion: 1,
  packageVersion: '1.12.0',
  compatible: true,
  compatibilityMode: 'INTEGRATION_V1',
};

const task = (taskId: string, status: CanonicalTaskAudit['status'] = 'VALID'): CanonicalTaskAudit => ({
  available: true,
  source: 'FORGELOOP_INTEGRATION',
  taskId,
  status,
  errors: [],
  warnings: [],
  result: { status },
  command: 'audit',
  exitCode: 0,
  error: null,
});

function aggregate(findings: AuditFinding[], taskAudits: CanonicalTaskAudit[] = [task('TASK-001')]) {
  return aggregateProjectAudit({
    project,
    protocol,
    taskAudits,
    qualityViews: [],
    findings,
    compatibilityMode: 'INTEGRATION_V1',
    forgeLoopPackageVersion: '1.12.0',
    forgeLoopCommit: 'b'.repeat(40),
    integrationApiVersion: 1,
    gitHead: 'abc123',
  });
}

function normalizedStatus(status: string): CanonicalTaskAudit['status'] {
  return normalizeCanonicalTaskAudit({ ok: true, result: { taskId: 'TASK-001', status } }, 0).status;
}

/**
 * The exact code and message ForgeLoop 1.12.0 raises from `getTaskTransaction`
 * when an active task transaction is reused against a different project.
 * See forgeloop v1.12.0 src/core/transaction.js lines 19-24.
 */
const contextMismatch: CanonicalAuditError = {
  code: 'E_TASK_CONTEXT_MISMATCH',
  message: 'Cannot reuse a task transaction for a different project',
};

describe('canonical error fail-closed behaviour', () => {
  describe('scenario A: cross-project task transaction', () => {
    it('classifies E_TASK_CONTEXT_MISMATCH as a canonical integrity failure', () => {
      const mapping = mapCanonicalError(contextMismatch);

      expect(mapping.classified).toBe(true);
      expect(mapping.severity).toBe('CRITICAL');
      expect(mapping.domain).toBe('WORKSPACE');
      expect(mapping.affectsIntegrity).toBe(true);
      expect(mapping.affectsCompletion).toBe(true);
    });

    it('never reports integrity or trust as valid when ForgeLoop rejects the transaction context', () => {
      const finding = canonicalErrorToFinding(contextMismatch, { taskId: 'TASK-001', channel: 'ERROR' });
      const result = aggregate([finding]);

      expect(finding.affectsIntegrity).toBe(true);
      expect(result.verdict.integrity).toBe('INVALID');
      expect(result.verdict.trust).toBe('DEGRADED');
      expect(result.counts.critical).toBe(1);
      expect(result.counts.unknown).toBe(0);
    });
  });

  describe('scenario B: aborted and rolled back transactions', () => {
    it.each(['ABORTED', 'ROLLED_BACK', 'ABANDONED', 'STAGING', 'COMMITTING'])(
      'never promotes ForgeLoop transaction status %s to a positive audit status',
      (status) => {
        expect(normalizedStatus(status)).not.toBe('VALID');
      },
    );

    it('recognises ABORTED as an incomplete task rather than an unreadable one', () => {
      expect(normalizedStatus('ABORTED')).toBe('INCOMPLETE');
      expect(normalizedStatus('aborted')).toBe('INCOMPLETE');
    });

    it('recognises ROLLED_BACK as incomplete because the writes were undone', () => {
      expect(normalizedStatus('ROLLED_BACK')).toBe('INCOMPLETE');
    });

    it('recognises ABANDONED as invalid because ForgeLoop rollback itself failed', () => {
      expect(normalizedStatus('ABANDONED')).toBe('INVALID');
    });

    it('never reports completion readiness as valid for an aborted task', () => {
      const result = aggregate([], [task('TASK-001', normalizedStatus('ABORTED'))]);

      expect(result.verdict.completionReadiness).toBe('INCOMPLETE');
      expect(result.verdict.completionReadiness).not.toBe('VALID');
    });
  });

  describe('scenario C: unrecognised canonical errors', () => {
    const futureSafetyError: CanonicalAuditError = {
      code: 'E_NEW_CANONICAL_SAFETY_ERROR',
      message: 'A future ForgeLoop release reported a canonical failure this Audit build cannot classify.',
    };

    it('marks an unrecognised canonical error as unclassified instead of harmless', () => {
      const mapping = mapCanonicalError(futureSafetyError);

      expect(mapping.classified).toBe(false);
      expect(mapping.severity).toBe('UNKNOWN');
      expect(mapping.affectsIntegrity).toBe(false);
    });

    it('refuses to assert integrity or trust for an unrecognised canonical error', () => {
      const finding = canonicalErrorToFinding(futureSafetyError, { taskId: 'TASK-001', channel: 'ERROR' });
      const result = aggregate([finding]);

      expect(finding.unclassifiedCanonicalError).toBe(true);
      expect(finding.affectsIntegrity).toBe(false);
      expect(result.verdict.integrity).toBe('UNKNOWN');
      expect(result.verdict.trust).toBe('UNKNOWN');
      expect(result.score).toBeNull();
    });

    it('keeps a known integrity failure stronger than an unclassified one', () => {
      const result = aggregate([
        canonicalErrorToFinding(contextMismatch, { taskId: 'TASK-001', channel: 'ERROR' }),
        canonicalErrorToFinding(futureSafetyError, { taskId: 'TASK-001', channel: 'ERROR' }),
      ]);

      expect(result.verdict.integrity).toBe('INVALID');
    });
  });

  describe('scenario D: benign cases must not become failures', () => {
    it('does not demote integrity for an unrecognised canonical warning', () => {
      const finding = canonicalErrorToFinding(
        { code: 'E_FUTURE_ADVISORY_NOTE', message: 'A future advisory note that carries no failure.' },
        { taskId: 'TASK-001', channel: 'WARNING' },
      );
      const result = aggregate([finding]);

      expect(finding.unclassifiedCanonicalError).toBeUndefined();
      expect(result.verdict.integrity).toBe('VALID');
      expect(result.verdict.trust).toBe('VALID');
    });

    it('keeps a recognised non-integrity error out of the integrity verdict', () => {
      const finding = canonicalErrorToFinding(
        { code: 'E_CONTINUITY_INCOMPLETE', message: 'Continuity trace is incomplete.' },
        { taskId: 'TASK-001', channel: 'ERROR' },
      );
      const result = aggregate([finding]);

      expect(finding.affectsIntegrity).toBe(false);
      expect(finding.unclassifiedCanonicalError).toBeUndefined();
      expect(result.verdict.integrity).toBe('VALID');
      expect(result.verdict.trust).toBe('VALID');
    });

    it('keeps a clean canonical audit valid', () => {
      const result = aggregate([]);

      expect(result.verdict.integrity).toBe('VALID');
      expect(result.verdict.trust).toBe('VALID');
    });
  });
});
