import type { ProjectKind, RecentProject } from '@shared/domain';

export function resolveRecentProjectKind(
  recentProjects: RecentProject[] | undefined,
  path: string,
): ProjectKind {
  const stored = recentProjects?.find((entry) => entry.path === path);
  return stored?.kind === 'DEMO' ? 'DEMO' : 'PROJECT';
}
