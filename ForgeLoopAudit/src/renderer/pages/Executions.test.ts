import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ExecutionRecord, ProjectSnapshot } from '@shared/domain';
import { ExecutionEntry, Executions } from './Executions';

const ISOLATED_EXECUTION = {
  executionId: 'exec-isolated-1',
  taskId: 'TASK-001',
  checkId: 'check-tests',
  requirement: 'Tests must pass',
  verificationCycle: 1,
  kind: 'COMMAND_EXECUTION',
  argv: ['npm', 'test'],
  cwd: '/repo/.forgeloop-isolation/worktree',
  executionKind: 'VERIFICATION',
  protocolProjectRoot: '/repo',
  executionIsolation: 'PROJECT_ISOLATED',
  isolation: {
    mode: 'PROJECT_ISOLATED',
    isolated: true,
    liveProjectWritable: false,
    networkPolicy: 'INHERITED',
    environmentPolicy: 'SANITIZED',
  },
  resolution: {},
  startedAt: '2026-08-20T10:00:00.000Z',
  finishedAt: '2026-08-20T10:01:00.000Z',
  status: 'passed',
  exitCode: 0,
} as unknown as ExecutionRecord;

function unavailableSnapshot(): ProjectSnapshot {
  return {
    project: { name: 'Demo', rootPath: '/repo' },
    protocol: {
      protocolVersion: 1,
      schemaVersion: 1,
      compatible: true,
      compatibilityMode: 'INTEGRATION_V1',
      featureSupport: {
        canonicalOwnership: true,
        observability: true,
        structuredDiagnostics: true,
        durableActions: true,
        approvals: true,
        capabilityPolicy: true,
        trajectoryMetrics: true,
      trajectoryEvaluations: true,
      verificationExecutionIsolation: false,
      workspaceBinding: false,
      canonicalHandoffs: false,
      responsibilityConstraints: false,
      differentialVerificationScope: false,
      codeAttestation: false,
      advisoryContextProviders: false,
    },
    },
    health: { status: 'VALID', source: 'FORGELOOP_STATUS_AGGREGATE' },
    observations: {
      taskCount: 1,
      evidence: { covered: 0, partial: 0, notVerified: 1, blocked: 0 },
      continuity: { present: 0, missing: 1 },
      artifactValidationErrors: 0,
      ownership: {
        activeCount: 0,
        recoveredResumeRequiredCount: 0,
        inconsistentCount: 0,
        unavailableCount: 0,
      },
    },
    tasks: [{ taskId: 'TASK-001' } as ProjectSnapshot['tasks'][number]],
    sessions: [],
    updatedAt: '2026-08-28T00:00:00.000Z',
  };
}

describe('Executions presentation wiring', () => {
  it('keeps generic execution data and raw JSON control while hiding isolation UI when unavailable', () => {
    const markup = renderToStaticMarkup(createElement(ExecutionEntry, {
      execution: ISOLATED_EXECUTION,
      featureAvailable: false,
      expanded: true,
      rawVisible: false,
      onToggleExpanded: () => undefined,
      onToggleRaw: () => undefined,
    }));

    expect(markup).toContain('exec-isolated-1');
    expect(markup).toContain('npm test');
    expect(markup).toContain('PASSED');
    expect(markup).toContain('exit 0');
    expect(markup).toContain('Show raw JSON');
    expect(markup).not.toContain('PROJECT_ISOLATED');
    expect(markup).not.toContain('Isolation mode');
    expect(markup).not.toContain('Network policy');
  });

  it('shows the neutral capability message when the snapshot omits isolation support', () => {
    const markup = renderToStaticMarkup(createElement(Executions, {
      snapshot: unavailableSnapshot(),
      selectedTaskId: 'TASK-001',
    }));

    expect(markup).toContain('Verification isolation capability is unavailable for this ForgeLoop runtime.');
    expect(markup).toContain('Persisted execution provenance remains available in raw form.');
  });
});
