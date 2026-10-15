import type {
  CanonicalAuditError,
  CanonicalTaskAudit,
  StructuralQualityAuditView,
  StructuralQualityMode,
  StructuralQualityStatus,
} from '@shared/audit';
import type { CanonicalProjectionError } from '@shared/domain';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBooleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function artifactRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (!isRecord(item)) return [];
    const ref = item.ref ?? item.path ?? item.artifact;
    return typeof ref === 'string' ? [ref] : [];
  });
}

function projectionError(value: unknown, fallbackCode: string, fallbackMessage: string): CanonicalProjectionError {
  if (isRecord(value)) {
    return {
      code: asString(value.code, fallbackCode),
      message: asString(value.message, fallbackMessage),
      ...(typeof value.next === 'string' ? { next: value.next } : {}),
    };
  }
  return { code: fallbackCode, message: fallbackMessage };
}

function normalizeError(value: unknown, fallbackCode = 'E_CANONICAL_AUDIT_ERROR'): CanonicalAuditError | null {
  if (typeof value === 'string') return { code: fallbackCode, message: value, canonicalMessage: value };
  if (!isRecord(value)) return null;
  const message = asString(value.message, asString(value.summary, fallbackCode));
  const code = asString(value.code, fallbackCode);
  return {
    code,
    message,
    canonicalMessage: asString(value.canonicalMessage, message),
    ...(typeof value.next === 'string' ? { next: value.next } : {}),
    ...(value.next === null ? { next: null } : {}),
    ...(artifactRefs(value.artifacts ?? value.artifactRefs).length > 0
      ? { artifacts: artifactRefs(value.artifacts ?? value.artifactRefs) }
      : {}),
    ...(stringArray(value.reasonCodes).length > 0 ? { reasonCodes: stringArray(value.reasonCodes) } : {}),
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
  };
}

function unwrapResult(value: UnknownRecord): UnknownRecord {
  if (isRecord(value.result)) return value.result;
  if (isRecord(value.data)) return value.data;
  return value;
}

const AUDIT_STATUSES = new Set<CanonicalTaskAudit['status']>(['VALID', 'INCOMPLETE', 'STALE', 'INVALID', 'UNKNOWN']);

/**
 * ForgeLoop task transaction statuses, translated into the audit taxonomy.
 * See forgeloop v1.12.0 `src/core/transaction.js`: ABORTED means staging failed
 * before anything was published, ROLLED_BACK means published writes were undone,
 * and ABANDONED means the rollback itself failed and the project may still hold
 * partial writes. None of them is a completion, and ABANDONED is not terminal
 * for ForgeLoop, so it is the only one that implies a broken project state.
 */
const TRANSACTION_STATUS_TRANSLATIONS: Readonly<Record<string, CanonicalTaskAudit['status']>> = Object.freeze({
  ABORTED: 'INCOMPLETE',
  ROLLED_BACK: 'INCOMPLETE',
  ABANDONED: 'INVALID',
});

function normalizeAuditStatus(value: unknown): CanonicalTaskAudit['status'] {
  const normalized = typeof value === 'string' ? value.toUpperCase() : '';
  if (normalized === 'COMPLETE' || normalized === 'COMPLETED' || normalized === 'PASS') return 'VALID';
  const translated = TRANSACTION_STATUS_TRANSLATIONS[normalized];
  if (translated) return translated;
  return AUDIT_STATUSES.has(normalized as CanonicalTaskAudit['status'])
    ? normalized as CanonicalTaskAudit['status']
    : 'UNKNOWN';
}

export function normalizeCanonicalTaskAudit(value: unknown, exitCode: number | null = 0): CanonicalTaskAudit {
  if (!isRecord(value)) {
    const error = projectionError(null, 'E_CANONICAL_AUDIT_UNAVAILABLE', 'Canonical ForgeLoop audit result is unavailable.');
    return {
      available: false,
      source: 'UNAVAILABLE',
      taskId: null,
      status: 'UNKNOWN',
      errors: [{ code: error.code, message: error.message, canonicalMessage: error.message }],
      warnings: [],
      result: null,
      command: 'audit',
      exitCode,
      error,
    };
  }

  const domain = unwrapResult(value);
  const invocationFailed = value.ok === false;
  const explicitError = normalizeError(value.error, 'E_CANONICAL_AUDIT_UNAVAILABLE');
  const domainErrors = (Array.isArray(domain.errors) ? domain.errors : [])
    .map((item) => normalizeError(item))
    .filter((item): item is CanonicalAuditError => item !== null);
  const domainWarnings = (Array.isArray(domain.warnings) ? domain.warnings : [])
    .map((item) => normalizeError(item, 'E_CANONICAL_AUDIT_WARNING'))
    .filter((item): item is CanonicalAuditError => item !== null);
  const errors = explicitError && invocationFailed ? [explicitError, ...domainErrors] : domainErrors;
  const available = !invocationFailed;
  const taskId = asNullableString(domain.taskId ?? value.taskId);
  const status = normalizeAuditStatus(domain.status ?? domain.verdict ?? domain.completionStatus);
  const unavailableError = available
    ? null
    : projectionError(explicitError, 'E_CANONICAL_AUDIT_UNAVAILABLE', 'Canonical ForgeLoop audit result is unavailable.');

  return {
    available,
    source: available ? 'FORGELOOP_INTEGRATION' : 'UNAVAILABLE',
    taskId,
    status,
    errors: errors.length > 0 ? errors : (unavailableError ? [{ code: unavailableError.code, message: unavailableError.message }] : []),
    warnings: domainWarnings,
    result: available ? domain : null,
    command: asString(value.command ?? domain.command, 'audit'),
    exitCode,
    error: unavailableError,
  };
}

