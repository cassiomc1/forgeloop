import { useEffect, useState } from 'react';
import type { ForgeLoopFeatureSupport, TaskHandoffsView } from '@shared/domain';
import { Archive, CircleHelp } from 'lucide-react';
import { HandoffAcceptanceBadge, HandoffAcceptanceDetail } from './HandoffAcceptanceBadge';
import { auditApi } from '../../lib/audit-client';

interface CanonicalHandoffsPanelProps {
  taskId: string;
  featureSupport?: ForgeLoopFeatureSupport;
  handoffRefreshToken?: number;
}

function unavailable(advertised: boolean): TaskHandoffsView {
  return {
    available: false,
    source: 'UNAVAILABLE',
    count: null,
    handoffs: [],
    error: {
      code: 'E_FEATURE_UNAVAILABLE',
      message: advertised ? 'Canonical handoffs are unavailable.' : 'Canonical handoffs are not advertised by this ForgeLoop build.',
    },
  };
}

function compactHash(value: string | null): string {
  if (!value) return 'Not recorded';
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function recordString(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : 'Not recorded';
}

export function CanonicalHandoffsPanel({ taskId, featureSupport, handoffRefreshToken = 0 }: CanonicalHandoffsPanelProps) {
  const [handoffs, setHandoffs] = useState<TaskHandoffsView | null>(null);
  const advertised = featureSupport ? featureSupport.canonicalHandoffs === true : true;

  useEffect(() => {
    let cancelled = false;
    const api = auditApi;
    const read = advertised && typeof api?.getTaskHandoffs === 'function'
      ? api.getTaskHandoffs(taskId).catch(() => unavailable(true))
      : Promise.resolve(unavailable(advertised));
    read.then((result) => { if (!cancelled) setHandoffs(result); });
    return () => { cancelled = true; };
  }, [advertised, handoffRefreshToken, taskId]);

  return (
    <section className="rounded-10 border border-forge-border-subtle bg-forge-primary-surface p-4" aria-labelledby="canonical-handoffs-heading">
      <div className="flex items-center gap-2">
        <Archive className="h-4 w-4 text-forge-accent" />
        <h2 id="canonical-handoffs-heading" className="text-sm font-semibold text-forge-text-primary">Canonical Handoffs</h2>
        {handoffs && <span className="ml-auto text-xs text-forge-text-muted">{handoffs.available ? `${handoffs.count ?? 0} recorded` : 'Unavailable'}</span>}
      </div>
      <p className="mt-1 text-xs text-forge-text-muted">Immutable snapshots preserved by ForgeLoop for continuity between authorized harnesses.</p>
      {!handoffs ? <p className="mt-4 text-sm text-forge-text-muted">Loading canonical handoffs…</p> : (
        <>
          {!handoffs.available ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-forge-warning"><CircleHelp className="h-4 w-4" />Canonical handoff snapshots are unavailable.</div>
          ) : handoffs.handoffs.length === 0 ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-forge-text-muted"><CircleHelp className="h-4 w-4" />No canonical handoff snapshots recorded.</div>
          ) : (
            <div className="mt-4 space-y-2">
              {handoffs.handoffs.slice(0, 10).map((handoff) => (
                <details key={handoff.handoffId || `${handoff.createdAt}-${handoff.revision}`} className="rounded-8 bg-forge-secondary-surface p-3">
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono text-forge-text-primary">{handoff.handoffId || 'Unnamed handoff'}</span>
                      <HandoffAcceptanceBadge acceptance={handoff.acceptance} />
                      <span className="text-forge-text-muted">{handoff.createdAt || 'Unknown time'}</span>
                      {handoff.phase && <span className="text-forge-text-muted">· {handoff.phase}</span>}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-forge-text-secondary md:grid-cols-4">
                      <span>Revision: <strong>{handoff.revision ?? 'Unknown'}</strong></span>
                      <span>Cycle: <strong>{handoff.verificationCycle ?? 'Unknown'}</strong></span>
                      <span>Recipient: <strong>{handoff.recipientHint || 'Not recorded'}</strong></span>
                      <span>Digest: <strong className="font-mono">{compactHash(handoff.digest)}</strong></span>
                    </div>
                  </summary>
                  <div className="mt-3 space-y-2 border-t border-forge-border-subtle/60 pt-3 text-xs text-forge-text-secondary">
                    {handoff.note && <p>Actor note: {handoff.note}</p>}
                    <HandoffAcceptanceDetail acceptance={handoff.acceptance} />
                    <p>Write claims: {Array.isArray(handoff.state?.writeClaims) && handoff.state.writeClaims.length > 0 ? handoff.state.writeClaims.join(', ') : 'None recorded'}</p>
                    <p>Changed paths: {Array.isArray(handoff.state?.changedPaths) && handoff.state.changedPaths.length > 0 ? handoff.state.changedPaths.join(', ') : 'None recorded'}</p>
                    <p>Execution references: {Array.isArray(handoff.evidence?.executionRefs) && handoff.evidence.executionRefs.length > 0 ? handoff.evidence.executionRefs.join(', ') : 'None recorded'}</p>
                    <p>Check IDs: {Array.isArray(handoff.evidence?.checkIds) && handoff.evidence.checkIds.length > 0 ? handoff.evidence.checkIds.join(', ') : 'None recorded'}</p>
                    <p>Continuity: {recordString(handoff.continuity?.ref)}</p>
                  </div>
                </details>
              ))}
            </div>
          )}
          {handoffs.error && <p className="mt-3 text-xs text-forge-warning">{handoffs.error.code}: {handoffs.error.message}</p>}
        </>
      )}
      <p className="mt-4 border-t border-forge-border-subtle/60 pt-3 text-[11px] text-forge-text-muted">Immutable protocol snapshot — not review, completion, delegation, or authority evidence.</p>
    </section>
  );
}
