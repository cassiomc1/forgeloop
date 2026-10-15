import type { AuditUxTimelineItemView, TaskAuditViewProjection } from '@shared/domain';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function boundedNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function projectTimelineItem(raw: unknown): AuditUxTimelineItemView | null {
  const record = asRecord(raw);
  if (!record || typeof record.kind !== 'string') return null;
  return {
    id: typeof record.id === 'string' ? record.id : `seq-${String(record.sequence ?? '')}`,
    sequence: boundedNumber(record.sequence) ?? 0,
    timestamp: nullableString(record.timestamp),
    timestampQuality: record.timestampQuality === 'authoritative' ? 'authoritative' : 'unknown',
    kind: record.kind,
    phase: nullableString(record.phase),
    status: nullableString(record.status),
    title: typeof record.title === 'string' ? record.title : record.kind,
    summary: typeof record.summary === 'string' ? record.summary : '',
    category: typeof record.category === 'string' ? record.category : 'LIFECYCLE',
  };
}

/**
 * Normalize the canonical `task/audit-view` projection for presentation.
 *
 * The Audit UX read model is a bounded, read-only composition of canonical
 * ForgeLoop projections; it is never a second lifecycle, evidence, ownership,
 * or completion authority. Unknown future fields degrade safely: they are
 * ignored rather than reinterpreted, and a malformed payload yields an
 * `available: false` projection instead of partial authority-shaped data.
 */
export function projectAuditView(raw: unknown): TaskAuditViewProjection {
  const data = asRecord(raw);
  if (!data || data.readOnly !== true) {
    return { available: false, authority: 'UNAVAILABLE', reason: 'Audit UX projection is missing its read-only contract.' };
  }
  const authority = asRecord(data.authority);
  if (
    !authority
    || authority.lifecycleAuthority !== false
    || authority.evidenceAuthority !== false
    || authority.completionAuthority !== false
    || authority.mutationAuthority !== false
    || authority.externalExecution !== false
  ) {
    return { available: false, authority: 'UNAVAILABLE', reason: 'Audit UX projection did not declare a non-authoritative boundary.' };
  }

  const health = asRecord(data.health);
  const lifecycle = asRecord(data.lifecycle);
  const verification = asRecord(data.verification);
  const completion = asRecord(data.completion);
  const ownership = asRecord(data.ownership);
  const integrity = asRecord(data.integrity);
  const timeline = asRecord(data.timeline);
  const rawItems = timeline && Array.isArray(timeline.items) ? timeline.items : [];

  const projection: TaskAuditViewProjection = {
    available: true,
    authority: 'CANONICAL_READ_ONLY',
    schemaVersion: boundedNumber(data.schemaVersion),
    auditStatus: nullableString(health?.auditStatus) ?? (integrity ? nullableString(integrity.auditStatus) : null) ?? undefined,
    phase: nullableString(lifecycle?.phase) ?? nullableString(health?.phase),
    status: nullableString(lifecycle?.status),
    nextAction: nullableString(lifecycle?.nextAction) ?? nullableString(health?.currentNextAction),
    terminal: lifecycle?.terminal === true,
  };

  if (typeof completion?.state === 'string') {
    projection.completion = {
      state: completion.state,
      valid: completion.valid === true,
    };
  }
  if (ownership) {
    projection.ownership = {
      claimState: nullableString(ownership.claimState),
      mutationAllowed: ownership.mutationAllowed === true,
      ownershipValid: ownership.ownershipValid === true,
    };
  }
  if (verification) {
    projection.verification = {
      checkCount: boundedNumber(verification.checkCount) ?? 0,
      totalAttempts: boundedNumber(verification.totalAttempts) ?? 0,
      failedAttempts: boundedNumber(verification.failedAttempts) ?? 0,
    };
  }
  if (integrity) {
    projection.integrity = {
      valid: integrity.valid === true,
      reasonCodes: stringList(integrity.reasonCodes),
    };
  }

  const items = rawItems
    .map(projectTimelineItem)
    .filter((item): item is AuditUxTimelineItemView => item !== null);
  projection.timeline = {
    totalAvailable: boundedNumber(timeline?.totalAvailable) ?? items.length,
    truncated: timeline?.truncated === true,
    items,
  };

  return projection;
}
