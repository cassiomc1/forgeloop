import { describe, expect, it } from 'vitest';
import type { ForgeLoopPhase, KanbanColumnId, ProjectSnapshot, TaskSummary } from '@shared/domain';
import {
  buildKanbanBoard,
  isAbandonedTask,
  kanbanColumnForPhase,
  kanbanColumnLabel,
  KANBAN_COLUMNS,
  toKanbanCard,
} from '@shared/kanban';

function task(taskId: string, phase: ForgeLoopPhase, extra: Partial<TaskSummary> = {}): TaskSummary {
  return {
    taskId,
    taskKey: taskId.toLowerCase(),
    phase,
    selectedGuides: [],
    completedSteps: [],
    pendingSteps: [],
    blockers: [],
    failures: [],
    checks: [],
    gates: [],
    evidenceCoverage: { total: 0, covered: 0, partial: 0, notVerified: 0, blocked: 0, coveragePercent: 50 },
    ...extra,
  } as unknown as TaskSummary;
}

function snapshot(tasks: TaskSummary[], activeTaskId?: string): ProjectSnapshot {
  return { tasks, activeTaskId } as unknown as ProjectSnapshot;
}

describe('kanban column mapping', () => {
  it('places every canonical ForgeLoop phase in exactly one column', () => {
    const phases: ForgeLoopPhase[] = [
      'RECEIVED', 'DISCOVERING', 'CONTRACT_READY', 'ROUTED', 'DESIGNING', 'PLANNED',
      'EXECUTING', 'VERIFYING', 'DIAGNOSING', 'CORRECTING', 'REVIEWING', 'COMPLETE', 'BLOCKED',
    ];
    const mapped = phases.map(kanbanColumnForPhase);
    expect(new Set(mapped).size).toBeGreaterThan(1);
    for (const phase of phases) {
      expect(KANBAN_COLUMNS.some((column) => column.phases.includes(phase))).toBe(true);
    }
  });

  it('keeps blocked and complete in distinct terminal columns', () => {
    expect(kanbanColumnForPhase('BLOCKED')).toBe('blocked');
    expect(kanbanColumnForPhase('COMPLETE')).toBe('complete');
  });

  it('never promotes an unknown phase to a passing column', () => {
    expect(kanbanColumnForPhase('FUTURE_PHASE' as ForgeLoopPhase)).toBe('backlog');
  });
});

describe('toKanbanCard', () => {
  const base = { projectPath: '/repo', projectName: 'Repo', projectKind: 'PROJECT' as const, isActiveTask: false };

  it('copies canonical coverage and counts observed validation errors', () => {
    const card = toKanbanCard({
      ...base,
      task: task('TASK-001', 'EXECUTING', { artifactErrors: ['a'], gateErrors: ['b', 'c'] }),
    });
    expect(card.evidenceCoveragePercent).toBe(50);
    expect(card.validationErrors).toBe(3);
    expect(card.column).toBe('in-progress');
  });

  it('renders an abandoned complete task as blocked, never as completion', () => {
    const card = toKanbanCard({
      ...base,
      task: task('TASK-007', 'COMPLETE', { recovery: { classificationAtRecovery: 'ABANDONED' } as TaskSummary['recovery'] }),
    });
    expect(card.phase).toBe('COMPLETE');
    expect(card.column).toBe('blocked');
    expect(isAbandonedTask(card as unknown as TaskSummary)).toBe(false);
  });
});

