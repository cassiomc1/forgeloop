import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { z } from 'zod';
import { PathBoundary } from '@main/security/path-boundary';
import { ForgeLoopAuditError } from '@shared/errors';
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
import type { AuditAppError } from '@shared/domain';
import type { AuditRuntimeDiagnostics } from '@shared/diagnostics';
import type {
  EventPage,
  ExecutionPage,
  ForgeLoopCompatibilityMode,
  ForgeLoopFeatureSupport,
  KanbanBoard,
  ProjectDetectionResult,
  ProjectTimeline,
  ProjectKind,
  ProjectSnapshot,
  ProjectUpdate,
  ProjectWorkspace,
  RecentProject,
  RepositoryIndexProjection,
  RepositorySearchRequest,
  RepositorySearchResult,
  TaskActionsView,
  TaskAttestationView,
  TaskHandoffsView,
  TaskHistoryView,
  TaskInspectionView,
  TaskReflectionView,
  TaskSnapshot,
  TaskTraceView,
  TrajectoryEvaluationsView,
  TrajectoryMetricsView,
  CapabilityPolicyView,
  WorkspaceBindingView,
  ContinuityLintView,
  ResponsibilityView,
  VerificationScopeView,
  ExecutionProfileContextView,
  TaskAuditViewProjection,
  PolicySummary,
  RawArtifactRequest,
  RawCollectionArtifactRequest,
} from '@shared/domain';
import { resolveRecentProjectKind } from './project-kind';
import { buildKanbanBoard } from '@shared/kanban';
import { WorkspaceRuntime, resolveWorkspaceProjectPath, type WorkspaceRuntimeOptions } from './workspace-runtime';
import { createProjectSnapshotBuilder, normalizePolicyStatus, type ProjectSnapshotBuilder, type ProjectCompatibilityContext } from '@main/core/project/project-snapshot';
import { createProjectDetector, createProjectReader, type ProjectReader } from '@main/core/project/project-reader';
import { ForgeCli } from '@main/core/cli/forge-cli';
import { createProjectWatcher, type WatcherEvent } from '@main/watcher/project-watcher';
import { createExecutionReader, type ExecutionReader } from '@main/core/executions/execution-reader';
import { createTaskIndexer, createTaskSnapshotBuilder, createGateReader, type TaskIndexer, type TaskSnapshotBuilder } from '@main/core/tasks/task-index';
import { createEventLedgerReader, type EventLedgerReader } from '@main/core/events/ledger-reader';
import { createForgeLoopIntegration, type ForgeLoopIntegrationAdapter } from '@main/core/integration/forgeloop-integration';
import { normalizeCanonicalProtocolInfo, negotiateCompatibilityMode } from '@main/core/protocol/protocol-capabilities';
import { runAuditReadCommand } from '@main/core/integration/audit-read-commands';
import { projectAuditView } from '@main/core/integration/audit-ux-projection';
import { createCanonicalObservabilityService, type CanonicalObservabilityService } from '@main/core/integration/canonical-observability';
import { createCanonicalActionsService, type CanonicalActionsService } from '@main/core/integration/canonical-actions';
import { createCanonicalTrajectoryService, type CanonicalTrajectoryService } from '@main/core/integration/canonical-trajectory';
import { createCanonicalExecutionProfileContextService, type CanonicalExecutionProfileContextService } from '@main/core/integration/canonical-execution-profile';
import { createCanonicalTaskBoundariesService, type CanonicalTaskBoundariesService } from '@main/core/integration/canonical-task-boundaries';
import { createCanonicalContinuityLintService, type CanonicalContinuityLintService } from '@main/core/integration/canonical-continuity-lint';
import { createCanonicalTaskReadService, type CanonicalTaskReadService } from '@main/core/tasks/canonical-task-read-service';
import { resolveTrustedSchemaDirectory, SchemaValidator } from '@main/core/protocol/validator';
import { buildAuditRuntimeDiagnostics } from '@main/core/diagnostics/diagnostics';
import { isFixtureProjectMode as resolveFixtureProjectMode } from './fixture-mode';
import { resolveBundledDemoPath } from '@main/demo/demo-path';
import { createProjectAuditService, type ProjectAuditService } from '@main/core/audit/project-audit-service';
import { createStructuralQualityAuditService, type StructuralQualityAuditService } from '@main/core/audit/structural-quality-service';
import { AuditSnapshotStore } from '@main/core/audit/audit-snapshot-store';
import { diffAuditSnapshots } from '@main/core/audit/audit-diff';
import { buildAuditReport } from '@main/core/audit/audit-report';
import { createProjectFingerprint } from '@main/core/audit/audit-fingerprint';
import { validateAuditExportPath } from '@main/core/audit/audit-export-path';
import { RecentProjectsStore } from '../storage/app-data';
import { deriveProjectTimeline } from '@main/core/timeline/project-timeline';

const TaskIdSchema = z.string().min(1).max(200);
const EventQuerySchema = z.object({ taskId: TaskIdSchema, cursor: z.string().max(256).optional(), limit: z.number().int().min(1).max(500).optional() });
const RecentProjectSchema = z.object({ path: z.string().min(1).max(4096), name: z.string().max(300), lastOpenedAt: z.string().max(100), kind: z.enum(['PROJECT', 'DEMO']).optional() });
const RawArtifactSchema = z.object({ taskId: TaskIdSchema, artifact: z.enum(['task.json', 'contract.json', 'routing-result.json', 'preflight.json', 'work-state.json', 'continuity.json', 'recovery.json', 'execution-receipt.json', 'policy-snapshot.json', 'events.ndjson', 'workspace-binding.json', 'responsibility.json', 'verification-scope.json']) });
const RawCollectionArtifactSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('action'), taskId: TaskIdSchema, actionId: z.string().regex(/^action-[A-Za-z0-9_-]+$/) }),
  z.object({ kind: z.literal('approval'), taskId: TaskIdSchema, approvalId: z.string().regex(/^approval-[A-Za-z0-9_-]+$/) }),
  z.object({ kind: z.literal('evaluation'), taskId: TaskIdSchema, evaluationId: z.string().regex(/^eval-[A-Za-z0-9_-]+$/) }),
  z.object({ kind: z.literal('handoff'), taskId: TaskIdSchema, handoffId: z.string().regex(/^handoff-[A-Za-z0-9_-]+$/) }),
  z.object({ kind: z.literal('code-manifest'), taskId: TaskIdSchema }),
  z.object({ kind: z.literal('attestation-statement'), taskId: TaskIdSchema }),
  z.object({ kind: z.literal('attestation-bundle'), taskId: TaskIdSchema }),
  z.object({ kind: z.literal('capability-policy') }),
]);
const ExecutionQuerySchema = z.object({ taskId: TaskIdSchema, limit: z.number().int().min(1).max(100).optional() });
const AuditFindingFilterSchema = z.object({
  taskId: TaskIdSchema.nullable().optional(),
  severity: z.union([z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN']), z.array(z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN']))]).optional(),
  domain: z.union([z.string().min(1).max(80), z.array(z.string().min(1).max(80))]).optional(),
  source: z.union([z.string().min(1).max(80), z.array(z.string().min(1).max(80))]).optional(),
  canonical: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});
