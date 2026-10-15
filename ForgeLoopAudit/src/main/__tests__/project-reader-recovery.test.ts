import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PathBoundary } from '@main/security/path-boundary';
import { SchemaValidator } from '@main/core/protocol/validator';
import { createProjectReader } from '@main/core/project/project-reader';
import { RESOURCE_LIMITS } from '@main/security/resource-limits';

const CONFIG = {
  schemaVersion: 1,
  protocolVersion: 1,
  complianceMode: 'standard',
  projectName: 'Recovery Fixture',
};

const KEY = 'a'.repeat(64);

const TASK_JSON = {
  schemaVersion: 1,
  protocolVersion: 1,
  taskId: 'TASK-001',
  taskKey: KEY,
  createdAt: '2026-08-20T09:00:00.000Z',
  updatedAt: '2026-08-20T10:00:00.000Z',
  writeClaims: [],
};

const RECOVERY = {
  schemaVersion: 1,
  protocolVersion: 1,
  taskId: 'TASK-001',
  status: 'RECOVERED',
  recoveredAt: '2026-08-20T10:00:00.000Z',
  recoveryId: 'recovery-abc123',
  recoveryEventSeq: 7,
  classificationAtRecovery: 'STALE',
  reasonCodes: ['E_TASK_CLAIM_STALE'],
  releasedClaims: ['src/a/**'],
  previousPhase: 'EXECUTING',
  previousRevision: 3,
  repositoryFingerprint: { branch: 'main', head: null },
  authority: { kind: 'HOST_ATTESTED' },
};

const ACTION = {
  schemaVersion: 1,
  taskId: 'TASK-001',
  actionId: 'action-read',
  actionFingerprint: 'a'.repeat(64),
  effectClass: 'READ_ONLY',
  capability: 'filesystem.read',
  operation: 'Inspect a file',
  target: 'src/a.ts',
  idempotencyKey: null,
  requiredForCompletion: false,
  requirement: null,
  provenance: 'CALLER_REPORTED',
  state: 'PROPOSED',
  revision: 0,
  createdAt: '2026-08-20T10:00:00.000Z',
  updatedAt: '2026-08-20T10:00:00.000Z',
};

const WORKSPACE_BINDING = {
  schemaVersion: 1,
  protocolVersion: 1,
  taskId: 'TASK-001',
  mode: 'GIT_WORKTREE',
  repositoryIdentity: 'b'.repeat(64),
  workspaceIdentity: 'c'.repeat(64),
  branchAtBind: 'main',
  headAtBind: 'd'.repeat(40),
  boundAt: '2026-08-20T10:00:00.000Z',
};

const RESPONSIBILITY = {
  schemaVersion: 1,
  protocolVersion: 1,
  taskId: 'TASK-001',
  label: 'recovery fixture',
  createdAt: '2026-08-20T10:00:00.000Z',
  allowedPaths: ['src/**'],
  readOnlyPaths: ['tests/**'],
  requiredCheckIds: [],
  frozenInputs: { contract: true, route: false, claims: true },
  baseline: {
    contractFingerprint: 'e'.repeat(64),
    routeFingerprint: null,
    claimsFingerprint: 'f'.repeat(64),
  },
};

const VERIFICATION_SCOPE = {
  schemaVersion: 1,
  protocolVersion: 1,
  taskId: 'TASK-001',
  requestedMode: 'FULL',
  resolvedMode: 'FULL',
  verificationCycle: 1,
  changedPaths: ['src/a.ts'],
  claimedPaths: ['src/a.ts'],
  selectedPaths: ['src/a.ts'],
  reasons: ['Full fixture verification'],
  fallback: null,
  contractFingerprint: '1'.repeat(64),
  repositoryFingerprint: { branch: 'main', head: 'd'.repeat(40) },
  claimsFingerprint: '2'.repeat(64),
  createdAt: '2026-08-20T10:00:00.000Z',
};

const HANDOFF = {
  schemaVersion: 1,
  protocolVersion: 1,
  handoffId: 'handoff-recovery',
  taskId: 'TASK-001',
  createdAt: '2026-08-20T10:00:00.000Z',
  intent: { recipientHint: 'next-harness', note: 'Continue the read-only fixture.' },
  state: {
    phase: 'EXECUTING',
    revision: 1,
    verificationCycle: 1,
    contractFingerprint: '3'.repeat(64),
    routeFingerprint: null,
    repositoryFingerprint: { branch: 'main', head: 'd'.repeat(40) },
    writeClaims: [],
    changedPaths: ['src/a.ts'],
  },
  evidence: { executionRefs: [], checkIds: [] },
  continuity: { ref: 'continuity.json', fingerprint: null },
  artifactDigest: '4'.repeat(64),
};

