import type {
  AuditDiff,
  AuditExportOptions,
  AuditExportResult,
  AuditFinding,
  AuditFindingFilter,
  AuditSnapshotMetadata,
  ProjectAuditSnapshot,
  StructuralQualityAuditView,
  TaskAuditSnapshot,
} from '@shared/audit';
import type { AuditRuntimeDiagnostics } from '@shared/diagnostics';
import type {
  CapabilityPolicyView,
  ContinuityLintView,
  DurableActionView,
  DurableApprovalView,
  EventPage,
  ExecutionPage,
  ExecutionProfileContextView,
  ForgeLoopAuditAPI,
  KanbanBoard,
  PolicySummary,
  ProjectDetectionResult,
  ProjectSnapshot,
  ProjectTimeline,
  ProjectUpdate,
  ProjectWorkspace,
  RawArtifactRequest,
  RawCollectionArtifactRequest,
  RecentProject,
  RepositoryIndexProjection,
  RepositorySearchRequest,
  RepositorySearchResult,
  ResponsibilityView,
  TaskActionsView,
  TaskAttestationView,
  TaskAuditViewProjection,
  TaskHandoffsView,
  TaskHistoryView,
  TaskInspectionView,
  TaskReflectionView,
  TaskSnapshot,
  TaskTraceView,
  TrajectoryEvaluationsView,
  TrajectoryMetricsView,
  VerificationScopeView,
  WorkspaceBindingView,
} from '@shared/domain';

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: {
    source: string;
    code: string;
    message: string;
    retryable: boolean;
  };
}

export class AuditHttpError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code = 'REQUEST_FAILED', retryable = true) {
    super(message);
    this.name = 'AuditHttpError';
    this.code = code;
    this.retryable = retryable;
  }
}

class HttpAuditClient implements ForgeLoopAuditAPI {
  private bootstrapPromise: Promise<void> | null = null;

  selectProject(): Promise<ProjectDetectionResult | null> {
    return Promise.resolve(null);
  }

  async openRecentProject(path: string): Promise<ProjectDetectionResult> {
    const state = await this.request<{ detection: ProjectDetectionResult }>('/api/v1/project/recent', { method: 'POST', body: { path } });
    return state.detection;
  }

  async openDemoProject(): Promise<ProjectDetectionResult> {
    const state = await this.request<{ detection: ProjectDetectionResult }>('/api/v1/project/demo', { method: 'POST' });
    return state.detection;
  }

  closeProject(): Promise<void> {
    return this.request<null>('/api/v1/project/close', { method: 'POST' }).then(() => undefined);
  }

  getProjectState(): Promise<{ detection: ProjectDetectionResult; snapshot: ProjectSnapshot } | null> {
    return this.request<{ detection: ProjectDetectionResult; snapshot: ProjectSnapshot } | null>('/api/v1/project');
  }

  getProjectAudit(): Promise<ProjectAuditSnapshot> {
    return this.request('/api/v1/audit/project');
  }

  getTaskAudit(taskId: string): Promise<TaskAuditSnapshot> {
    return this.request(`/api/v1/audit/task/${encodeURIComponent(taskId)}`);
  }

  getAuditFindings(filter?: AuditFindingFilter): Promise<AuditFinding[]> {
    const query = new URLSearchParams();
    if (filter?.taskId) query.set('taskId', filter.taskId);
    for (const severity of toArray(filter?.severity)) query.append('severity', severity);
    for (const domain of toArray(filter?.domain)) query.append('domain', domain);
    for (const source of toArray(filter?.source)) query.append('source', source);
    if (filter?.canonical !== undefined) query.set('canonical', String(filter.canonical));
    if (filter?.limit !== undefined) query.set('limit', String(filter.limit));
    return this.request(`/api/v1/audit/findings${query.size ? `?${query}` : ''}`);
  }

  getTaskStructuralQuality(taskId: string): Promise<StructuralQualityAuditView> {
    return this.request(`/api/v1/audit/quality/${encodeURIComponent(taskId)}`);
  }

  saveAuditBaseline(): Promise<AuditSnapshotMetadata> {
    return this.request('/api/v1/audit/history/save', { method: 'POST' });
  }

  listAuditHistory(): Promise<AuditSnapshotMetadata[]> {
    return this.request('/api/v1/audit/history');
  }

  compareAudits(baseAuditId: string, currentAuditId?: string): Promise<AuditDiff> {
    return this.request('/api/v1/audit/history/compare', { method: 'POST', body: { baseAuditId, currentAuditId } });
  }

  exportAuditReport(options: AuditExportOptions): Promise<AuditExportResult> {
    return this.request('/api/v1/audit/report', {
      method: 'POST',
      body: { format: options.format, includeDiff: options.includeDiff, baseAuditId: options.baseAuditId },
    });
  }

  getProjectSnapshot(): Promise<ProjectSnapshot> {
    return this.request('/api/v1/project/snapshot');
  }

