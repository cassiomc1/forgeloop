import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecentProjectsStore, WorkspaceProjectsStore, type WorkspaceProjectEntry } from '../../server/storage/app-data';

let root: string;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'fla-app-data-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function entry(path: string, overrides: Partial<WorkspaceProjectEntry> = {}): WorkspaceProjectEntry {
  return { path, name: 'demo', kind: 'DEMO', addedAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z', ...overrides };
}

describe('WorkspaceProjectsStore', () => {
  it('returns an empty list when nothing has been saved', async () => {
    expect(await new WorkspaceProjectsStore({ applicationDataRoot: root }).list()).toEqual([]);
  });

  it('persists a registered project across store instances', async () => {
    const store = new WorkspaceProjectsStore({ applicationDataRoot: root });
    await store.add(entry('/repo/a'));
    expect(await new WorkspaceProjectsStore({ applicationDataRoot: root }).list()).toEqual([entry('/repo/a')]);
  });

  it('treats re-adding a known project as a reopen, not a duplicate', async () => {
    const store = new WorkspaceProjectsStore({ applicationDataRoot: root });
    await store.add(entry('/repo/a'));
    const list = await store.add(entry('/repo/a', { lastOpenedAt: '2026-02-02T00:00:00.000Z' }));
    expect(list).toHaveLength(1);
    expect(list[0].lastOpenedAt).toBe('2026-02-02T00:00:00.000Z');
  });

  it('moves the most recently opened project to the front', async () => {
    const store = new WorkspaceProjectsStore({ applicationDataRoot: root });
    await store.add(entry('/repo/a', { lastOpenedAt: '2026-01-01T00:00:00.000Z' }));
    await store.add(entry('/repo/b', { lastOpenedAt: '2026-03-03T00:00:00.000Z' }));
    const list = await store.add(entry('/repo/a', { lastOpenedAt: '2026-04-04T00:00:00.000Z' }));
    expect(list.map((project) => project.path)).toEqual(['/repo/a', '/repo/b']);
  });

  it('removes a project without touching the others', async () => {
    const store = new WorkspaceProjectsStore({ applicationDataRoot: root });
    await store.add(entry('/repo/a'));
    await store.add(entry('/repo/b'));
    expect((await store.remove('/repo/a')).map((project) => project.path)).toEqual(['/repo/b']);
  });

  it('ignores a corrupt or partial workspace file', async () => {
    mkdirSync(join(root, 'settings'), { recursive: true });
    writeFileSync(join(root, 'settings', 'workspace-projects.json'), '{ not json', 'utf8');
    expect(await new WorkspaceProjectsStore({ applicationDataRoot: root }).list()).toEqual([]);
  });

  it('drops entries that do not match the workspace schema', async () => {
    mkdirSync(join(root, 'settings'), { recursive: true });
    writeFileSync(join(root, 'settings', 'workspace-projects.json'), JSON.stringify({
      schemaVersion: 1,
      projects: [entry('/repo/a'), { path: '/repo/b' }, null, 'nope'],
    }), 'utf8');
    expect((await new WorkspaceProjectsStore({ applicationDataRoot: root }).list()).map((project) => project.path)).toEqual(['/repo/a']);
  });

  it('touch updates only the requested project timestamp', async () => {
    const store = new WorkspaceProjectsStore({ applicationDataRoot: root });
    await store.add(entry('/repo/a'));
    await store.add(entry('/repo/b', { lastOpenedAt: '2026-05-05T00:00:00.000Z' }));
    const list = await store.touch('/repo/a', '2026-06-06T00:00:00.000Z');
    expect(list.find((project) => project.path === '/repo/a')?.lastOpenedAt).toBe('2026-06-06T00:00:00.000Z');
    expect(list.find((project) => project.path === '/repo/b')?.lastOpenedAt).toBe('2026-05-05T00:00:00.000Z');
  });
});

describe('RecentProjectsStore', () => {
  it('keeps the most recently opened project first and de-duplicates by path', async () => {
    const store = new RecentProjectsStore({ applicationDataRoot: root });
    await store.add({ path: '/repo/a', name: 'a', lastOpenedAt: '2026-01-01T00:00:00.000Z' });
    await store.add({ path: '/repo/b', name: 'b', lastOpenedAt: '2026-02-02T00:00:00.000Z' });
    await store.add({ path: '/repo/a', name: 'a', lastOpenedAt: '2026-03-03T00:00:00.000Z' });
    expect((await store.list()).map((project) => project.path)).toEqual(['/repo/a', '/repo/b']);
  });

  it('removes a recent project by path', async () => {
    const store = new RecentProjectsStore({ applicationDataRoot: root });
    await store.add({ path: '/repo/a', name: 'a', lastOpenedAt: '2026-01-01T00:00:00.000Z' });
    await store.add({ path: '/repo/b', name: 'b', lastOpenedAt: '2026-02-02T00:00:00.000Z' });
    await store.remove('/repo/a');
    expect((await store.list()).map((project) => project.path)).toEqual(['/repo/b']);
  });
});
