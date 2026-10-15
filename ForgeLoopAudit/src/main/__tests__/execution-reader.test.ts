import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PathBoundary } from '@main/security/path-boundary';
import { SchemaValidator } from '@main/core/protocol/validator';
import { createExecutionReader } from '@main/core/executions/execution-reader';

const VALID_EXECUTION = {
  schemaVersion: 1,
  protocolVersion: 1,
  executionId: 'exec-1',
  taskId: 'TASK-001',
  checkId: 'check-tests',
  requirement: 'Tests must pass',
  verificationCycle: 1,
  kind: 'COMMAND_EXECUTION',
  argv: ['npm', 'test'],
  cwd: '/repo',
  resolution: { resolutionMode: 'direct', mayInstall: false, installer: null, tool: null },
  startedAt: '2026-08-20T10:00:00.000Z',
  finishedAt: '2026-08-20T10:01:00.000Z',
  status: 'passed',
  exitCode: 0,
};

const V161_EXECUTION = {
  ...VALID_EXECUTION,
  executionId: 'exec-isolated-1',
  executionKind: 'VERIFICATION',
  protocolProjectRoot: '/repo',
  cwd: '/repo/.forgeloop-isolation/worktree',
  executionIsolation: 'PROJECT_ISOLATED',
  isolation: {
    mode: 'PROJECT_ISOLATED',
    isolated: true,
    liveProjectWritable: false,
    networkPolicy: 'INHERITED',
    environmentPolicy: 'SANITIZED',
  },
};

const NATIVE_EXECUTION = {
  ...VALID_EXECUTION,
  executionId: 'exec-native-1',
  executionKind: 'VERIFICATION',
  protocolProjectRoot: '/repo',
  cwd: '/repo',
  executionIsolation: 'NATIVE_PROJECT',
  isolation: {
    mode: 'NATIVE_PROJECT',
    isolated: false,
    liveProjectWritable: true,
    networkPolicy: 'INHERITED',
    environmentPolicy: 'INHERITED',
  },
};

