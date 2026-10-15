import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ForgeLoopPhase } from '@shared/domain';
import { cn } from '../../lib/utils';
import { CheckCircle, AlertTriangle, Circle, XCircle } from 'lucide-react';

interface FlowNodeData {
  label: string;
  phase: ForgeLoopPhase;
  state: 'completed' | 'current' | 'pending' | 'blocked' | 'failed';
  hasEvents?: boolean;
  taskId: string;
}

export const FlowNode = memo(({ data, selected }: NodeProps) => {
  const getStateConfig = (state: string) => {
    switch (state) {
      case 'completed':
        return {
          bg: 'bg-forge-success/10',
          border: 'border-forge-success/30',
          text: 'text-forge-success',
          icon: <CheckCircle className="w-4 h-4" />,
          pulse: false,
        };
      case 'current':
        return {
          bg: 'bg-forge-accent/10',
          border: 'border-forge-accent/50',
          text: 'text-forge-accent',
          icon: <Circle className="w-4 h-4 fill-current" />,
          pulse: true,
        };
      case 'blocked':
        return {
          bg: 'bg-forge-danger/10',
          border: 'border-forge-danger/30',
          text: 'text-forge-danger',
          icon: <XCircle className="w-4 h-4" />,
          pulse: false,
        };
      case 'failed':
        return {
          bg: 'bg-forge-warning/10',
          border: 'border-forge-warning/30',
          text: 'text-forge-warning',
          icon: <AlertTriangle className="w-4 h-4" />,
          pulse: false,
        };
      default:
        return {
          bg: 'bg-forge-secondary-surface',
          border: 'border-forge-border-subtle',
          text: 'text-forge-text-muted',
          icon: <Circle className="w-4 h-4" />,
          pulse: false,
        };
    }
  };

  const nodeData = data as unknown as FlowNodeData;
  const config = getStateConfig(nodeData.state);

  return (
    <div
      className={cn(
        'px-4 py-3 rounded-10 border-2 transition-all duration-200 min-w-[140px]',
        config.bg,
        config.border,
        selected && 'ring-2 ring-forge-accent ring-offset-2 ring-offset-forge-background',
        config.pulse && 'animate-pulse-subtle'
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !bg-forge-border-strong !border-2 !border-forge-secondary-surface"
      />

      <div className="flex items-center gap-2">
        <span className={config.text}>{config.icon}</span>
        <span className={cn('text-xs font-semibold uppercase tracking-wider', config.text)}>
          {nodeData.label}
        </span>
      </div>

      {nodeData.hasEvents && (
        <div className="mt-1.5 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-forge-accent" />
          <span className="text-[10px] text-forge-text-muted">Events recorded</span>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !bg-forge-border-strong !border-2 !border-forge-secondary-surface"
      />
    </div>
  );
});

FlowNode.displayName = 'FlowNode';