const AuditExportSchema = z.object({
  format: z.enum(['JSON', 'MARKDOWN', 'SARIF']),
  destinationPath: z.string().min(1).max(4096),
  includeDiff: z.boolean().optional(),
  baseAuditId: z.string().max(300).optional(),
  allowProjectProtocolPath: z.boolean().optional(),
});

export interface AuditProjectState {
  detection: ProjectDetectionResult;
  snapshot: ProjectSnapshot;
}

export interface AuditRuntimeOptions extends WorkspaceRuntimeOptions {
  auditVersion: string;
  applicationDataRoot: string;
  schemaDirectory?: string;
  appPath?: string;
  demoPath?: string | null;
  environment?: NodeJS.ProcessEnv;
  fixtureMode?: boolean;
  onUpdate?: (update: ProjectUpdate) => void;
}

/**
 * Runtime-neutral implementation of the local ForgeLoopAudit session.
 *
 * The local web host owns transport and session policy around this runtime.
 * Protocol semantics remain in the domain layer while cookies, HTTP policy and
 * SSE delivery stay in the server layer.
 */
export class AuditRuntime {
  private readonly options: AuditRuntimeOptions;
  private readonly recentProjects: RecentProjectsStore;
  private readonly listeners = new Set<(update: ProjectUpdate) => void>();
  private currentProjectBoundary: PathBoundary | null = null;
  private currentProjectReader: ProjectReader | null = null;
  private currentTaskIndexer: TaskIndexer | null = null;
  private currentTaskSnapshotBuilder: TaskSnapshotBuilder | null = null;
  private currentEventReader: EventLedgerReader | null = null;
  private currentExecutionReader: ExecutionReader | null = null;
  private currentCanonicalTaskService: CanonicalTaskReadService | null = null;
  private currentForgeCli: ForgeCli | null = null;
  private currentIntegration: ForgeLoopIntegrationAdapter | null = null;
  private currentCompatibilityMode: ForgeLoopCompatibilityMode = 'ARTIFACT_ONLY';
  private currentFeatureSupport: ForgeLoopFeatureSupport | null = null;
  private currentObservability: CanonicalObservabilityService | null = null;
  private currentActions: CanonicalActionsService | null = null;
  private currentTrajectory: CanonicalTrajectoryService | null = null;
  private currentExecutionProfileContext: CanonicalExecutionProfileContextService | null = null;
  private currentTaskBoundaries: CanonicalTaskBoundariesService | null = null;
  private currentContinuityLint: CanonicalContinuityLintService | null = null;
  private currentWatcher: ReturnType<typeof createProjectWatcher> | null = null;
  private currentSnapshotBuilder: ProjectSnapshotBuilder | null = null;
  private currentProjectAuditService: ProjectAuditService | null = null;
  private currentStructuralQualityService: StructuralQualityAuditService | null = null;
  private currentAuditHistoryStore: AuditSnapshotStore | null = null;
  private currentAuditSnapshot: ProjectAuditSnapshot | null = null;
  private currentTimelineCache: { key: string; value: ProjectTimeline } | null = null;
  private currentDetection: ProjectDetectionResult | null = null;
  private snapshotRefreshScheduled = false;
  private snapshotRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotGeneration = 0;
  private readonly workspace: WorkspaceRuntime;
  /** The deep canonical build produced by the most recent open or background refresh. */
  private lastDeepSnapshot: ProjectSnapshot | null = null;

  constructor(options: AuditRuntimeOptions) {
    this.options = options;
    this.recentProjects = new RecentProjectsStore({ applicationDataRoot: options.applicationDataRoot });
    // Workspace updates and the deep project session share one update stream so
    // cross-project views refresh in the same tick as the active project.
    this.workspace = new WorkspaceRuntime({ ...options, onUpdate: (update) => this.notify(update) });
    if (options.onUpdate) this.listeners.add(options.onUpdate);
  }