describe('core/executions/execution-reader', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'forgeloop-executions-'));
    const execDir = join(root, '.forgeloop', 'task-state', 'a'.repeat(64), 'executions');
    mkdirSync(execDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function reader() {
    return createExecutionReader(new PathBoundary(root), new SchemaValidator('schemas'));
  }

  it('accepts a valid legacy protocol-v1 execution without isolation metadata', () => {
    const dir = join(root, '.forgeloop', 'task-state', 'a'.repeat(64), 'executions');
    for (const id of ['exec-c', 'exec-a', 'exec-b']) {
      writeFileSync(join(dir, `${id}.json`), JSON.stringify({ ...VALID_EXECUTION, executionId: id }));
    }
    const page = reader().readExecutions('a'.repeat(64));
    expect(page.executions.map((entry) => entry.executionId)).toEqual(['exec-a', 'exec-b', 'exec-c']);
    expect(page.invalidCount).toBe(0);
  });

  it('accepts a valid ForgeLoop 1.6.1 execution and preserves isolation metadata', () => {
    const dir = join(root, '.forgeloop', 'task-state', 'a'.repeat(64), 'executions');
    writeFileSync(join(dir, 'exec-isolated-1.json'), JSON.stringify(V161_EXECUTION));

    const page = reader().readExecutions('a'.repeat(64));

    expect(page.invalidCount).toBe(0);
    expect(page.executions).toHaveLength(1);
    expect(page.executions[0]).toMatchObject({
      executionKind: 'VERIFICATION',
      protocolProjectRoot: '/repo',
      cwd: '/repo/.forgeloop-isolation/worktree',
      executionIsolation: 'PROJECT_ISOLATED',
      isolation: V161_EXECUTION.isolation,
    });
  });

  it('accepts a native ForgeLoop 1.6.1 execution and preserves its recorded boundary', () => {
    const dir = join(root, '.forgeloop', 'task-state', 'a'.repeat(64), 'executions');
    writeFileSync(join(dir, 'exec-native-1.json'), JSON.stringify(NATIVE_EXECUTION));

    const page = reader().readExecutions('a'.repeat(64));

    expect(page.invalidCount).toBe(0);
    expect(page.executions).toHaveLength(1);
    expect(page.executions[0]).toMatchObject({
      executionKind: 'VERIFICATION',
      protocolProjectRoot: '/repo',
      cwd: '/repo',
      executionIsolation: 'NATIVE_PROJECT',
      isolation: NATIVE_EXECUTION.isolation,
    });
  });

  it('surfaces invalid executions without dropping the valid ones', () => {
    const dir = join(root, '.forgeloop', 'task-state', 'a'.repeat(64), 'executions');
    writeFileSync(join(dir, 'exec-good.json'), JSON.stringify({ ...VALID_EXECUTION, executionId: 'exec-good' }));
    writeFileSync(join(dir, 'exec-bad.json'), JSON.stringify({ ...VALID_EXECUTION, status: 'meh' }));
    const page = reader().readExecutions('a'.repeat(64));
    expect(page.executions).toHaveLength(1);
    expect(page.invalidCount).toBe(1);
  });

  it('withholds unsupported top-level properties while keeping valid siblings visible', () => {
    const dir = join(root, '.forgeloop', 'task-state', 'a'.repeat(64), 'executions');
    writeFileSync(join(dir, 'exec-good.json'), JSON.stringify({ ...VALID_EXECUTION, executionId: 'exec-good' }));
    writeFileSync(join(dir, 'exec-unknown.json'), JSON.stringify({
      ...VALID_EXECUTION,
      executionId: 'exec-unknown',
      unsupportedProperty: true,
    }));

    const page = reader().readExecutions('a'.repeat(64));

    expect(page.executions.map((entry) => entry.executionId)).toEqual(['exec-good']);
    expect(page.invalidCount).toBe(1);
  });

  it('rejects symlinked execution files', () => {
    const dir = join(root, '.forgeloop', 'task-state', 'a'.repeat(64), 'executions');
    symlinkSync('/etc/hostname', join(dir, 'exec-link.json'));
    const page = reader().readExecutions('a'.repeat(64));
    expect(page.executions).toHaveLength(0);
    expect(page.invalidCount).toBe(1);
  });

  it('only accepts exec-*.json file names', () => {
    const dir = join(root, '.forgeloop', 'task-state', 'a'.repeat(64), 'executions');
    writeFileSync(join(dir, 'notes.json'), JSON.stringify(VALID_EXECUTION));
    const page = reader().readExecutions('a'.repeat(64));
    expect(page.executions).toHaveLength(0);
    expect(page.invalidCount).toBe(0);
  });

  it('returns an empty bounded result when the directory is missing', () => {
    const page = reader().readExecutions('b'.repeat(64));
    expect(page.executions).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('bounds the number of returned executions', () => {
    const dir = join(root, '.forgeloop', 'task-state', 'a'.repeat(64), 'executions');
    for (let i = 0; i < 5; i += 1) {
      writeFileSync(join(dir, `exec-${i}.json`), JSON.stringify({ ...VALID_EXECUTION, executionId: `exec-${i}` }));
    }
    const page = reader().readExecutions('a'.repeat(64), { limit: 2 });
    expect(page.executions).toHaveLength(2);
    expect(page.hasMore).toBe(true);
  });

  it('rejects path escape attempts through the task key', () => {
    expect(() => reader().readExecutions('../../escape')).toThrow();
  });

  it('rejects a symlinked executions directory', () => {
    const key = 'c'.repeat(64);
    mkdirSync(join(root, '.forgeloop', 'task-state', key), { recursive: true });
    // Real directory outside the project boundary; junction keeps this
    // portable across Windows (no admin rights) and POSIX.
    const outsideTarget = mkdtempSync(join(tmpdir(), 'exec-outside-'));
    const linkPath = join(root, '.forgeloop', 'task-state', key, 'executions');
    if (process.platform === 'win32') symlinkSync(outsideTarget, linkPath, 'junction');
    else symlinkSync(outsideTarget, linkPath);
    try {
      expect(() => reader().readExecutions(key)).toThrow(/Path traversal|symbolic link/i);
    } finally {
      rmSync(linkPath, { force: true });
      rmSync(outsideTarget, { recursive: true, force: true });
    }
  });

  it('rejects when the executions path resolves to a regular file instead of a directory', () => {
    const key = 'd'.repeat(64);
    mkdirSync(join(root, '.forgeloop', 'task-state', key), { recursive: true });
    writeFileSync(join(root, '.forgeloop', 'task-state', key, 'executions'), 'not a directory');
    expect(() => reader().readExecutions(key)).toThrow();
  });
});
