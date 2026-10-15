import type {
  ForgeLoopPhase,
  KanbanBoard,
  KanbanCard,
  KanbanColumn,
  KanbanColumnId,
  ProjectKind,
  TaskSummary,
} from './domain';

/**
 * The Kanban board is a read-only projection of canonical ForgeLoop phases. It
 * never introduces a status ForgeLoop does not already report, and it never
 * reorders a card into a column that contradicts its phase.
 */
export const KANBAN_COLUMNS: ReadonlyArray<{
  id: KanbanColumnId;
  label: string;
  description: string;
  phases: readonly ForgeLoopPhase[];
}> = [
  {
    id: 'backlog',
    label: 'Backlog',
    description: 'Received and discovery work not yet routed to a contract.',
    phases: ['RECEIVED', 'DISCOVERING'],
  },
  {
    id: 'ready',
    label: 'Ready',
    description: 'Contract, routing, design and planning are settled before execution.',
    phases: ['CONTRACT_READY', 'ROUTED', 'DESIGNING', 'PLANNED'],
  },
  {
    id: 'in-progress',
    label: 'In Progress',
    description: 'Canonical execution, diagnosis and correction are running.',
    phases: ['EXECUTING', 'DIAGNOSING', 'CORRECTING'],
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Verification and review are in progress; completion is not yet claimed.',
    phases: ['VERIFYING', 'REVIEWING'],
  },
  {
    id: 'blocked',
    label: 'Blocked',
    description: 'ForgeLoop reported a blocking condition. Recovery is canonical, not inferred.',
    phases: ['BLOCKED'],
  },
  {
    id: 'complete',
    label: 'Complete',
    description: 'Canonically complete tasks only. Abandonment is never rendered as completion.',
    phases: ['COMPLETE'],
  },
];

const PHASE_TO_COLUMN: ReadonlyMap<ForgeLoopPhase, KanbanColumnId> = new Map(
  KANBAN_COLUMNS.flatMap((column) => column.phases.map((phase) => [phase, column.id] as const)),
);

const COLUMN_ORDER: ReadonlyMap<KanbanColumnId, number> = new Map(
  KANBAN_COLUMNS.map((column, index) => [column.id, index]),
);

export function kanbanColumnForPhase(phase: ForgeLoopPhase): KanbanColumnId {
  // A phase this build does not know is never silently promoted to a passing
  // column; it is surfaced in Backlog as unreviewed work.
  return PHASE_TO_COLUMN.get(phase) ?? 'backlog';
}

export function kanbanColumnLabel(columnId: KanbanColumnId): string {
  return KANBAN_COLUMNS.find((column) => column.id === columnId)?.label ?? columnId;
}

export function isAbandonedTask(task: TaskSummary): boolean {
  return task.recovery?.classificationAtRecovery === 'ABANDONED';
}

export interface KanbanCardInput {
  task: TaskSummary;
  projectPath: string;
  projectName: string;
  projectKind: ProjectKind;
  isActiveTask: boolean;
}

export function toKanbanCard(input: KanbanCardInput): KanbanCard {
  const { task } = input;
  return {
    taskId: task.taskId,
    projectPath: input.projectPath,
    projectName: input.projectName,
    projectKind: input.projectKind,
    objective: task.objective,
    phase: task.phase,
    // An abandoned task keeps its canonical phase, but it is never counted or
    // displayed as completed work.
    column: isAbandonedTask(task) && task.phase === 'COMPLETE' ? 'blocked' : kanbanColumnForPhase(task.phase),
    evidenceCoveragePercent: task.evidenceCoverage?.coveragePercent ?? 0,
    validationErrors: (task.artifactErrors?.length ?? 0) + (task.gateErrors?.length ?? 0),
    canonicalStatus: task.canonicalStatus?.status,
    lastUpdated: task.lastUpdated,
    isActive: input.isActiveTask,
  };
}

export interface KanbanBoardInput {
  projects: Array<{
    path: string;
    name: string;
    kind: ProjectKind;
    snapshot: { tasks: TaskSummary[]; activeTaskId?: string } | null;
  }>;
  filterProjectPath?: string | null;
  generatedAt: string;
}

/**
 * Build the cross-project board. `filterProjectPath` of `null` shows every
 * registered project; any other value restricts the board to that project.
 */
export function buildKanbanBoard(input: KanbanBoardInput): KanbanBoard {
  const filter = input.filterProjectPath ?? null;
  const selected = filter
    ? input.projects.filter((project) => project.path === filter)
    : input.projects;

  const cards: KanbanCard[] = [];
  const projectSummaries: KanbanBoard['projects'] = [];

  for (const project of selected) {
    const tasks = project.snapshot?.tasks ?? [];
    projectSummaries.push({ path: project.path, name: project.name, kind: project.kind, taskCount: tasks.length });
    for (const task of tasks) {
      cards.push(toKanbanCard({
        task,
        projectPath: project.path,
        projectName: project.name,
        projectKind: project.kind,
        isActiveTask: project.snapshot?.activeTaskId === task.taskId,
      }));
    }
  }

  const columns: KanbanColumn[] = KANBAN_COLUMNS.map((column) => ({
    id: column.id,
    label: column.label,
    description: column.description,
    cards: cards
      .filter((card) => card.column === column.id)
      .sort(compareKanbanCards),
  }));

  return {
    columns: columns.sort((a, b) => (COLUMN_ORDER.get(a.id) ?? 0) - (COLUMN_ORDER.get(b.id) ?? 0)),
    projects: projectSummaries,
    filterProjectPath: filter,
    totalTasks: cards.length,
    generatedAt: input.generatedAt,
  };
}

/** Active work first, then blockers, then stable project/task ordering. */
function compareKanbanCards(a: KanbanCard, b: KanbanCard): number {
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
  if (a.phase === 'BLOCKED' !== (b.phase === 'BLOCKED')) return a.phase === 'BLOCKED' ? -1 : 1;
  if (a.projectName !== b.projectName) return a.projectName.localeCompare(b.projectName);
  return a.taskId.localeCompare(b.taskId, undefined, { numeric: true });
}
