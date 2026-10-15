import { EventEmitter } from 'events';
import { WATCHER_DEBOUNCE_MS } from '@shared/constants';

export type CoalescedChange = {
  type: 'file' | 'directory';
  path: string;
  changeType: 'add' | 'change' | 'unlink';
  timestamp: number;
};

export class ChangeCoalescer extends EventEmitter {
  private readonly debounceMs: number;
  private readonly pendingChanges: Map<string, CoalescedChange> = new Map();
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(debounceMs = WATCHER_DEBOUNCE_MS) {
    super();
    this.debounceMs = debounceMs;
  }

  addChange(change: CoalescedChange): void {
    const key = `${change.changeType}:${change.path}`;
    this.pendingChanges.set(key, change);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.flush();
    }, this.debounceMs);
  }

  private flush(): void {
    if (this.pendingChanges.size === 0) return;

    const changes = Array.from(this.pendingChanges.values());
    this.pendingChanges.clear();
    this.debounceTimer = null;

    this.emit('coalesced', changes);
  }

  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingChanges.clear();
    this.removeAllListeners();
  }
}