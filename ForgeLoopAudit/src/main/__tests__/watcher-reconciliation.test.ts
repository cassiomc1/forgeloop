import { describe, expect, it, vi } from 'vitest';
import { ProjectReconciler } from '@main/watcher/project-reconciler';

describe('project reconciliation', () => {
  it('coalesces bursts into one bounded reconciliation', async () => {
    const reconcile = vi.fn(async () => undefined);
    const instance = new ProjectReconciler(reconcile, 1);
    for (let i = 0; i < 200; i++) instance.request({ reason: 'WATCHER', changedPaths: [`task-${i % 3}`] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect((reconcile.mock.calls[0] as any)[0].changedPaths).toHaveLength(3);
    instance.dispose();
  });
});
