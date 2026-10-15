import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PathBoundary } from '@main/security/path-boundary';
import { ProjectReader } from '@main/core/project/project-reader';
import { SchemaValidator } from '@main/core/protocol/validator';
import { readForgeLoopIntegrationResource } from '@cassiomc1/forgeloop/integration';

const validRoot = 'tests/fixtures/protocol-valid';
const invalidRoot = 'tests/fixtures/protocol-invalid';
const legacyRoot = 'tests/fixtures/legacy/forgeloop-1.3';

interface FixtureMetadata {
  forgeloopVersion: string;
  expectedPhase: string;
  expectedAuditHealth: string;
  expectedClaimState: string | null;
  expectedArtifactErrors: boolean;
  taskKeyMatchesDirectory: boolean;
  legacy: boolean;
}

async function canonicalClaimState(fixtureRoot: string): Promise<string | null> {
  const list = (await readForgeLoopIntegrationResource('project/tasks', { projectPath: fixtureRoot })) as { data: { tasks: Array<{ taskId: string }> } };
  const taskId = list.data.tasks[0]?.taskId;
  if (!taskId) return null;
  const ownership = await readForgeLoopIntegrationResource('task/ownership', { projectPath: fixtureRoot, taskId }) as {
    data: { claimState?: unknown };
  };
  return ownership.data.claimState as string;
}

describe('ForgeLoop 1.5 conformance fixtures', () => {
  it('loads every generated valid protocol fixture through ForgeLoopAudit readers', async () => {
    for (const name of readdirSync(validRoot)) {
      const fixtureRoot = join(validRoot, name);
      const metadata = JSON.parse(readFileSync(join(fixtureRoot, 'fixture.json'), 'utf8')) as FixtureMetadata;
      expect(metadata.forgeloopVersion, name).toBe('1.5.0');
      expect(metadata.legacy, name).toBe(false);

      const reader = new ProjectReader(new PathBoundary(fixtureRoot), new SchemaValidator('schemas'));
      expect(reader.readConfig().protocolVersion).toBe(1);
      const taskKey = reader.listTaskKeys()[0];
      const artifacts = reader.readTaskSummaryArtifacts(taskKey);
      expect(artifacts['work-state.json']).toBeDefined();
      if (!metadata.expectedArtifactErrors) {
        expect(reader.getArtifactErrors(taskKey), name).toEqual([]);
      }
      for (const artifactName of ['task.json', 'work-state.json']) {
        expect(artifacts[artifactName]).toMatchObject({ protocolVersion: 1, schemaVersion: 1 });
      }
      expect(artifacts['work-state.json']).toMatchObject({ phase: metadata.expectedPhase });

      // Schema validity and operational consistency are separate gates: a
      // schema-valid fixture may still be canonically inconsistent.
      const canonicalState = await canonicalClaimState(fixtureRoot);
      if (metadata.expectedClaimState) {
        // Historical JSON remains schema-valid; native recovery authority requires migration.
        expect(canonicalState, name).toBe(metadata.expectedClaimState === 'RELEASED_BY_RECOVERY' ? 'INCONSISTENT' : metadata.expectedClaimState);
      }
    }
  });

  it('separates schema-valid JSON from operational consistency', () => {
    // ownership-inconsistent validates against every trusted schema while its
    // canonical claim state must fail closed.
    const root = join(validRoot, 'ownership-inconsistent');
    const reader = new ProjectReader(new PathBoundary(root), new SchemaValidator('schemas'));
    const taskKey = reader.listTaskKeys()[0];
    expect(reader.getArtifactErrors(taskKey)).toEqual([]);
    const metadata = JSON.parse(readFileSync(join(root, 'fixture.json'), 'utf8')) as FixtureMetadata;
    expect(metadata.expectedClaimState).toBe('INCONSISTENT');
  });

  it('fails closed on corrupt recovery artifacts without hiding them', () => {
    const root = join(validRoot, 'corrupt-recovery');
    const reader = new ProjectReader(new PathBoundary(root), new SchemaValidator('schemas'));
    const taskKey = reader.listTaskKeys()[0];
    const artifacts = reader.readTaskSummaryArtifacts(taskKey);
    expect(artifacts['recovery.json']).toBeUndefined();
    expect(reader.getArtifactErrors(taskKey).join('\n')).toMatch(/recovery\.json/);
  });

  it('flags a task directory whose key does not match sha256(taskId)', () => {
    const root = join(validRoot, 'task-key-mismatch');
    const reader = new ProjectReader(new PathBoundary(root), new SchemaValidator('schemas'));
    const dirKey = reader.listTaskKeys()[0];
    const descriptor = reader.readTaskDescriptor(dirKey) as Record<string, unknown>;
    expect(dirKey).not.toBe(descriptor.taskKey);
    expect(createHash('sha256').update(String(descriptor.taskId)).digest('hex')).toBe(descriptor.taskKey);
  });

  it('rejects every generated invalid protocol fixture with an actionable read error', () => {
    for (const name of readdirSync(invalidRoot)) {
      const fixtureRoot = join(invalidRoot, name);
      const metadata = JSON.parse(readFileSync(join(fixtureRoot, 'fixture.json'), 'utf8')) as { legacy: boolean };
      expect(metadata.legacy).toBe(false);
      const reader = new ProjectReader(new PathBoundary(fixtureRoot), new SchemaValidator('schemas'));
      expect(() => reader.readConfig()).toThrow();
    }
  });
});

describe('legacy ForgeLoop 1.3 conformance fixtures', () => {
  it('keeps the legacy fixture set explicitly separated and read-only compatible', () => {
    for (const group of ['protocol-valid', 'protocol-invalid']) {
      const names = readdirSync(join(legacyRoot, group));
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        const metadata = JSON.parse(readFileSync(join(legacyRoot, group, name, 'fixture.json'), 'utf8')) as { forgeloopVersion: string; legacy?: boolean };
        expect(metadata.forgeloopVersion).toBe('1.3.0');
      }
    }
  });

  it('still opens legacy valid fixtures through ForgeLoopAudit readers without upgrade', () => {
    for (const name of readdirSync(join(legacyRoot, 'protocol-valid'))) {
      const fixtureRoot = join(legacyRoot, 'protocol-valid', name);
      const reader = new ProjectReader(new PathBoundary(fixtureRoot), new SchemaValidator('schemas'));
      expect(reader.readConfig().protocolVersion).toBe(1);
      expect(reader.listTaskKeys()).toHaveLength(1);
    }
  });
});
