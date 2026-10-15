import type { ForgeLoopPhase, TaskSummary } from '@shared/domain';

export interface DemoScenario {
  taskId: string;
  expectedPhase: ForgeLoopPhase;
  label: string;
  summary: string;
}

export type DemoScenarioMatch =
  | { kind: 'intentional'; scenario: DemoScenario }
  | { kind: 'drift'; scenario: DemoScenario; actualPhase: ForgeLoopPhase }
  | { kind: 'unknown' };

/**
 * The authoritative scenario map for the bundled ForgeShop demo.
 * Must stay in sync with demo/README.md and scripts/demo/project-builder.mjs.
 *
 * This classifier only receives `taskId` and `phase`. It deliberately cannot
 * see artifact/gate validation errors, so it can never mark a real validation
 * failure as intentional demo behavior.
 */
export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    taskId: 'TASK-001',
    expectedPhase: 'COMPLETE',
    label: 'Successful lifecycle',
    summary: 'Reference scenario showing a fully completed task with receipt, checks, gates, and evidence.',
  },
  {
    taskId: 'TASK-002',
    expectedPhase: 'VERIFYING',
    label: 'Verification rejection',
    summary: 'Intentionally remains in verification because corrupted-cart hydration lacks acceptable verification evidence.',
  },
  {
    taskId: 'TASK-003',
    expectedPhase: 'EXECUTING',
    label: 'Active execution',
    summary: 'Intentionally shows an in-progress task with a canonical INVALID responsibility result, partial evidence, and remaining retry/security work.',
  },
  {
    taskId: 'TASK-004',
    expectedPhase: 'BLOCKED',
    label: 'Recovery and continuity',
    summary: 'Intentionally blocked by an accessibility gate to demonstrate durable recovery (released-by-recovery, resume required) and cross-harness continuity.',
  },
  {
    taskId: 'TASK-005',
    expectedPhase: 'PLANNED',
    label: 'Planned work',
    summary: 'Intentionally stops at planning after recording a performance baseline, before implementation and budget verification.',
  },
  {
    taskId: 'TASK-006',
    expectedPhase: 'COMPLETE',
    label: 'Security lifecycle',
    summary: 'Reference scenario showing successful security-policy gates and completion.',
  },
  {
    taskId: 'TASK-007',
    expectedPhase: 'PLANNED',
    label: 'Abandoned task',
    summary: 'Intentionally abandoned by the caller: renders TASK_ABANDONED distinctly, never as completion, publication, or evidence, with claims released by canonical recovery.',
  },
  {
    taskId: 'TASK-008',
    expectedPhase: 'ROUTED',
    label: 'Contract revision and checkpoint revalidation',
    summary: 'Intentionally shows a pre-execution contract revision (PLANNED to ROUTED) followed by a repository-drift checkpoint revalidation, both rendered as provenance refreshes rather than execution or completion.',
  },
];

const DEMO_SCENARIOS_BY_TASK = new Map(
  DEMO_SCENARIOS.map((scenario) => [scenario.taskId, scenario]),
);

export function classifyDemoScenario(
  task: Pick<TaskSummary, 'taskId' | 'phase'>,
): DemoScenarioMatch {
  const scenario = DEMO_SCENARIOS_BY_TASK.get(task.taskId);

  if (!scenario) {
    return { kind: 'unknown' };
  }

  if (scenario.expectedPhase !== task.phase) {
    return {
      kind: 'drift',
      scenario,
      actualPhase: task.phase,
    };
  }

  return {
    kind: 'intentional',
    scenario,
  };
}
