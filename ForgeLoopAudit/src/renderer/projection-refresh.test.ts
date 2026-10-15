import { describe, expect, it } from 'vitest';
import type { ProjectUpdate } from '@shared/domain';
import {
  createProjectionRefreshEpochs,
  reduceProjectionRefresh,
  shouldApplySnapshotGeneration,
  taskProjectionRefreshEpoch,
} from './projection-refresh';

function update(type: ProjectUpdate['type'], taskId?: string, data?: unknown): ProjectUpdate {
  return { type, taskId, data, timestamp: '2026-08-30T00:00:00.000Z' };
}

describe('resource-specific renderer projection refresh', () => {
  it('keeps action and handoff changes away from selected-task attestation reads', () => {
    const initial = createProjectionRefreshEpochs();
    const action = reduceProjectionRefresh(initial, update('action-changed', 'TASK-B'));
    const handoff = reduceProjectionRefresh(initial, update('handoff-changed', 'TASK-B'));

    expect(taskProjectionRefreshEpoch(action, 'attestation', 'TASK-A')).toBe(0);
    expect(taskProjectionRefreshEpoch(handoff, 'attestation', 'TASK-A')).toBe(0);
    expect(taskProjectionRefreshEpoch(action, 'actions', 'TASK-B')).toBe(1);
    expect(taskProjectionRefreshEpoch(handoff, 'handoffs', 'TASK-B')).toBe(1);
  });

  it('refreshes verification scope without refreshing attestation', () => {
    const next = reduceProjectionRefresh(createProjectionRefreshEpochs(), update('verification-scope-changed', 'TASK-A'));
    expect(taskProjectionRefreshEpoch(next, 'verificationScope', 'TASK-A')).toBe(1);
    expect(taskProjectionRefreshEpoch(next, 'attestation', 'TASK-A')).toBe(0);
  });

  it('refreshes attestation only for the changed task', () => {
    const next = reduceProjectionRefresh(createProjectionRefreshEpochs(), update('attestation-changed', 'TASK-A'));
    expect(taskProjectionRefreshEpoch(next, 'attestation', 'TASK-A')).toBe(1);
    expect(taskProjectionRefreshEpoch(next, 'attestation', 'TASK-B')).toBe(0);
  });

  it('keeps a generic snapshot refresh separate from canonical attestation', () => {
    const next = reduceProjectionRefresh(createProjectionRefreshEpochs(), update('snapshot-refreshed'));
    expect(next.genericTask).toBe(1);
    expect(taskProjectionRefreshEpoch(next, 'attestation', 'TASK-A')).toBe(0);
  });

  it('updates approvals and actions together while preserving other resources', () => {
    const next = reduceProjectionRefresh(createProjectionRefreshEpochs(), update('approval-changed', 'TASK-A'));
    expect(taskProjectionRefreshEpoch(next, 'approvals', 'TASK-A')).toBe(1);
    expect(taskProjectionRefreshEpoch(next, 'actions', 'TASK-A')).toBe(1);
    expect(taskProjectionRefreshEpoch(next, 'evaluations', 'TASK-A')).toBe(0);
  });

  it('refreshes only the ledger surface for appended events and executions', () => {
    const initial = createProjectionRefreshEpochs();
    const event = reduceProjectionRefresh(initial, update('task-updated', 'TASK-A', { type: 'event-appended' }));
    const execution = reduceProjectionRefresh(initial, update('task-updated', 'TASK-B', { type: 'execution-changed' }));

    expect(taskProjectionRefreshEpoch(event, 'events', 'TASK-A')).toBe(1);
    expect(taskProjectionRefreshEpoch(event, 'executions', 'TASK-A')).toBe(0);
    expect(event.genericTask).toBe(0);
    expect(taskProjectionRefreshEpoch(execution, 'executions', 'TASK-B')).toBe(1);
    expect(taskProjectionRefreshEpoch(execution, 'events', 'TASK-B')).toBe(0);
    expect(execution.genericTask).toBe(0);
  });

  it('rejects snapshots that finish with an older generation', () => {
    expect(shouldApplySnapshotGeneration(4, 4)).toBe(true);
    expect(shouldApplySnapshotGeneration(4, 5)).toBe(true);
    expect(shouldApplySnapshotGeneration(4, 3)).toBe(false);
    expect(shouldApplySnapshotGeneration(4)).toBe(true);
  });
});
