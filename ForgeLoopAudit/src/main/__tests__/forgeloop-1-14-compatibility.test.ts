import { describe, expect, it } from 'vitest';
import { projectAuditView } from '@main/core/integration/audit-ux-projection';
import { normalizeCanonicalProtocolInfo, negotiateCompatibilityMode } from '@main/core/protocol/protocol-capabilities';
import { eventTone, matchesEventFilter, EVENT_TONE_CLASS } from '@renderer/lib/event-presentation';
import type { ForgeLoopCapabilitiesSummary } from '@main/core/integration/types';

describe('Audit UX read model projection', () => {
  it('projects the canonical bounded view without inventing authority', () => {
    const projection = projectAuditView(validAuditView());
    expect(projection.available).toBe(true);
    expect(projection.authority).toBe('CANONICAL_READ_ONLY');
    expect(projection.auditStatus).toBe('VALID');
    expect(projection.phase).toBe('COMPLETE');
    expect(projection.completion).toEqual({ state: 'INCOMPLETE', valid: false });
    expect(projection.ownership).toEqual({ claimState: 'RELEASED_BY_COMPLETION', mutationAllowed: false, ownershipValid: true });
    expect(projection.integrity?.valid).toBe(true);
    expect(projection.timeline?.items.map((item) => item.kind)).toEqual(['TASK_RECEIVED', 'TASK_ABANDONED']);
  });

  it('fails closed when the projection claims lifecycle authority', () => {
    const escalating = validAuditView();
    (escalating.authority as Record<string, unknown>).lifecycleAuthority = true;
    const projection = projectAuditView(escalating);
    expect(projection.available).toBe(false);
    expect(projection.authority).toBe('UNAVAILABLE');
  });

  it('fails closed when the read-only contract is missing', () => {
    expect(projectAuditView(validAuditView({ readOnly: false })).available).toBe(false);
  });

  it('degrades safely on malformed or unknown payloads', () => {
    expect(projectAuditView(null).available).toBe(false);
    expect(projectAuditView('nope').available).toBe(false);
    expect(projectAuditView({ readOnly: true }).available).toBe(false);
  });

  it('keeps unknown timeline entries instead of dropping the projection', () => {
    const view = validAuditView();
    (view.timeline as Record<string, unknown>).items = [
      { id: 'x', sequence: 9, timestamp: null, timestampQuality: 'unknown', kind: 'FUTURE_CANONICAL_EVENT', title: 'Future event', summary: '', category: 'LIFECYCLE' },
      { sequence: 10, details: 'malformed' },
    ];
    const projection = projectAuditView(view);
    expect(projection.available).toBe(true);
    expect(projection.timeline?.items).toHaveLength(1);
    expect(projection.timeline?.items[0].kind).toBe('FUTURE_CANONICAL_EVENT');
    expect(projection.timeline?.items[0].timestampQuality).toBe('unknown');
  });
});

function validAuditView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId: 'TASK-001',
    readOnly: true,
    authority: {
      readOnly: true,
      lifecycleAuthority: false,
      evidenceAuthority: false,
      completionAuthority: false,
      mutationAuthority: false,
      externalExecution: false,
    },
    health: { phase: 'COMPLETE', auditStatus: 'VALID', ownershipValid: true, claimState: 'RELEASED_BY_COMPLETION', currentNextAction: null },
    lifecycle: { phase: 'COMPLETE', status: null, nextAction: null, terminal: true },
    timeline: {
      items: [
        { id: 'e1', sequence: 1, timestamp: '2026-08-01T09:00:00.000Z', timestampQuality: 'authoritative', kind: 'TASK_RECEIVED', phase: 'RECEIVED', status: null, title: 'Task received', summary: 'Task created', category: 'LIFECYCLE' },
        { id: 'e2', sequence: 2, timestamp: '2026-08-01T09:07:00.000Z', timestampQuality: 'authoritative', kind: 'TASK_ABANDONED', phase: 'PLANNED', status: null, title: 'Task abandoned', summary: 'CALLER_ABANDONED', category: 'RECOVERY' },
      ],
      totalAvailable: 2,
      truncated: false,
    },
    verification: { checks: [], checkCount: 0, totalAttempts: 0, failedAttempts: 0 },
    ownership: { claimState: 'RELEASED_BY_COMPLETION', ownershipValid: true, mutationAllowed: false },
    diagnostics: { legacyDiagnosisCount: 0, cases: [], caseCount: 0, interventionCount: 0, dispositionCount: 0, invalidRevisionCount: 0 },
    completion: { state: 'INCOMPLETE', valid: false, requirementsSatisfied: false, claimsReleased: false, publicationStatus: null, productionReadiness: null, reasonCodes: [], coverage: [] },
    integrity: { valid: true, auditStatus: 'VALID', traceValid: true, historyValid: true, reasonCodes: [] },
    history: { quality: 'COMPLETE', totalEventCount: 2, returnedEventCount: 2, truncated: false },
    actions: { total: 0, byState: {}, byCapability: {}, required: 0, ambiguous: 0, failed: 0, verified: 0, trustedSatisfied: 0, untrustedRequired: 0, repeatedIdempotencyAttempts: 0, reconciliationCount: 0, eventCount: 0, bounded: true },
    approvals: [],
    recovery: { active: false, status: null, events: [] },
    links: { status: 'task/status', ownership: 'task/ownership', contract: 'task/contract', auditView: 'task/audit-view' },
    ...overrides,
  };
}

