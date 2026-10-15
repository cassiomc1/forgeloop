import { describe, expect, it } from 'vitest';
import { resolveRecentProjectKind } from '../../server/runtime/project-kind';
import type { RecentProject } from '@shared/domain';

describe('resolveRecentProjectKind', () => {
  const demoEntry: RecentProject = {
    path: '/tmp/ForgeShop',
    name: 'ForgeShop',
    lastOpenedAt: '2026-01-01T00:00:00.000Z',
    kind: 'DEMO',
  };

  const normalEntry: RecentProject = {
    path: '/tmp/real-project',
    name: 'real-project',
    lastOpenedAt: '2026-01-02T00:00:00.000Z',
    kind: 'PROJECT',
  };

  it('preserves DEMO classification for the bundled demo', () => {
    expect(resolveRecentProjectKind([demoEntry, normalEntry], '/tmp/ForgeShop')).toBe('DEMO');
  });

  it('returns PROJECT for explicitly classified normal projects', () => {
    expect(resolveRecentProjectKind([demoEntry, normalEntry], '/tmp/real-project')).toBe('PROJECT');
  });

  it('defaults legacy entries without a kind field to PROJECT', () => {
    const legacy: RecentProject = { path: '/tmp/legacy', name: 'legacy', lastOpenedAt: '2025-01-01T00:00:00.000Z' };
    expect(resolveRecentProjectKind([demoEntry, legacy], '/tmp/legacy')).toBe('PROJECT');
  });

  it('defaults unknown paths (never stored) to PROJECT', () => {
    expect(resolveRecentProjectKind([demoEntry], '/tmp/somewhere-else')).toBe('PROJECT');
  });

  it('handles a missing recent list safely', () => {
    expect(resolveRecentProjectKind(undefined, '/tmp/anything')).toBe('PROJECT');
  });
});
