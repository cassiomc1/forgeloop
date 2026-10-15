import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createNativeDemoFixture } from '../../../scripts/demo/native-fixture.mjs';
import { AuditRuntime } from '../../server/runtime/audit-runtime';

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('ForgeLoop 2 native storage through the public Integration API', () => {
  let native: ReturnType<typeof createNativeDemoFixture>;
  let appRoot: string;
  let runtime: AuditRuntime;

  beforeAll(async () => {
    native = createNativeDemoFixture();
    appRoot = mkdtempSync(join(tmpdir(), 'forgeloop-audit-native-app-'));
    runtime = new AuditRuntime({ auditVersion: '0.3.0-rc.3', applicationDataRoot: appRoot, appPath: process.cwd(), schemaDirectory: join(process.cwd(), 'schemas') });
  }, 60_000);

  afterAll(async () => {
    await runtime?.shutdown();
    native?.cleanup();
    if (appRoot) rmSync(appRoot, { recursive: true, force: true });
  });

  it('discovers and inspects native tasks without JSON namespaces or database writes', async () => {
    const database = join(native.root, '.forgeloop', 'state.sqlite');
    const before = digest(database);
    const filesBefore = readdirSync(join(native.root, '.forgeloop')).sort();
    const detection = await runtime.openProjectForStartup(native.root);
    expect(detection.compatibilityMode).toBe('INTEGRATION_V1');
    const updates: Array<{ type: string }> = [];
    const unsubscribe = runtime.subscribe((update) => updates.push(update));
    const snapshot = await runtime.getProjectSnapshot();
    expect(snapshot.tasks).toHaveLength(8);
    expect(snapshot.tasks.find((task) => task.taskId === 'TASK-002')?.phase).toBe('VERIFYING');
    const task = await runtime.getTask('TASK-002');
    expect(task.summary.phase).toBe('VERIFYING');
    expect(task.contract?.objective).toBeTypeOf('string');
    expect(task.workState?.phase).toBe('VERIFYING');
    const abandoned = await runtime.getTask('TASK-007');
    expect(abandoned.summary.recovery?.classificationAtRecovery).toBe('ABANDONED');
    expect(abandoned.summary.phase).not.toBe('COMPLETE');
    await expect(runtime.getTaskEvents('TASK-002')).rejects.toMatchObject({ code: 'ARTIFACT_UNREADABLE' });
    expect(digest(database)).toBe(before);
    expect(readdirSync(join(native.root, '.forgeloop')).sort()).toEqual(filesBefore);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(updates.some((update) => update.type === 'audit-invalidated')).toBe(false);
    unsubscribe();
  }, 60_000);

  it('invalidates and refreshes observations after a native database commit', async () => {
    const updates: unknown[] = [];
    const unsubscribe = runtime.subscribe((update) => updates.push(update));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const db = new DatabaseSync(join(native.root, '.forgeloop', 'state.sqlite'));
    try {
      const row = db.prepare('SELECT state_json FROM tasks WHERE task_id = ?').get('TASK-005') as { state_json: string };
      const state = JSON.parse(row.state_json);
      state.lastUpdated = '2026-10-14T12:00:00.000Z';
      db.prepare('UPDATE tasks SET state_json = ? WHERE task_id = ?').run(JSON.stringify(state), 'TASK-005');
    } finally { db.close(); }
    // Cold hosted Windows reads the full eight-task canonical projection.
    // Its observed startup exceeds ten seconds; still require a real refresh
    // and the committed value, within a bounded platform-specific deadline.
    const refreshTimeout = process.platform === 'win32' ? 30_000 : 10_000;
    await expect.poll(() => updates.some((update) => (update as { type: string }).type === 'snapshot-refreshed'), { timeout: refreshTimeout }).toBe(true);
    expect((await runtime.getTask('TASK-005')).workState?.lastUpdated).toBe('2026-10-14T12:00:00.000Z');
    unsubscribe();
  }, 60_000);

  it('reads an RC4 attachment-inclusive restore at a new root without modifying native authority', async () => {
    const restoredRoot = mkdtempSync(join(tmpdir(), 'forgeloop-audit-restored-'));
    const isolatedApp = mkdtempSync(join(tmpdir(), 'forgeloop-audit-restored-app-'));
    const restoredRuntime = new AuditRuntime({ auditVersion: '0.3.0-rc.3', applicationDataRoot: isolatedApp, appPath: process.cwd(), schemaDirectory: join(process.cwd(), 'schemas') });
    const cli = fileURLToPath(import.meta.resolve('@cassiomc1/forgeloop'));
    const backup = 'audit-restore-backup';
    try {
      execFileSync(process.execPath, [cli, 'storage-backup', '--destination', backup, '--include-attachments', '--json'], { cwd: native.root, encoding: 'utf8' });
      const restored = JSON.parse(execFileSync(process.execPath, [cli, 'storage-restore', '--source', join(native.root, backup), '--writers-quiesced', '--json'], { cwd: restoredRoot, encoding: 'utf8' }));
      expect(restored.active).toBe(true);
      // Restore activates storage only; the user initializes the kit separately.
      execFileSync(process.execPath, [cli, 'init'], { cwd: restoredRoot, encoding: 'utf8' });
      const database = join(restoredRoot, '.forgeloop', 'state.sqlite');
      const before = digest(database);
      const filesBefore = readdirSync(join(restoredRoot, '.forgeloop')).sort();
      expect((await restoredRuntime.openProjectForStartup(restoredRoot)).compatibilityMode).toBe('INTEGRATION_V1');
      expect((await restoredRuntime.getProjectSnapshot()).tasks).toHaveLength(8);
      expect((await restoredRuntime.getTask('TASK-002')).summary.phase).toBe('VERIFYING');
      expect(digest(database)).toBe(before);
      const filesAfter = readdirSync(join(restoredRoot, '.forgeloop')).sort();
      // SQLite may allocate coordination sidecars for the first read after
      // restore. An empty WAL contains no committed database writes.
      expect(filesAfter.filter((name) => !['state.sqlite-wal', 'state.sqlite-shm'].includes(name))).toEqual(filesBefore);
      if (filesAfter.includes('state.sqlite-wal')) {
        expect(readFileSync(join(restoredRoot, '.forgeloop', 'state.sqlite-wal'))).toHaveLength(0);
      }
    } finally {
      await restoredRuntime.shutdown();
      rmSync(restoredRoot, { recursive: true, force: true });
      rmSync(isolatedApp, { recursive: true, force: true });
    }
  }, 60_000);

  it('keeps historical JSON projects in artifact-only mode without migration', async () => {
    const detection = await runtime.openProjectForStartup(join(process.cwd(), 'demo'));
    expect(detection.compatibilityMode).toBe('ARTIFACT_ONLY');
    expect((await runtime.getProjectSnapshot()).tasks).toHaveLength(8);
    expect(readdirSync(join(process.cwd(), 'demo', '.forgeloop'))).not.toContain('state.sqlite');
  }, 30_000);

  it('refuses retained artifact fallback when a selected native database is missing', async () => {
    await runtime.closeProject();
    const database = join(native.root, '.forgeloop', 'state.sqlite');
    renameSync(database, `${database}.retained`);
    try {
      await expect(runtime.openProjectForStartup(native.root)).rejects.toThrow('Canonical task discovery unavailable');
    } finally { renameSync(`${database}.retained`, database); }
  }, 30_000);
});
