import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { ProjectKind, RecentProject } from '@shared/domain';

const RECENT_PROJECT_LIMIT = 10;
const WORKSPACE_PROJECT_LIMIT = 32;

/**
 * Resolve the web host's private application-data directory. The directory is
 * deliberately separate from the audited repository: project data is read
 * from the selected project, while settings, audit history, and exports are
 * owned by this local host.
 */
export function resolveApplicationDataRoot(environment: NodeJS.ProcessEnv = process.env): string {
  const override = environment.FORGELOOP_AUDIT_DATA_DIR?.trim();
  if (override) return resolve(override);

  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'ForgeLoopAudit');
  if (process.platform === 'win32') return join(environment.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ForgeLoopAudit');
  return join(environment.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'forgeloop-audit');
}

export interface RecentProjectsStoreOptions {
  applicationDataRoot: string;
}

export class RecentProjectsStore {
  private readonly filePath: string;

  constructor(options: RecentProjectsStoreOptions) {
    this.filePath = join(resolve(options.applicationDataRoot), 'settings', 'recent-projects.json');
  }

  async list(): Promise<RecentProject[]> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter(isRecentProject).slice(0, RECENT_PROJECT_LIMIT)
        : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      return [];
    }
  }

  async add(project: RecentProject): Promise<void> {
    const current = await this.list();
    const next = [project, ...current.filter((entry) => entry.path !== project.path)].slice(0, RECENT_PROJECT_LIMIT);
    await this.write(next);
  }

  async remove(path: string): Promise<void> {
    await this.write((await this.list()).filter((entry) => entry.path !== path));
  }

  private async write(projects: RecentProject[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(projects, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
}

function isRecentProject(value: unknown): value is RecentProject {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.path === 'string'
    && record.path.length > 0
    && typeof record.name === 'string'
    && typeof record.lastOpenedAt === 'string'
    && (record.kind === undefined || record.kind === 'PROJECT' || record.kind === 'DEMO');
}

/**
 * A project the user explicitly registered in the local workspace. The
 * workspace is owned by this local host and stored in application data, never
 * inside any audited repository.
 */
export interface WorkspaceProjectEntry {
  path: string;
  name: string;
  kind: ProjectKind;
  addedAt: string;
  lastOpenedAt: string;
}

export interface WorkspaceProjectsFile {
  schemaVersion: 1;
  projects: WorkspaceProjectEntry[];
}

export interface WorkspaceProjectsStoreOptions {
  applicationDataRoot: string;
}

export class WorkspaceProjectsStore {
  private readonly filePath: string;

  constructor(options: WorkspaceProjectsStoreOptions) {
    this.filePath = join(resolve(options.applicationDataRoot), 'settings', 'workspace-projects.json');
  }

  async list(): Promise<WorkspaceProjectEntry[]> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      const projects = (parsed as Partial<WorkspaceProjectsFile> | null)?.projects;
      return Array.isArray(projects)
        ? projects.filter(isWorkspaceProjectEntry).slice(0, WORKSPACE_PROJECT_LIMIT)
        : [];
    } catch {
      return [];
    }
  }

  async add(entry: WorkspaceProjectEntry): Promise<WorkspaceProjectEntry[]> {
    const current = await this.list();
    // Re-adding a known project is a reopen, not a duplicate registration.
    const next = [
      entry,
      ...current.filter((project) => project.path !== entry.path),
    ].slice(0, WORKSPACE_PROJECT_LIMIT);
    await this.write(next);
    return next;
  }

  async remove(path: string): Promise<WorkspaceProjectEntry[]> {
    const next = (await this.list()).filter((entry) => entry.path !== path);
    await this.write(next);
    return next;
  }

  async touch(path: string, timestamp: string): Promise<WorkspaceProjectEntry[]> {
    const current = await this.list();
    const next = current
      .map((entry) => (entry.path === path ? { ...entry, lastOpenedAt: timestamp } : entry))
      .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
    await this.write(next);
    return next;
  }

  private async write(projects: WorkspaceProjectEntry[]): Promise<void> {
    const payload: WorkspaceProjectsFile = { schemaVersion: 1, projects };
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
}

function isWorkspaceProjectEntry(value: unknown): value is WorkspaceProjectEntry {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.path === 'string'
    && record.path.length > 0
    && typeof record.name === 'string'
    && typeof record.addedAt === 'string'
    && typeof record.lastOpenedAt === 'string'
    && (record.kind === 'PROJECT' || record.kind === 'DEMO');
}
