import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PathBoundary, isPathWithinBoundary, normalizePath } from '@main/security/path-boundary';

describe('PathBoundary', () => {
  it('accepts trusted ForgeLoop paths and rejects missing or escaped paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-boundary-'));
    await mkdir(join(root, '.forgeloop', 'task-state'), { recursive: true });
    await writeFile(join(root, '.forgeloop', 'config.json'), '{}');
    await writeFile(join(root, '.forgeloop', 'task-state', 'events.ndjson'), '');
    const boundary = new PathBoundary(root);
    expect(boundary.validatePath('.forgeloop/config.json')).toContain('.forgeloop');
    expect(boundary.validateForgeLoopPath('task-state/events.ndjson')).toContain('events.ndjson');
    expect(boundary.validateLexicalPath('.forgeloop/new.json')).toContain('.forgeloop');
    expect(() => boundary.validatePath('missing.json')).toThrow();
    expect(() => boundary.validateLexicalPath('../outside')).toThrow();
    expect(boundary.isWithinProject(join(root, '.forgeloop'))).toBe(true);
    expect(isPathWithinBoundary(join(root, '.forgeloop'), root)).toBe(true);
    expect(isPathWithinBoundary(join(root, 'missing'), root)).toBe(false);
    expect(normalizePath(root)).toBe(root);
  });
});