describe('buildKanbanBoard', () => {
  const projects = [
    { path: '/a', name: 'Alpha', kind: 'PROJECT' as const, snapshot: snapshot([task('TASK-001', 'EXECUTING'), task('TASK-002', 'BLOCKED')]) },
    { path: '/b', name: 'Beta', kind: 'PROJECT' as const, snapshot: snapshot([task('TASK-001', 'PLANNED'), task('TASK-002', 'COMPLETE')]) },
  ];

  it('aggregates every project when no filter is applied', () => {
    const board = buildKanbanBoard({ projects, generatedAt: 'now' });
    expect(board.filterProjectPath).toBeNull();
    expect(board.totalTasks).toBe(4);
    expect(board.projects).toHaveLength(2);
    expect(board.columns.find((column) => column.id === 'blocked')?.cards).toHaveLength(1);
  });

  it('restricts the board to a single project when filtered', () => {
    const board = buildKanbanBoard({ projects, filterProjectPath: '/a', generatedAt: 'now' });
    expect(board.totalTasks).toBe(2);
    expect(board.projects.map((project) => project.name)).toEqual(['Alpha']);
    expect(board.columns.flatMap((column) => column.cards).every((card) => card.projectPath === '/a')).toBe(true);
  });

  it('keeps all six columns present even when a column is empty', () => {
    const board = buildKanbanBoard({ projects: [projects[0]], generatedAt: 'now' });
    expect(board.columns).toHaveLength(6);
    expect(board.columns.find((column) => column.id === 'complete')?.cards).toHaveLength(0);
  });

  it('marks the canonical active task of its project', () => {
    const board = buildKanbanBoard({
      projects: [{ ...projects[0], snapshot: snapshot([task('TASK-001', 'EXECUTING')], 'TASK-001') }],
      generatedAt: 'now',
    });
    const cards = board.columns.flatMap((column) => column.cards);
    expect(cards.find((card) => card.taskId === 'TASK-001')?.isActive).toBe(true);
  });

  it('returns an empty board for an unknown filter instead of failing', () => {
    const board = buildKanbanBoard({ projects, filterProjectPath: '/missing', generatedAt: 'now' });
    expect(board.totalTasks).toBe(0);
  });

  it('defaults a missing filter to every project and keeps its timestamp', () => {
    const board = buildKanbanBoard({ projects, filterProjectPath: undefined, generatedAt: 'stamp' });
    expect(board.filterProjectPath).toBeNull();
    expect(board.generatedAt).toBe('stamp');
    expect(board.totalTasks).toBe(4);
  });

  it('counts a registered project with no readable snapshot as zero tasks', () => {
    const board = buildKanbanBoard({
      projects: [{ path: '/c', name: 'Gamma', kind: 'PROJECT' as const, snapshot: null }],
      generatedAt: 'now',
    });
    expect(board.totalTasks).toBe(0);
    expect(board.projects).toEqual([{ path: '/c', name: 'Gamma', kind: 'PROJECT', taskCount: 0 }]);
  });

  it('tolerates a task with no evidence coverage or validation errors reported', () => {
    const board = buildKanbanBoard({
      projects: [{ path: '/a', name: 'Alpha', kind: 'PROJECT' as const, snapshot: snapshot([{ taskId: 'TASK-009', phase: 'RECEIVED' } as unknown as TaskSummary]) }],
      generatedAt: 'now',
    });
    const card = board.columns.flatMap((column) => column.cards)[0];
    expect(card.evidenceCoveragePercent).toBe(0);
    expect(card.validationErrors).toBe(0);
  });

  it('marks no task as active when the project reports no active task', () => {
    const board = buildKanbanBoard({ projects: [{ ...projects[0], snapshot: snapshot([task('TASK-001', 'EXECUTING')]) }], generatedAt: 'now' });
    expect(board.columns.flatMap((column) => column.cards).every((card) => card.isActive)).toBe(false);
  });

  it('sorts the active task ahead of other work in the same column', () => {
    const board = buildKanbanBoard({
      projects: [{ path: '/a', name: 'Alpha', kind: 'PROJECT' as const, snapshot: snapshot([task('TASK-050', 'EXECUTING'), task('TASK-002', 'EXECUTING')], 'TASK-050') }],
      generatedAt: 'now',
    });
    expect((board.columns.find((column) => column.id === 'in-progress')?.cards ?? [])[0].taskId).toBe('TASK-050');
  });

  it('orders cards by project name then task id inside a column', () => {
    const board = buildKanbanBoard({
      projects: [
        { path: '/z', name: 'Zulu', kind: 'PROJECT' as const, snapshot: snapshot([task('TASK-001', 'PLANNED')]) },
        { path: '/a', name: 'Alpha', kind: 'PROJECT' as const, snapshot: snapshot([task('TASK-010', 'PLANNED'), task('TASK-002', 'PLANNED')]) },
      ],
      generatedAt: 'now',
    });
    const cards = board.columns.find((column) => column.id === 'ready')?.cards ?? [];
    expect(cards.map((card) => `${card.projectName}/${card.taskId}`)).toEqual(['Alpha/TASK-002', 'Alpha/TASK-010', 'Zulu/TASK-001']);
  });

  it('orders task ids numerically rather than lexicographically', () => {
    const board = buildKanbanBoard({
      projects: [{ path: '/a', name: 'Alpha', kind: 'PROJECT' as const, snapshot: snapshot([task('TASK-10', 'PLANNED'), task('TASK-9', 'PLANNED')]) }],
      generatedAt: 'now',
    });
    const cards = board.columns.find((column) => column.id === 'ready')?.cards ?? [];
    expect(cards.map((card) => card.taskId)).toEqual(['TASK-9', 'TASK-10']);
  });

  it('orders the columns from backlog through complete', () => {
    expect(buildKanbanBoard({ projects, generatedAt: 'now' }).columns.map((column) => column.id))
      .toEqual(['backlog', 'ready', 'in-progress', 'review', 'blocked', 'complete']);
  });
});

describe('kanbanColumnLabel', () => {
  it('returns the human label for a known column', () => {
    expect(kanbanColumnLabel('in-progress')).toBe('In Progress');
  });

  it('falls back to the id for an unknown column', () => {
    expect(kanbanColumnLabel('nope' as KanbanColumnId)).toBe('nope');
  });
});
