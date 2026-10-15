import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { PathBoundary } from '@main/security/path-boundary';
import { ForgeLoopAuditError } from '@shared/errors';
import { FORGELOOP_DIR_NAME } from '@shared/constants';
import type {
  ForgeLoopHealthStatus,
  KanbanBoard,
  ProjectKind,
  ProjectSnapshot,
  ProjectTimeline,
  ProjectUpdate,
  ProjectWorkspace,
  WorkspaceProjectSummary,
} from '@shared/domain';
import { buildKanbanBoard } from '@shared/kanban';
import { createProjectDetector, createProjectReader, type ProjectReader } from '@main/core/project/project-reader';
import { createProjectSnapshotBuilder, type ProjectSnapshotBuilder } from '@main/core/project/project-snapshot';
import { ForgeCli } from '@main/core/cli/forge-cli';
import { createProjectWatcher, type ProjectWatcher } from '@main/watcher/project-watcher';
import { resolveTrustedSchemaDirectory, SchemaValidator } from '@main/core/protocol/validator';
import { deriveProjectTimeline } from '@main/core/timeline/project-timeline';
import { WorkspaceProjectsStore, type WorkspaceProjectEntry } from '../storage/app-data';

const ProjectPathSchema = z.string().min(1).max(4096);
const SNAPSHOT_REFRESH_DEBOUNCE_MS = 150;
const WORKSPACE_CLI_DISABLED = '__forgeloop_audit_workspace_cli_disabled__';

export interface WorkspaceRuntimeOptions {
  applicationDataRoot: string;
  schemaDirectory?: string;
  appPath?: string;
  onUpdate?: (update: ProjectUpdate) => void;
}

interface WorkspaceSession {
  entry: WorkspaceProjectEntry;
  boundary: PathBoundary | null;
  reader: ProjectReader | null;
  snapshotBuilder: ProjectSnapshotBuilder | null;
  watcher: ProjectWatcher | null;
  snapshot: ProjectSnapshot | null;
  forgeLoopVersion?: string;
  protocolVersion: number;
  error?: string;
  lastChangeAt?: string;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  refreshing: Promise<ProjectSnapshot | null> | null;
  /** True when this runtime holds a watcher for the project. */
  monitored: boolean;
  /** Whether a missing snapshot should be built on read by this runtime. */
  buildOnRead: boolean;
}

/**
 * Owns every project the local auditor tracks.
 *
 * The active project is additionally opened through `AuditRuntime` for deep
 * canonical inspection. This runtime keeps a bounded, read-only live session
 * per registered project so the projects screen and the cross-project Kanban
 * board stay live while other projects are being worked on.
 */
export class WorkspaceRuntime {
  private readonly store: WorkspaceProjectsStore;
  private readonly schemas: SchemaValidator;
  private readonly sessions = new Map<string, WorkspaceSession>();
  private readonly listeners = new Set<(update: ProjectUpdate) => void>();
  private activeProjectPath: string | null = null;
  private lastUpdated = new Date(0).toISOString();
  private initialized = false;

  constructor(options: WorkspaceRuntimeOptions) {
    this.store = new WorkspaceProjectsStore({ applicationDataRoot: options.applicationDataRoot });
    this.schemas = new SchemaValidator(options.schemaDirectory ?? resolveTrustedSchemaDirectory({
      allowEnvironmentOverride: true,
      appPath: options.appPath ?? process.cwd(),
      cwd: process.cwd(),
      moduleDir: process.cwd(),
    }));
    if (options.onUpdate) this.listeners.add(options.onUpdate);
  }