  getProjectTimeline(): Promise<ProjectTimeline> {
    return this.request('/api/v1/project/timeline');
  }

  getTask(taskId: string): Promise<TaskSnapshot> {
    return this.request(`/api/v1/tasks/${encodeURIComponent(taskId)}`);
  }

  getTaskEvents(taskId: string, cursor?: string, limit?: number): Promise<EventPage> {
    const query = new URLSearchParams();
    if (cursor) query.set('cursor', cursor);
    if (limit !== undefined) query.set('limit', String(limit));
    return this.request(`/api/v1/tasks/events/${encodeURIComponent(taskId)}${query.size ? `?${query}` : ''}`);
  }

  validateEventLedger(taskId: string): Promise<NonNullable<EventPage['validation']>> {
    return this.request(`/api/v1/tasks/ledger/${encodeURIComponent(taskId)}`, { method: 'POST' });
  }

  getPolicyStatus(taskId?: string): Promise<PolicySummary | null> {
    return this.request(taskId ? `/api/v1/tasks/policy/${encodeURIComponent(taskId)}` : '/api/v1/policy');
  }

  getRawArtifact(request: RawArtifactRequest): Promise<string> {
    return this.request('/api/v1/raw-artifact', { method: 'POST', body: request });
  }

  getRawCollectionArtifact(request: RawCollectionArtifactRequest): Promise<string> {
    return this.request('/api/v1/raw-collection-artifact', { method: 'POST', body: request });
  }

  getTaskHistory(taskId: string): Promise<TaskHistoryView> { return this.request(`/api/v1/tasks/history/${encodeURIComponent(taskId)}`); }
  getTaskTrace(taskId: string): Promise<TaskTraceView> { return this.request(`/api/v1/tasks/trace/${encodeURIComponent(taskId)}`); }
  getTaskReflection(taskId: string): Promise<TaskReflectionView> { return this.request(`/api/v1/tasks/reflection/${encodeURIComponent(taskId)}`); }
  getTaskInspection(taskId: string): Promise<TaskInspectionView> { return this.request(`/api/v1/tasks/inspection/${encodeURIComponent(taskId)}`); }
  getTaskActions(taskId: string): Promise<TaskActionsView> { return this.request(`/api/v1/tasks/actions/${encodeURIComponent(taskId)}`); }
  getTaskAction(taskId: string, actionId: string): Promise<DurableActionView | null> { return this.request(`/api/v1/tasks/action/${encodeURIComponent(taskId)}/${encodeURIComponent(actionId)}`); }
  getTaskApprovals(taskId: string): Promise<DurableApprovalView[]> { return this.request(`/api/v1/tasks/approvals/${encodeURIComponent(taskId)}`); }
  getTaskMetrics(taskId: string): Promise<TrajectoryMetricsView> { return this.request(`/api/v1/tasks/metrics/${encodeURIComponent(taskId)}`); }
  getTaskEvaluations(taskId: string): Promise<TrajectoryEvaluationsView> { return this.request(`/api/v1/tasks/evaluations/${encodeURIComponent(taskId)}`); }
  getCapabilityPolicy(): Promise<CapabilityPolicyView> { return this.request('/api/v1/capability-policy'); }
  getTaskWorkspaceBinding(taskId: string): Promise<WorkspaceBindingView> { return this.request(`/api/v1/tasks/workspace-binding/${encodeURIComponent(taskId)}`); }
  getTaskHandoffs(taskId: string): Promise<TaskHandoffsView> { return this.request(`/api/v1/tasks/handoffs/${encodeURIComponent(taskId)}`); }
  getTaskContinuityLint(taskId: string): Promise<ContinuityLintView> { return this.request(`/api/v1/tasks/continuity-lint/${encodeURIComponent(taskId)}`); }
  getTaskResponsibility(taskId: string): Promise<ResponsibilityView> { return this.request(`/api/v1/tasks/responsibility/${encodeURIComponent(taskId)}`); }
  getTaskVerificationScope(taskId: string): Promise<VerificationScopeView> { return this.request(`/api/v1/tasks/verification-scope/${encodeURIComponent(taskId)}`); }
  getTaskAttestation(taskId: string): Promise<TaskAttestationView> { return this.request(`/api/v1/tasks/attestation/${encodeURIComponent(taskId)}`); }
  getTaskExecutionProfileContext(taskId: string): Promise<ExecutionProfileContextView> { return this.request(`/api/v1/tasks/execution-profile/${encodeURIComponent(taskId)}`); }
  getTaskAuditView(taskId: string): Promise<TaskAuditViewProjection> { return this.request(`/api/v1/tasks/audit-view/${encodeURIComponent(taskId)}`); }
  getTaskExecutions(taskId: string, limit?: number): Promise<ExecutionPage> { return this.request(`/api/v1/tasks/executions/${encodeURIComponent(taskId)}${limit === undefined ? '' : `?limit=${limit}`}`); }

