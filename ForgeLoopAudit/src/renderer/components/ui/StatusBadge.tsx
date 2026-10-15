import { cn } from '../../lib/utils';
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  Info,
} from 'lucide-react';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export function StatusBadge({ status, size = 'sm', showLabel = true }: StatusBadgeProps) {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'VALID':
        return { icon: <CheckCircle className="w-3 h-3" />, color: 'status-badge-success', label: 'Valid' };
      case 'INCOMPLETE':
        return { icon: <Clock className="w-3 h-3" />, color: 'status-badge-warning', label: 'Incomplete' };
      case 'STALE':
        return { icon: <AlertTriangle className="w-3 h-3" />, color: 'status-badge-warning', label: 'Stale' };
      case 'INCONSISTENT':
        return { icon: <XCircle className="w-3 h-3" />, color: 'status-badge-danger', label: 'Inconsistent' };
      case 'INVALID':
        return { icon: <XCircle className="w-3 h-3" />, color: 'status-badge-danger', label: 'Invalid' };
      default:
        return { icon: <Info className="w-3 h-3" />, color: 'status-badge-neutral', label: status };
    }
  };

  const config = getStatusConfig(status);
  const sizeClasses = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <span className={cn(config.color, sizeClasses)}>
      {config.icon}
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}