  subscribe(listener: (update: ProjectUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Re-open every persisted registration. Unreadable ones stay listed as unavailable. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    for (const entry of await this.store.list()) await this.attach(entry);
  }

  async getWorkspace(): Promise<ProjectWorkspace> {
    await this.initialize();
    const projects: WorkspaceProjectSummary[] = [];
    for (const [projectPath, session] of this.sessions) {
      // Await a pending first read so the very first response already carries
      // real task counts instead of a zeroed placeholder.
      if (!session.snapshot && session.buildOnRead) await this.refreshSession(session);
      projects.push(this.toSummary(projectPath, session));
    }
    projects.sort((a, b) => Number(b.active) - Number(a.active) || b.lastOpenedAt.localeCompare(a.lastOpenedAt));
    return {
      projects,
      activeProjectPath: this.activeProjectPath,
      // The open project is watched by the runtime that owns it, so it counts
      // as watched even though this runtime holds no watcher for it.
      watching: [...this.sessions.values()].filter((session) => (
        session.monitored || this.activeProjectPath === session.entry.path
      )).length,
      updatedAt: this.lastUpdated,
    };
  }

  /**
   * Register a project from a user-supplied path and persist it. The path must
   * resolve to a real directory that contains a `.forgeloop` state tree.
   *
   * `monitor: false` registers the project without starting a second watcher or
   * a second snapshot build. The open project is used that way: `AuditRuntime`
   * already watches and builds it, so duplicating that work would slow startup
   * and double the file handles for the same directory.
   */
  async addProject(projectPath: string, kind: ProjectKind = 'PROJECT', options: { monitor?: boolean } = {}): Promise<void> {
    await this.initialize();
    const monitor = options.monitor ?? true;
    const resolved = await resolveWorkspaceProjectPath(projectPath);
    const timestamp = new Date().toISOString();
    const existing = this.sessions.get(resolved);
    const entry: WorkspaceProjectEntry = {
      path: resolved,
      name: basename(resolved) || resolved,
      kind,
      addedAt: existing?.entry.addedAt ?? timestamp,
      lastOpenedAt: timestamp,
    };
    await this.store.add(entry);
    if (existing) {
      // Reopening a known project restarts its live session so a removed or
      // repaired project recovers without restarting the host.
      await this.detach(existing);
    }
    await this.attach(entry, monitor);
  }

  async removeProject(projectPath: string): Promise<void> {
    await this.initialize();
    const resolved = resolve(ProjectPathSchema.parse(projectPath));
    const session = this.sessions.get(resolved);
    if (session) {
      await this.detach(session);
      this.sessions.delete(resolved);
    }
    await this.store.remove(resolved);
    if (this.activeProjectPath === resolved) this.activeProjectPath = null;
  }

  async setActiveProject(projectPath: string | null): Promise<void> {
    await this.initialize();
    if (projectPath === null) {
      // Hand the open project's monitoring back to this runtime.
      const previous = this.activeProjectPath;
      this.activeProjectPath = null;
      if (previous) await this.setMonitored(previous, true);
      return;
    }
    const resolved = resolve(ProjectPathSchema.parse(projectPath));
    if (!this.sessions.has(resolved)) throw ForgeLoopAuditError.projectNotForgeLoop(resolved);
    await this.store.touch(resolved, new Date().toISOString());
    const previous = this.activeProjectPath;
    this.activeProjectPath = resolved;
    // Exactly one runtime watches each project: the open project is watched by
    // the runtime that owns it, and the project it replaced is watched here.
    if (previous && previous !== resolved) await this.setMonitored(previous, true);
    await this.setMonitored(resolved, false);
  }

  /** Start or stop this runtime's own watcher and read-through build for a project. */
  private async setMonitored(projectPath: string, monitor: boolean): Promise<void> {
    const session = this.sessions.get(projectPath);
    if (!session || session.monitored === monitor) return;
    session.monitored = monitor;
    session.buildOnRead = monitor;
    if (monitor) {
      if (session.boundary && !session.watcher) {
        session.watcher = createProjectWatcher(
          session.boundary,
          (event) => this.handleSessionChange(projectPath, event.type),
          (error) => this.handleSessionError(projectPath, error),
          () => undefined,
        );
        session.watcher.start();
      }
      await this.refreshSession(session);
    } else if (session.watcher) {
      await this.detach(session);
    }
  }

  /** Rebuild one project from disk on demand, independent of the watcher. */
  async refreshProject(projectPath: string): Promise<void> {
    await this.initialize();
    const resolved = resolve(ProjectPathSchema.parse(projectPath));
    const session = this.sessions.get(resolved);
    if (!session) throw ForgeLoopAuditError.projectNotForgeLoop(resolved);
    await this.refreshSession(session, true);
  }

  async getKanbanBoard(filterProjectPath: string | null = null): Promise<KanbanBoard> {
    const workspace = await this.getWorkspace();
    const projects = await Promise.all(workspace.projects.map(async (project) => ({
      path: project.path,
      name: project.name,
      kind: project.kind,
      snapshot: this.sessions.get(project.path)?.snapshot ?? null,
    })));
    return buildKanbanBoard({ projects, filterProjectPath, generatedAt: new Date().toISOString() });
  }

  /** Derive the project timeline for any registered project, not only the active one. */
  async getTimeline(projectPath: string): Promise<ProjectTimeline> {
    await this.initialize();
    const resolved = resolve(ProjectPathSchema.parse(projectPath));
    const session = this.sessions.get(resolved);
    if (!session) throw ForgeLoopAuditError.projectNotForgeLoop(resolved);
    const snapshot = session.snapshot ?? await this.refreshSession(session, true);
    if (!snapshot) {
      throw ForgeLoopAuditError.artifactUnreadable('.forgeloop', `Project timeline is unavailable for ${session.entry.name}`);
    }
    return deriveProjectTimeline({
      projectRoot: resolved,
      snapshot,
      audit: null,
      forgeLoopVersion: session.forgeLoopVersion ?? snapshot.protocol.packageVersion ?? null,
    });
  }

  getActiveProjectPath(): string | null {
    return this.activeProjectPath;
  }

  /** Last known lightweight snapshot for a registered project, if any. */
  getSnapshot(projectPath: string): ProjectSnapshot | null {
    return this.sessions.get(projectPath)?.snapshot ?? null;
  }

  private async attach(entry: WorkspaceProjectEntry, monitor = true): Promise<void> {
    const session: WorkspaceSession = {
      entry,
      boundary: null,
      reader: null,
      snapshotBuilder: null,
      watcher: null,
      snapshot: null,
      protocolVersion: 0,
      refreshTimer: null,
      refreshing: null,
      // A project monitored elsewhere is never built here; its authoritative
      // snapshot comes from the runtime that owns it.
      monitored: monitor,
      buildOnRead: monitor,
    };
    try {
      session.boundary = new PathBoundary(entry.path);
      const detection = createProjectDetector(session.boundary, this.schemas).detect();
      session.protocolVersion = detection.protocolVersion;
      session.forgeLoopVersion = detection.forgeLoopVersion;
      session.reader = createProjectReader(session.boundary, this.schemas);
      // Workspace sessions never execute the ForgeLoop CLI: they only read the
      // bounded state tree, so a background project cannot drive work.
      session.snapshotBuilder = createProjectSnapshotBuilder(
        session.boundary,
        session.reader,
        new ForgeCli(entry.path, WORKSPACE_CLI_DISABLED),
        undefined,
        false,
      );
      if (monitor) {
        session.watcher = createProjectWatcher(
          session.boundary,
          (event) => this.handleSessionChange(entry.path, event.type),
          (error) => this.handleSessionError(entry.path, error),
          () => undefined,
        );
        session.watcher.start();
        await this.refreshSession(session, true);
      }
    } catch (error) {
      // A project that cannot be opened stays listed with an explicit error.
      // It is never rendered as healthy or silently dropped.
      session.error = error instanceof Error ? error.message : 'Project could not be opened.';
      session.watcher = null;
    }
    this.sessions.set(entry.path, session);
  }

  private async detach(session: WorkspaceSession): Promise<void> {
    if (session.refreshTimer) clearTimeout(session.refreshTimer);
    session.refreshTimer = null;
    const watcher = session.watcher;
    session.watcher = null;
    if (watcher) await watcher.stop();
  }

  private async refreshSession(session: WorkspaceSession, force = false): Promise<ProjectSnapshot | null> {
    const builder = session.snapshotBuilder;
    if (!force && session.refreshing) return session.refreshing;
    if (force && session.refreshing) await session.refreshing.catch(() => null);
    if (!builder) return session.snapshot;
    const attempt = (async () => {
      try {
        const snapshot = await builder.build();
        if (this.sessions.get(session.entry.path) !== session) return null;
        session.snapshot = snapshot;
        session.error = undefined;
        return snapshot;
      } catch (error) {
        if (this.sessions.get(session.entry.path) !== session) return null;
        session.error = error instanceof Error ? error.message : 'Project snapshot could not be built.';
        return null;
      } finally {
        session.refreshing = null;
      }
    })();
    session.refreshing = attempt;
    return attempt;
  }

  async close(): Promise<void> {
    for (const session of [...this.sessions.values()]) await this.detach(session);
    this.sessions.clear();
    this.listeners.clear();
    this.initialized = false;
  }

  private readonly handleSessionChange = (projectPath: string, eventType: string): void => {
    const session = this.sessions.get(projectPath);
    if (session) {
      session.lastChangeAt = new Date().toISOString();
      if (session.refreshTimer) clearTimeout(session.refreshTimer);
      session.refreshTimer = setTimeout(() => {
        session.refreshTimer = null;
        void this.refreshSession(session).then(() => this.changed(projectPath));
      }, SNAPSHOT_REFRESH_DEBOUNCE_MS);
    }
    this.changed(projectPath, eventType);
  };

  private readonly handleSessionError = (projectPath: string, error: Error): void => {
    const session = this.sessions.get(projectPath);
    if (session) session.error = error.message;
    this.changed(projectPath);
  };

  private toSummary(projectPath: string, session: WorkspaceSession): WorkspaceProjectSummary {
    const snapshot = session.snapshot;
    const tasks = snapshot?.tasks ?? [];
    return {
      path: projectPath,
      displayPath: displayWorkspacePath(projectPath),
      name: snapshot?.project.name ?? session.entry.name,
      kind: session.entry.kind,
      addedAt: session.entry.addedAt,
      lastOpenedAt: session.entry.lastOpenedAt,
      active: this.activeProjectPath === projectPath,
      available: !session.error,
      health: (snapshot?.health.status ?? 'UNKNOWN') as ForgeLoopHealthStatus,
      taskCount: tasks.length,
      blockedCount: tasks.filter((task) => task.phase === 'BLOCKED').length,
      completeCount: tasks.filter((task) => task.phase === 'COMPLETE').length,
      inProgressCount: tasks.filter((task) => task.phase === 'EXECUTING' || task.phase === 'VERIFYING').length,
      branch: snapshot?.project.branch,
      head: snapshot?.project.head,
      protocolVersion: session.protocolVersion,
      forgeLoopVersion: session.forgeLoopVersion,
      error: session.error,
      lastChangeAt: session.lastChangeAt,
    };
  }

  private changed(projectPath: string | null, eventType?: string): void {
    this.lastUpdated = new Date().toISOString();
    const update: ProjectUpdate = {
      type: 'workspace-changed',
      projectPath: projectPath ?? undefined,
      data: { eventType },
      timestamp: this.lastUpdated,
    };
    for (const listener of this.listeners) listener(update);
  }
}

/**
 * Resolve a user-supplied project path for workspace registration. The path
 * must be an existing directory that actually contains ForgeLoop state; the
 * host never registers an arbitrary directory it cannot audit.
 */
export async function resolveWorkspaceProjectPath(projectPath: string): Promise<string> {
  const candidate = ProjectPathSchema.parse(projectPath);
  if (!isAbsolute(candidate)) {
    throw ForgeLoopAuditError.pathBoundaryViolation(candidate, 'an absolute project path is required');
  }
  const resolved = resolve(candidate);
  if (resolved === resolve(sep) || resolved === resolve(homedir())) {
    throw ForgeLoopAuditError.pathBoundaryViolation(resolved, 'the filesystem and home roots are not auditable projects');
  }
  const info = await stat(resolved).catch(() => null);
  if (!info || !info.isDirectory()) throw ForgeLoopAuditError.projectNotForgeLoop(resolved);
  // PathBoundary remains the authority on what the host will read; this check
  // only produces an explicit, actionable rejection for directories that hold
  // no ForgeLoop state at all.
  const forgeLoopState = await stat(join(resolved, FORGELOOP_DIR_NAME)).catch(() => null);
  if (!forgeLoopState?.isDirectory()) throw ForgeLoopAuditError.projectNotForgeLoop(resolved);
  new PathBoundary(resolved).validateForgeLoopPath('');
  return resolved;
}

/** Render a project path relative to the user's home directory for display. */
export function displayWorkspacePath(projectPath: string): string {
  const home = resolve(homedir());
  const normalized = resolve(projectPath);
  if (normalized === home) return '~';
  return normalized.startsWith(`${home}${sep}`) ? `~${normalized.slice(home.length)}` : normalized;
}
