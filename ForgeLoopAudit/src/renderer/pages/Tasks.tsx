import { useState, useMemo } from 'react';
import type { ProjectSnapshot } from '@shared/domain';
import type { ProjectAuditSnapshot } from '@shared/audit';
import { TaskRow } from '../components/tasks/TaskRow';
import { NoTasksState } from '../components/ui/EmptyState';
import { cn } from '../lib/utils';
import { Search, X } from 'lucide-react';

interface TasksProps {
  snapshot: ProjectSnapshot;
  audit?: ProjectAuditSnapshot | null;
  isDemoProject?: boolean;
  onTaskSelect?: (taskId: string) => void;
}

type FilterType = 'all' | 'active' | 'blocked' | 'complete';

export function Tasks({ snapshot, audit, isDemoProject, onTaskSelect }: TasksProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  const filteredTasks = useMemo(() => {
    let tasks = [...snapshot.tasks];

    if (activeFilter === 'active') {
      tasks = tasks.filter((t) => t.phase !== 'COMPLETE' && t.phase !== 'BLOCKED');
    } else if (activeFilter === 'blocked') {
      tasks = tasks.filter((t) => t.phase === 'BLOCKED');
    } else if (activeFilter === 'complete') {
      tasks = tasks.filter((t) => t.phase === 'COMPLETE');
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      tasks = tasks.filter(
        (t) =>
          t.taskId.toLowerCase().includes(query) ||
          (t.objective && t.objective.toLowerCase().includes(query))
      );
    }

    return tasks.sort((a, b) => {
      const phaseOrder: Record<string, number> = {
        EXECUTING: 0,
        VERIFYING: 1,
        REVIEWING: 2,
        DESIGNING: 3,
        PLANNED: 4,
        ROUTED: 5,
        CONTRACT_READY: 6,
        DISCOVERING: 7,
        RECEIVED: 8,
        BLOCKED: 99,
        COMPLETE: 100,
      };
      const aOrder = phaseOrder[a.phase] ?? 50;
      const bOrder = phaseOrder[b.phase] ?? 50;
      return aOrder - bOrder;
    });
  }, [snapshot.tasks, activeFilter, searchQuery]);

  const filters: { type: FilterType; label: string; count: number }[] = [
    { type: 'all', label: 'All', count: snapshot.tasks.length },
    { type: 'active', label: 'Active', count: snapshot.tasks.filter((t) => t.phase !== 'COMPLETE' && t.phase !== 'BLOCKED').length },
    { type: 'blocked', label: 'Blocked', count: snapshot.tasks.filter((t) => t.phase === 'BLOCKED').length },
    { type: 'complete', label: 'Complete', count: snapshot.tasks.filter((t) => t.phase === 'COMPLETE').length },
  ];

  if (snapshot.tasks.length === 0) {
    return <NoTasksState />;
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-forge-text-primary">Tasks</h1>
          <p className="text-sm text-forge-text-muted mt-1">{snapshot.tasks.length} ForgeLoop tasks</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-forge-text-muted" />
          <input
            type="text"
            placeholder="Search tasks by ID or objective..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-10 pr-10"
          />
          {searchQuery && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-forge-text-muted hover:text-forge-text-primary"
              onClick={() => setSearchQuery('')}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {filters.map((filter) => (
            <button
              key={filter.type}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-6 transition-colors',
                activeFilter === filter.type
                  ? 'bg-forge-accent/10 text-forge-accent'
                  : 'text-forge-text-secondary hover:bg-forge-hover-surface hover:text-forge-text-primary'
              )}
              onClick={() => setActiveFilter(filter.type)}
            >
              {filter.label}
              <span className="ml-1.5 text-xs opacity-60">{filter.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 overflow-hidden">
        <div className="divide-y divide-forge-border-subtle/50">
          {filteredTasks.length === 0 ? (
            <div className="p-8 text-center text-sm text-forge-text-muted">
              No tasks match your search
            </div>
          ) : (
            filteredTasks.map((task) => (
              <TaskRow
                key={task.taskId}
                task={task}
                auditSummary={audit?.taskAudits.find((summary) => summary.taskId === task.taskId)}
                isActive={task.taskId === snapshot.activeTaskId}
                isDemoProject={isDemoProject}
                onClick={() => onTaskSelect?.(task.taskId)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
