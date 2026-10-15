import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ForgeLoopAuditError } from '@shared/errors';
import { CONFIG_FILE, MANIFEST_FILE, LEGACY_MANIFEST_FILE } from '@shared/constants';

const PROJECT_MARKER_FILES = [CONFIG_FILE, MANIFEST_FILE, LEGACY_MANIFEST_FILE];

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.worktrees',
  'worktrees',
  'node_modules',
  'dist',
  'build',
  'coverage',
]);

async function isForgeLoopProject(directory: string): Promise<boolean> {
  try {
    const forgeLoopDirectory = await lstat(join(directory, '.forgeloop'));
    if (!forgeLoopDirectory.isDirectory()) return false;

    for (const marker of PROJECT_MARKER_FILES) {
      try {
        const markerStat = await lstat(join(directory, '.forgeloop', marker));
        if (markerStat.isFile()) return true;
      } catch {
        // marker absent; try the next one
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function isDirectory(directory: string): Promise<boolean> {
  try {
    return (await lstat(directory)).isDirectory();
  } catch {
    return false;
  }
}

export async function discoverForgeLoopProjects(selectedDirectory: string): Promise<string[]> {
  const root = resolve(selectedDirectory);
  const candidates: string[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const directory = pending.shift();
    if (!directory || !(await isDirectory(directory))) continue;

    if (await isForgeLoopProject(directory)) {
      candidates.push(directory);
      continue;
    }

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink() || !entry.isDirectory() || IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
      pending.push(join(directory, entry.name));
    }
  }

  return candidates.sort((left, right) => left.localeCompare(right));
}

export async function resolveForgeLoopProjectRoot(selectedDirectory: string): Promise<string> {
  const selectedRoot = resolve(selectedDirectory);
  const candidates = await discoverForgeLoopProjects(selectedRoot);

  if (candidates.length > 1) {
    throw ForgeLoopAuditError.projectDiscoveryAmbiguous(selectedRoot, candidates);
  }

  return candidates[0] ?? selectedRoot;
}
