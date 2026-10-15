import type { TaskOwnershipSummary, TaskOperationalState, TaskSummary } from '@shared/domain';

export interface OperationalStateInput {
  phase: string;
  ownership: TaskOwnershipSummary;
}

/**
 * Classify a task's operational state from canonical ownership facts.
 *
 * Ownership is an independent layer above the lifecycle phase: phase alone
 * never proves claim release, and inconsistent ownership must surface even
 * when the lifecycle looks finished. Without canonical ownership the state
 * degrades to READ_ONLY_UNKNOWN instead of guessing healthy.
 */
export function resolveOperationalState(input: OperationalStateInput): TaskOperationalState {
  const { ownership, phase } = input;

  if (ownership.claimState === 'INCONSISTENT' || ownership.ownershipValid === false) {
    return 'OWNERSHIP_INCONSISTENT';
  }

  if (ownership.claimState === 'RELEASED_BY_RECOVERY' && ownership.mutationAllowed === false) {
    return 'RECOVERY_RESUME_REQUIRED';
  }

  if (phase === 'COMPLETE' && ownership.claimState === 'RELEASED_BY_COMPLETION' && ownership.ownershipValid === true) {
    return 'COMPLETED_RELEASED';
  }

  if (phase === 'BLOCKED') {
    return 'BLOCKED';
  }

  if (ownership.claimState === 'ACTIVE' && ownership.ownershipValid === true) {
    return 'ACTIVE';
  }

  return 'READ_ONLY_UNKNOWN';
}

/**
 * Select the highlighted active task. Only operationally ACTIVE tasks
 * qualify; recovered tasks may deserve attention but are never presented as
 * active.
 */
export function selectActiveTaskId(tasks: Array<Pick<TaskSummary, 'operationalState' | 'taskId'>>): string | undefined {
  return tasks.find((task) => task.operationalState === 'ACTIVE')?.taskId;
}
