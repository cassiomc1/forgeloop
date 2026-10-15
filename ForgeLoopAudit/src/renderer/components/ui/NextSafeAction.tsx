import { useState } from 'react';
import type { TaskSummary } from '@shared/domain';
import { cn, getNextActionColor } from '../../lib/utils';
import { Zap, AlertTriangle, RefreshCw, XCircle, Copy, Check, ShieldAlert } from 'lucide-react';

interface NextSafeActionProps {
  task: TaskSummary;
}

function CommandSynopsis({ synopsis }: { synopsis: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(synopsis);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable; the text remains visible for manual copy.
    }
  };

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 bg-forge-secondary-surface rounded-6">
      <code className="text-[11px] font-mono text-forge-text-secondary break-all flex-1 select-text">{synopsis}</code>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy command"
        title="Copy command (does not execute)"
        className="p-1 rounded-4 text-forge-text-muted hover:text-forge-text-primary transition-colors shrink-0"
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  );
}

export function NextSafeAction({ task }: NextSafeActionProps) {
  if (!task.nextAction) {
    return (
      <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
        <h3 className="text-xs font-semibold text-forge-text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4" />
          Next Safe Action
        </h3>
        <p className="text-sm text-forge-text-muted">No action available</p>
        {task.operationalState === 'RECOVERY_RESUME_REQUIRED' && (
          <p className="text-xs text-forge-warning mt-2 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5" />
            This task was recovered. Resume is required through ForgeLoop before any action applies.
          </p>
        )}
      </div>
    );
  }

  const getActionIcon = (type: string) => {
    switch (type) {
      case 'progress':
        return <Zap className="w-4 h-4" />;
      case 'recovery':
        return <RefreshCw className="w-4 h-4" />;
      case 'blocker':
        return <XCircle className="w-4 h-4" />;
      case 'inconsistency':
        return <AlertTriangle className="w-4 h-4" />;
      default:
        return <Zap className="w-4 h-4" />;
    }
  };

  const resumeRequired = task.recovery?.resumeRequired === true || task.operationalState === 'RECOVERY_RESUME_REQUIRED';

  return (
    <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
      <h3 className="text-xs font-semibold text-forge-text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
        <Zap className="w-4 h-4" />
        Next Safe Action
      </h3>
      <div className="space-y-2">
        <div className={cn('flex items-start gap-3 p-3 rounded-8', {
          'bg-forge-accent/5': task.nextAction.type === 'progress',
          'bg-forge-warning/5': task.nextAction.type === 'recovery' || resumeRequired,
          'bg-forge-danger/5': task.nextAction.type === 'blocker' || task.nextAction.type === 'inconsistency',
        })}>
          <div className={cn('mt-0.5', getNextActionColor(task.nextAction.type))}>
            {getActionIcon(task.nextAction.type)}
          </div>
          <div className="flex-1 min-w-0">
            <p className={cn('text-sm font-medium', getNextActionColor(task.nextAction.type))}>
              {task.nextAction.action}
            </p>
            {task.nextAction.expectedPhase && (
              <p className="text-xs text-forge-text-muted mt-1">
                Expected next phase: <span className="font-medium text-forge-text-secondary">{task.nextAction.expectedPhase}</span>
              </p>
            )}
            {task.nextAction.details && (
              <p className="text-xs text-forge-text-muted mt-1">{task.nextAction.details}</p>
            )}
          </div>
        </div>

        {resumeRequired && (
          <p className="text-xs text-forge-warning flex items-start gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            This task was recovered and mutations stay blocked until the canonical ForgeLoop resume is performed by an authorized harness. The ForgeLoopAudit only displays this requirement.
          </p>
        )}

        {task.nextAction.commandSynopses && task.nextAction.commandSynopses.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <p className="text-[11px] text-forge-text-muted">
              Canonical next commands (copy only — the ForgeLoopAudit never executes ForgeLoop mutations):
            </p>
            {task.nextAction.commandSynopses.map((synopsis) => (
              <CommandSynopsis key={synopsis} synopsis={synopsis} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
