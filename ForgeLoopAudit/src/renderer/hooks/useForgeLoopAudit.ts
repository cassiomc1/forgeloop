import { useState, useCallback } from 'react';
import { ProjectSnapshot, ProjectUpdate, WatcherStatus } from '@shared/domain';
import { auditApi } from '../lib/audit-client';

export function useForgeLoopAudit() {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [watcherStatus, setWatcherStatus] = useState<WatcherStatus>({ active: false });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [lastGeneration, setLastGeneration] = useState(0);

  const api = auditApi;

  const loadSnapshot = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.getProjectSnapshot();
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError({
        message: err instanceof Error ? err.message : 'Failed to load snapshot',
        code: 'UNKNOWN_ERROR',
      });
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  const subscribeToUpdates = useCallback(() => {
    const unsubscribe = api.subscribeProjectUpdates((update: ProjectUpdate) => {
      switch (update.type) {
        case 'snapshot-refreshed':
          if (update.snapshot && (update.generation === undefined || update.generation > lastGeneration)) {
            setSnapshot(update.snapshot);
            if (update.generation !== undefined) setLastGeneration(update.generation);
          }
          break;
        case 'watcher-status':
          if (update.data) {
            setWatcherStatus(update.data as WatcherStatus);
          }
          break;
        case 'action-changed':
        case 'approval-changed':
        case 'evaluation-changed':
        case 'capability-policy-changed':
          // These bounded updates intentionally do not replace the snapshot;
          // task-scoped projections refresh their own canonical read models.
          if (update.generation !== undefined && update.generation > lastGeneration) {
            setLastGeneration(update.generation);
          }
          break;
        case 'error':
          if (update.data) {
            setError(update.data as { message: string; code: string });
            setTimeout(() => setError(null), 5000);
          }
          break;
      }
    });

    return unsubscribe;
  }, [api, lastGeneration]);

  return {
    snapshot,
    watcherStatus,
    isLoading,
    error,
    loadSnapshot,
    subscribeToUpdates,
  };
}
