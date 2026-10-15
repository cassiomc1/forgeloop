import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProjectSnapshot } from '@shared/domain';
import { Continuity } from './Continuity';

function snapshotWithDiagnosticContext(): ProjectSnapshot {
  return {
    project: {
      name: 'Demo',
      rootPath: '/demo',
    },
    protocol: {
      protocolVersion: 1,
      schemaVersion: 1,
      compatible: true,
    },
    health: {
      status: 'healthy',
      issues: [],
    },
    observations: [],
    updatedAt: '2026-08-26T00:00:00.000Z',
    activeTaskId: 'TASK-002',
    tasks: [
      {
        taskId: 'TASK-002',
        taskKey: 'task-key',
        phase: 'VERIFYING',
        continuity: {
          taskId: 'TASK-002',
          phase: 'VERIFYING',
          updatedAt: '2026-08-04T11:03:00.000Z',
          remainingWork: [],
          knownIssues: [],
          changedAreas: [],
          inspectFirst: [],
          resumeNote: 'Resume in VERIFYING.',
          diagnosticContext: {
            present: true,
            activeFailureSignatures: ['sig-1'],
            activeFailedRequirements: ['Corrupted persisted carts are discarded safely'],
            openHypotheses: ['h-cart-parser'],
            latestIntervention: 'intervention-cart-guard',
            nextExperiment: 'Run verification cycle 2',
            doNotRepeat: [{ summary: 'repeat-semantic-fingerprint' }],
          },
        },
      },
    ],
    sessions: [],
  } as unknown as ProjectSnapshot;
}

describe('Continuity page', () => {
  it('renders canonical diagnostic-context fields without local stall semantics', () => {
    const html = renderToStaticMarkup(
      React.createElement(Continuity, {
        snapshot: snapshotWithDiagnosticContext(),
        selectedTaskId: 'TASK-002',
      }),
    );

    expect(html).toContain('Open hypotheses');
    expect(html).toContain('h-cart-parser');
    expect(html).toContain('Latest intervention');
    expect(html).toContain('intervention-cart-guard');
    expect(html).toContain('Next experiment');
    expect(html).toContain('Run verification cycle 2');
    expect(html).not.toContain('Guidance');
  });
});