  subscribe(listener: (update: ProjectUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async selectProject(): Promise<ProjectDetectionResult | null> {
    // A browser cannot open an arbitrary local directory. The CLI owns the
    // initial project selection; the UI can reopen a server-owned recent path
    // or the bundled demo through explicit routes.
    return null;
  }

  async openRecentProject(projectPath: string): Promise<ProjectDetectionResult> {
    const safePath = z.string().min(1).max(4096).parse(projectPath);
    const recent = await this.recentProjects.list();
    if (!recent.some((entry) => entry.path === safePath)) {
      throw ForgeLoopAuditError.pathBoundaryViolation(safePath, 'web clients may only reopen server-owned recent projects');
    }
    return this.openProject(safePath, resolveRecentProjectKind(recent, safePath));
  }

  async openDemoProject(): Promise<ProjectDetectionResult> {
    const demoRoot = this.options.demoPath ?? resolveBundledDemoPath({
      isBundled: false,
      appPath: this.options.appPath ?? process.cwd(),
    });
    if (!demoRoot) throw ForgeLoopAuditError.projectNotForgeLoop('bundled demo');
    return this.openProject(demoRoot, 'DEMO');
  }

  async openProjectForStartup(projectRoot: string, projectKind: ProjectKind = 'PROJECT'): Promise<ProjectDetectionResult> {
    return this.openProject(z.string().min(1).max(4096).parse(projectRoot), projectKind);
  }

  async closeProject(): Promise<void> {
    if (this.snapshotRefreshTimer) {
      clearTimeout(this.snapshotRefreshTimer);
      this.snapshotRefreshTimer = null;
    }
    this.snapshotRefreshScheduled = false;
    if (this.currentWatcher) {
      await this.currentWatcher.stop();
      this.currentWatcher = null;
    }
    this.currentProjectBoundary = null;
    this.currentProjectReader = null;
    this.currentTaskIndexer = null;
    this.currentTaskSnapshotBuilder = null;
    this.currentEventReader = null;
    this.currentExecutionReader = null;
    this.currentCanonicalTaskService = null;
    this.currentForgeCli = null;
    this.currentIntegration = null;
    this.currentCompatibilityMode = 'ARTIFACT_ONLY';
    this.currentFeatureSupport = null;
    this.currentObservability = null;
    this.currentActions = null;
    this.currentTrajectory = null;
    this.currentExecutionProfileContext = null;
    this.currentTaskBoundaries = null;
    this.currentContinuityLint = null;
    this.currentSnapshotBuilder = null;
    this.currentProjectAuditService = null;
    this.currentStructuralQualityService = null;
    this.currentAuditHistoryStore = null;
    this.currentAuditSnapshot = null;
    this.currentTimelineCache = null;
    this.currentDetection = null;
    this.lastDeepSnapshot = null;
    this.snapshotGeneration = 0;
  }

  async shutdown(): Promise<void> {
    await this.closeProject();
    await this.workspace.close();
    this.listeners.clear();
  }

  async getProjectState(): Promise<AuditProjectState | null> {
    if (!this.currentDetection || !this.currentSnapshotBuilder) return null;
    return { detection: this.currentDetection, snapshot: await this.currentSnapshotBuilder.build() };
  }

  async getProjectAudit(): Promise<ProjectAuditSnapshot> {
    if (!this.currentProjectAuditService) throw ForgeLoopAuditError.unknown('No project open');
    const audit = await this.currentProjectAuditService.auditProject();
    this.currentAuditSnapshot = audit;
    return audit;
  }

  async getProjectTimeline(): Promise<ProjectTimeline> {
    if (!this.currentSnapshotBuilder || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    const snapshot = await this.currentSnapshotBuilder.build();
    const forgeLoopVersion = this.currentIntegration?.getPackageVersion() ?? snapshot.protocol.packageVersion ?? null;
    let audit = this.currentAuditSnapshot;
    if (!audit && this.currentProjectAuditService) {
      try {
        audit = await this.currentProjectAuditService.auditProject();
        this.currentAuditSnapshot = audit;
      } catch {
        // The timeline remains useful from bounded project/Git signals when a
        // partial project cannot produce a complete audit snapshot.
      }
    }
    const key = `${this.getCurrentProjectRoot()}:${snapshot.project.head ?? 'no-head'}:${forgeLoopVersion ?? 'unknown'}:${audit?.generatedAt ?? 'no-audit'}`;
    if (this.currentTimelineCache?.key === key) return this.currentTimelineCache.value;
    const timeline = await deriveProjectTimeline({
      projectRoot: this.getCurrentProjectRoot()!,
      snapshot,
      audit,
      forgeLoopVersion,
    });
    this.currentTimelineCache = { key, value: timeline };
    return timeline;
  }

  async getTaskAudit(taskId: string): Promise<TaskAuditSnapshot> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentProjectAuditService) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentProjectAuditService.auditTask(safeTaskId);
  }

  async getAuditFindings(filter?: AuditFindingFilter): Promise<AuditFinding[]> {
    if (!this.currentProjectAuditService) throw ForgeLoopAuditError.unknown('No project open');
    const safeFilter = AuditFindingFilterSchema.parse(filter ?? {}) as AuditFindingFilter;
    const audit = this.currentAuditSnapshot ?? await this.currentProjectAuditService.auditProject();
    this.currentAuditSnapshot = audit;
    return audit.findings.filter((finding) => matchesAuditFindingFilter(finding, safeFilter)).slice(0, safeFilter.limit ?? 1000);
  }

  async getTaskStructuralQuality(taskId: string): Promise<StructuralQualityAuditView> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentStructuralQualityService) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentStructuralQualityService.readTask(safeTaskId);
  }

  async saveAuditBaseline(): Promise<AuditSnapshotMetadata> {
    if (!this.currentProjectAuditService || !this.currentAuditHistoryStore) throw ForgeLoopAuditError.unknown('No project open');
    const audit = await this.currentProjectAuditService.auditProject();
    const metadata = await this.currentAuditHistoryStore.save(audit);
    this.currentAuditSnapshot = { ...audit, auditId: metadata.auditId };
    return metadata;
  }

  async listAuditHistory(): Promise<AuditSnapshotMetadata[]> {
    if (!this.currentAuditHistoryStore) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentAuditHistoryStore.list();
  }

  async compareAudits(baseAuditId: string, currentAuditId?: string): Promise<AuditDiff> {
    const safeBaseId = z.string().min(1).max(300).parse(baseAuditId);
    const safeCurrentId = currentAuditId === undefined ? undefined : z.string().min(1).max(300).parse(currentAuditId);
    if (!this.currentAuditHistoryStore || !this.currentProjectAuditService) throw ForgeLoopAuditError.unknown('No project open');
    const base = await this.currentAuditHistoryStore.read(safeBaseId);
    const current = safeCurrentId
      ? await this.currentAuditHistoryStore.read(safeCurrentId)
      : this.currentAuditSnapshot ?? await this.currentProjectAuditService.auditProject();
    this.currentAuditSnapshot = current;
    return diffAuditSnapshots(base, current);
  }

  async exportAuditReport(options: AuditExportOptions): Promise<AuditExportResult> {
    const safeOptions = AuditExportSchema.parse(options) as AuditExportOptions;
    if (!this.currentProjectAuditService) throw ForgeLoopAuditError.unknown('No project open');
    const audit = this.currentAuditSnapshot ?? await this.currentProjectAuditService.auditProject();
    this.currentAuditSnapshot = audit;
    const destinationPath = validateAuditExportPath(safeOptions.destinationPath, this.getCurrentProjectRoot(), safeOptions.allowProjectProtocolPath === true);
    const content = buildAuditReport(audit, safeOptions.format);
    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, content, { encoding: 'utf8', flag: 'wx' });
    return {
      format: safeOptions.format,
      destinationPath,
      auditId: audit.auditId ?? audit.fingerprint,
      fingerprint: audit.fingerprint,
      bytes: Buffer.byteLength(content, 'utf8'),
      sha256: createHash('sha256').update(content).digest('hex'),
    };
  }

  async getProjectSnapshot(): Promise<ProjectSnapshot> {
    if (!this.currentSnapshotBuilder) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentSnapshotBuilder.build();
  }

  private async listCurrentTasks() {
    if (this.currentProjectReader?.hasNativeStorage()) {
      if (!this.currentSnapshotBuilder) throw ForgeLoopAuditError.unknown('No canonical project reader');
      return this.lastDeepSnapshot?.tasks ?? (await this.currentSnapshotBuilder.build()).tasks;
    }
    return this.currentTaskIndexer?.listTasks() ?? [];
  }

  async getTask(taskId: string): Promise<TaskSnapshot> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentTaskSnapshotBuilder || !this.currentTaskIndexer || !this.currentEventReader || !this.currentProjectReader) {
      throw ForgeLoopAuditError.unknown('No project open');
    }
    const task = (await this.listCurrentTasks()).find((entry) => entry.taskId === safeTaskId || entry.taskKey === safeTaskId);
    if (!task) throw ForgeLoopAuditError.artifactUnreadable(safeTaskId, 'Task not found');
    let artifacts = this.currentProjectReader.readTaskSummaryArtifacts(task.taskKey);
    const canonical = this.currentCanonicalTaskService
      ? await this.currentCanonicalTaskService.readTask(task.taskId, task.taskKey)
      : null;
    if (canonical && this.currentProjectReader.hasNativeStorage()) artifacts = canonical.artifacts;
    const nextResult = canonical ? { success: true as const } : await this.readNextAction(safeTaskId);
    const { summary, events } = this.currentTaskSnapshotBuilder.buildSnapshot(
      task.taskKey,
      artifacts,
      nextResult.success ? (nextResult as { data?: Record<string, unknown> }).data : undefined,
      canonical?.summary,
    );
    return {
      summary,
      contract: artifactObject(artifacts['contract.json']),
      routing: artifactObject(artifacts['routing-result.json']),
      preflight: artifactObject(artifacts['preflight.json']),
      workState: artifactObject(artifacts['work-state.json']),
      continuity: artifactObject(artifacts['continuity.json']),
      executionReceipt: artifactObject(artifacts['execution-receipt.json']),
      events,
      policySnapshot: artifactObject(artifacts['policy-snapshot.json']),
    };
  }

  async getPolicyStatus(taskId?: string): Promise<PolicySummary | null> {
    const safeTaskId = taskId === undefined ? undefined : TaskIdSchema.parse(taskId);
    if (!this.currentForgeCli || !this.currentProjectReader) throw ForgeLoopAuditError.unknown('No project open');
    if (this.isFixtureProjectMode()) return null;
    let policyResult: { success: boolean; data?: Record<string, unknown> };
    if (this.currentIntegration && this.currentCompatibilityMode === 'INTEGRATION_V1' && this.getCurrentProjectRoot()) {
      const outcome = await runAuditReadCommand<Record<string, unknown>>(
        this.currentIntegration,
        this.getCurrentProjectRoot()!,
        'policy-status',
        safeTaskId ? { taskId: safeTaskId } : {},
      );
      policyResult = outcome.kind === 'DOMAIN_OUTCOME' ? { success: true, data: outcome.data ?? undefined } : { success: false };
    } else {
      policyResult = await this.currentForgeCli.policyStatus<Record<string, unknown>>(safeTaskId);
    }
    if (!policyResult.success) return null;
    const config = this.currentProjectReader.tryReadConfig();
    return normalizePolicyStatus(policyResult.data, config && typeof config.complianceMode === 'string' ? config.complianceMode : 'Unknown', 'POLICY_STATUS');
  }

  async getTaskEvents(taskId: string, cursor?: string, limit?: number): Promise<EventPage> {
    const query = EventQuerySchema.parse({ taskId, cursor, limit });
    if (!this.currentTaskIndexer || !this.currentEventReader) throw ForgeLoopAuditError.unknown('No project open');
    if (this.currentProjectReader?.hasNativeStorage()) throw ForgeLoopAuditError.artifactUnreadable('events.ndjson', 'Raw SQLite ledger is unavailable; use canonical History and Trace projections');
    const task = (await this.listCurrentTasks()).find((entry) => entry.taskId === query.taskId || entry.taskKey === query.taskId);
    if (!task) throw ForgeLoopAuditError.artifactUnreadable(query.taskId, 'Task not found');
    return this.currentEventReader.readEventsPaginated(task.taskKey, query.cursor, query.limit);
  }

  async validateEventLedger(taskId: string): Promise<NonNullable<EventPage['validation']>> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentTaskIndexer || !this.currentEventReader) throw ForgeLoopAuditError.unknown('No project open');
    if (this.currentProjectReader?.hasNativeStorage()) throw ForgeLoopAuditError.artifactUnreadable('events.ndjson', 'Raw SQLite ledger is unavailable; use canonical History and Trace projections');
    const task = (await this.listCurrentTasks()).find((entry) => entry.taskId === safeTaskId || entry.taskKey === safeTaskId);
    if (!task) throw ForgeLoopAuditError.artifactUnreadable(safeTaskId, 'Task not found');
    return { ...this.currentEventReader.validateIntegrity(task.taskKey), scope: 'LEDGER' };
  }

  async getRawArtifact(request: RawArtifactRequest): Promise<string> {
    const safeRequest = RawArtifactSchema.parse(request);
    if (!this.currentTaskIndexer || !this.currentProjectReader) throw ForgeLoopAuditError.unknown('No project open');
    if (this.currentProjectReader.hasNativeStorage()) throw ForgeLoopAuditError.artifactUnreadable(safeRequest.artifact, 'Raw SQLite artifacts are unavailable through the public Integration API');
    const task = (await this.listCurrentTasks()).find((entry) => entry.taskId === safeRequest.taskId || entry.taskKey === safeRequest.taskId);
    if (!task) throw ForgeLoopAuditError.artifactUnreadable(safeRequest.taskId, 'Task not found');
    if (safeRequest.artifact === 'events.ndjson') return this.currentProjectReader.readEventPreview(task.taskKey);
    const artifacts = this.currentProjectReader.readTaskSummaryArtifacts(task.taskKey);
    const content = artifacts[safeRequest.artifact as keyof typeof artifacts];
    if (content === undefined) throw ForgeLoopAuditError.artifactUnreadable(safeRequest.artifact, 'Artifact not found');
    return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  }

  async getRawCollectionArtifact(request: RawCollectionArtifactRequest): Promise<string> {
    const safeRequest = RawCollectionArtifactSchema.parse(request);
    if (!this.currentProjectReader || !this.currentTaskIndexer) throw ForgeLoopAuditError.unknown('No project open');
    if (safeRequest.kind === 'capability-policy') return this.currentProjectReader.readRawCapabilityPolicy();
    if (this.currentProjectReader.hasNativeStorage()) throw ForgeLoopAuditError.artifactUnreadable(safeRequest.kind, 'Raw SQLite collections are unavailable; use canonical projections');
    const task = (await this.listCurrentTasks()).find((entry) => entry.taskId === safeRequest.taskId || entry.taskKey === safeRequest.taskId);
    if (!task) throw ForgeLoopAuditError.artifactUnreadable(safeRequest.taskId, 'Task not found');
    return this.currentProjectReader.readRawCollectionArtifact(task.taskKey, safeRequest);
  }

  async getTaskHistory(taskId: string): Promise<TaskHistoryView> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentObservability || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentObservability.getHistory(this.getCurrentProjectRoot()!, safeTaskId);
  }

  async getTaskTrace(taskId: string): Promise<TaskTraceView> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentObservability || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentObservability.getTrace(this.getCurrentProjectRoot()!, safeTaskId);
  }

  async getTaskReflection(taskId: string): Promise<TaskReflectionView> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentObservability || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentObservability.getReflection(this.getCurrentProjectRoot()!, safeTaskId);
  }

  async getTaskInspection(taskId: string): Promise<TaskInspectionView> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentObservability || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentObservability.getInspection(this.getCurrentProjectRoot()!, safeTaskId);
  }

  async getTaskActions(taskId: string): Promise<TaskActionsView> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentActions || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentActions.getActions(this.getCurrentProjectRoot()!, safeTaskId);
  }

  async getTaskAction(taskId: string, actionId: string) {
    const safeTaskId = TaskIdSchema.parse(taskId);
    const safeActionId = z.string().regex(/^action-[A-Za-z0-9_-]+$/).parse(actionId);
    if (!this.currentActions || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentActions.getAction(this.getCurrentProjectRoot()!, safeTaskId, safeActionId);
  }

  async getTaskApprovals(taskId: string) {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentActions || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentActions.getApprovals(this.getCurrentProjectRoot()!, safeTaskId);
  }

  async getTaskMetrics(taskId: string): Promise<TrajectoryMetricsView> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentTrajectory || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentTrajectory.getMetrics(this.getCurrentProjectRoot()!, safeTaskId);
  }

  async getTaskEvaluations(taskId: string): Promise<TrajectoryEvaluationsView> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentTrajectory || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentTrajectory.getEvaluations(this.getCurrentProjectRoot()!, safeTaskId);
  }

  async getCapabilityPolicy(): Promise<CapabilityPolicyView> {
    if (!this.currentActions || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentActions.getCapabilityPolicy(this.getCurrentProjectRoot()!);
  }

  async getTaskWorkspaceBinding(taskId: string): Promise<WorkspaceBindingView> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentTaskBoundaries || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentTaskBoundaries.getWorkspaceBinding(this.getCurrentProjectRoot()!, safeTaskId);
  }

  async getTaskHandoffs(taskId: string): Promise<TaskHandoffsView> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentTaskBoundaries || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentTaskBoundaries.getHandoffs(this.getCurrentProjectRoot()!, safeTaskId);
  }

  async getTaskContinuityLint(taskId: string): Promise<ContinuityLintView> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentContinuityLint || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentContinuityLint.getLint(this.getCurrentProjectRoot()!, safeTaskId);
  }

  async getTaskResponsibility(taskId: string): Promise<ResponsibilityView> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentTaskBoundaries || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentTaskBoundaries.getResponsibility(this.getCurrentProjectRoot()!, safeTaskId);
  }

  async getTaskVerificationScope(taskId: string): Promise<VerificationScopeView> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentTaskBoundaries || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentTaskBoundaries.getVerificationScope(this.getCurrentProjectRoot()!, safeTaskId);
  }

  async getTaskAttestation(taskId: string): Promise<TaskAttestationView> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentTaskBoundaries || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentTaskBoundaries.getAttestation(this.getCurrentProjectRoot()!, safeTaskId);
  }

  async getTaskExecutionProfileContext(taskId: string): Promise<ExecutionProfileContextView> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    if (!this.currentExecutionProfileContext || !this.getCurrentProjectRoot()) throw ForgeLoopAuditError.unknown('No project open');
    return this.currentExecutionProfileContext.getContext(this.getCurrentProjectRoot()!, safeTaskId);
  }

  /**
   * Read the canonical, bounded Audit UX projection (`task/audit-view`) for one
   * task when the capability is advertised. The result is read-only canonical
   * presentation context; ForgeLoopAudit never derives or overrides lifecycle,
   * evidence, ownership, or completion state from it.
   */
  async getTaskAuditView(taskId: string): Promise<TaskAuditViewProjection> {
    const safeTaskId = TaskIdSchema.parse(taskId);
    const projectRoot = this.getCurrentProjectRoot();
    if (!this.currentIntegration || !projectRoot) throw ForgeLoopAuditError.unknown('No project open');
    if (!this.currentIntegration.readTaskAuditView || this.currentFeatureSupport?.auditUx !== true) {
      return {
        available: false,
        authority: 'UNAVAILABLE',
        reason: 'The Audit UX read model is not advertised by this ForgeLoop capability set.',
      };
    }
    try {
      const raw = await this.currentIntegration.readTaskAuditView(projectRoot, safeTaskId, { limit: 50 });
      return projectAuditView(raw);
    } catch (error) {
      return {
        available: false,
        authority: 'UNAVAILABLE',
        reason: error instanceof Error ? error.message : 'Audit UX projection is unavailable for this task.',
      };
    }
  }

  async getTaskExecutions(taskId: string, limit?: number): Promise<ExecutionPage> {
    const query = ExecutionQuerySchema.parse({ taskId, limit });
    if (!this.currentTaskIndexer || !this.currentExecutionReader) throw ForgeLoopAuditError.unknown('No project open');
    if (this.currentProjectReader?.hasNativeStorage()) throw ForgeLoopAuditError.artifactUnreadable('executions', 'Raw SQLite execution records are unavailable; use canonical Trace');
    const task = (await this.listCurrentTasks()).find((entry) => entry.taskId === query.taskId || entry.taskKey === query.taskId);
    if (!task) throw ForgeLoopAuditError.artifactUnreadable(query.taskId, 'Task not found');
    return this.currentExecutionReader.readExecutions(task.taskKey, { limit: query.limit });
  }

  async getRecentProjects(): Promise<RecentProject[]> {
    return this.recentProjects.list();
  }

  async addRecentProject(project: RecentProject): Promise<void> {
    await this.recentProjects.add(RecentProjectSchema.parse(project));
  }

  async removeRecentProject(path: string): Promise<void> {
    await this.recentProjects.remove(z.string().min(1).max(4096).parse(path));
  }

  async getProjectWorkspace(): Promise<ProjectWorkspace> {
    const workspace = await this.workspace.getWorkspace();
    // The open project is additionally reported from the deep canonical session,
    // whose health is authoritative. The cached build is used rather than a
    // fresh one so a cross-project read never competes with the snapshot the
    // deep session is building; the event stream always notifies before the
    // client reads, so the cached build is current.
    const deepSnapshot = await this.deepSnapshotForWorkspace();
    if (!deepSnapshot) return workspace;
    return {
      ...workspace,
      projects: workspace.projects.map((project) => project.path === deepSnapshot.project.rootPath
        ? {
          ...project,
          name: deepSnapshot.project.name,
          health: deepSnapshot.health.status,
          taskCount: deepSnapshot.tasks.length,
          blockedCount: deepSnapshot.tasks.filter((task) => task.phase === 'BLOCKED').length,
          completeCount: deepSnapshot.tasks.filter((task) => task.phase === 'COMPLETE').length,
          inProgressCount: deepSnapshot.tasks.filter((task) => task.phase === 'EXECUTING' || task.phase === 'VERIFYING').length,
          branch: deepSnapshot.project.branch,
          head: deepSnapshot.project.head,
          available: true,
          error: undefined,
        }
        : project),
    };
  }

  /**
   * Register a project in the workspace and make it the active project. This is
   * the "open" path: the project is persisted and opened for deep inspection.
   */
  async openWorkspaceProject(projectPath: string, kind: ProjectKind = 'PROJECT'): Promise<ProjectWorkspace> {
    const resolved = await resolveWorkspaceProjectPath(projectPath);
    // `openProject` registers the project in the workspace as part of opening it.
    await this.openProject(resolved, kind);
    return this.getProjectWorkspace();
  }

  /**
   * Save a project to the workspace without switching to it. The project keeps a
   * live session so its board and status stay current, but the open project and
   * every task-detail surface stay untouched.
   */
  async saveWorkspaceProject(projectPath: string, kind: ProjectKind = 'PROJECT'): Promise<ProjectWorkspace> {
    const resolved = await resolveWorkspaceProjectPath(projectPath);
    await this.workspace.addProject(resolved, kind);
    return this.getProjectWorkspace();
  }

  async removeWorkspaceProject(projectPath: string): Promise<ProjectWorkspace> {
    const resolved = z.string().min(1).max(4096).parse(projectPath);
    if (this.getCurrentProjectRoot() === resolve(resolved)) await this.closeProject();
    await this.workspace.removeProject(resolved);
    return this.getProjectWorkspace();
  }

  async refreshWorkspaceProject(projectPath: string): Promise<ProjectWorkspace> {
    await this.workspace.refreshProject(projectPath);
    return this.getProjectWorkspace();
  }

  async getKanbanBoard(projectPath?: string | null): Promise<KanbanBoard> {
    return this.buildKanbanBoard(projectPath ?? null);
  }

  /**
   * The board prefers the deep snapshot for the open project so its cards match
   * the canonical task detail, and the lightweight session for every other
   * registered project.
   */
  private async buildKanbanBoard(projectPath: string | null): Promise<KanbanBoard> {
    const workspace = await this.getProjectWorkspace();
    const deepSnapshot = await this.deepSnapshotForWorkspace();
    const projects = workspace.projects.map((project) => ({
      path: project.path,
      name: project.name,
      kind: project.kind,
      snapshot: project.path === deepSnapshot?.project.rootPath ? deepSnapshot : this.workspace.getSnapshot(project.path),
    }));
    return buildKanbanBoard({ projects, filterProjectPath: projectPath, generatedAt: new Date().toISOString() });
  }

  /**
   * The canonical snapshot the deep session already built, or a fresh build
   * only when none exists yet. Cross-project reads intentionally never trigger
   * a rebuild: they would contend with the snapshot the deep session is
   * building, and the client always reads after the update was pushed.
   */
  private deepSnapshotForWorkspace(): Promise<ProjectSnapshot | null> {
    if (this.lastDeepSnapshot) return Promise.resolve(this.lastDeepSnapshot);
    if (!this.currentSnapshotBuilder) return Promise.resolve(null);
    return this.currentSnapshotBuilder.build().catch(() => null);
  }

  async getWorkspaceTimeline(projectPath: string): Promise<ProjectTimeline> {
    return this.workspace.getTimeline(projectPath);
  }

  async notifyRendererReady(): Promise<void> {
    const environment = this.options.environment ?? process.env;
    if (!this.options.fixtureMode && resolveFixtureProjectMode(false, environment)) {
      const fixturePath = environment.FORGELOOP_AUDIT_FIXTURE_PROJECT;
      if (fixturePath && resolve(fixturePath) !== this.getCurrentProjectRoot()) await this.openProject(fixturePath, 'PROJECT');
    }
  }

  getAppVersion(): string {
    return this.options.auditVersion;
  }

  getDiagnostics(): AuditRuntimeDiagnostics {
    return buildAuditRuntimeDiagnostics({
      auditVersion: this.options.auditVersion,
      forgeLoopCompatibilityMode: this.currentCompatibilityMode,
      protocolVersion: this.currentDetection?.protocolVersion,
      watcherStatus: this.currentWatcher ? 'active' : 'inactive',
    });
  }

  async getRepositoryIndexStatus(): Promise<RepositoryIndexProjection> {
    if (!this.currentIntegration || !this.currentFeatureSupport?.repositoryIndex || !this.getCurrentProjectRoot()) {
      return unavailableRepositoryIndex('ForgeLoop Repository Index is not available for this project.');
    }
    if (!this.currentIntegration.getRepositoryIndexStatus) return unavailableRepositoryIndex('The installed ForgeLoop Integration API does not expose Repository Index status.');
    return this.currentIntegration.getRepositoryIndexStatus(this.getCurrentProjectRoot()!);
  }

  async searchRepository(request: RepositorySearchRequest): Promise<RepositorySearchResult> {
    const safeRequest = z.object({
      pattern: z.string().min(1).max(1000),
      globs: z.array(z.string().max(200)).max(50).optional(),
      types: z.array(z.string().max(100)).max(50).optional(),
      fixedStrings: z.boolean().optional(),
      ignoreCase: z.boolean().optional(),
      smartCase: z.boolean().optional(),
      wordRegexp: z.boolean().optional(),
      context: z.number().int().min(0).max(20).nullable().optional(),
      beforeContext: z.number().int().min(0).max(20).nullable().optional(),
      afterContext: z.number().int().min(0).max(20).nullable().optional(),
      maxCount: z.number().int().min(1).max(10000).nullable().optional(),
      filesWithMatches: z.boolean().optional(),
      stats: z.boolean().optional(),
    }).parse(request) as RepositorySearchRequest;
    if (!this.currentIntegration || !this.currentFeatureSupport?.repositoryIndex || !this.getCurrentProjectRoot()) {
      return unavailableRepositorySearch(safeRequest, 'ForgeLoop Repository Search is not available for this project.');
    }
    if (!this.currentIntegration.searchRepository) return unavailableRepositorySearch(safeRequest, 'The installed ForgeLoop Integration API does not expose Repository Search.');
    return this.currentIntegration.searchRepository(this.getCurrentProjectRoot()!, safeRequest);
  }

  getCurrentProjectRoot(): string | null {
    return this.currentProjectBoundary?.getProjectRoot() ?? null;
  }

  private async openProject(projectRoot: string, projectKind: ProjectKind = 'PROJECT'): Promise<ProjectDetectionResult> {
    await this.closeProject();
    this.snapshotGeneration = 0;
    const pathBoundary = new PathBoundary(projectRoot);
    const schemaDir = this.options.schemaDirectory ?? resolveTrustedSchemaDirectory({
      allowEnvironmentOverride: true,
      appPath: this.options.appPath ?? process.cwd(),
      cwd: process.cwd(),
      moduleDir: process.cwd(),
    });
    const protocolSchemas = new SchemaValidator(schemaDir);
    const detector = createProjectDetector(pathBoundary, protocolSchemas);
    const detectionResult = detector.detect();
    if (!detectionResult.compatible) throw ForgeLoopAuditError.protocolUnsupported(detectionResult.protocolVersion, projectRoot);

    this.currentProjectBoundary = pathBoundary;
    this.currentProjectReader = createProjectReader(pathBoundary, protocolSchemas);
    const fixtureCliDisabled = this.isFixtureProjectMode();
    this.currentForgeCli = new ForgeCli(projectRoot, fixtureCliDisabled ? '__fixture_cli_unavailable__' : 'forgeloop');

    const integration = await createForgeLoopIntegration();
    let canonicalProtocolInfo: ReturnType<typeof normalizeCanonicalProtocolInfo> = null;
    try {
      canonicalProtocolInfo = normalizeCanonicalProtocolInfo(await integration.readProtocolInfo(projectRoot));
    } catch {
      canonicalProtocolInfo = null;
    }
    if (!this.currentProjectReader.hasNativeStorage()) canonicalProtocolInfo = null;
    const negotiation = negotiateCompatibilityMode({ protocolInfo: canonicalProtocolInfo, capabilities: integration.getCapabilities() });
    if (negotiation.mode === 'INCOMPATIBLE') {
      throw ForgeLoopAuditError.protocolUnsupported(canonicalProtocolInfo?.protocolVersion ?? detectionResult.protocolVersion, projectRoot);
    }
    this.currentIntegration = integration;
    this.currentCompatibilityMode = negotiation.mode;
    this.currentFeatureSupport = negotiation.featureSupport;
    this.currentObservability = createCanonicalObservabilityService({ integration, featureSupport: negotiation.featureSupport });
    this.currentActions = createCanonicalActionsService({ integration, featureSupport: negotiation.featureSupport });
    this.currentTrajectory = createCanonicalTrajectoryService({ integration, featureSupport: negotiation.featureSupport });
    this.currentExecutionProfileContext = createCanonicalExecutionProfileContextService({ integration, featureSupport: negotiation.featureSupport });
    this.currentTaskBoundaries = createCanonicalTaskBoundariesService({
      integration,
      featureSupport: negotiation.featureSupport,
      readAttestationConfig: () => this.currentProjectReader?.tryReadConfig() ?? null,
    });
    this.currentContinuityLint = createCanonicalContinuityLintService({ integration });
    detectionResult.forgeLoopVersion = canonicalProtocolInfo?.packageVersion ?? detectionResult.forgeLoopVersion;
    detectionResult.compatibilityMode = negotiation.mode;
    detectionResult.warnings = [
      ...detectionResult.warnings,
      negotiation.mode === 'INTEGRATION_V1'
        ? 'Compatibility negotiated through ForgeLoop Integration API v1.'
        : `Degraded compatibility mode: ${negotiation.mode}${negotiation.reason ? ` (${negotiation.reason})` : ''}.`,
    ];

    const taskEventReader = createEventLedgerReader(pathBoundary, protocolSchemas);
    const gateReader = createGateReader(pathBoundary, protocolSchemas);
    this.currentTaskIndexer = createTaskIndexer(pathBoundary, this.currentProjectReader);
    this.currentEventReader = taskEventReader;
    this.currentExecutionReader = createExecutionReader(pathBoundary, protocolSchemas);
    this.currentCanonicalTaskService = negotiation.mode === 'INTEGRATION_V1'
      ? createCanonicalTaskReadService({ projectRoot, projectReader: this.currentProjectReader, integration })
      : null;
    this.currentTaskSnapshotBuilder = createTaskSnapshotBuilder(pathBoundary, taskEventReader, gateReader);

    const compatibilityContext: ProjectCompatibilityContext = {
      source: canonicalProtocolInfo ? 'PROTOCOL_INFO' : 'ARTIFACT_ONLY',
      protocolVersion: canonicalProtocolInfo?.protocolVersion ?? detectionResult.protocolVersion,
      schemaVersion: canonicalProtocolInfo?.schemaVersion ?? detectionResult.schemaVersion,
      packageVersion: canonicalProtocolInfo?.packageVersion ?? undefined,
      compatibilityMode: negotiation.mode,
      featureSupport: negotiation.featureSupport,
    };
    this.currentSnapshotBuilder = createProjectSnapshotBuilder(
      pathBoundary,
      this.currentProjectReader,
      this.currentForgeCli,
      compatibilityContext,
      !fixtureCliDisabled,
      integration,
    );
    this.currentStructuralQualityService = createStructuralQualityAuditService({ projectRoot, integration, featureSupport: negotiation.featureSupport });
    this.currentProjectAuditService = createProjectAuditService({
      projectRoot,
      snapshotBuilder: this.currentSnapshotBuilder,
      integration: negotiation.mode === 'INTEGRATION_V1' ? integration : null,
      observability: negotiation.mode === 'INTEGRATION_V1' ? this.currentObservability : null,
      compatibilityMode: negotiation.mode,
      featureSupport: negotiation.featureSupport,
      forgeLoopPackageVersion: canonicalProtocolInfo?.packageVersion ?? integration.getPackageVersion(),
    });
    this.currentAuditHistoryStore = new AuditSnapshotStore({
      userDataPath: this.options.applicationDataRoot,
      projectFingerprint: createProjectFingerprint(projectRoot),
    });
    this.currentAuditSnapshot = null;
    this.currentTimelineCache = null;
    this.currentWatcher = createProjectWatcher(pathBoundary, this.handleWatcherEvent, this.handleWatcherError, this.handleWatcherStatusChange);
    this.currentWatcher.start();

    const recentProject: RecentProject = {
      path: projectRoot,
      name: basename(projectRoot) || 'Unknown',
      lastOpenedAt: new Date().toISOString(),
      kind: projectKind,
    };
    await this.recentProjects.add(recentProject);
    this.currentDetection = classifyDetection(detectionResult, projectKind);
    // Opening a project also registers it in the workspace so it stays tracked
    // and live even after the user switches to another project. It is registered
    // without a second watcher or snapshot build: this runtime already watches
    // and builds it, and the workspace reports it from the deep snapshot.
    await this.workspace.addProject(projectRoot, projectKind, { monitor: false });
    await this.workspace.setActiveProject(projectRoot);
    const initialSnapshot = await this.currentSnapshotBuilder.build();
    this.lastDeepSnapshot = initialSnapshot;
    this.notify({
      type: 'project-opened',
      detection: this.currentDetection,
      snapshot: initialSnapshot,
      generation: this.snapshotGeneration,
      timestamp: new Date().toISOString(),
    });
    return this.currentDetection;
  }

  private async readNextAction(taskId: string): Promise<{ success: boolean; data?: Record<string, unknown> }> {
    if (this.currentIntegration && this.currentCompatibilityMode === 'INTEGRATION_V1' && this.getCurrentProjectRoot()) {
      const outcome = await runAuditReadCommand<Record<string, unknown>>(this.currentIntegration, this.getCurrentProjectRoot()!, 'next', { taskId });
      if (outcome.kind === 'DOMAIN_OUTCOME') return { success: true, data: outcome.data ?? undefined };
      return { success: false };
    }
    return this.currentForgeCli ? this.currentForgeCli.next(taskId) : { success: false };
  }

  private isFixtureProjectMode(): boolean {
    return this.options.fixtureMode ?? resolveFixtureProjectMode(false, this.options.environment ?? process.env);
  }

  private readonly handleWatcherEvent = (event: WatcherEvent): void => {
    const timestamp = new Date().toISOString();
    this.currentAuditSnapshot = null;
    const taskId = this.watcherTaskId(event);
    this.notify({ type: 'audit-invalidated', taskId, data: { reason: 'ForgeLoop project state changed', event }, generation: ++this.snapshotGeneration, timestamp });
    const targetedType: ProjectUpdate['type'] = event.type === 'action-changed'
      || event.type === 'approval-changed'
      || event.type === 'evaluation-changed'
      || event.type === 'capability-policy-changed'
      || event.type === 'workspace-binding-changed'
      || event.type === 'handoff-changed'
      || event.type === 'responsibility-changed'
      || event.type === 'verification-scope-changed'
      || event.type === 'attestation-changed'
      ? event.type
      : 'task-updated';
    this.notify({ type: targetedType, taskId, data: event, generation: ++this.snapshotGeneration, timestamp });
    this.notify({ type: 'watcher-status', data: { active: true, lastEventAt: timestamp, lastEventType: event.type, lastTaskId: taskId }, timestamp });
    if (event.type === 'execution-changed' || event.type === 'event-appended' || event.type === 'action-changed' || event.type === 'approval-changed' || event.type === 'evaluation-changed' || event.type === 'capability-policy-changed' || event.type === 'workspace-binding-changed' || event.type === 'handoff-changed' || event.type === 'responsibility-changed' || event.type === 'verification-scope-changed' || event.type === 'attestation-changed') return;
    if (this.currentSnapshotBuilder && !this.snapshotRefreshScheduled) {
      this.snapshotRefreshScheduled = true;
      this.snapshotRefreshTimer = setTimeout(async () => {
        this.snapshotRefreshTimer = null;
        this.snapshotRefreshScheduled = false;
        const builder = this.currentSnapshotBuilder;
        if (!builder) return;
        const generation = this.snapshotGeneration;
        try {
          const snapshot = await builder.build();
          if (this.currentSnapshotBuilder !== builder) return;
          this.lastDeepSnapshot = snapshot;
          this.notify({ type: 'snapshot-refreshed', snapshot, generation, timestamp: new Date().toISOString() });
        } catch (error) {
          console.error('Failed to refresh project snapshot:', error);
        }
      }, 100);
    }
  };

  private readonly handleWatcherError = (error: Error): void => {
    const timestamp = new Date().toISOString();
    const auditError: AuditAppError = { code: 'WATCHER_FAILED', message: 'Filesystem watcher failed', recoverable: true };
    this.notify({ type: 'watcher-status', data: { active: false, error: error.message }, timestamp });
    this.notify({ type: 'error', data: auditError, timestamp });
  };

  private readonly handleWatcherStatusChange = (active: boolean): void => {
    this.notify({ type: 'watcher-status', data: { active }, timestamp: new Date().toISOString() });
  };

  private watcherTaskId(event: WatcherEvent): string | undefined {
    if (!event.taskKey || !this.currentProjectReader) return undefined;
    try {
      const descriptor = this.currentProjectReader.readTaskDescriptor(event.taskKey);
      return typeof descriptor.taskId === 'string' ? descriptor.taskId : undefined;
    } catch {
      return undefined;
    }
  }

  private notify(update: ProjectUpdate): void {
    for (const listener of this.listeners) listener(update);
  }
}

