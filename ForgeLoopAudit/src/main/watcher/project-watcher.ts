import { join, relative, sep } from 'path';
import { lstatSync } from 'node:fs';
import chokidar, { FSWatcher } from 'chokidar';
import { PathBoundary } from '@main/security/path-boundary';
import { TASK_STATE_DIR, SESSIONS_DIR, POLICY_DIR } from '@shared/constants';
import { ChangeCoalescer, type CoalescedChange } from './change-coalescer';
import { ForgeLoopAuditError } from '@shared/errors';
import { WATCHER_RETRY_MS, WATCHER_MAX_RETRIES } from '@shared/constants';

const PATH_VALIDATION_RETRY_MS = 50;
const PATH_VALIDATION_MAX_RETRIES = 10;
const ATTESTATION_BURST_DEBOUNCE_MS = 250;

export interface WatcherEvent {
  type: 'artifact-changed' | 'task-added' | 'task-removed' | 'event-appended' | 'policy-changed' | 'session-changed' | 'execution-changed' | 'action-changed' | 'approval-changed' | 'evaluation-changed' | 'capability-policy-changed' | 'workspace-binding-changed' | 'handoff-changed' | 'responsibility-changed' | 'verification-scope-changed' | 'attestation-changed';
  taskKey?: string;
  artifact?: string;
  path: string;
}

