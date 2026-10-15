import { Gauge, Info, ShieldCheck } from 'lucide-react';
import type { ExecutionProfileContextView, TrajectoryMetricsView } from '@shared/domain';
import { cn } from '../../lib/utils';
import { Provenance } from '../ui/Provenance';

interface ExecutionProfilePanelProps {
  context: ExecutionProfileContextView | null;
  metrics: TrajectoryMetricsView | null;
  observedAt: string;
}

function displayProfile(value: string | null): string {
  return value ? value.toUpperCase() : 'NOT AVAILABLE';
}

function displayBoolean(value: boolean | null): string {
  return value === null ? 'NOT AVAILABLE' : value ? 'YES' : 'NO';
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function measuredValue(value: unknown, suffix = ''): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString() + suffix
    : 'NOT MEASURED';
}

function usageFrom(context: ExecutionProfileContextView | null, metrics: TrajectoryMetricsView | null) {
  if (context?.usage) return context.usage;
  const metricsRecord = recordValue(metrics?.metrics);
  const usage = recordValue(metricsRecord?.usage);
  if (!usage) return null;
  return {
    source: typeof usage.source === 'string' ? usage.source as 'PROVIDER_REPORTED' | 'HOST_REPORTED' | 'ACTOR_REPORTED' | 'UNKNOWN' : 'UNKNOWN',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    costUsd: usage.costUsd,
    model: typeof usage.model === 'string' ? usage.model : null,
    provider: typeof usage.provider === 'string' ? usage.provider : null,
  };
}

export function ExecutionProfilePanel({ context, metrics, observedAt }: ExecutionProfilePanelProps) {
  if (!context) {
    return (
      <section className="rounded-10 border border-forge-border-subtle bg-forge-primary-surface p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-forge-text-primary">
          <Gauge className="h-4 w-4 text-forge-accent" />
          Execution Profile
        </div>
        <p className="mt-3 text-sm text-forge-text-muted">Loading canonical task/context…</p>
      </section>
    );
  }

  const usage = usageFrom(context, metrics);
  const metricsRecord = recordValue(metrics?.metrics);
  const timing = recordValue(metricsRecord?.timing);
  const comparison = recordValue(metricsRecord?.comparison ?? metricsRecord?.baselineComparison);
  const policy = context.contextPolicy;

  return (
    <section className={cn(
      'rounded-10 border bg-forge-primary-surface p-4',
      context.status === 'UNAVAILABLE' ? 'border-forge-warning/40' : 'border-forge-border-subtle',
    )}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-forge-text-primary">
            <Gauge className="h-4 w-4 text-forge-accent" />
            Execution Profile
          </h2>
          <p className="mt-1 text-xs text-forge-text-muted">
            Canonical resolution and bounded context policy for the selected task.
          </p>
        </div>
        <span className={cn(
          'rounded-6 px-2 py-1 text-[11px] font-medium',
          context.status === 'CANONICAL'
            ? 'bg-forge-success/10 text-forge-success'
            : context.status === 'COMPATIBILITY_FALLBACK'
              ? 'bg-forge-info/10 text-forge-info'
              : 'bg-forge-warning/10 text-forge-warning',
        )}>
          {context.status === 'CANONICAL' ? 'CANONICAL' : context.status === 'COMPATIBILITY_FALLBACK' ? 'BALANCED COMPATIBILITY' : 'UNAVAILABLE'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Requested', displayProfile(context.executionProfile.requested)],
          ['Safety floor', displayProfile(context.executionProfile.floor)],
          ['Resolved', displayProfile(context.executionProfile.resolved)],
          ['Escalated', displayBoolean(context.executionProfile.escalated)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-8 bg-forge-secondary-surface p-3">
            <span className="text-[11px] uppercase tracking-wide text-forge-text-muted">{label}</span>
            <p className={cn('mt-1 text-sm font-semibold', label === 'Resolved' ? 'text-forge-accent' : 'text-forge-text-primary')}>{value}</p>
          </div>
        ))}
      </div>

      {context.executionProfile.reasons.length > 0 && (
        <p className="mt-3 text-xs text-forge-text-muted">
          Resolution reasons: {context.executionProfile.reasons.join(', ')}
        </p>
      )}

      {policy && (
        <div className="mt-4 rounded-8 border border-forge-border-subtle/70 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-forge-text-muted">Context policy</h3>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs md:grid-cols-3">
            <PolicyValue label="Depth" value={policy.contextDepth} />
            <PolicyValue label="Output" value={policy.output} />
            <PolicyValue label="Plan" value={policy.planDepth} />
            <PolicyValue label="Guides" value={policy.guideStrategy} />
            <PolicyValue label="Verification" value={policy.verificationStrategy} />
            <PolicyValue label="Optional artifacts" value={policy.optionalArtifacts} />
          </div>
          <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
            <ListValue label="Required sections" values={policy.requiredSections} />
            <ListValue label="Excluded context" values={policy.excludedContext} />
          </div>
        </div>
      )}

      <div className="mt-4 rounded-8 border border-forge-border-subtle/70 p-3">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-forge-text-muted">
          <ShieldCheck className="h-3.5 w-3.5" />
          Efficiency telemetry
        </h3>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <PolicyValue label="Usage source" value={usage?.source ?? 'NOT MEASURED'} />
          <PolicyValue label="Total tokens" value={measuredValue(usage?.totalTokens)} />
          <PolicyValue label="Input tokens" value={measuredValue(usage?.inputTokens)} />
          <PolicyValue label="Output tokens" value={measuredValue(usage?.outputTokens)} />
          <PolicyValue label="Wall clock" value={measuredValue(timing?.wallClockMs, ' ms')} />
          <PolicyValue label="Provider" value={usage?.provider ?? 'NOT MEASURED'} />
          <PolicyValue label="Model" value={usage?.model ?? 'NOT MEASURED'} />
          <PolicyValue label="Baseline comparison" value={comparison ? 'AVAILABLE' : 'NOT MEASURED'} />
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-forge-text-muted">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          Missing provider, host, or compatible baseline data is shown as NOT MEASURED; it is never treated as zero.
        </p>
      </div>

      {context.status === 'UNAVAILABLE' && context.error && (
        <p className="mt-3 text-xs text-forge-warning">{context.error.code}: {context.error.message}</p>
      )}
      {context.status === 'COMPATIBILITY_FALLBACK' && context.error && (
        <p className="mt-3 text-xs text-forge-text-muted">{context.error.message}</p>
      )}
      <div className="mt-3">
        <Provenance
          source={context.source === 'FORGELOOP_INTEGRATION' ? 'ForgeLoop task/context' : 'Compatibility projection'}
          authority={context.source === 'FORGELOOP_INTEGRATION' ? 'FORGELOOP' : 'AUDIT_OBSERVATION'}
          observedAt={observedAt}
        />
      </div>
    </section>
  );
}

function PolicyValue({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <span className="text-forge-text-muted">{label}</span>
      <p className="mt-1 truncate text-forge-text-primary">{value}</p>
    </div>
  );
}

function ListValue({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <span className="text-forge-text-muted">{label}</span>
      <p className="mt-1 text-forge-text-primary">{values.length > 0 ? values.join(' · ') : 'None'}</p>
    </div>
  );
}
