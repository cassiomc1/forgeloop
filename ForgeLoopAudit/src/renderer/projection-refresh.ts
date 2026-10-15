import type { ProjectUpdate } from '@shared/domain';

export type TaskProjectionEpochKey =
  | 'events'
  | 'executions'
  | 'actions'
  | 'approvals'
  | 'evaluations'
  | 'workspaceBinding'
  | 'handoffs'
  | 'responsibility'
  | 'verificationScope'
  | 'attestation';

export interface ProjectionRefreshEpochs {
  genericTask: number;
  capabilityPolicy: number;
  events: Record<string, number>;
  executions: Record<string, number>;
  actions: Record<string, number>;
  approvals: Record<string, number>;
  evaluations: Record<string, number>;
  workspaceBinding: Record<string, number>;
  handoffs: Record<string, number>;
  responsibility: Record<string, number>;
  verificationScope: Record<string, number>;
  attestation: Record<string, number>;
}

const ALL_TASKS = '*';

export function createProjectionRefreshEpochs(): ProjectionRefreshEpochs {
  return {
    genericTask: 0,
    capabilityPolicy: 0,
    events: {},
    executions: {},
    actions: {},
    approvals: {},
    evaluations: {},
    workspaceBinding: {},
    handoffs: {},
    responsibility: {},
    verificationScope: {},
    attestation: {},
  };
}

function bumpTaskEpoch(epochs: Record<string, number>, taskId?: string): Record<string, number> {
  const key = taskId || ALL_TASKS;
  return { ...epochs, [key]: (epochs[key] || 0) + 1 };
}

function bumpTaskProjection(
  current: ProjectionRefreshEpochs,
  key: TaskProjectionEpochKey,
  taskId?: string,
): ProjectionRefreshEpochs {
  return { ...current, [key]: bumpTaskEpoch(current[key], taskId) };
}

export function reduceProjectionRefresh(current: ProjectionRefreshEpochs, update: ProjectUpdate): ProjectionRefreshEpochs {
  switch (update.type) {
    case 'project-opened':
      return createProjectionRefreshEpochs();
    case 'snapshot-refreshed':
      return { ...current, genericTask: current.genericTask + 1 };
    case 'audit-invalidated':
    case 'audit-refreshed':
    case 'finding-changed':
      return current;
    case 'task-updated': {
      const watcherEvent = update.data && typeof update.data === 'object'
        ? (update.data as { type?: string }).type
        : undefined;
      if (watcherEvent === 'event-appended') return bumpTaskProjection(current, 'events', update.taskId);
      if (watcherEvent === 'execution-changed') return bumpTaskProjection(current, 'executions', update.taskId);
      return { ...current, genericTask: current.genericTask + 1 };
    }
    case 'task-added':
    case 'task-removed':
    case 'project-health-changed':
    case 'policy-changed':
    case 'session-changed':
      return { ...current, genericTask: current.genericTask + 1 };
    case 'action-changed':
      return bumpTaskProjection(current, 'actions', update.taskId);
    case 'approval-changed':
      return bumpTaskProjection(bumpTaskProjection(current, 'approvals', update.taskId), 'actions', update.taskId);
    case 'evaluation-changed':
      return bumpTaskProjection(current, 'evaluations', update.taskId);
    case 'capability-policy-changed':
      return { ...current, capabilityPolicy: current.capabilityPolicy + 1 };
    case 'workspace-binding-changed':
      return bumpTaskProjection(current, 'workspaceBinding', update.taskId);
    case 'handoff-changed':
      return bumpTaskProjection(current, 'handoffs', update.taskId);
    case 'responsibility-changed':
      return bumpTaskProjection(current, 'responsibility', update.taskId);
    case 'verification-scope-changed':
      return bumpTaskProjection(current, 'verificationScope', update.taskId);
    case 'attestation-changed':
      return bumpTaskProjection(current, 'attestation', update.taskId);
    case 'watcher-status':
    case 'workspace-changed':
    case 'error':
      return current;
  }
}

export function shouldApplySnapshotGeneration(currentGeneration: number, incomingGeneration?: number): boolean {
  return incomingGeneration === undefined || incomingGeneration >= currentGeneration;
}

export function taskProjectionRefreshEpoch(
  epochs: ProjectionRefreshEpochs,
  key: TaskProjectionEpochKey,
  taskId: string | null | undefined,
): number {
  const values = epochs[key];
  return (values[ALL_TASKS] || 0) + (taskId ? values[taskId] || 0 : 0);
}
