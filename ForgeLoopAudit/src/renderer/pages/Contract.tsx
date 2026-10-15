import { useState, useEffect } from 'react';
import { ProjectSnapshot, TaskSummary } from '@shared/domain';
import { EmptyState } from '../components/ui/EmptyState';
import { cn } from '../lib/utils';
import { auditApi } from '../lib/audit-client';

interface ContractProps {
  snapshot: ProjectSnapshot;
  selectedTaskId?: string | null;
  onSelectedTaskChange?: (taskId: string) => void;
}

export function Contract({ snapshot, selectedTaskId, onSelectedTaskChange }: ContractProps) {
  const [selectedTask, setSelectedTask] = useState<TaskSummary | null>(
    snapshot.tasks.find((t) => t.taskId === snapshot.activeTaskId) || snapshot.tasks[0] || null
  );
  useEffect(() => { setSelectedTask(snapshot.tasks.find((t) => t.taskId === selectedTaskId) || snapshot.tasks.find((t) => t.taskId === snapshot.activeTaskId) || snapshot.tasks[0] || null); }, [snapshot, selectedTaskId]);
  const [rawJson, setRawJson] = useState<Record<string, unknown> | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (selectedTask) {
      auditApi.getRawArtifact({
        taskId: selectedTask.taskId,
        artifact: 'contract.json',
      }).then((content) => {
        try {
          setRawJson(JSON.parse(content));
        } catch {
          setRawJson(null);
        }
      }).catch(() => setRawJson(null));
    }
  }, [selectedTask]);

  const handleCopy = () => {
    if (rawJson) {
      navigator.clipboard.writeText(JSON.stringify(rawJson, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (snapshot.tasks.length === 0) {
    return <EmptyState title="No tasks available" description="Select a task to view its contract." />;
  }

  const contract = rawJson as Record<string, any>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-forge-text-primary">Contract Inspector</h1>
          <p className="text-sm text-forge-text-muted mt-1">Human-readable task contract view</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="input w-48"
            value={selectedTask?.taskId || ''}
            onChange={(e) => {
              const task = snapshot.tasks.find((t) => t.taskId === e.target.value);
              setSelectedTask(task || null);
              if (task) onSelectedTaskChange?.(task.taskId);
            }}
          >
            {snapshot.tasks.map((task) => (
              <option key={task.taskId} value={task.taskId}>
                {task.taskId}
              </option>
            ))}
          </select>
          <button
            className={cn('btn-secondary', showRaw && 'bg-forge-accent/10 text-forge-accent')}
            onClick={() => setShowRaw(!showRaw)}
          >
            {showRaw ? 'Human' : 'Raw JSON'}
          </button>
          {showRaw && (
            <button className="btn-ghost" onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
      </div>

      {showRaw ? (
        <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
          <pre className="text-xs text-forge-text-secondary font-mono whitespace-pre-wrap overflow-auto max-h-[600px]">
            {JSON.stringify(rawJson, null, 2)}
          </pre>
        </div>
      ) : (
        <div className="space-y-4">
          {contract?.objective && (
            <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
              <h3 className="text-xs font-semibold text-forge-text-muted uppercase tracking-wider mb-2">Objective</h3>
              <p className="text-sm text-forge-text-secondary">{contract.objective}</p>
            </div>
          )}

          {contract?.deliverables && contract.deliverables.length > 0 && (
            <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
              <h3 className="text-xs font-semibold text-forge-text-muted uppercase tracking-wider mb-2">Deliverables</h3>
              <ul className="space-y-1.5">
                {contract.deliverables.map((d: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-forge-text-secondary">
                    <span className="text-forge-success mt-0.5">✓</span>
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {contract?.constraints && contract.constraints.length > 0 && (
            <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
              <h3 className="text-xs font-semibold text-forge-text-muted uppercase tracking-wider mb-2">Constraints</h3>
              <ul className="space-y-1.5">
                {contract.constraints.map((c: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-forge-text-secondary">
                    <span className="text-forge-text-muted mt-0.5">•</span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {contract?.risks && contract.risks.length > 0 && (
            <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
              <h3 className="text-xs font-semibold text-forge-text-muted uppercase tracking-wider mb-2">Risks</h3>
              <div className="flex flex-wrap gap-2">
                {contract.risks.map((r: string, i: number) => (
                  <span key={i} className="px-2.5 py-1 text-xs font-medium rounded-6 bg-forge-warning/10 text-forge-warning">
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}

          {contract?.verification && contract.verification.length > 0 && (
            <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
              <h3 className="text-xs font-semibold text-forge-text-muted uppercase tracking-wider mb-2">Verification Requirements</h3>
              <div className="space-y-2">
                {contract.verification.map((v: any, i: number) => {
                  const id = typeof v === 'string' ? v : v?.id;
                  const text = typeof v === 'object' && v !== null ? v.text : undefined;
                  return (
                    <div key={i} className="p-2 bg-forge-secondary-surface rounded-6">
                      <p className="text-xs font-medium text-forge-text-primary">{id || text || 'Unspecified verification requirement'}</p>
                      {text && id && text !== id && <p className="text-xs text-forge-text-muted mt-1">{text}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {contract?.successCriteria && contract.successCriteria.length > 0 && (
            <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
              <h3 className="text-xs font-semibold text-forge-text-muted uppercase tracking-wider mb-2">Success Criteria</h3>
              <ul className="space-y-1.5">
                {contract.successCriteria.map((s: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-forge-text-secondary">
                    <span className="text-forge-success mt-0.5">○</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {contract?.stopConditions && contract.stopConditions.length > 0 && (
            <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
              <h3 className="text-xs font-semibold text-forge-text-muted uppercase tracking-wider mb-2">Stop Conditions</h3>
              <ul className="space-y-1.5">
                {contract.stopConditions.map((s: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-forge-danger">
                    <span className="mt-0.5">⚠</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {contract?.assumptions && contract.assumptions.length > 0 && (
            <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
              <h3 className="text-xs font-semibold text-forge-text-muted uppercase tracking-wider mb-2">Assumptions</h3>
              <div className="space-y-2">
                {contract.assumptions.map((a: any, i: number) => (
                  <div key={i} className="p-2 bg-forge-secondary-surface rounded-6">
                    <p className="text-xs text-forge-text-primary">{a.value || a}</p>
                    {a.reason && <p className="text-[10px] text-forge-text-muted mt-1">Reason: {a.reason}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
