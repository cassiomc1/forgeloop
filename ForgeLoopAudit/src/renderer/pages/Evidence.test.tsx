import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TaskAttestationView, VerificationScopeView } from '@shared/domain';
import { AttestationCard, VerificationScopeCard } from './Evidence';

const scope = (requestedMode: VerificationScopeView['requestedMode'], resolvedMode: VerificationScopeView['resolvedMode']): VerificationScopeView => ({
  available: true,
  source: 'FORGELOOP_INTEGRATION',
  requestedMode,
  resolvedMode,
  verificationCycle: 1,
  changedPaths: ['src/cart.ts'],
  claimedPaths: ['src/cart.ts'],
  selectedPaths: ['src/cart.ts'],
  reasons: ['Canonical changed paths'],
  fallback: null,
  fingerprint: 'a'.repeat(64),
  checkerCapabilityFingerprint: 'b'.repeat(64),
  createdAt: '2026-08-20T10:00:00.000Z',
  error: null,
});

const attestation = (status: TaskAttestationView['status'], level: TaskAttestationView['level']): TaskAttestationView => ({
  available: true,
  source: 'FORGELOOP_INTEGRATION',
  status,
  level,
  content: 'VALID',
  receipt: 'VALID',
  ledger: 'VALID',
  signature: 'UNSIGNED',
  signer: { provider: 'none' },
  files: 1,
  subject: 'TASK-001',
  errors: status === 'INVALID' ? [{ code: 'E_ATTESTATION_INVALID', message: 'Canonical attestation is invalid.' }] : [],
});

describe('Evidence boundary presentation', () => {
  it('renders requested and resolved verification modes without an IMPACTED mode', () => {
    for (const mode of ['AUTO', 'CHANGED', 'CLAIMED', 'FULL'] as const) {
      const html = renderToStaticMarkup(createElement(VerificationScopeCard, { scope: scope(mode, mode === 'AUTO' ? 'CHANGED' : mode) }));
      expect(html).toContain(mode);
    }
    const html = renderToStaticMarkup(createElement(VerificationScopeCard, { scope: scope('AUTO', 'CHANGED') }));
    expect(html).toContain('not revision-range attestation coverage');
    expect(html).not.toContain('IMPACTED');
  });

  it('renders canonical UNRESOLVED as a warning without changing the requested mode', () => {
    const html = renderToStaticMarkup(createElement(VerificationScopeCard, { scope: scope('AUTO', 'UNRESOLVED') }));
    expect(html).toContain('AUTO');
    expect(html).toContain('UNRESOLVED');
    expect(html).toContain('could not resolve a verification scope');
  });

  it('keeps attestation levels separate and exposes invalid errors without trust overclaims', () => {
    for (const level of ['PROCESSED', 'VERIFIED', 'ATTESTED'] as const) {
      const html = renderToStaticMarkup(createElement(AttestationCard, { attestation: attestation('VALID', level) }));
      expect(html).toContain(level);
    }
    const invalidHtml = renderToStaticMarkup(createElement(AttestationCard, { attestation: attestation('INVALID', 'PROCESSED') }));
    expect(invalidHtml).toContain('E_ATTESTATION_INVALID');
    expect(invalidHtml).toContain('does not claim security, authorship, or bug-free code');
  });
});