function classifyDetection(detectionResult: ProjectDetectionResult, projectKind: ProjectKind): ProjectDetectionResult {
  return { ...detectionResult, projectKind };
}

function matchesAuditFindingFilter(finding: AuditFinding, filter: AuditFindingFilter): boolean {
  const matches = <T extends string>(actual: T, expected: T | T[] | undefined): boolean => {
    if (expected === undefined) return true;
    return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
  };
  return (filter.taskId === undefined || filter.taskId === finding.taskId)
    && matches(finding.severity, filter.severity)
    && matches(finding.domain, filter.domain)
    && matches(finding.source, filter.source)
    && (filter.canonical === undefined || filter.canonical === finding.canonical);
}

function unavailableRepositoryIndex(message: string): RepositoryIndexProjection {
  return {
    schemaVersion: null,
    available: false,
    source: 'UNAVAILABLE',
    required: null,
    engine: null,
    engineVersion: null,
    managedBinary: null,
    overridden: null,
    index: { present: null, complete: null, files: null, trigrams: null, createdAt: null, updatedAt: null },
    policy: { maxFileSize: null, maxCpuPercent: null, watcherQueueCap: null, autoSaveMutations: null },
    server: { running: null, owned: null, pid: null, port: null, watcher: null, indexing: null, files: null },
    health: 'UNAVAILABLE',
    diagnostics: [{ code: 'REPOSITORY_INDEX_UNAVAILABLE', message }],
    message,
  };
}

function unavailableRepositorySearch(request: RepositorySearchRequest, message: string): RepositorySearchResult {
  return {
    available: false,
    source: 'UNAVAILABLE',
    query: { ...request, globs: request.globs ?? [], types: request.types ?? [] },
    repositoryIndex: null,
    matches: [],
    contexts: [],
    files: [],
    stats: {},
    metrics: null,
    trust: 'DISCOVERY_ONLY',
    message,
  };
}

function artifactObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