describe('providerExtensions capability advertisement', () => {
  const baseInfo = {
    packageVersion: '1.14.0',
    compatibility: { protocolVersion: 1, schemaVersion: 1 },
  };
  const providerExtensions = {
    version: 1,
    supported: true,
    providerNeutral: true,
    maturity: 'experimental',
    publicRegistryApi: false,
    packageSubpathExported: false,
    autoInstall: false,
    lifecycleAuthority: false,
    completionAuthority: false,
    evidenceAuthority: false,
    providerKinds: ['ADVISORY_CONTEXT', 'BROWSER_VERIFICATION', 'SECURITY_REVIEW', 'PRESENTATION'],
    resultBoundary: 'STRICT_JSON_SNAPSHOT',
    cancellation: 'COOPERATIVE_ABORT_SIGNAL',
  };
  const coreCapabilities = {
    packageVersion: '1.14.0',
    protocolVersion: 1,
    integrationApiVersion: 1,
    executorParity: true,
    features: { taskClaimRecovery: { version: 1, durableRecoveryState: true, explicitResume: true, validatedClaimProjection: true } },
    resources: ['protocol/info', 'project/tasks', 'task/status', 'task/ownership', 'task/contract', 'task/continuity'],
    commands: [],
  } as unknown as ForgeLoopCapabilitiesSummary;

  it('recognises the v1 provider-neutral advertisement with observation kinds', () => {
    const info = normalizeCanonicalProtocolInfo({ ...baseInfo, features: { providerExtensions } });
    expect(info?.providerExtensions?.version).toBe(1);
    expect(info?.providerExtensions?.providerKinds).toContain('SECURITY_REVIEW');
    const result = negotiateCompatibilityMode({ protocolInfo: info, capabilities: coreCapabilities });
    expect(result.mode).toBe('INTEGRATION_V1');
    expect(result.featureSupport.providerExtensions).toBe(true);
  });

  it('degrades an authority-escalating advertisement to unavailable', () => {
    const info = normalizeCanonicalProtocolInfo({
      ...baseInfo,
      features: { providerExtensions: { ...providerExtensions, evidenceAuthority: true } },
    });
    expect(info?.providerExtensions).toBeNull();
    const result = negotiateCompatibilityMode({ protocolInfo: info, capabilities: coreCapabilities });
    expect(result.mode).toBe('INTEGRATION_V1');
    expect(result.featureSupport.providerExtensions).toBe(false);
  });

  it('ignores an auto-installing advertisement', () => {
    const info = normalizeCanonicalProtocolInfo({
      ...baseInfo,
      features: { providerExtensions: { ...providerExtensions, autoInstall: true } },
    });
    expect(info?.providerExtensions).toBeNull();
  });

  it('fails safe for future versions while remaining forward compatible', () => {
    const info = normalizeCanonicalProtocolInfo({
      ...baseInfo,
      features: { providerExtensions: { ...providerExtensions, version: 2, providerKinds: [...providerExtensions.providerKinds, 'FUTURE_KIND'] } },
    });
    const result = negotiateCompatibilityMode({ protocolInfo: info, capabilities: coreCapabilities });
    expect(result.mode).toBe('INTEGRATION_V1');
    expect(result.featureSupport.providerExtensions).toBe(false);
    expect(result.featureSupport.auditUx).toBe(false);
  });
});

describe('lifecycle event presentation', () => {
  it('never renders abandonment as completion', () => {
    expect(eventTone('TASK_ABANDONED')).toBe('warning');
    expect(eventTone('TASK_COMPLETED')).toBe('success');
    expect(EVENT_TONE_CLASS[eventTone('TASK_ABANDONED')]).not.toBe(EVENT_TONE_CLASS[eventTone('TASK_COMPLETED')]);
  });

  it('renders revisions and revalidations as provenance refreshes, not execution', () => {
    expect(eventTone('CONTRACT_REVISED')).toBe('accent');
    expect(eventTone('CHECKPOINT_REVALIDATED')).toBe('accent');
    expect(eventTone('CHECKPOINT_RECONCILED')).toBe('accent');
    expect(eventTone('CONTRACT_REVISED')).not.toBe(eventTone('TASK_COMPLETED'));
  });

  it('classifies unknown future events without guessing', () => {
    expect(eventTone('FUTURE_LIFECYCLE_EVENT')).toBe('neutral');
    expect(matchesEventFilter('FUTURE_LIFECYCLE_EVENT', 'all')).toBe(true);
  });

  it('includes abandonment, revision and revalidation in the lifecycle filter', () => {
    expect(matchesEventFilter('TASK_ABANDONED', 'lifecycle')).toBe(true);
    expect(matchesEventFilter('CONTRACT_REVISED', 'lifecycle')).toBe(true);
    expect(matchesEventFilter('CHECKPOINT_REVALIDATED', 'lifecycle')).toBe(true);
    expect(matchesEventFilter('CHECKPOINT_REVALIDATED', 'continuity')).toBe(true);
  });
});