const CODE_MANIFEST = {
  schemaVersion: 1,
  protocolVersion: 1,
  taskId: 'TASK-001',
  verificationCycle: 1,
  capture: {
    mode: 'WORKTREE',
    revisionProvider: 'git',
    baseRevision: null,
    observedRevision: 'd'.repeat(40),
    providerMetadata: {},
  },
  bindings: {
    contractFingerprint: '5'.repeat(64),
    routeFingerprint: null,
    stateFingerprint: '6'.repeat(64),
    receiptFingerprint: '7'.repeat(64),
    ledgerSeq: 1,
    ledgerHash: '8'.repeat(64),
  },
  entries: [],
  contentDigest: '9'.repeat(64),
};

const ATTESTATION_STATEMENT = {
  schemaVersion: 1,
  _type: 'https://in-toto.io/Statement/v1',
  subject: [{ name: 'fixture', digest: { sha256: 'a'.repeat(64) } }],
  predicateType: 'https://forgeloop.dev/attestation/v1',
  predicate: {},
};

describe('project-reader recovery artifact', () => {
  let root: string;
  let reader: ReturnType<typeof createProjectReader>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'forgeloop-recovery-'));
    const taskDir = join(root, '.forgeloop', 'task-state', KEY);
    mkdirSync(join(taskDir, 'actions'), { recursive: true });
    mkdirSync(join(taskDir, 'approvals'), { recursive: true });
    mkdirSync(join(taskDir, 'evaluations'), { recursive: true });
    mkdirSync(join(root, '.forgeloop', 'policy'), { recursive: true });
    writeFileSync(join(root, '.forgeloop', 'config.json'), JSON.stringify(CONFIG));
    writeFileSync(join(taskDir, 'task.json'), JSON.stringify(TASK_JSON));
    reader = createProjectReader(new PathBoundary(root), new SchemaValidator('schemas'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads a valid recovery.json as a raw task artifact', () => {
    writeFileSync(join(root, '.forgeloop', 'task-state', KEY, 'recovery.json'), JSON.stringify(RECOVERY));
    const artifacts = reader.readTaskSummaryArtifacts(KEY);
    expect(artifacts['recovery.json']).toBeDefined();
    expect((artifacts['recovery.json'] as Record<string, unknown>).recoveryId).toBe('recovery-abc123');
    expect(artifacts.artifactErrors as string[] | undefined).toBeUndefined();
  });

  it('surfaces schema-invalid recovery instead of silently accepting it', () => {
    writeFileSync(
      join(root, '.forgeloop', 'task-state', KEY, 'recovery.json'),
      JSON.stringify({ ...RECOVERY, status: 'NOT_RECOVERED_AT_ALL' }),
    );
    const artifacts = reader.readTaskSummaryArtifacts(KEY);
    expect(artifacts['recovery.json']).toBeUndefined();
    expect(((artifacts.artifactErrors as string[] | undefined) || []).some((entry) => entry.startsWith('recovery.json:'))).toBe(true);
  });

  it('rejects symbolic link recovery artifacts', () => {
    symlinkSync('/etc/hostname', join(root, '.forgeloop', 'task-state', KEY, 'recovery.json'));
    const artifacts = reader.readTaskSummaryArtifacts(KEY);
    expect(artifacts['recovery.json']).toBeUndefined();
    expect(((artifacts.artifactErrors as string[] | undefined) || []).join('\n')).toMatch(/symbolic links/);
  });

  it('reads schema-validated action, approval, evaluation and capability-policy artifacts', () => {
    writeFileSync(join(root, '.forgeloop', 'task-state', KEY, 'actions', 'action-read.json'), JSON.stringify(ACTION));
    writeFileSync(join(root, '.forgeloop', 'task-state', KEY, 'approvals', 'approval-read.json'), JSON.stringify({
      schemaVersion: 1,
      taskId: 'TASK-001',
      approvalId: 'approval-read',
      actionId: 'action-read',
      actionFingerprint: 'a'.repeat(64),
      contractFingerprint: 'b'.repeat(64),
      taskRevision: 0,
      capability: 'filesystem.read',
      status: 'PENDING',
      requestedAt: '2026-08-20T10:00:00.000Z',
    }));
    writeFileSync(join(root, '.forgeloop', 'task-state', KEY, 'evaluations', 'eval-read.json'), JSON.stringify({
      schemaVersion: 1,
      evaluationId: 'eval-read',
      scenarioId: 'fixture',
      taskId: 'TASK-001',
      result: 'PASS',
      completionValid: true,
      safetyValid: true,
      evaluationFingerprint: 'c'.repeat(64),
    }));
    writeFileSync(join(root, '.forgeloop', 'policy', 'capabilities.json'), JSON.stringify({
      schemaVersion: 1,
      defaultDecision: 'DENY',
      rules: [{ capability: 'filesystem.read', decision: 'ALLOW' }],
    }));

    expect(JSON.parse(reader.readRawCollectionArtifact(KEY, { kind: 'action', taskId: 'TASK-001', actionId: 'action-read' })).actionId).toBe('action-read');
    expect(JSON.parse(reader.readRawCollectionArtifact(KEY, { kind: 'approval', taskId: 'TASK-001', approvalId: 'approval-read' })).approvalId).toBe('approval-read');
    expect(JSON.parse(reader.readRawCollectionArtifact(KEY, { kind: 'evaluation', taskId: 'TASK-001', evaluationId: 'eval-read' })).evaluationId).toBe('eval-read');
    expect(JSON.parse(reader.readRawCapabilityPolicy()).defaultDecision).toBe('DENY');
  });

  it('reads the 1.6.4 task boundary artifacts and fixed attestation collections', () => {
    const taskDir = join(root, '.forgeloop', 'task-state', KEY);
    writeFileSync(join(taskDir, 'workspace-binding.json'), JSON.stringify(WORKSPACE_BINDING));
    writeFileSync(join(taskDir, 'responsibility.json'), JSON.stringify(RESPONSIBILITY));
    writeFileSync(join(taskDir, 'verification-scope.json'), JSON.stringify(VERIFICATION_SCOPE));
    mkdirSync(join(taskDir, 'handoffs'), { recursive: true });
    mkdirSync(join(taskDir, 'attestations'), { recursive: true });
    writeFileSync(join(taskDir, 'handoffs', 'handoff-recovery.json'), JSON.stringify(HANDOFF));
    writeFileSync(join(taskDir, 'attestations', 'code-manifest.json'), JSON.stringify(CODE_MANIFEST));
    writeFileSync(join(taskDir, 'attestations', 'statement.json'), JSON.stringify(ATTESTATION_STATEMENT));
    writeFileSync(join(taskDir, 'attestations', 'statement.sigstore.json'), JSON.stringify({ external: true }));

    const artifacts = reader.readTaskSummaryArtifacts(KEY);
    expect(artifacts['workspace-binding.json']).toMatchObject({ taskId: 'TASK-001', mode: 'GIT_WORKTREE' });
    expect(artifacts['responsibility.json']).toMatchObject({ taskId: 'TASK-001', label: 'recovery fixture' });
    expect(artifacts['verification-scope.json']).toMatchObject({ taskId: 'TASK-001', resolvedMode: 'FULL' });
    expect(JSON.parse(reader.readRawCollectionArtifact(KEY, { kind: 'handoff', taskId: 'TASK-001', handoffId: 'handoff-recovery' })).handoffId).toBe('handoff-recovery');
    expect(JSON.parse(reader.readRawCollectionArtifact(KEY, { kind: 'code-manifest', taskId: 'TASK-001' })).taskId).toBe('TASK-001');
    expect(JSON.parse(reader.readRawCollectionArtifact(KEY, { kind: 'attestation-statement', taskId: 'TASK-001' }))._type).toBe('https://in-toto.io/Statement/v1');
    expect(JSON.parse(reader.readRawCollectionArtifact(KEY, { kind: 'attestation-bundle', taskId: 'TASK-001' })).external).toBe(true);
  });

  it('rejects oversized signature bundles and handoffs before JSON parsing', () => {
    const taskDir = join(root, '.forgeloop', 'task-state', KEY);
    mkdirSync(join(taskDir, 'handoffs'), { recursive: true });
    mkdirSync(join(taskDir, 'attestations'), { recursive: true });
    const oversized = `${' '.repeat(RESOURCE_LIMITS.JSON_MAX_SIZE_BYTES)}{}`;
    writeFileSync(join(taskDir, 'attestations', 'statement.sigstore.json'), oversized);
    writeFileSync(join(taskDir, 'handoffs', 'handoff-recovery.json'), oversized);

    let bundleError: unknown;
    try {
      reader.readRawCollectionArtifact(KEY, { kind: 'attestation-bundle', taskId: 'TASK-001' });
    } catch (error) {
      bundleError = error;
    }
    let handoffError: unknown;
    try {
      reader.readRawCollectionArtifact(KEY, { kind: 'handoff', taskId: 'TASK-001', handoffId: 'handoff-recovery' });
    } catch (error) {
      handoffError = error;
    }
    expect(bundleError).toMatchObject({ details: expect.stringContaining('JSON artifact exceeds maximum size') });
    expect(handoffError).toMatchObject({ details: expect.stringContaining('JSON artifact exceeds maximum size') });
  });

  it('rejects collection path traversal and symbolic links', () => {
    expect(() => reader.readRawCollectionArtifact(KEY, { kind: 'action', taskId: 'TASK-001', actionId: '../action-read' })).toThrow(/Path traversal|invalid action artifact identifier/);
    expect(() => reader.readRawCollectionArtifact(KEY, { kind: 'handoff', taskId: 'TASK-001', handoffId: 'handoff-../escape' })).toThrow(/Path traversal|invalid handoff artifact identifier/);
    symlinkSync('/etc/hostname', join(root, '.forgeloop', 'task-state', KEY, 'actions', 'action-link.json'));
    let error: unknown;
    try {
      reader.readRawCollectionArtifact(KEY, { kind: 'action', taskId: 'TASK-001', actionId: 'action-link' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ details: expect.stringMatching(/Symbolic links/) });
  });
});
