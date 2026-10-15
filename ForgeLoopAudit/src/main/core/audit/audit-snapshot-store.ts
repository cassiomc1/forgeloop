import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve, relative, isAbsolute, sep } from 'node:path';
import type { AuditSnapshotMetadata, ProjectAuditSnapshot } from '@shared/audit';
import { stableStringify } from './audit-fingerprint';

interface RetainableSnapshot {
  id: string;
  generatedAt: string;
}

export function retainAuditSnapshots<T extends RetainableSnapshot>(snapshots: T[], retention = 50): T[] {
  const boundedRetention = Number.isInteger(retention) && retention > 0 ? retention : 50;
  return [...snapshots]
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt) || right.id.localeCompare(left.id))
    .slice(0, boundedRetention);
}

function assertSafeSegment(value: string, name: string): void {
  if (!/^[A-Za-z0-9._-]+$/u.test(value) || value === '.' || value === '..') throw new Error(`${name} is not a safe path segment`);
}

async function assertNoSymlinkBelow(root: string, target: string): Promise<void> {
  const relativeTarget = relative(root, target);
  if (isAbsolute(relativeTarget) || relativeTarget === '..' || relativeTarget.startsWith('..' + sep)) {
    throw new Error('Audit history path escapes the application data directory');
  }
  let current = root;
  for (const segment of relativeTarget.split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Audit history path contains a symlink: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }
}

export interface AuditSnapshotStoreOptions {
  userDataPath: string;
  projectFingerprint: string;
  retention?: number;
}

export class AuditSnapshotStore {
  private readonly applicationDataRoot: string;
  private readonly directory: string;
  private readonly snapshotsDirectory: string;
  private readonly retention: number;

  constructor(options: AuditSnapshotStoreOptions) {
    assertSafeSegment(options.projectFingerprint, 'project fingerprint');
    this.applicationDataRoot = resolve(options.userDataPath);
    this.directory = resolve(options.userDataPath, 'audits', options.projectFingerprint);
    this.snapshotsDirectory = join(this.directory, 'snapshots');
    this.retention = options.retention ?? 50;
    const root = resolve(options.userDataPath, 'audits');
    const relativeDirectory = relative(root, this.directory);
    if (isAbsolute(relativeDirectory) || relativeDirectory.startsWith('..')) throw new Error('Audit history path escapes the application data directory');
  }

  async save(snapshot: ProjectAuditSnapshot): Promise<AuditSnapshotMetadata> {
    await assertNoSymlinkBelow(this.applicationDataRoot, this.snapshotsDirectory);
    await mkdir(this.snapshotsDirectory, { recursive: true });
    await assertNoSymlinkBelow(this.applicationDataRoot, this.snapshotsDirectory);
    const digest = createHash('sha256').update(stableStringify(snapshot)).digest('hex').slice(0, 16);
    const auditId = snapshot.auditId ?? `audit-${Date.now()}-${digest}`;
    assertSafeSegment(auditId, 'audit id');
    const stored = { ...snapshot, auditId };
    const snapshotPath = join(this.snapshotsDirectory, `${auditId}.json`);
    await assertNoSymlinkBelow(this.applicationDataRoot, snapshotPath);
    await writeFile(snapshotPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
    const entries = await this.readIndex();
    const metadata: AuditSnapshotMetadata = {
      auditId,
      generatedAt: snapshot.generatedAt,
      gitHead: snapshot.gitHead,
      fingerprint: snapshot.fingerprint,
      verdict: snapshot.verdict,
      coveragePercent: snapshot.coverage.percent,
      counts: snapshot.counts,
      score: snapshot.score,
    };
    const next = retainAuditSnapshots([...entries.filter((entry) => entry.auditId !== auditId), metadata].map((entry) => ({ ...entry, id: entry.auditId })) as Array<AuditSnapshotMetadata & { id: string }>, this.retention)
      .map(({ id: _id, ...entry }) => entry);
    const indexPath = join(this.directory, 'index.json');
    await assertNoSymlinkBelow(this.applicationDataRoot, indexPath);
    await writeFile(indexPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    const retainedIds = new Set(next.map((entry) => entry.auditId));
    for (const file of await readdir(this.snapshotsDirectory)) {
      if (!file.endsWith('.json')) continue;
      const id = basename(file, '.json');
      if (!retainedIds.has(id)) await rm(join(this.snapshotsDirectory, file), { force: true });
    }
    return metadata;
  }

  async list(): Promise<AuditSnapshotMetadata[]> {
    return this.readIndex();
  }

  async read(auditId: string): Promise<ProjectAuditSnapshot> {
    assertSafeSegment(auditId, 'audit id');
    const path = join(this.snapshotsDirectory, `${auditId}.json`);
    await assertNoSymlinkBelow(this.applicationDataRoot, path);
    const parsed = JSON.parse(await readFile(path, 'utf8')) as ProjectAuditSnapshot;
    if (parsed.auditId !== auditId) throw new Error('Audit history identity mismatch');
    return parsed;
  }

  private async readIndex(): Promise<AuditSnapshotMetadata[]> {
    const indexPath = join(this.directory, 'index.json');
    try {
      await assertNoSymlinkBelow(this.applicationDataRoot, indexPath);
      const parsed = JSON.parse(await readFile(indexPath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry): entry is AuditSnapshotMetadata => typeof entry === 'object' && entry !== null && typeof (entry as { auditId?: unknown }).auditId === 'string');
    } catch (error) {
      if (error instanceof Error && /contains a symlink/iu.test(error.message)) throw error;
      return [];
    }
  }
}
