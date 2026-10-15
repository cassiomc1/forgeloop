import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditSnapshotStore, retainAuditSnapshots } from '@main/core/audit/audit-snapshot-store';
import { snapshotFixture } from './fixtures/audit-fixtures';

describe('AuditSnapshotStore', () => {
  it('stores, lists, reads and prunes snapshots inside application data', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'forgeloop-audit-history-'));
    try {
      const store = new AuditSnapshotStore({ userDataPath, projectFingerprint: 'a'.repeat(64), retention: 2 });
      const first = { ...snapshotFixture(), auditId: 'audit-1', generatedAt: '2026-01-01T00:00:00.000Z' };
      const second = { ...snapshotFixture(), auditId: 'audit-2', generatedAt: '2026-01-02T00:00:00.000Z' };
      const third = { ...snapshotFixture(), auditId: 'audit-3', generatedAt: '2026-01-03T00:00:00.000Z' };

      await store.save(first);
      await store.save(second);
      await store.save(third);

      expect((await store.list()).map((entry) => entry.auditId)).toEqual(['audit-3', 'audit-2']);
      await expect(store.read('audit-3')).resolves.toMatchObject({ auditId: 'audit-3' });
      await expect(store.read('audit-1')).rejects.toThrow();
      const index = JSON.parse(await readFile(join(userDataPath, 'audits', 'a'.repeat(64), 'index.json'), 'utf8')) as Array<{ auditId: string }>;
      expect(index.map((entry) => entry.auditId)).toEqual(['audit-3', 'audit-2']);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it('fails closed on unsafe identities and tolerates a malformed history index', async () => {
    await expect(Promise.resolve().then(() => new AuditSnapshotStore({ userDataPath: '/tmp', projectFingerprint: '../escape' }))).rejects.toThrow('safe path segment');
    const userDataPath = await mkdtemp(join(tmpdir(), 'forgeloop-audit-history-'));
    try {
      const projectDirectory = join(userDataPath, 'audits', 'project');
      await mkdir(projectDirectory, { recursive: true });
      await writeFile(join(projectDirectory, 'index.json'), '{broken', 'utf8');
      const store = new AuditSnapshotStore({ userDataPath, projectFingerprint: 'project' });
      await expect(store.list()).resolves.toEqual([]);
      await expect(store.read('../escape')).rejects.toThrow('safe path segment');
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it('uses a safe default for invalid retention values', () => {
    const snapshots = Array.from({ length: 52 }, (_, index) => ({ id: String(index), generatedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z` }));
    expect(retainAuditSnapshots(snapshots, 0)).toHaveLength(50);
    expect(retainAuditSnapshots(snapshots, 1.5)).toHaveLength(50);
  });

  it('rejects symlinked history directories and snapshot files', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'forgeloop-audit-history-'));
    const outsidePath = await mkdtemp(join(tmpdir(), 'forgeloop-audit-outside-'));
    const fingerprint = 'b'.repeat(64);
    try {
      const projectDirectory = join(userDataPath, 'audits', fingerprint);
      await mkdir(join(userDataPath, 'audits'), { recursive: true });
      await mkdir(outsidePath, { recursive: true });
      await mkdir(projectDirectory, { recursive: true });
      await symlink(outsidePath, join(projectDirectory, 'snapshots'), 'dir');
      const symlinkedDirectoryStore = new AuditSnapshotStore({ userDataPath, projectFingerprint: fingerprint });
      await expect(symlinkedDirectoryStore.save({ ...snapshotFixture(), auditId: 'audit-dir', generatedAt: '2026-01-01T00:00:00.000Z' })).rejects.toThrow(/symlink/iu);

      const regularStore = new AuditSnapshotStore({ userDataPath, projectFingerprint: 'c'.repeat(64) });
      await regularStore.save({ ...snapshotFixture(), auditId: 'audit-file', generatedAt: '2026-01-01T00:00:00.000Z' });
      const snapshotPath = join(userDataPath, 'audits', 'c'.repeat(64), 'snapshots', 'audit-file.json');
      const outsideSnapshot = join(outsidePath, 'audit-file.json');
      await writeFile(outsideSnapshot, `${JSON.stringify({ ...snapshotFixture(), auditId: 'audit-file' })}\n`, 'utf8');
      await rm(snapshotPath);
      await symlink(outsideSnapshot, snapshotPath, 'file');
      await expect(regularStore.read('audit-file')).rejects.toThrow(/symlink/iu);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
      await rm(outsidePath, { recursive: true, force: true });
    }
  });
});
