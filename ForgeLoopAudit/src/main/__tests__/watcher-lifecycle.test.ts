import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PathBoundary } from '@main/security/path-boundary';
import { ChangeCoalescer } from '@main/watcher/change-coalescer';
import { ProjectWatcher } from '@main/watcher/project-watcher';

describe('watcher lifecycle', () => {
  it('coalesces changes and tears down its timer', async () => {
    const coalescer = new ChangeCoalescer(5);
    const received = vi.fn();
    coalescer.on('coalesced', received);
    coalescer.addChange({ type: 'file', path: '/tmp/a', changeType: 'change', timestamp: Date.now() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received).toHaveBeenCalledOnce();
    coalescer.destroy();
  });

  it('starts, reports filesystem events, and stops cleanly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-watcher-'));
    await mkdir(join(root, '.forgeloop', 'task-state'), { recursive: true });
    const boundary = new PathBoundary(root);
    const events: unknown[] = [];
    const watcher = new ProjectWatcher(boundary, (event) => events.push(event), vi.fn(), vi.fn());
    watcher.start();
    const deadline = Date.now() + 5_000;
    while (!watcher.getStatus().active && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(watcher.getStatus().active).toBe(true);
    await writeFile(join(root, '.forgeloop', 'config.json'), '{}');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(watcher.getStatus().active).toBe(true);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'artifact-changed', artifact: 'config.json' })]));
    await watcher.stop();
    expect(watcher.getStatus().active).toBe(false);
  });

  it('retries a transient path validation failure before dropping a live event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-watcher-retry-'));
    await mkdir(join(root, '.forgeloop', 'task-state'), { recursive: true });
    const boundary = new PathBoundary(root);
    const events: unknown[] = [];
    const watcher = new ProjectWatcher(boundary, (event) => events.push(event), vi.fn(), vi.fn());
    watcher.start();
    const readinessDeadline = Date.now() + 5_000;
    while (!watcher.getStatus().active && Date.now() < readinessDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(watcher.getStatus().active).toBe(true);

    const validatePath = vi.spyOn(boundary, 'validatePath');
    validatePath.mockImplementationOnce(() => {
      throw new Error('transient filesystem visibility');
    });

    try {
      await writeFile(join(root, '.forgeloop', 'config.json'), '{}');
      const eventDeadline = Date.now() + 2_000;
      while (!events.some((event) => (
        typeof event === 'object' && event !== null
          && (event as { type?: string }).type === 'artifact-changed'
          && (event as { artifact?: string }).artifact === 'config.json'
      )) && Date.now() < eventDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'artifact-changed', artifact: 'config.json' }),
      ]));
    } finally {
      validatePath.mockRestore();
      await watcher.stop();
    }
  }, 10000);
});
