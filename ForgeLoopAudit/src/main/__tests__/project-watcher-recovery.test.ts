import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PathBoundary } from '@main/security/path-boundary';
import { ProjectWatcher } from '@main/watcher/project-watcher';

const TASK_KEY = 'a'.repeat(64);

async function makeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'forgeloop-watcher-recovery-'));
  await mkdir(join(root, '.forgeloop', 'task-state', TASK_KEY, 'executions'), { recursive: true });
  await mkdir(join(root, '.forgeloop', 'task-state', TASK_KEY, 'actions'), { recursive: true });
  await mkdir(join(root, '.forgeloop', 'task-state', TASK_KEY, 'approvals'), { recursive: true });
  await mkdir(join(root, '.forgeloop', 'task-state', TASK_KEY, 'evaluations'), { recursive: true });
  await mkdir(join(root, '.forgeloop', 'task-state', TASK_KEY, 'handoffs'), { recursive: true });
  await mkdir(join(root, '.forgeloop', 'task-state', TASK_KEY, 'attestations'), { recursive: true });
  await mkdir(join(root, '.forgeloop', 'policy'), { recursive: true });
  return root;
}

async function waitForEvent(events: unknown[], predicate: (event: unknown) => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (events.some(predicate)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(events).toEqual(expect.arrayContaining([expect.any(Object)]));
  throw new Error('Timed out waiting for watcher event');
}

async function startWatcher(root: string, events: unknown[]): Promise<ProjectWatcher> {
  const watcher = new ProjectWatcher(new PathBoundary(root), (event) => events.push(event), vi.fn(), vi.fn());
  watcher.start();
  const deadline = Date.now() + 5_000;
  while (!watcher.getStatus().active && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!watcher.getStatus().active) {
    await watcher.stop();
    throw new Error('Timed out waiting for watcher readiness');
  }
  return watcher;
}

describe('watcher recovery and execution artifacts', () => {
  it('emits an artifact-changed event when recovery.json appears', async () => {
    const root = await makeProject();
    const events: unknown[] = [];
    const watcher = await startWatcher(root, events);
    try {
      await writeFile(
        join(root, '.forgeloop', 'task-state', TASK_KEY, 'recovery.json'),
        JSON.stringify({ schemaVersion: 1 }),
      );
      await waitForEvent(events, (event) => (
        typeof event === 'object' && event !== null
          && (event as { type?: string }).type === 'artifact-changed'
          && (event as { artifact?: string }).artifact === 'recovery.json'
          && (event as { taskKey?: string }).taskKey === TASK_KEY
      ));
    } finally {
      await watcher.stop();
    }
  });

  it('classifies execution artifact changes as bounded execution-changed events', async () => {
    const root = await makeProject();
    const events: unknown[] = [];
    const watcher = await startWatcher(root, events);
    try {
      await writeFile(
        join(root, '.forgeloop', 'task-state', TASK_KEY, 'executions', 'exec-1.json'),
        JSON.stringify({ schemaVersion: 1 }),
      );
      // Wait for the canonical event instead of assuming a fixed filesystem
      // notification latency: chokidar delivery timing varies per platform.
      await waitForEvent(events, (event) => (
        typeof event === 'object' && event !== null
          && (event as { type?: string }).type === 'execution-changed'
          && (event as { taskKey?: string }).taskKey === TASK_KEY
      ));
      expect(events).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'artifact-changed', artifact: 'exec-1.json' }),
      ]));
    } finally {
      await watcher.stop();
    }
  }, 15000);

  it.each([
    ['workspace-binding.json', 'workspace-binding-changed'],
    ['responsibility.json', 'responsibility-changed'],
    ['verification-scope.json', 'verification-scope-changed'],
  ])('classifies %s as %s', async (fileName, eventType) => {
    const root = await makeProject();
    const events: unknown[] = [];
    const watcher = await startWatcher(root, events);
    try {
      await writeFile(join(root, '.forgeloop', 'task-state', TASK_KEY, fileName), JSON.stringify({ schemaVersion: 1 }));
      await waitForEvent(events, (event) => (
        typeof event === 'object' && event !== null
          && (event as { type?: string }).type === eventType
          && (event as { taskKey?: string }).taskKey === TASK_KEY
      ));
    } finally {
      await watcher.stop();
    }
  }, 15000);

  it('classifies handoff collection changes and coalesces an attestation file burst', async () => {
    const root = await makeProject();
    const events: unknown[] = [];
    const watcher = await startWatcher(root, events);
    try {
      await writeFile(
        join(root, '.forgeloop', 'task-state', TASK_KEY, 'handoffs', 'handoff-123.json'),
        JSON.stringify({ schemaVersion: 1 }),
      );
      await waitForEvent(events, (event) => (
        typeof event === 'object' && event !== null
          && (event as { type?: string }).type === 'handoff-changed'
          && (event as { taskKey?: string }).taskKey === TASK_KEY
      ));

      await Promise.all([
        writeFile(join(root, '.forgeloop', 'task-state', TASK_KEY, 'attestations', 'code-manifest.json'), JSON.stringify({ schemaVersion: 1 })),
        writeFile(join(root, '.forgeloop', 'task-state', TASK_KEY, 'attestations', 'statement.json'), JSON.stringify({ schemaVersion: 1 })),
        writeFile(join(root, '.forgeloop', 'task-state', TASK_KEY, 'attestations', 'statement.sigstore.json'), JSON.stringify({ bundle: true })),
      ]);
      await waitForEvent(events, (event) => (
        typeof event === 'object' && event !== null
          && (event as { type?: string }).type === 'attestation-changed'
          && (event as { taskKey?: string }).taskKey === TASK_KEY
      ));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const attestationEvents = events.filter((event) => (
        typeof event === 'object' && event !== null
          && (event as { type?: string }).type === 'attestation-changed'
      ));
      expect(attestationEvents).toHaveLength(1);
      expect(attestationEvents[0]).toMatchObject({ taskKey: TASK_KEY, artifact: 'attestations' });
    } finally {
      await watcher.stop();
    }
  }, 15000);

  it.each([
    ['actions', 'action-added', 'action-changed'],
    ['approvals', 'approval-added', 'approval-changed'],
    ['evaluations', 'eval-added', 'evaluation-changed'],
  ])('classifies %s collection files without promoting their directories to tasks', async (collection, fileStem, eventType) => {
    const root = await makeProject();
    const events: unknown[] = [];
    const watcher = await startWatcher(root, events);
    const fileName = `${fileStem}.json`;
    const filePath = join(root, '.forgeloop', 'task-state', TASK_KEY, collection, fileName);
    try {
      await writeFile(filePath, JSON.stringify({ schemaVersion: 1 }));
      await waitForEvent(events, (event) => (
        typeof event === 'object' && event !== null
          && (event as { type?: string }).type === eventType
          && (event as { taskKey?: string }).taskKey === TASK_KEY
      ));
      expect(events).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'task-added', taskKey: TASK_KEY }),
      ]));
    } finally {
      await watcher.stop();
    }
  }, 15000);

  it('classifies collection file changes and removals as bounded typed events', async () => {
    const root = await makeProject();
    const events: unknown[] = [];
    const actionPath = join(root, '.forgeloop', 'task-state', TASK_KEY, 'actions', 'action-cycle.json');
    await writeFile(actionPath, JSON.stringify({ schemaVersion: 1, state: 'PLANNED' }));
    const watcher = await startWatcher(root, events);
    try {
      await writeFile(actionPath, JSON.stringify({ schemaVersion: 1, state: 'VERIFIED' }));
      await waitForEvent(events, (event) => (
        typeof event === 'object' && event !== null
          && (event as { type?: string }).type === 'action-changed'
          && (event as { taskKey?: string }).taskKey === TASK_KEY
      ));
      await unlink(actionPath);
      await waitForEvent(events, (event) => (
        typeof event === 'object' && event !== null
          && (event as { type?: string }).type === 'action-changed'
          && (event as { artifact?: string }).artifact === 'action-cycle.json'
      ));
    } finally {
      await watcher.stop();
    }
  }, 15000);

  it('classifies policy capabilities separately from generic policy changes', async () => {
    const root = await makeProject();
    const events: unknown[] = [];
    const watcher = await startWatcher(root, events);
    try {
      await writeFile(
        join(root, '.forgeloop', 'policy', 'capabilities.json'),
        JSON.stringify({ schemaVersion: 1, policy: { default: 'DENY', rules: [] } }),
      );
      await waitForEvent(events, (event) => (
        typeof event === 'object' && event !== null
          && (event as { type?: string }).type === 'capability-policy-changed'
      ));
      expect(events).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'policy-changed', path: expect.stringContaining('capabilities.json') }),
      ]));
    } finally {
      await watcher.stop();
    }
  }, 15000);
});
