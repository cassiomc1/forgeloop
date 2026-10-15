import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverForgeLoopProjects, resolveForgeLoopProjectRoot } from '@main/core/project/project-discovery';

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'forgeloop-project-discovery-'));
}

function writeProjectConfig(root: string): void {
  mkdirSync(join(root, '.forgeloop'), { recursive: true });
  writeFileSync(join(root, '.forgeloop', 'config.json'), JSON.stringify({ schemaVersion: 1, protocolVersion: 1 }));
}

describe('ForgeLoop project discovery', () => {
  it('selects the chosen directory when it is already a ForgeLoop project', async () => {
    const root = makeRoot();
    try {
      writeProjectConfig(root);

      await expect(discoverForgeLoopProjects(root)).resolves.toEqual([resolve(root)]);
      await expect(resolveForgeLoopProjectRoot(root)).resolves.toBe(resolve(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds a ForgeLoop project recursively below the chosen directory', async () => {
    const root = makeRoot();
    const project = join(root, 'workspace', 'nested-project');
    try {
      writeProjectConfig(project);

      await expect(discoverForgeLoopProjects(root)).resolves.toEqual([resolve(project)]);
      await expect(resolveForgeLoopProjectRoot(root)).resolves.toBe(resolve(project));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when the chosen directory contains multiple projects', async () => {
    const root = makeRoot();
    const first = join(root, 'alpha');
    const second = join(root, 'beta', 'nested');
    try {
      writeProjectConfig(first);
      writeProjectConfig(second);

      await expect(discoverForgeLoopProjects(root)).resolves.toEqual([resolve(first), resolve(second)]);
      await expect(resolveForgeLoopProjectRoot(root)).rejects.toMatchObject({
        code: 'PROJECT_DISCOVERY_AMBIGUOUS',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not follow symlinked directories while searching', async () => {
    const root = makeRoot();
    const outside = makeRoot();
    try {
      writeProjectConfig(outside);
      symlinkSync(outside, join(root, 'linked-project'), 'dir');

      await expect(discoverForgeLoopProjects(root)).resolves.toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('does not enter dependency or build directories', async () => {
    const root = makeRoot();
    try {
      for (const ignoredDirectory of ['.git', '.worktrees', 'worktrees', 'node_modules', 'dist', 'build', 'coverage']) {
        writeProjectConfig(join(root, ignoredDirectory, `${ignoredDirectory}-project`));
      }

      await expect(discoverForgeLoopProjects(root)).resolves.toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
