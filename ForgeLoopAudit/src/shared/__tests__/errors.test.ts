import { describe, it, expect } from 'vitest';
import { ForgeLoopAuditError } from '@shared/errors';

describe('shared/errors', () => {
  describe('ForgeLoopAuditError', () => {
    it('should create error with correct properties', () => {
      const error = new ForgeLoopAuditError('CLI_FAILED', 'test message', true, 'details');
      expect(error.code).toBe('CLI_FAILED');
      expect(error.message).toBe('test message');
      expect(error.recoverable).toBe(true);
      expect(error.details).toBe('details');
      expect(error.name).toBe('ForgeLoopAuditError');
      expect(error).toBeInstanceOf(Error);
    });

    it('should serialize to JSON', () => {
      const error = new ForgeLoopAuditError('CLI_FAILED', 'msg', true, 'det');
      const json = error.toJSON();
      expect(json).toEqual({
        code: 'CLI_FAILED',
        message: 'msg',
        recoverable: true,
        details: 'det',
      });
    });

    describe('static factory methods', () => {
      it('projectNotForgeLoop', () => {
        const error = ForgeLoopAuditError.projectNotForgeLoop('/path');
        expect(error.code).toBe('PROJECT_NOT_FORGELOOP');
        expect(error.recoverable).toBe(true);
        expect(error.details).toContain('/path');
      });

      it('projectDiscoveryAmbiguous', () => {
        const error = ForgeLoopAuditError.projectDiscoveryAmbiguous('/workspace', ['/workspace/one', '/workspace/two']);
        expect(error.code).toBe('PROJECT_DISCOVERY_AMBIGUOUS');
        expect(error.message).toContain('Multiple ForgeLoop projects');
        expect(error.details).toContain('/workspace/two');
      });

      it('protocolUnsupported', () => {
        const error = ForgeLoopAuditError.protocolUnsupported(99, '/path');
        expect(error.code).toBe('PROTOCOL_UNSUPPORTED');
        expect(error.recoverable).toBe(false);
        expect(error.message).toContain('99');
      });

      it('artifactInvalid', () => {
        const error = ForgeLoopAuditError.artifactInvalid('task.json', 'bad format');
        expect(error.code).toBe('ARTIFACT_INVALID');
        expect(error.recoverable).toBe(true);
      });

      it('artifactUnreadable', () => {
        const error = ForgeLoopAuditError.artifactUnreadable('config.json', 'not found');
        expect(error.code).toBe('ARTIFACT_UNREADABLE');
        expect(error.recoverable).toBe(true);
      });

      it('cliNotFound', () => {
        const error = ForgeLoopAuditError.cliNotFound('forgeloop');
        expect(error.code).toBe('CLI_NOT_FOUND');
        expect(error.recoverable).toBe(false);
      });

      it('cliFailed', () => {
        const error = ForgeLoopAuditError.cliFailed('task-list', 1, 'error output');
        expect(error.code).toBe('CLI_FAILED');
        expect(error.recoverable).toBe(true);
        expect(error.details).toContain('task-list');
        expect(error.details).toContain('error output');
      });

      it('pathBoundaryViolation', () => {
        const error = ForgeLoopAuditError.pathBoundaryViolation('/evil/path', '/project');
        expect(error.code).toBe('PATH_BOUNDARY_VIOLATION');
        expect(error.recoverable).toBe(false);
      });

      it('ledgerInvalid', () => {
        const error = ForgeLoopAuditError.ledgerInvalid(42, 'malformed line');
        expect(error.code).toBe('LEDGER_INVALID');
        expect(error.recoverable).toBe(true);
      });

      it('watcherFailed', () => {
        const error = ForgeLoopAuditError.watcherFailed('permission denied');
        expect(error.code).toBe('WATCHER_FAILED');
        expect(error.recoverable).toBe(true);
      });

      it('projectRemoved', () => {
        const error = ForgeLoopAuditError.projectRemoved('/path');
        expect(error.code).toBe('PROJECT_REMOVED');
        expect(error.recoverable).toBe(true);
      });

      it('permissionDenied', () => {
        const error = ForgeLoopAuditError.permissionDenied('/path');
        expect(error.code).toBe('PERMISSION_DENIED');
        expect(error.recoverable).toBe(false);
      });

      it('unknown', () => {
        const error = ForgeLoopAuditError.unknown('something broke', 'stack trace');
        expect(error.code).toBe('UNKNOWN_ERROR');
        expect(error.recoverable).toBe(true);
        expect(error.details).toBe('stack trace');
      });
    });
  });
});
