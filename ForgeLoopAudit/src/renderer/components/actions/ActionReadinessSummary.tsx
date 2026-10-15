import type { ActionReadinessSummary as Readiness } from '@shared/domain';
import { MetricCard } from '../ui/MetricCard';
import { AlertTriangle, CheckCircle, Clock, ListChecks, ShieldAlert, XCircle } from 'lucide-react';

function display(value: number | null | undefined): string | number {
  return value === null || value === undefined ? 'Unknown' : value;
}

export function ActionReadinessSummary({ readiness, actionCount, pendingCount }: { readiness: Readiness | null; actionCount: number; pendingCount: number }) {
  const trusted = readiness?.satisfied ?? null;
  const unresolved = readiness?.unresolved ?? null;
  const failed = readiness?.failed ?? null;
  const ambiguous = readiness?.ambiguous ?? null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
      <MetricCard label="Total" value={display(readiness?.total ?? actionCount)} icon={<ListChecks className="w-4 h-4" />} color="info" />
      <MetricCard label="Trusted satisfied" value={display(trusted)} icon={<CheckCircle className="w-4 h-4" />} color="success" />
      <MetricCard label="Unresolved required" value={display(unresolved)} icon={<ShieldAlert className="w-4 h-4" />} color="warning" alert={unresolved !== null && unresolved > 0} />
      <MetricCard label="Failed" value={display(failed)} icon={<XCircle className="w-4 h-4" />} color="danger" alert={failed !== null && failed > 0} />
      <MetricCard label="Ambiguous" value={display(ambiguous)} icon={<AlertTriangle className="w-4 h-4" />} color="danger" alert={ambiguous !== null && ambiguous > 0} />
      <MetricCard label="Pending state" value={pendingCount} icon={<Clock className="w-4 h-4" />} color="warning" />
      <MetricCard label="Readiness source" value={readiness?.source === 'FORGELOOP_INTEGRATION' ? 'Canonical' : 'Unavailable'} icon={<ShieldAlert className="w-4 h-4" />} color="accent" />
    </div>
  );
}
