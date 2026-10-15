import { useState, useEffect, useCallback, useRef } from 'react';
import type { ProjectDetectionResult, ProjectSnapshot, ProjectUpdate, WatcherStatus, AuditAppError, ForgeLoopAuditAPI } from '@shared/domain';
import type { ProjectAuditSnapshot } from '@shared/audit';
import { AppShell } from './components/app-shell/AppShell';
import { ThemeToggle } from './components/ui/theme-toggle';
import { Overview } from './pages/Overview';
import { Tasks } from './pages/Tasks';
import { Flow } from './pages/Flow';
import { Contract } from './pages/Contract';
import { Evidence } from './pages/Evidence';
import { Events } from './pages/Events';
import { Executions } from './pages/Executions';
import { Continuity } from './pages/Continuity';
import { Policy } from './pages/Policy';
import { PolicyTrust } from './pages/PolicyTrust';
import { Diagnostics } from './pages/Diagnostics';
import { Actions } from './pages/Actions';
import { Settings } from './pages/Settings';
import { AuditSummary } from './pages/AuditSummary';
import { Findings } from './pages/Findings';
import { Quality } from './pages/Quality';
import { AuditHistory } from './pages/AuditHistory';
import { Reports } from './pages/Reports';
import { Repository } from './pages/Repository';
import { TaskAudit } from './pages/TaskAudit';
import { Timeline } from './pages/Timeline';
import { Projects } from './pages/Projects';
import { Kanban } from './pages/Kanban';
import { EmptyState } from './components/ui/EmptyState';
import { LoadingState } from './components/ui/LoadingState';
import {
  createProjectionRefreshEpochs,
  reduceProjectionRefresh,
  shouldApplySnapshotGeneration,
  taskProjectionRefreshEpoch,
} from './projection-refresh';
import { getAuditClient } from './lib/audit-client';

