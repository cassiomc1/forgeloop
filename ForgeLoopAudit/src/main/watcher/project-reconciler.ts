export interface ReconcileRequest {
  reason: 'WATCHER' | 'MANUAL' | 'RECOVERY';
  changedPaths: string[];
}

export class ProjectReconciler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: ReconcileRequest[] = [];
  private cycles = 0;
  constructor(private readonly reconcile: (request: ReconcileRequest) => Promise<void>, private readonly debounceMs = 100) {}
  request(request: ReconcileRequest): void {
    this.pending.push(request);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const requests = this.pending.splice(0);
      const changedPaths = [...new Set(requests.flatMap((item) => item.changedPaths))];
      void this.reconcile({ reason: requests.some((item) => item.reason === 'RECOVERY') ? 'RECOVERY' : 'WATCHER', changedPaths });
      this.cycles++;
    }, this.debounceMs);
  }
  getCycleCount(): number { return this.cycles; }
  dispose(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.pending = []; }
}
