import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PathBoundary } from '@main/security/path-boundary';
import { ProjectSnapshotBuilder } from '@main/core/project/project-snapshot';

describe('ProjectSnapshotBuilder observations', () => {
  it('surfaces CLI and artifact phase contradictions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forgeloop-snapshot-'));
    try {
      const builder = new ProjectSnapshotBuilder(
        new PathBoundary(root),
        {
          readConfig: () => ({ schemaVersion: 1, protocolVersion: 1, projectName: 'Fixture' }),
          tryReadConfig: () => ({ schemaVersion: 1, protocolVersion: 1, projectName: 'Fixture' }),
          listTaskKeys: () => ['task-1'],
          readTaskSummaryArtifacts: () => ({
            'task.json': { taskId: 'task-1' },
            'work-state.json': { phase: 'VERIFYING' },
          }),
          listSessions: () => [],
          readGlobalPolicy: () => ({}),
        } as any,
        {
          next: async () => ({ success: true, data: { nextAction: 'verify' } }),
          status: async () => ({ success: true, data: { phase: 'COMPLETE', status: 'VALID' } }),
          policyStatus: async () => ({ success: false }),
        } as any,
        { source: 'PROTOCOL_INFO', protocolVersion: 1, schemaVersion: 1 },
        true,
      );

      const snapshot = await builder.build();
      expect(snapshot.tasks[0].protocolConflicts).toEqual([
        { field: 'phase', artifactValue: 'VERIFYING', cliValue: 'COMPLETE' },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not represent task presence as evidence or continuity health', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forgeloop-snapshot-'));
    try {
      const builder = new ProjectSnapshotBuilder(
        new PathBoundary(root),
        {
          readConfig: () => ({ schemaVersion: 1, protocolVersion: 1, projectName: 'Fixture' }),
          tryReadConfig: () => ({ schemaVersion: 1, protocolVersion: 1, projectName: 'Fixture' }),
          listTaskKeys: () => ['task-1'],
          readTaskSummaryArtifacts: () => ({
            'task.json': { taskId: 'task-1' },
            'work-state.json': { phase: 'EXECUTING' },
          }),
          listSessions: () => [],
          readGlobalPolicy: () => ({}),
        } as any,
        { next: async () => ({ success: false }), status: async () => ({ success: false }), policyStatus: async () => ({ success: false }) } as any,
        { source: 'ARTIFACT_ONLY', protocolVersion: 1, schemaVersion: 1 },
        false,
      );

      const snapshot = await builder.build();
      expect(snapshot.health).not.toHaveProperty('state');
      expect(snapshot.health).not.toHaveProperty('evidence');
      expect(snapshot.health).not.toHaveProperty('continuity');
      expect(snapshot.observations).toMatchObject({
        taskCount: 1,
        evidence: { covered: 0, partial: 0, notVerified: 0, blocked: 0 },
        continuity: { present: 0, missing: 1 },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
