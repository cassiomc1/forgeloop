import { useState, useEffect, useCallback, useRef } from 'react';
import type { ProjectSnapshot, ExecutionPage, ExecutionRecord } from '@shared/domain';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingState } from '../components/ui/LoadingState';
import { cn } from '../lib/utils';
import { Terminal, ChevronDown, ChevronRight } from 'lucide-react';
import { auditApi } from '../lib/audit-client';
import {
  executionKindLabel,
  executionIsolationDetails,
  executionProvenanceDetails,
  isolationModeLabel,
  isVerificationExecutionIsolationAvailable,
  NOT_RECORDED_EXECUTION_METADATA,
} from './execution-display';

interface ExecutionsProps {
  snapshot: ProjectSnapshot;
  selectedTaskId: string | null;
  executionsRefreshToken?: number;
  onSelectedTaskChange?: (taskId: string) => void;
}

export interface ExecutionEntryProps {
  execution: ExecutionRecord;
  featureAvailable: boolean;
  expanded: boolean;
  rawVisible: boolean;
  onToggleExpanded: () => void;
  onToggleRaw: () => void;
}

export function ExecutionEntry({
  execution,
  featureAvailable,
  expanded,
  rawVisible,
  onToggleExpanded,
  onToggleRaw,
}: ExecutionEntryProps) {
  const kind = executionKindLabel(execution);
  const isolationMode = isolationModeLabel(execution);
  const provenanceDetails = executionProvenanceDetails(execution);
  const isolationDetails = executionIsolationDetails(execution, featureAvailable);

  return (
    <div>
      <button
        className="w-full px-4 py-3 flex items-center gap-4 hover:bg-forge-hover-surface transition-colors text-left"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
      >
        {expanded
          ? <ChevronDown className="w-4 h-4 text-forge-text-muted shrink-0" />
          : <ChevronRight className="w-4 h-4 text-forge-text-muted shrink-0" />}
        <Terminal className="w-4 h-4 text-forge-text-muted shrink-0" />
        <span className="text-sm font-mono font-medium text-forge-text-primary truncate">
          {execution.executionId}
        </span>
        <span className="text-xs text-forge-text-secondary truncate flex-1">{execution.argv.join(' ')}</span>
        {kind !== NOT_RECORDED_EXECUTION_METADATA && (
          <span className="hidden md:inline-flex items-center rounded-4 border border-forge-border-subtle bg-forge-secondary-surface px-2 py-0.5 text-[10px] font-semibold tracking-wide text-forge-text-secondary">
            {kind}
          </span>
        )}
        {featureAvailable && isolationMode !== NOT_RECORDED_EXECUTION_METADATA && (
          <span className="hidden lg:inline-flex items-center rounded-4 border border-forge-border-subtle bg-forge-secondary-surface px-2 py-0.5 text-[10px] font-semibold tracking-wide text-forge-text-secondary">
            {isolationMode}
          </span>
        )}
        <span className={cn('text-xs font-semibold', execution.status === 'passed' ? 'text-forge-success' : 'text-forge-danger')}>
          {execution.status.toUpperCase()}
        </span>
        <span className="text-xs text-forge-text-muted font-mono">
          exit {execution.exitCode ?? '—'}
        </span>
      </button>

      {expanded && (
        <div className="px-12 pb-4 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <p><span className="text-forge-text-muted">Check:</span> <span className="font-mono">{execution.checkId}</span></p>
            <p><span className="text-forge-text-muted">Cycle:</span> <span className="font-mono">{execution.verificationCycle}</span></p>
            <p><span className="text-forge-text-muted">Started:</span> <span className="font-mono">{execution.startedAt}</span></p>
            <p><span className="text-forge-text-muted">Finished:</span> <span className="font-mono">{execution.finishedAt}</span></p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {provenanceDetails.map((detail) => (
              <p key={detail.label} className="break-words">
                <span className="text-forge-text-muted">{detail.label}:</span>{' '}
                <span className="font-mono break-all">{detail.value}</span>
              </p>
            ))}
            {isolationDetails.map((detail) => (
              <p key={detail.label} className="break-words">
                <span className="text-forge-text-muted">{detail.label}:</span>{' '}
                <span className="font-mono break-all">{detail.value}</span>
              </p>
            ))}
          </div>
          <button
            type="button"
            className="text-xs text-forge-accent hover:text-forge-accent-hover"
            onClick={onToggleRaw}
          >
            {rawVisible ? 'Hide raw JSON' : 'Show raw JSON'}
          </button>
          {rawVisible && (
            <pre className="text-[11px] font-mono text-forge-text-secondary bg-forge-secondary-surface rounded-6 p-3 overflow-x-auto select-text whitespace-pre-wrap">
{JSON.stringify(execution, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function Executions({ snapshot, selectedTaskId, executionsRefreshToken = 0, onSelectedTaskChange }: ExecutionsProps) {
  const [page, setPage] = useState<ExecutionPage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rawJson, setRawJson] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const effectiveTask = snapshot.tasks.find((t) => t.taskId === selectedTaskId) || null;
  const isolationFeatureAvailable = isVerificationExecutionIsolationAvailable(snapshot.protocol.featureSupport);

  const loadExecutions = useCallback(async () => {
    if (!effectiveTask) return;
    const requestId = ++requestIdRef.current;
    const taskId = effectiveTask.taskId;
    setIsLoading(true);
    setError(null);
    try {
      const result = await auditApi.getTaskExecutions(taskId);
      if (requestId !== requestIdRef.current) return;
      setPage(result);
      setRawJson(null);
      setExpandedId(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load execution provenance');
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [effectiveTask]);

  useEffect(() => {
    void loadExecutions();
  }, [loadExecutions, executionsRefreshToken]);

  if (snapshot.tasks.length === 0) {
    return <EmptyState title="No tasks" description="Execution provenance is per-task; this project has no tasks." />;
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-forge-text-primary">Executions</h1>
          <p className="text-sm text-forge-text-muted mt-1">
            Read-only command execution provenance from current ForgeLoop artifacts
          </p>
          <p className="text-xs text-forge-text-muted mt-2 max-w-2xl">
            Isolation information is persisted by ForgeLoop. ForgeLoopAudit displays the recorded provenance and does not create or verify execution sandboxes itself.
          </p>
          {!isolationFeatureAvailable && (
            <p className="text-xs text-forge-text-muted mt-2 max-w-2xl" role="status">
              Verification isolation capability is unavailable for this ForgeLoop runtime. Persisted execution provenance remains available in raw form.
            </p>
          )}
        </div>
        <select
          className="input w-56"
          value={effectiveTask?.taskId || ''}
          onChange={(e) => onSelectedTaskChange?.(e.target.value)}
        >
          {!effectiveTask && <option value="">Select a task</option>}
          {snapshot.tasks.map((task) => (
            <option key={task.taskId} value={task.taskId}>
              {task.taskId}
            </option>
          ))}
        </select>
      </div>

      {!effectiveTask && (
        <EmptyState title="Select a task" description="Choose a task to inspect its bounded execution ledger." />
      )}

      {effectiveTask && isLoading && <LoadingState />}

      {effectiveTask && !isLoading && error && (
        <div className="bg-forge-danger/10 border border-forge-danger/30 rounded-10 p-4 text-sm text-forge-danger">
          {error}
        </div>
      )}

      {effectiveTask && !isLoading && page && (
        <>
          {page.invalidCount > 0 && (
            <div className="bg-forge-warning/10 border border-forge-warning/30 rounded-10 p-3 text-xs text-forge-warning">
              {page.invalidCount} execution artifact(s) failed schema validation and were withheld. This is surfaced, not hidden.
            </div>
          )}
          {page.executions.length === 0 ? (
            <EmptyState title="No executions" description={`No valid exec-*.json provenance found for ${effectiveTask.taskId}.`} />
          ) : (
            <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 divide-y divide-forge-border-subtle/50">
              {page.executions.map((execution) => (
                <ExecutionEntry
                  key={execution.executionId}
                  execution={execution}
                  featureAvailable={isolationFeatureAvailable}
                  expanded={expandedId === execution.executionId}
                  rawVisible={rawJson === execution.executionId}
                  onToggleExpanded={() => setExpandedId(expandedId === execution.executionId ? null : execution.executionId)}
                  onToggleRaw={() => setRawJson(rawJson === execution.executionId ? null : execution.executionId)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
