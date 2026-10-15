import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARTIFACT_SCHEMAS, getArtifactDefinition, getMissingArtifactSchemas, getSchemaForArtifact, isRequiredArtifact, isTaskArtifact } from '@main/core/protocol/artifact-registry';

describe('artifact registry', () => {
  it('keeps required, task, optional, and schema mappings explicit', async () => {
    expect(getSchemaForArtifact('config.json')).toBe('config.schema.json');
    expect(isRequiredArtifact('config.json')).toBe(true);
    expect(isRequiredArtifact('task.json')).toBe(false);
    expect(isTaskArtifact('task.json')).toBe(true);
    expect(isTaskArtifact('policy-snapshot.json')).toBe(true);
    expect(isTaskArtifact('config.json')).toBe(false);
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-schemas-'));
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'config.schema.json'), '{}');
    expect(getMissingArtifactSchemas(root)).toEqual(expect.arrayContaining(['task-descriptor.schema.json']));
    expect(Object.keys(ARTIFACT_SCHEMAS)).toContain('policy/policy.lock');
  });

  it('maps canonical collection artifacts to trusted schemas and bounded paths', () => {
    expect(getSchemaForArtifact('action.json')).toBe('action.schema.json');
    expect(getSchemaForArtifact('approval.json')).toBe('approval.schema.json');
    expect(getSchemaForArtifact('trajectory-evaluation.json')).toBe('trajectory-evaluation.schema.json');
    expect(getSchemaForArtifact('policy/capabilities.json')).toBe('capability-policy.schema.json');
    expect(getArtifactDefinition('action.json').pattern?.test('task-state/task-1/actions/action-abc.json')).toBe(true);
    expect(getArtifactDefinition('approval.json').pattern?.test('task-state/task-1/approvals/approval-abc.json')).toBe(true);
    expect(getArtifactDefinition('trajectory-evaluation.json').pattern?.test('task-state/task-1/evaluations/eval-abc.json')).toBe(true);
    expect(getArtifactDefinition('action.json').pattern?.test('task-state/task-1/actions/action-abc.ndjson')).toBe(false);
  });
});
