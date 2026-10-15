import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateAuditExportPath } from '@main/core/audit/audit-export-path';

describe('audit export path policy', () => {
  it('requires an absolute path and protects the audited protocol directory by default', () => {
    const projectRoot = resolve('project');
    const protocolReport = join(projectRoot, '.forgeloop', 'reports', 'audit.md');
    expect(() => validateAuditExportPath('reports/audit.md', projectRoot, false)).toThrow(/path traversal/iu);
    expect(() => validateAuditExportPath(protocolReport, projectRoot, false)).toThrow();
    expect(validateAuditExportPath(protocolReport, projectRoot, true)).toBe(protocolReport);
  });

  it('allows explicit external destinations without widening the protocol path', () => {
    const projectRoot = resolve('project');
    const externalReport = join(resolve('tmp'), 'audit.md');
    const lookalikeReport = join(projectRoot, '.forgeloopish', 'audit.md');
    expect(validateAuditExportPath(externalReport, projectRoot, false)).toBe(externalReport);
    expect(validateAuditExportPath(lookalikeReport, projectRoot, false)).toBe(lookalikeReport);
    expect(validateAuditExportPath(externalReport, null, false)).toBe(externalReport);
  });
});
