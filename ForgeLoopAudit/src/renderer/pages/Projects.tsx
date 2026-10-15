import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, FolderPlus, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import type { ProjectWorkspace, WorkspaceProjectSummary } from '@shared/domain';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { EmptyState, ErrorState } from '../components/ui/EmptyState';
import { auditApi } from '../lib/audit-client';

interface ProjectsProps {
  /** Increments whenever any registered project changes on disk. */
  refreshToken: number;
  onOpenProject: (path: string) => void;
  onOpenDemoProject: () => void;
}

/**
 * Screen for managing every project the local auditor tracks. Projects are
 * stored in this host's application data; the audited repositories are only
 * ever read.
 */
export function Projects({ refreshToken, onOpenProject, onOpenDemoProject }: ProjectsProps) {
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setWorkspace(await auditApi.getProjectWorkspace());
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The project workspace could not be loaded.');
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshToken]);

  async function run(action: () => Promise<ProjectWorkspace>, successMessage: string) {
    setBusy(true);
    setMessage(null);
    try {
      setWorkspace(await action());
      setError(null);
      setMessage(successMessage);
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : 'The project could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  const projects = workspace?.projects ?? [];


  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-forge-text-primary">Projects</h1>
          <p className="mt-1 text-sm text-forge-text-muted">
            Open and save the ForgeLoop projects this host tracks. Every registered project stays live, so its board updates while you inspect another one.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">{projects.length} registered</Badge>
          <Badge variant={workspace && workspace.watching > 0 ? 'success' : 'secondary'}>
            {workspace?.watching ?? 0} watched
          </Badge>
        </div>
      </div>

      {error && <ErrorState message="Project workspace unavailable" details={error} onRetry={() => void load()} />}

      <Card>
        <CardHeader>
          <CardTitle>Add a project</CardTitle>
          <CardDescription>
            Provide the absolute path of a directory that contains a <code className="font-mono">.forgeloop</code> folder. The project is saved to this host&apos;s application data and opened for inspection.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              const candidate = pathInput.trim();
              if (!candidate) {
                setMessage('Enter the absolute path of a ForgeLoop project.');
                return;
              }
              void run(() => auditApi.addWorkspaceProject(candidate), 'Project saved and opened.');
            }}
          >
            <input
              className="input flex-1 font-mono"
              aria-label="Project path"
              placeholder="/absolute/path/to/your/project"
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
            />
            <button className="btn-primary" type="submit" disabled={busy}>
              <FolderPlus className="h-4 w-4" aria-hidden="true" />
              Open and save
            </button>
            <button
              className="btn-secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                const candidate = pathInput.trim();
                if (!candidate) {
                  setMessage('Enter the absolute path of a ForgeLoop project.');
                  return;
                }
                void run(() => auditApi.saveWorkspaceProject(candidate), 'Project saved to the workspace without switching to it.');
              }}
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              Save only
            </button>
          </form>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn-secondary" type="button" onClick={onOpenDemoProject} disabled={busy}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add the demo project
            </button>
            <button className="btn-secondary" type="button" onClick={() => void load()} disabled={busy}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Reload workspace
            </button>
          </div>
          {message && <p role="status" className="mt-3 text-sm text-forge-text-secondary">{message}</p>}
        </CardContent>
      </Card>

      {projects.length === 0 ? (
        <EmptyState
          title="No projects registered yet"
          description="Add a ForgeLoop project by path to manage several projects at once and to see their tasks together on the task board."
          icon={<FolderOpen className="h-12 w-12" />}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {projects.map((project) => (
            <li key={project.path}>
              <ProjectCard
                project={project}
                busy={busy}
                onOpen={() => onOpenProject(project.path)}
                onRefresh={() => void run(() => auditApi.refreshWorkspaceProject(project.path), `${project.name} refreshed.`)}
                onRemove={() => void run(() => auditApi.removeWorkspaceProject(project.path), `${project.name} removed from the workspace.`)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


function ProjectCard({
  project,
  busy,
  onOpen,
  onRefresh,
  onRemove,
}: {
  project: WorkspaceProjectSummary;
  busy: boolean;
  onOpen: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  return (
    <Card className={project.active ? 'border-forge-accent/50' : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate">{project.name}</CardTitle>
            <CardDescription className="truncate font-mono text-xs" title={project.displayPath}>
              {project.displayPath}
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {project.active && <Badge variant="default">Active</Badge>}
            {project.kind === 'DEMO' && <Badge variant="secondary">Demo</Badge>}
            <Badge variant={project.available ? 'success' : 'danger'}>{project.available ? 'Available' : 'Unavailable'}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {project.error && <p className="rounded-8 bg-forge-danger/10 px-3 py-2 text-xs text-forge-danger">{project.error}</p>}
        <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {([
            ['Tasks', project.taskCount],
            ['In progress', project.inProgressCount],
            ['Blocked', project.blockedCount],
            ['Complete', project.completeCount],
          ] as const).map(([label, value]) => (
            <div key={label} className="rounded-8 bg-forge-secondary-surface/60 px-3 py-2">
              <dt className="text-forge-text-muted">{label}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-forge-text-primary">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-forge-text-muted">
          Protocol v{project.protocolVersion}
          {project.forgeLoopVersion ? ` · ForgeLoop ${project.forgeLoopVersion}` : ''}
          {project.branch ? ` · ${project.branch}` : ''}
          {project.lastChangeAt ? ` · updated ${new Date(project.lastChangeAt).toLocaleTimeString()}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary text-xs" type="button" onClick={onOpen} disabled={busy || project.active}>
            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
            {project.active ? 'Currently open' : 'Open project'}
          </button>
          <button className="btn-secondary text-xs" type="button" onClick={onRefresh} disabled={busy}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </button>
          <button className="btn-secondary text-xs" type="button" onClick={onRemove} disabled={busy}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Remove
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