  getRecentProjects(): Promise<RecentProject[]> { return this.request('/api/v1/recent-projects'); }
  addRecentProject(project: RecentProject): Promise<void> { return this.request<null>('/api/v1/recent-projects', { method: 'POST', body: project }).then(() => undefined); }
  removeRecentProject(path: string): Promise<void> { return this.request<null>(`/api/v1/recent-projects?path=${encodeURIComponent(path)}`, { method: 'DELETE' }).then(() => undefined); }
  notifyRendererReady(): Promise<void> { return this.request<null>('/api/v1/renderer-ready', { method: 'POST' }).then(() => undefined); }
  getAppVersion(): Promise<string> { return this.request<{ version: string }>('/api/v1/app').then((data) => data.version); }
  getDiagnostics(): Promise<AuditRuntimeDiagnostics> { return this.request('/api/v1/diagnostics'); }
  getRepositoryIndexStatus(): Promise<RepositoryIndexProjection> { return this.request('/api/v1/repository/index-status'); }
  searchRepository(request: RepositorySearchRequest): Promise<RepositorySearchResult> { return this.request('/api/v1/repository/search', { method: 'POST', body: request }); }
  minimizeWindow(): Promise<void> { return Promise.resolve(); }
  toggleMaximizeWindow(): Promise<boolean> { return Promise.resolve(false); }
  getProjectWorkspace(): Promise<ProjectWorkspace> { return this.request('/api/v1/workspace'); }
  addWorkspaceProject(path: string): Promise<ProjectWorkspace> { return this.request('/api/v1/workspace/projects', { method: 'POST', body: { path } }); }
  saveWorkspaceProject(path: string): Promise<ProjectWorkspace> { return this.request('/api/v1/workspace/projects/save', { method: 'POST', body: { path } }); }
  removeWorkspaceProject(path: string): Promise<ProjectWorkspace> { return this.request(`/api/v1/workspace/projects?path=${encodeURIComponent(path)}`, { method: 'DELETE' }); }
  setActiveWorkspaceProject(path: string | null): Promise<ProjectWorkspace> { return this.request('/api/v1/workspace/active', { method: 'POST', body: { path } }); }
  refreshWorkspaceProject(path: string): Promise<ProjectWorkspace> { return this.request(`/api/v1/workspace/projects/refresh?path=${encodeURIComponent(path)}`, { method: 'POST' }); }
  getKanbanBoard(projectPath?: string | null): Promise<KanbanBoard> { return this.request(projectPath ? `/api/v1/kanban?project=${encodeURIComponent(projectPath)}` : '/api/v1/kanban'); }
  getWorkspaceTimeline(path: string): Promise<ProjectTimeline> { return this.request(`/api/v1/workspace/timeline?path=${encodeURIComponent(path)}`); }

  subscribeProjectUpdates(listener: (update: ProjectUpdate) => void): () => void {
    let source: EventSource | null = null;
    let cancelled = false;
    void this.ensureSession().then(() => {
      if (cancelled) return;
      source = new EventSource('/api/v1/events', { withCredentials: true });
      source.addEventListener('project-update', (event) => {
        try { listener(JSON.parse((event as MessageEvent<string>).data) as ProjectUpdate); } catch (error) { console.error('Invalid project update from local server', error); }
      });
      source.addEventListener('error', () => undefined);
    }).catch((error: unknown) => console.error('Failed to establish local update stream', error));
    return () => {
      cancelled = true;
      source?.close();
    };
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    await this.ensureSession();
    const response = await fetch(path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = await response.json() as ApiEnvelope<T>;
    if (!response.ok || payload.ok !== true) {
      const error = payload.error;
      throw new AuditHttpError(error?.message ?? 'The local web request failed', error?.code, error?.retryable ?? response.status >= 500);
    }
    return payload.data as T;
  }

  private ensureSession(): Promise<void> {
    if (this.bootstrapPromise) return this.bootstrapPromise;
    const token = new URLSearchParams(window.location.search).get('bootstrap');
    this.bootstrapPromise = token
      ? fetch('/api/v1/session/bootstrap', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ token }) })
        .then(async (response) => {
          const payload = await response.json() as ApiEnvelope<unknown>;
          if (!response.ok || payload.ok !== true) throw new AuditHttpError(payload.error?.message ?? 'Browser bootstrap failed', payload.error?.code ?? 'BOOTSTRAP_FAILED', false);
          window.history.replaceState({}, document.title, window.location.pathname);
        })
      : Promise.resolve();
    return this.bootstrapPromise;
  }
}

let client: ForgeLoopAuditAPI | null = null;

export function getAuditClient(): ForgeLoopAuditAPI {
  client ??= new HttpAuditClient();
  return client;
}

export const auditApi = getAuditClient();

function toArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
