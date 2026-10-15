import type { EvidenceCoverageSummary } from '@shared/domain';

export function formatEvidenceSummary(summary: Pick<EvidenceCoverageSummary, 'covered' | 'partial' | 'notVerified' | 'blocked'>): string {
  const parts = [
    summary.covered > 0 ? `${summary.covered} covered` : '',
    summary.partial > 0 ? `${summary.partial} partial` : '',
    summary.notVerified > 0 ? `${summary.notVerified} not verified` : '',
    summary.blocked > 0 ? `${summary.blocked} blocked` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'No evidence recorded';
}
