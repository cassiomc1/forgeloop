import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Columns3, FolderKanban, Layers } from 'lucide-react';
import type { KanbanBoard, KanbanCard } from '@shared/domain';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { EmptyState, ErrorState } from '../components/ui/EmptyState';
import { LoadingState } from '../components/ui/LoadingState';
import { auditApi } from '../lib/audit-client';

interface KanbanProps {
  /** Increments whenever any registered project changes, to keep the board live. */
  refreshToken: number;
  /** Restricted to a single project; `null` shows every registered project. */
  scopeProjectPath?: string | null;
  onOpenTask?: (card: KanbanCard) => void;
}

/**
 * Read-only Kanban board. Columns are derived from canonical ForgeLoop phases;
 * the auditor never writes lifecycle state, so cards are not draggable and no
 * column accepts a drop.
 */
export function Kanban({ refreshToken, scopeProjectPath = null, onOpenTask }: KanbanProps) {
  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(scopeProjectPath);
  const [loading, setLoading] = useState(true);

  useEffect(() => { setFilter(scopeProjectPath); }, [scopeProjectPath]);

  const load = useCallback(async () => {
    try {
      setBoard(await auditApi.getKanbanBoard(filter));
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The Kanban board could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load, refreshToken]);

  if (!board && loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <BoardHeading totalCards={0} />
        <LoadingState message="Building the Kanban board…" />
      </div>
    );
  }

  const columns = board?.columns ?? [];
  const totalCards = board?.totalTasks ?? 0;

  return (
    <div className="space-y-5 animate-fade-in">
      <BoardHeading totalCards={totalCards} />
      {error && <ErrorState message="Kanban board unavailable" details={error} onRetry={() => void load()} />}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Project filter">
        <span className="text-xs uppercase tracking-wider text-forge-text-muted">Project</span>
        <FilterButton active={filter === null} onClick={() => setFilter(null)} label="All projects" count={board?.projects.reduce((total, project) => total + project.taskCount, 0) ?? 0} />
        {(board?.projects ?? []).map((project) => (
          <FilterButton
            key={project.path}
            active={filter === project.path}
            onClick={() => setFilter(project.path)}
            label={project.name}
            count={project.taskCount}
          />
        ))}
      </div>

      {totalCards === 0 ? (
        <EmptyState
          title="No tasks to place on the board"
          description="Register a ForgeLoop project with tasks to see its work distributed across the canonical status columns."
          icon={<Columns3 className="h-12 w-12" />}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {columns.map((column) => (
            <section key={column.id} className="flex min-w-0 flex-col gap-3" aria-label={`${column.label} column`}>
              <header className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-forge-text-primary">{column.label}</h2>
                <span className="rounded-6 bg-forge-secondary-surface px-2 py-0.5 text-xs text-forge-text-muted">{column.cards.length}</span>
              </header>
              <p className="text-[11px] leading-4 text-forge-text-muted">{column.description}</p>
              <div className="flex flex-col gap-2">
                {column.cards.length === 0 ? (
                  <p className="rounded-8 border border-dashed border-forge-border-subtle px-3 py-4 text-center text-xs text-forge-text-muted">
                    No tasks
                  </p>
                ) : column.cards.map((card) => (
                  <KanbanTaskCard key={`${card.projectPath}-${card.taskId}`} card={card} onOpen={onOpenTask} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function BoardHeading({ totalCards }: { totalCards: number }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-forge-text-primary">Task Board</h1>
        <p className="mt-1 text-sm text-forge-text-muted">
          Every task from the registered projects, grouped by its canonical ForgeLoop phase.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline">{totalCards} task{totalCards === 1 ? '' : 's'}</Badge>
        <Badge variant="secondary">Read-only</Badge>
      </div>
    </div>
  );
}

function FilterButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`btn ${active ? 'bg-forge-accent text-forge-background' : 'btn-secondary'}`}
    >
      <span>{label}</span>
      <span className="ml-1.5 text-xs opacity-70">{count}</span>
    </button>
  );
}


function KanbanTaskCard({ card, onOpen }: { card: KanbanCard; onOpen?: (card: KanbanCard) => void }) {
  return (
    <Card className={card.isActive ? 'border-forge-accent/50' : undefined}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-forge-text-primary">{card.taskId}</span>
          {card.isActive && <Badge variant="default">Active</Badge>}
        </div>
        {card.objective && <p className="mt-1.5 line-clamp-3 text-sm text-forge-text-secondary">{card.objective}</p>}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          <Badge variant={phaseBadgeVariant(card.phase)}>{card.phase}</Badge>
          {card.validationErrors > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-forge-danger/30 bg-forge-danger/10 px-2 py-0.5 font-semibold text-forge-danger">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {card.validationErrors} artifact error{card.validationErrors === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-forge-border-subtle pt-2 text-[11px] text-forge-text-muted">
          <span className="inline-flex min-w-0 items-center gap-1">
            <FolderKanban className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{card.projectName}</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1" title="Canonical evidence coverage">
            <Layers className="h-3 w-3" aria-hidden="true" />
            {card.evidenceCoveragePercent}%
          </span>
        </div>
        {onOpen && (
          <button
            type="button"
            className="btn-secondary mt-2.5 w-full text-xs"
            onClick={() => onOpen(card)}
            disabled={!card.isActive}
            title={card.isActive ? 'Open this task' : 'Open the project to inspect this task'}
          >
            Open task
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function phaseBadgeVariant(phase: string): 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'danger' {
  if (phase === 'COMPLETE') return 'success';
  if (phase === 'BLOCKED') return 'danger';
  if (phase === 'EXECUTING' || phase === 'VERIFYING' || phase === 'REVIEWING') return 'warning';
  if (phase === 'DESIGNING' || phase === 'PLANNED' || phase === 'ROUTED' || phase === 'CONTRACT_READY') return 'default';
  return 'outline';
}