export const NAV_ITEMS = [
  { id: 'audit-summary', label: 'Audit Summary', icon: 'layout-dashboard' },
  { id: 'projects', label: 'Projects', icon: 'folder' },
  { id: 'kanban', label: 'Task Board', icon: 'kanban' },
  { id: 'timeline', label: 'Project Timeline', icon: 'timeline' },
  { id: 'findings', label: 'Findings', icon: 'clipboard-check' },
  { id: 'tasks', label: 'Tasks', icon: 'list-check' },
  { id: 'evidence', label: 'Evidence', icon: 'clipboard-check' },
  { id: 'quality', label: 'Quality', icon: 'activity' },
  { id: 'policy-trust', label: 'Policy & Trust', icon: 'shield' },
  { id: 'audit-history', label: 'Audit History', icon: 'history' },
  { id: 'reports', label: 'Reports', icon: 'file-text' },
  { id: 'repository', label: 'Repository Search', icon: 'search' },
  { id: 'diagnostics', label: 'Diagnostics', icon: 'activity' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
] as const;

export const TASK_DETAIL_ITEMS = [
  { id: 'task-audit', label: 'Audit', icon: 'clipboard-check' },
  { id: 'contract', label: 'Contract', icon: 'file-text' },
  { id: 'evidence', label: 'Evidence', icon: 'clipboard-check' },
  { id: 'flow', label: 'Lifecycle', icon: 'git-branch' },
  { id: 'events', label: 'Events', icon: 'repeat' },
  { id: 'executions', label: 'Executions', icon: 'activity' },
  { id: 'continuity', label: 'Continuity', icon: 'repeat' },
  { id: 'actions', label: 'Actions', icon: 'zap' },
  { id: 'overview', label: 'Boundaries', icon: 'shield' },
] as const;

export type NavItemId = typeof NAV_ITEMS[number]['id'] | typeof TASK_DETAIL_ITEMS[number]['id'] | 'policy';

function initialNav(): NavItemId {
  const value = window.location.hash.replace(/^#/u, '');
  return (NAV_ITEMS.some((item) => item.id === value) ? value : 'audit-summary') as NavItemId;
}

export function App() {
  const [detectionResult, setDetectionResult] = useState<ProjectDetectionResult | null>(null);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [audit, setAudit] = useState<ProjectAuditSnapshot | null>(null);
  const [activeNav, setActiveNav] = useState<NavItemId>(initialNav);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [error, setError] = useState<AuditAppError | null>(null);
  const [watcherStatus, setWatcherStatus] = useState<WatcherStatus>({ active: false });
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [projectionRefreshEpochs, setProjectionRefreshEpochs] = useState(createProjectionRefreshEpochs);
  const [workspaceRefreshToken, setWorkspaceRefreshToken] = useState(0);
  const [projectRefreshToken, setProjectRefreshToken] = useState(0);
  const latestSnapshotGeneration = useRef(0);
  const detectionPathRef = useRef<string | null>(null);

  const api: ForgeLoopAuditAPI = getAuditClient();

  useEffect(() => {
    const handleHashChange = () => setActiveNav(initialNav());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const hash = activeNav === 'audit-summary' ? '' : `#${activeNav}`;
    if (window.location.hash !== hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
  }, [activeNav]);

  const refreshAudit = useCallback(async () => {
    try {
      setAudit(await api.getProjectAudit());
    } catch (err) {
      console.error('Failed to load ForgeLoopAudit audit:', err);
      setAudit(null);
    }
  }, [api]);

  const handleProjectUpdate = useCallback((update: ProjectUpdate) => {
    if (update.type === 'project-opened') {
      latestSnapshotGeneration.current = update.generation ?? 0;
    } else if (!shouldApplySnapshotGeneration(latestSnapshotGeneration.current, update.generation)) {
      // Snapshot builds are asynchronous. A slower build may finish after a
      // newer one; its generation must never roll the UI back to stale data.
      return;
    } else if (update.generation !== undefined) {
      latestSnapshotGeneration.current = update.generation;
    }

    setProjectionRefreshEpochs((current) => reduceProjectionRefresh(current, update));
    switch (update.type) {
      case 'workspace-changed':
        // A change in any registered project refreshes the cross-project views
        // and, when it is the open project, its derived surfaces too.
        setWorkspaceRefreshToken((token) => token + 1);
        if (update.projectPath && update.projectPath === detectionPathRef.current) {
          setProjectRefreshToken((token) => token + 1);
        }
        break;
      case 'project-opened':
        if (update.detection) setDetectionResult(update.detection);
        if (update.snapshot) setSnapshot(update.snapshot);
        detectionPathRef.current = update.detection?.projectRoot ?? null;
        setSelectedTaskId(null);
        setAudit(null);
        setWorkspaceRefreshToken((token) => token + 1);
        setProjectRefreshToken((token) => token + 1);
        setActiveNav('audit-summary');
        break;
      case 'snapshot-refreshed':
        if (update.snapshot) {
          setSnapshot(update.snapshot);
          setAudit(null);
          setProjectRefreshToken((token) => token + 1);
          setSelectedTaskId((current) => current && update.snapshot?.tasks.some((task) => task.taskId === current) ? current : null);
        }
        break;
      case 'audit-invalidated':
      case 'finding-changed':
        setAudit(null);
        break;
      case 'watcher-status':
        if (update.data) {
          setWatcherStatus(update.data as WatcherStatus);
        }
        break;
      case 'error':
        if (update.data) {
          setError(update.data as AuditAppError);
          setTimeout(() => setError(null), 5000);
        }
        break;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = api.subscribeProjectUpdates(handleProjectUpdate);
    void api.getProjectState().then((state) => {
      if (!state) return;
      setDetectionResult(state.detection);
      setSnapshot(state.snapshot);
      detectionPathRef.current = state.detection.projectRoot;
      setActiveNav('audit-summary');
      void refreshAudit();
    }).catch((err) => console.error('Failed to load the current local project:', err));
    void api.notifyRendererReady().catch((err) => console.error('Failed to notify renderer readiness:', err));
    return unsubscribe;
  }, [api, handleProjectUpdate, refreshAudit]);

  const handleOpenDemoProject = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await api.openDemoProject();
      setDetectionResult(result);
      setActiveNav('audit-summary');
      setSnapshot(await api.getProjectSnapshot());
      await refreshAudit();
    } catch (err) {
      const auditError: AuditAppError = err instanceof Error
        ? { code: 'UNKNOWN_ERROR', message: err.message, recoverable: true }
        : { code: 'UNKNOWN_ERROR', message: 'Failed to open the demo project', recoverable: true };
      setError(auditError);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCloseProject = async () => {
    try {
      await api.closeProject();
      setDetectionResult(null);
      setSnapshot(null);
      setAudit(null);
      setActiveNav('audit-summary');
      setSelectedTaskId(null);
      setWatcherStatus({ active: false });
      latestSnapshotGeneration.current = 0;
      setProjectionRefreshEpochs(createProjectionRefreshEpochs());
    } catch (err) {
      console.error('Failed to close project:', err);
    }
  };

  const handleOpenProject = async (path: string) => {
    try {
      setIsLoading(true);
      setError(null);
      await api.addWorkspaceProject(path);
      detectionPathRef.current = path;
      setActiveNav('audit-summary');
      await refreshAudit();
    } catch (err) {
      const auditError: AuditAppError = err instanceof Error
        ? { code: 'UNKNOWN_ERROR', message: err.message, recoverable: true }
        : { code: 'UNKNOWN_ERROR', message: 'Failed to open project', recoverable: true };
      setError(auditError);
    } finally {
      setIsLoading(false);
    }
  };

  if (!detectionResult) {
    // Without an open project the workspace screen is the entry point: it can
    // register several projects before any of them is opened for deep audit.
    return (
      <div className="h-screen w-full overflow-auto forge-background">
        <header className="flex h-12 shrink-0 items-center justify-between border-b forge-border-subtle forge-primary-surface px-4">
          <span className="text-sm font-semibold text-forge-text-primary">ForgeLoopAudit</span>
          <ThemeToggle />
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">
          {error && (
            <div className="mb-4 rounded-8 bg-forge-danger/10 p-3 text-sm text-forge-danger" role="alert">{error.message}</div>
          )}
          <Projects
            refreshToken={workspaceRefreshToken}
            onOpenProject={(path) => { void handleOpenProject(path); }}
            onOpenDemoProject={() => { void handleOpenDemoProject(); }}
          />
        </main>
      </div>
    );
  }

  const isDemoProject = detectionResult.projectKind === 'DEMO';
  const selectedProjectionTaskId = snapshot
    ? selectedTaskId || snapshot.activeTaskId || snapshot.tasks[0]?.taskId || null
    : null;
  const taskRefresh = (key: Parameters<typeof taskProjectionRefreshEpoch>[1]) =>
    taskProjectionRefreshEpoch(projectionRefreshEpochs, key, selectedProjectionTaskId);

  const renderPage = () => {
    if (!snapshot) {
      return <LoadingState />;
    }

    switch (activeNav) {
      case 'audit-summary':
        return <AuditSummary audit={audit} snapshot={snapshot} detection={detectionResult} onRefresh={refreshAudit} onTaskSelect={(taskId) => { setSelectedTaskId(taskId); setActiveNav('findings'); }} onViewFindings={() => setActiveNav('findings')} />;
      case 'projects':
        return (
          <Projects
            refreshToken={workspaceRefreshToken}
            onOpenProject={(path) => { void handleOpenProject(path); }}
            onOpenDemoProject={() => { void handleOpenDemoProject(); }}
          />
        );
      case 'kanban':
        return (
          <Kanban
            refreshToken={workspaceRefreshToken}
            onOpenTask={(card) => { setSelectedTaskId(card.taskId); setActiveNav('task-audit'); }}
          />
        );
      case 'timeline':
        return <Timeline refreshToken={projectRefreshToken} />;
      case 'findings':
        return <Findings audit={audit} onTaskSelect={(taskId) => { setSelectedTaskId(taskId); setActiveNav('tasks'); }} />;
      case 'task-audit':
        return <TaskAudit snapshot={snapshot} audit={audit} selectedTaskId={selectedTaskId} onSelectedTaskChange={setSelectedTaskId} onRefreshAudit={refreshAudit} />;
      case 'overview':
        return <Overview
          snapshot={snapshot}
          detection={detectionResult}
          watcherStatus={watcherStatus}
          selectedTaskId={selectedTaskId}
          genericTaskRefreshToken={projectionRefreshEpochs.genericTask}
          actionsRefreshToken={taskRefresh('actions')}
          taskBoundaryRefreshTokens={{
            workspaceBinding: taskRefresh('workspaceBinding'),
            handoffs: taskRefresh('handoffs'),
            responsibility: taskRefresh('responsibility'),
          }}
          onTaskSelect={(taskId) => { setSelectedTaskId(taskId); setActiveNav('task-audit'); }}
          onViewAllTasks={() => setActiveNav('tasks')}
        />;
      case 'tasks':
        return <Tasks snapshot={snapshot} audit={audit} isDemoProject={isDemoProject} onTaskSelect={(taskId) => { setSelectedTaskId(taskId); setActiveNav('task-audit'); }} />;
      case 'flow':
        return <Flow snapshot={snapshot} selectedTaskId={selectedTaskId} onSelectedTaskChange={setSelectedTaskId} />;
      case 'contract':
        return <Contract snapshot={snapshot} selectedTaskId={selectedTaskId} onSelectedTaskChange={setSelectedTaskId} />;
      case 'evidence':
        return <Evidence
          snapshot={snapshot}
          selectedTaskId={selectedTaskId}
          genericTaskRefreshToken={projectionRefreshEpochs.genericTask}
          verificationScopeRefreshToken={taskRefresh('verificationScope')}
          attestationRefreshToken={taskRefresh('attestation')}
          onSelectedTaskChange={setSelectedTaskId}
          onOpenActions={() => setActiveNav('actions')}
        />;
      case 'events':
        return <Events snapshot={snapshot} selectedTaskId={selectedTaskId} eventsRefreshToken={taskRefresh('events')} onSelectedTaskChange={setSelectedTaskId} />;
      case 'executions':
        return <Executions snapshot={snapshot} selectedTaskId={selectedTaskId} executionsRefreshToken={taskRefresh('executions')} onSelectedTaskChange={setSelectedTaskId} />;
      case 'continuity':
        return <Continuity snapshot={snapshot} selectedTaskId={selectedTaskId} handoffRefreshToken={taskRefresh('handoffs')} onSelectedTaskChange={setSelectedTaskId} onOpenDiagnostics={() => setActiveNav('diagnostics')} />;
      case 'quality':
        return <Quality snapshot={snapshot} selectedTaskId={selectedTaskId} onSelectedTaskChange={setSelectedTaskId} />;
      case 'audit-history':
        return <AuditHistory audit={audit} onRefreshAudit={refreshAudit} />;
      case 'reports':
        return <Reports audit={audit} onRefreshAudit={refreshAudit} />;
      case 'repository':
        return <Repository />;
      case 'diagnostics':
        return <Diagnostics snapshot={snapshot} selectedTaskId={selectedTaskId} genericTaskRefreshToken={projectionRefreshEpochs.genericTask} evaluationsRefreshToken={taskRefresh('evaluations')} onSelectedTaskChange={setSelectedTaskId} />;
      case 'actions':
        return <Actions snapshot={snapshot} selectedTaskId={selectedTaskId} actionsRefreshToken={taskRefresh('actions')} onSelectedTaskChange={setSelectedTaskId} />;
      case 'policy-trust':
        return <PolicyTrust snapshot={snapshot} selectedTaskId={selectedTaskId} capabilityPolicyRefreshToken={projectionRefreshEpochs.capabilityPolicy} onSelectedTaskChange={setSelectedTaskId} />;
      case 'policy':
        return <Policy snapshot={snapshot} selectedTaskId={selectedTaskId} capabilityPolicyRefreshToken={projectionRefreshEpochs.capabilityPolicy} onSelectedTaskChange={setSelectedTaskId} />;
      case 'settings':
        return <Settings snapshot={snapshot} detection={detectionResult} watcherStatus={watcherStatus} />;
      default:
        return <EmptyState title="Unknown page" />;
    }
  };

  return (
    <AppShell
      projectName={snapshot?.project.name || 'Project'}
      isDemoProject={isDemoProject}
      branch={snapshot?.project.branch}
      head={snapshot?.project.head}
      protocolVersion={detectionResult.protocolVersion}
      health={audit?.verdict.integrity ?? snapshot?.health.status ?? 'UNKNOWN'}
      watcherStatus={watcherStatus}
      activeNav={activeNav}
      onNavChange={setActiveNav}
      sidebarCollapsed={sidebarCollapsed}
      onSidebarToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      onCloseProject={handleCloseProject}
      navItems={NAV_ITEMS}
      taskDetailItems={TASK_DETAIL_ITEMS}
      selectedTaskId={selectedTaskId}
      isLoading={isLoading}
      error={error}
    >
      {renderPage()}
    </AppShell>
  );
}
