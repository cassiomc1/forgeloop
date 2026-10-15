import { cn } from '../../lib/utils';

interface MetricCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: 'accent' | 'success' | 'warning' | 'danger' | 'info';
  alert?: boolean;
}

const colorMap = {
  accent: 'text-forge-accent bg-forge-accent/10',
  success: 'text-forge-success bg-forge-success/10',
  warning: 'text-forge-warning bg-forge-warning/10',
  danger: 'text-forge-danger bg-forge-danger/10',
  info: 'text-forge-info bg-forge-info/10',
};

export function MetricCard({ label, value, icon, color, alert }: MetricCardProps) {
  return (
    <div className={cn('metric-card', alert && 'ring-1 ring-forge-danger/20')}>
      <div className="flex items-center justify-between mb-3">
        <span className="metric-label">{label}</span>
        <div className={cn('w-8 h-8 rounded-8 flex items-center justify-center', colorMap[color])}>
          {icon}
        </div>
      </div>
      <div className="metric-value">{value}</div>
    </div>
  );
}