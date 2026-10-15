import type { AuditAppError, AuditAppErrorCode } from './domain';
export type { AuditAppError, AuditAppErrorCode } from './domain';

export class ForgeLoopAuditError extends Error {
  public readonly code: AuditAppErrorCode;
  public readonly recoverable: boolean;
  public readonly details?: string;

  constructor(code: AuditAppErrorCode, message: string, recoverable: boolean, details?: string) {
    super(message);
    this.name = 'ForgeLoopAuditError';
    this.code = code;
    this.recoverable = recoverable;
    this.details = details;
  }

  static projectNotForgeLoop(path: string): ForgeLoopAuditError {
    return new ForgeLoopAuditError(
      'PROJECT_NOT_FORGELOOP',
      `The selected directory does not contain a ForgeLoop project (.forgeloop/ not found)`,
      true,
      `Path: ${path}`
    );
  }

  static projectDiscoveryAmbiguous(path: string, candidates: string[]): ForgeLoopAuditError {
    return new ForgeLoopAuditError(
      'PROJECT_DISCOVERY_AMBIGUOUS',
      'Multiple ForgeLoop projects were found below the selected directory. Select one project folder directly.',
      true,
      `Path: ${path}\nProjects:\n${candidates.map((candidate) => `- ${candidate}`).join('\n')}`,
    );
  }

  static protocolUnsupported(version: number, path: string): ForgeLoopAuditError {
    return new ForgeLoopAuditError(
      'PROTOCOL_UNSUPPORTED',
      `ForgeLoop protocol version ${version} is not supported by this version of ForgeLoopAudit`,
      false,
      `Path: ${path}, Protocol version: ${version}`
    );
  }

  static artifactInvalid(artifact: string, reason: string): ForgeLoopAuditError {
    return new ForgeLoopAuditError(
      'ARTIFACT_INVALID',
      `Invalid ForgeLoop artifact: ${artifact}`,
      true,
      reason
    );
  }

  static artifactUnreadable(artifact: string, reason: string): ForgeLoopAuditError {
    return new ForgeLoopAuditError(
      'ARTIFACT_UNREADABLE',
      `Cannot read ForgeLoop artifact: ${artifact}`,
      true,
      reason
    );
  }

  static cliNotFound(command: string): ForgeLoopAuditError {
    return new ForgeLoopAuditError(
      'CLI_NOT_FOUND',
      `ForgeLoop CLI not found. Please ensure 'forgeloop' is in your PATH.`,
      false,
      `Command: ${command}`
    );
  }

  static cliFailed(command: string, exitCode: number, stderr: string): ForgeLoopAuditError {
    return new ForgeLoopAuditError(
      'CLI_FAILED',
      `ForgeLoop CLI command failed with exit code ${exitCode}`,
      true,
      `Command: ${command}, stderr: ${stderr}`
    );
  }

  static pathBoundaryViolation(path: string, boundary: string): ForgeLoopAuditError {
    return new ForgeLoopAuditError(
      'PATH_BOUNDARY_VIOLATION',
      `Path traversal attempt detected`,
      false,
      `Attempted path: ${path}, Boundary: ${boundary}`
    );
  }

  static ledgerInvalid(line: number, reason: string): ForgeLoopAuditError {
    return new ForgeLoopAuditError(
      'LEDGER_INVALID',
      `Invalid event ledger at line ${line}`,
      true,
      reason
    );
  }

  static watcherFailed(reason: string): ForgeLoopAuditError {
    return new ForgeLoopAuditError(
      'WATCHER_FAILED',
      `Filesystem watcher failed`,
      true,
      reason
    );
  }

  static projectRemoved(path: string): ForgeLoopAuditError {
    return new ForgeLoopAuditError(
      'PROJECT_REMOVED',
      `The selected project directory no longer exists`,
      true,
      `Path: ${path}`
    );
  }

  static permissionDenied(path: string): ForgeLoopAuditError {
    return new ForgeLoopAuditError(
      'PERMISSION_DENIED',
      `Permission denied accessing project`,
      false,
      `Path: ${path}`
    );
  }

  static unknown(message: string, details?: string): ForgeLoopAuditError {
    return new ForgeLoopAuditError('UNKNOWN_ERROR', message, true, details);
  }

  toJSON(): AuditAppError {
    return {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      details: this.details,
    };
  }
}