export class ProjectWatcher {
  private watcher: FSWatcher | null = null;
  private readonly coalescer: ChangeCoalescer;
  private readonly pathBoundary: PathBoundary;
  private readonly forgeLoopRoot: string;
  private isActive = false;
  private retryCount = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private readonly pathValidationRetryTimers = new Set<NodeJS.Timeout>();
  private readonly pendingAttestationChanges = new Map<string, CoalescedChange>();
  private readonly knownTaskKeys = new Set<string>();
  private attestationBurstTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    pathBoundary: PathBoundary,
    private readonly onEvent: (event: WatcherEvent) => void,
    private readonly onError: (error: Error) => void,
    private readonly onStatusChange: (active: boolean) => void
  ) {
    this.pathBoundary = pathBoundary;
    this.forgeLoopRoot = pathBoundary.validateForgeLoopPath('');
    this.coalescer = new ChangeCoalescer();
    this.coalescer.on('coalesced', this.handleCoalescedChanges.bind(this));
  }

  start(): void {
    if (this.isActive) return;
    this.stopped = false;
    this.knownTaskKeys.clear();

    try {
      // Watch the bounded ForgeLoop state tree once and classify events below.
      // Multiple overlapping glob roots can share native watcher handles and
      // lose a child notification on Windows; one recursive root keeps the
      // monitored surface complete while classification remains allowlisted.
      this.watcher = chokidar.watch(this.forgeLoopRoot, {
        ignored: [
          join(this.forgeLoopRoot, '.txn', '**'),
          join(this.forgeLoopRoot, '*.log'),
          join(this.forgeLoopRoot, '*.tmp'),
        ],
        ignoreInitial: true,
        persistent: true,
        // Windows can silently drop a subset of rapid additions through its
        // native fs.watch backend. Polling keeps the live projection complete
        // for the small, bounded ForgeLoop state tree without changing the
        // native backend used by macOS and Linux.
        usePolling: process.platform === 'win32',
        awaitWriteFinish: {
          stabilityThreshold: 50,
          pollInterval: 20,
        },
        depth: 10,
      });

      this.watcher
        .on('add', (path) => this.handleFileChange(path, 'add'))
        .on('change', (path) => this.handleFileChange(path, 'change'))
        .on('unlink', (path) => this.handleFileChange(path, 'unlink'))
        .on('addDir', (path) => this.handleDirChange(path, 'add'))
        .on('unlinkDir', (path) => this.handleDirChange(path, 'unlink'))
        .on('error', (error) => this.handleError(error instanceof Error ? error : new Error(String(error))))
        .on('ready', () => {
          this.initializeKnownTaskKeys();
          this.isActive = true;
          this.retryCount = 0;
          this.onStatusChange(true);
        });

    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    for (const timer of this.pathValidationRetryTimers) clearTimeout(timer);
    this.pathValidationRetryTimers.clear();
    if (this.attestationBurstTimer) {
      clearTimeout(this.attestationBurstTimer);
      this.attestationBurstTimer = null;
    }
    this.pendingAttestationChanges.clear();
    this.knownTaskKeys.clear();
    const watcher = this.watcher;
    this.watcher = null;
    this.coalescer.destroy();
    this.isActive = false;
    this.onStatusChange(false);
    if (watcher) await watcher.close();
  }

  private handleFileChange(path: string, changeType: 'add' | 'change' | 'unlink', attempt = 0): void {
    if (this.stopped) return;

    try {
      const validatedPath = changeType === 'unlink'
        ? this.pathBoundary.validateLexicalPath(path)
        : this.pathBoundary.validatePath(path);
      this.coalescer.addChange({
        type: 'file',
        path: validatedPath,
        changeType,
        timestamp: Date.now(),
      });
    } catch {
      // A native watcher can report an add/change while the file is still
      // being committed by the writer or antivirus scanner. Retry only after
      // the realpath-aware boundary check succeeds, and stop after a bounded
      // window. Paths outside the boundary remain rejected on every attempt.
      this.schedulePathValidationRetry(path, changeType, 'file', attempt);
    }
  }

  private handleDirChange(path: string, changeType: 'add' | 'unlink', attempt = 0): void {
    if (this.stopped) return;

    try {
      const validatedPath = changeType === 'unlink'
        ? this.pathBoundary.validateLexicalPath(path)
        : this.pathBoundary.validatePath(path);
      this.coalescer.addChange({
        type: 'directory',
        path: validatedPath,
        changeType,
        timestamp: Date.now(),
      });
    } catch {
      this.schedulePathValidationRetry(path, changeType, 'directory', attempt);
    }
  }

  private schedulePathValidationRetry(
    path: string,
    changeType: 'add' | 'change' | 'unlink',
    observedType: 'file' | 'directory',
    attempt: number,
  ): void {
    if (this.stopped || changeType === 'unlink' || attempt >= PATH_VALIDATION_MAX_RETRIES) return;

    const timer = setTimeout(() => {
      this.pathValidationRetryTimers.delete(timer);
      if (observedType === 'file') this.handleFileChange(path, changeType, attempt + 1);
      else this.handleDirChange(path, changeType as 'add' | 'unlink', attempt + 1);
    }, PATH_VALIDATION_RETRY_MS);
    this.pathValidationRetryTimers.add(timer);
  }

  private handleCoalescedChanges(changes: CoalescedChange[]): void {
    for (const change of changes) {
      const event = this.classifyChange(change);
      if (event) {
        if (event.type === 'task-added' && event.taskKey) {
          // A recursive root watcher can rediscover an already-existing task
          // while reconciling a child directory. Only announce a task once.
          if (this.knownTaskKeys.has(event.taskKey)) continue;
          this.knownTaskKeys.add(event.taskKey);
        }
        if (event.type === 'attestation-changed' && event.taskKey) {
          // Files in an attestation collection are often committed together,
          // but platform watchers can discover them in separate batches. Keep
          // one bounded task-level notification across that short window.
          this.pendingAttestationChanges.set(event.taskKey, change);
          continue;
        }
        this.onEvent(event);
      }
    }
    if (this.pendingAttestationChanges.size > 0) {
      if (this.attestationBurstTimer) clearTimeout(this.attestationBurstTimer);
      this.attestationBurstTimer = setTimeout(() => {
        this.attestationBurstTimer = null;
        const attestationChanges = Array.from(this.pendingAttestationChanges.entries());
        this.pendingAttestationChanges.clear();
        for (const [taskKey, change] of attestationChanges) {
          this.onEvent({
            type: 'attestation-changed',
            taskKey,
            artifact: 'attestations',
            path: change.path,
          });
        }
      }, ATTESTATION_BURST_DEBOUNCE_MS);
    }
  }

  private initializeKnownTaskKeys(): void {
    this.knownTaskKeys.clear();
    if (!this.watcher) return;

    const taskStateRoot = join(this.forgeLoopRoot, TASK_STATE_DIR);
    for (const watchedPath of Object.keys(this.watcher.getWatched())) {
      const relativePath = relative(taskStateRoot, watchedPath);
      if (!relativePath || relativePath.startsWith('..') || relativePath.includes(`${sep}..${sep}`)) continue;
      const parts = relativePath.split(sep);
      if (parts.length === 1) this.knownTaskKeys.add(parts[0]);
    }
  }

  private classifyChange(change: CoalescedChange): WatcherEvent | null {
    const relativePath = relative(this.forgeLoopRoot, change.path).split(sep).join('/');

    // SHM contains reader locks, and opening a read-only WAL connection can
    // create/remove an empty WAL. Neither is a committed state change.
    if (relativePath === 'state.sqlite-shm') return null;
    if (relativePath === 'state.sqlite-wal') {
      if (change.changeType === 'unlink') return null;
      try { if (lstatSync(change.path).size === 0) return null; } catch { return null; }
      return { type: 'artifact-changed', artifact: relativePath, path: change.path };
    }
    if (['state.sqlite', 'storage-version.json'].includes(relativePath)) {
      return { type: 'artifact-changed', artifact: relativePath, path: change.path };
    }

    if (relativePath.startsWith(TASK_STATE_DIR + '/')) {
      const parts = relativePath.split('/');
      if (parts.length >= 2) {
        const taskKey = parts[1];

        if (change.path.endsWith('events.ndjson')) {
          return {
            type: 'event-appended',
            taskKey,
            artifact: 'events.ndjson',
            path: change.path,
          };
        }

        // Execution provenance artifacts live in their own per-task
        // directory; they get a lightweight bounded event instead of a full
        // snapshot rebuild so bursts never trigger rebuild storms.
        if (parts.length >= 3 && parts[2] === 'executions' && change.path.endsWith('.json')) {
          return {
            type: 'execution-changed',
            taskKey,
            artifact: parts[parts.length - 1],
            path: change.path,
          };
        }

        if (parts.length >= 3 && parts[2] === 'actions' && /^action-[A-Za-z0-9_-]+\.json$/.test(parts[parts.length - 1])) {
          return {
            type: 'action-changed',
            taskKey,
            artifact: parts[parts.length - 1],
            path: change.path,
          };
        }

        if (parts.length >= 3 && parts[2] === 'approvals' && /^approval-[A-Za-z0-9_-]+\.json$/.test(parts[parts.length - 1])) {
          return {
            type: 'approval-changed',
            taskKey,
            artifact: parts[parts.length - 1],
            path: change.path,
          };
        }

        if (parts.length >= 3 && parts[2] === 'evaluations' && /^eval-[A-Za-z0-9_-]+\.json$/.test(parts[parts.length - 1])) {
          return {
            type: 'evaluation-changed',
            taskKey,
            artifact: parts[parts.length - 1],
            path: change.path,
          };
        }

        if (parts.length >= 3 && parts[2] === 'handoffs' && /^handoff-[A-Za-z0-9_-]+\.json$/.test(parts[parts.length - 1])) {
          return {
            type: 'handoff-changed',
            taskKey,
            artifact: parts[parts.length - 1],
            path: change.path,
          };
        }

        if (parts.length >= 3 && parts[2] === 'attestations'
          && ['code-manifest.json', 'statement.json', 'statement.sigstore.json'].includes(parts[parts.length - 1])) {
          return {
            type: 'attestation-changed',
            taskKey,
            artifact: parts[parts.length - 1],
            path: change.path,
          };
        }

        if (parts.length === 3 && change.path.endsWith('workspace-binding.json')) {
          return {
            type: 'workspace-binding-changed',
            taskKey,
            artifact: 'workspace-binding.json',
            path: change.path,
          };
        }

        if (parts.length === 3 && change.path.endsWith('responsibility.json')) {
          return {
            type: 'responsibility-changed',
            taskKey,
            artifact: 'responsibility.json',
            path: change.path,
          };
        }

        if (parts.length === 3 && change.path.endsWith('verification-scope.json')) {
          return {
            type: 'verification-scope-changed',
            taskKey,
            artifact: 'verification-scope.json',
            path: change.path,
          };
        }

        if (change.path.endsWith('recovery.json')) {
          return {
            type: 'artifact-changed',
            taskKey,
            artifact: 'recovery.json',
            path: change.path,
          };
        }

        if (change.path.endsWith('.json')) {
          const artifact = parts[parts.length - 1];
          return {
            type: 'artifact-changed',
            taskKey,
            artifact,
            path: change.path,
          };
        }

        if (change.type === 'directory' && change.changeType === 'add' && parts.length === 2) {
          return {
            type: 'task-added',
            taskKey,
            path: change.path,
          };
        }

        if (change.type === 'directory' && change.changeType === 'unlink' && parts.length === 2) {
          return {
            type: 'task-removed',
            taskKey,
            path: change.path,
          };
        }
      }
    }

    if (relativePath.startsWith(SESSIONS_DIR + '/')) {
      return {
        type: 'session-changed',
        path: change.path,
      };
    }

    if (relativePath === `${POLICY_DIR}/capabilities.json`) {
      return {
        type: 'capability-policy-changed',
        path: change.path,
      };
    }

    if (relativePath.startsWith(POLICY_DIR + '/')) {
      return {
        type: 'policy-changed',
        path: change.path,
      };
    }

    if (relativePath === 'config.json' || relativePath === 'sources.json') {
      return {
        type: 'artifact-changed',
        artifact: relativePath,
        path: change.path,
      };
    }

    return null;
  }

  private handleError(error: Error): void {
    if (this.stopped) return;
    this.isActive = false;
    const watcher = this.watcher;
    this.watcher = null;
    void watcher?.close();
    this.onError(error);

    if (this.retryCount < WATCHER_MAX_RETRIES) {
      this.retryCount++;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (!this.stopped && !this.isActive) {
          this.start();
        }
      }, WATCHER_RETRY_MS * this.retryCount);
    } else {
      this.onStatusChange(false);
      this.onError(ForgeLoopAuditError.watcherFailed(`Max retries exceeded: ${error.message}`));
    }
  }

  getStatus(): { active: boolean; forgeLoopRoot: string } {
    return {
      active: this.isActive,
      forgeLoopRoot: this.forgeLoopRoot,
    };
  }
}

export function createProjectWatcher(
  pathBoundary: PathBoundary,
  onEvent: (event: WatcherEvent) => void,
  onError: (error: Error) => void,
  onStatusChange: (active: boolean) => void
): ProjectWatcher {
  return new ProjectWatcher(pathBoundary, onEvent, onError, onStatusChange);
}