const QUALITY_MODES = new Set<StructuralQualityMode>(['off', 'observe', 'gate', 'unknown']);
const QUALITY_STATUSES = new Set<StructuralQualityStatus>(['PASS', 'FAIL', 'BLOCKED', 'NOT_OBSERVED', 'UNKNOWN']);

function normalizeQualityMode(value: unknown): StructuralQualityMode {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  return QUALITY_MODES.has(normalized as StructuralQualityMode) ? normalized as StructuralQualityMode : 'unknown';
}

function normalizeQualityStatus(value: unknown): StructuralQualityStatus {
  const normalized = typeof value === 'string' ? value.toUpperCase() : '';
  return QUALITY_STATUSES.has(normalized as StructuralQualityStatus) ? normalized as StructuralQualityStatus : 'UNKNOWN';
}

function qualityPart(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

export function unavailableStructuralQuality(taskId: string | null = null, message = 'Canonical structural quality is unavailable.'): StructuralQualityAuditView {
  return {
    available: false,
    source: 'UNAVAILABLE',
    taskId,
    mode: 'unknown',
    provider: null,
    baseline: { status: 'UNKNOWN', qualitySignal: null, artifactRef: null, fingerprint: null },
    current: { status: 'UNKNOWN', verificationCycle: null, attempt: null, qualitySignal: null, delta: null, bottleneck: null, artifactRef: null },
    comparable: null,
    completionRequired: false,
    reasonCodes: [],
    next: null,
    evidenceKind: null,
    error: { code: 'E_STRUCTURAL_QUALITY_UNAVAILABLE', message },
  };
}

export function normalizeStructuralQuality(value: unknown, expectedTaskId?: string): StructuralQualityAuditView {
  if (!isRecord(value)) return unavailableStructuralQuality(expectedTaskId ?? null);
  const domain = isRecord(value.data) ? value.data : value;
  const taskId = asNullableString(domain.taskId) ?? expectedTaskId ?? null;
  const canonicalError = normalizeError(domain.error, 'E_STRUCTURAL_QUALITY_UNAVAILABLE');
  const baseline = qualityPart(domain.baseline);
  const current = qualityPart(domain.current);
  const available = domain.available !== false && canonicalError === null;
  const error = available ? null : projectionError(canonicalError, 'E_STRUCTURAL_QUALITY_UNAVAILABLE', 'Canonical structural quality is unavailable.');
  return {
    available,
    source: available ? 'FORGELOOP_INTEGRATION' : 'UNAVAILABLE',
    taskId,
    mode: normalizeQualityMode(domain.mode),
    provider: asNullableString(domain.provider ?? domain.providerId),
    baseline: {
      status: asString(baseline.status, 'UNKNOWN'),
      qualitySignal: asFiniteNumber(baseline.qualitySignal ?? baseline.signal ?? baseline.score),
      artifactRef: asNullableString(baseline.artifactRef ?? baseline.artifact ?? baseline.ref),
      fingerprint: asNullableString(baseline.fingerprint),
    },
    current: {
      status: normalizeQualityStatus(current.status ?? domain.status),
      verificationCycle: asFiniteNumber(current.verificationCycle ?? current.cycle),
      attempt: asFiniteNumber(current.attempt),
      qualitySignal: asFiniteNumber(current.qualitySignal ?? current.signal ?? current.score),
      delta: asFiniteNumber(current.delta),
      bottleneck: asNullableString(current.bottleneck),
      artifactRef: asNullableString(current.artifactRef ?? current.artifact ?? current.ref),
    },
    comparable: asBooleanOrNull(domain.comparable),
    completionRequired: domain.completionRequired === true,
    reasonCodes: stringArray(domain.reasonCodes),
    next: asNullableString(domain.next),
    evidenceKind: asNullableString(domain.evidenceKind),
    error,
  };
}
