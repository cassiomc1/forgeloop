import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { PathBoundary } from '@main/security/path-boundary';
import { SchemaValidator, resolveTrustedSchemaDirectory } from '@main/core/protocol/validator';
import { ProjectDetector, createProjectReader } from '@main/core/project/project-reader';
import { createTaskIndexer, createGateReader, createTaskSnapshotBuilder } from '@main/core/tasks/task-index';
import { createEventLedgerReader } from '@main/core/events/ledger-reader';
import { buildTaskSummary } from '@main/core/tasks/task-reader';
import type { RawTaskArtifacts } from '@main/core/tasks/task-reader';

const DEMO_ROOT = join(process.cwd(), 'demo');

describe('bundled demo project', () => {
  it('is detected as a compatible ForgeLoop project through the normal pipeline', () => {
    const boundary = new PathBoundary(DEMO_ROOT);
    const validator = new SchemaValidator(resolveTrustedSchemaDirectory({ allowEnvironmentOverride: true, cwd: process.cwd() }));
    const detection = new ProjectDetector(boundary, validator).detect();
    expect(detection.compatible).toBe(true);
    expect(detection.protocolVersion).toBe(1);
    expect(detection.warnings).toEqual([]);
  });

  it('loads all eight tasks through the real readers with valid lifecycle phases', () => {
    const boundary = new PathBoundary(DEMO_ROOT);
    const schemaDir = resolveTrustedSchemaDirectory({ allowEnvironmentOverride: true, cwd: process.cwd() });
    const validator = new SchemaValidator(schemaDir);
    const reader = createProjectReader(boundary, validator);

    const config = reader.readConfig();
    expect(config.complianceMode).toBe('standard');

    const indexer = createTaskIndexer(boundary, reader);
    const tasks = indexer.listTasks();
    expect(tasks).toHaveLength(8);

    const summaries = tasks.map((task) => {
      const artifacts = reader.readTaskSummaryArtifacts(task.taskKey) as unknown as RawTaskArtifacts;
      expect(artifacts.artifactErrors).toBeUndefined();
      return buildTaskSummary(task.taskKey, artifacts);
    });

    const phases = summaries.map((summary) => summary.phase).sort();
    expect(phases).toEqual(['BLOCKED', 'COMPLETE', 'COMPLETE', 'EXECUTING', 'PLANNED', 'PLANNED', 'ROUTED', 'VERIFYING']);

    const taskIds = summaries.map((summary) => summary.taskId).sort();
    expect(taskIds).toEqual(['TASK-001', 'TASK-002', 'TASK-003', 'TASK-004', 'TASK-005', 'TASK-006', 'TASK-007', 'TASK-008']);
  });

  it('keeps an abandoned task distinguishable from completion', () => {
    const boundary = new PathBoundary(DEMO_ROOT);
    const validator = new SchemaValidator(resolveTrustedSchemaDirectory({ allowEnvironmentOverride: true, cwd: process.cwd() }));
    const reader = createProjectReader(boundary, validator);
    const indexer = createTaskIndexer(boundary, reader);
    const snapshotBuilder = createTaskSnapshotBuilder(
      boundary,
      createEventLedgerReader(boundary, validator),
      createGateReader(boundary, validator),
    );

    const abandoned = indexer.listTasks().find((task) => task.taskId === 'TASK-007');
    expect(abandoned).toBeDefined();
    if (!abandoned) return;

    const artifacts = reader.readTaskSummaryArtifacts(abandoned.taskKey) as unknown as RawTaskArtifacts;
    const { summary, events } = snapshotBuilder.buildSnapshot(abandoned.taskKey, artifacts);

    // Abandonment keeps the last canonical phase and is never completion.
    expect(summary.phase).toBe('PLANNED');
    expect(summary.publicationStatus).not.toBe('pushed');
    const recovery = artifacts['recovery.json'] as Record<string, unknown>;
    expect(recovery.classificationAtRecovery).toBe('ABANDONED');
    expect(recovery.status).toBe('RECOVERED');
    expect(recovery.authority).toEqual({ kind: 'CALLER_ACKNOWLEDGED' });
    expect(events.some((event) => event.event === 'TASK_COMPLETED')).toBe(false);
    expect(events.some((event) => event.event === 'COMPLETION_VALIDATED')).toBe(false);

    const abandonment = events.find((event) => event.event === 'TASK_ABANDONED');
    expect(abandonment).toBeDefined();
    expect(abandonment?.details?.classification).toBe('ABANDONED');
    expect(abandonment?.details?.reasonCodes).toEqual(['CALLER_ABANDONED']);
    expect(abandonment?.details?.authorityKind).toBe('CALLER_ACKNOWLEDGED');
  });

  it('surfaces contract revision and checkpoint revalidation as provenance boundaries', () => {
    const boundary = new PathBoundary(DEMO_ROOT);
    const validator = new SchemaValidator(resolveTrustedSchemaDirectory({ allowEnvironmentOverride: true, cwd: process.cwd() }));
    const reader = createProjectReader(boundary, validator);
    const indexer = createTaskIndexer(boundary, reader);
    const eventReader = createEventLedgerReader(boundary, validator);

    const revised = indexer.listTasks().find((task) => task.taskId === 'TASK-008');
    expect(revised).toBeDefined();
    if (!revised) return;

    const events = eventReader.readEvents(revised.taskKey);
    const revision = events.find((event) => event.event === 'CONTRACT_REVISED');
    expect(revision?.details?.previousPhase).toBe('PLANNED');
    expect(revision?.details?.phase).toBe('ROUTED');
    expect(revision?.details?.contractFingerprint).not.toBe(revision?.details?.previousContractFingerprint);

    const revalidation = events.find((event) => event.event === 'CHECKPOINT_REVALIDATED');
    expect(revalidation).toBeDefined();
    expect(revalidation?.details?.phase).toBe('ROUTED');
    expect(revalidation?.details?.revalidatedStateRevision).toBe((revalidation?.details?.previousStateRevision as number) + 1);

    // Revalidation and revision are not execution and not completion.
    expect(events.some((event) => event.event === 'EXECUTION_STARTED')).toBe(false);
    expect(events.some((event) => event.event === 'TASK_COMPLETED')).toBe(false);
  });

  it('exposes the blocked TASK-004 recovery and cross-harness continuity state', () => {
    const boundary = new PathBoundary(DEMO_ROOT);
    const validator = new SchemaValidator(resolveTrustedSchemaDirectory({ allowEnvironmentOverride: true, cwd: process.cwd() }));
    const reader = createProjectReader(boundary, validator);
    const indexer = createTaskIndexer(boundary, reader);
    const snapshotBuilder = createTaskSnapshotBuilder(
      boundary,
      createEventLedgerReader(boundary, validator),
      createGateReader(boundary, validator),
    );

    const blocked = indexer.listTasks().find((task) => task.taskId === 'TASK-004');
    expect(blocked).toBeDefined();
    if (!blocked) return;

    const artifacts = reader.readTaskSummaryArtifacts(blocked.taskKey) as unknown as RawTaskArtifacts;
    const { summary, events } = snapshotBuilder.buildSnapshot(blocked.taskKey, artifacts);

    expect(summary.phase).toBe('BLOCKED');
    expect(summary.blockers.length).toBeGreaterThan(0);
    expect(summary.failures.some((failure) => failure.id.includes('keyboard'))).toBe(true);

    const gateNames = summary.gates.map((gate) => gate.id);
    expect(gateNames).toContain('accessibility-audit');
    const auditGate = summary.gates.find((gate) => gate.id === 'accessibility-audit');
    expect(auditGate?.status).toBe('blocked');

    const ledgerEvents = events.map((event) => event.event);
    expect(ledgerEvents).toContain('TASK_BLOCKED');
    expect(ledgerEvents).toContain('RECOVERY_ROUTE_SELECTED');
    expect(ledgerEvents).toContain('HANDOFF_CREATED');

    const continuity = reader.readTaskSummaryArtifacts(blocked.taskKey)['continuity.json'] as Record<string, unknown>;
    expect(String(continuity.resumeNote)).toContain('harness-b');
  });

  it('validates every demo event ledger through the integrity chain check', () => {
    const boundary = new PathBoundary(DEMO_ROOT);
    const validator = new SchemaValidator(resolveTrustedSchemaDirectory({ allowEnvironmentOverride: true, cwd: process.cwd() }));
    const reader = createProjectReader(boundary, validator);
    const eventReader = createEventLedgerReader(boundary, validator);

    for (const task of createTaskIndexer(boundary, reader).listTasks()) {
      const integrity = eventReader.validateIntegrity(task.taskKey);
      expect(integrity.schema, task.taskId).toBe('VALID');
      expect(integrity.chain, task.taskId).toBe('VALID');
    }
  });

  it('aggregates policy and sessions without invalid artifacts', () => {
    const boundary = new PathBoundary(DEMO_ROOT);
    const validator = new SchemaValidator(resolveTrustedSchemaDirectory({ allowEnvironmentOverride: true, cwd: process.cwd() }));
    const reader = createProjectReader(boundary, validator);

    const policy = reader.readGlobalPolicy();
    expect(policy['rules.json']).toBeTruthy();
    expect(policy['policy.lock']).toBeTruthy();

    const sessions = reader.listSessions();
    expect(sessions.sort()).toEqual(['session-harness-a', 'session-harness-b']);
    for (const session of sessions) {
      expect(reader.readSession(session)).toMatchObject({ protocolVersion: 1 });
    }

    for (const task of createTaskIndexer(boundary, reader).listTasks()) {
      expect(reader.getArtifactErrors(task.taskKey), task.taskId).toEqual([]);
    }
  });
});
