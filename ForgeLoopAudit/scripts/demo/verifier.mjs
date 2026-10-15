import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { SCHEMA_FILES, assertSchemaValid } from './fixtures.mjs';

const REGISTERED_ARTIFACT_TYPES = Object.keys(SCHEMA_FILES);

const REQUIRED_FILES = [
  '.forgeloop/config.json',
  '.forgeloop/sources.json',
  '.forgeloop/policy/rules.json',
  '.forgeloop/policy/discovery.json',
  '.forgeloop/policy/baseline.json',
  '.forgeloop/policy/policy.lock',
  'README.md',
  'package.json',
  'src/app.ts',
  'src/catalog.ts',
  'src/cart.ts',
  'src/checkout.ts',
  'tests/catalog.test.ts',
  'tests/cart.test.ts',
  'tests/checkout.test.ts',
];

const EXPECTED_PHASES = ['COMPLETE', 'VERIFYING', 'EXECUTING', 'BLOCKED', 'PLANNED', 'ROUTED'];

const SCHEMA_BY_FILE = {
  'config.json': 'config.json',
  'sources.json': 'sources.json',
  'task.json': 'task.json',
  'contract.json': 'contract.json',
  'routing-result.json': 'routing-result.json',
  'preflight.json': 'preflight.json',
  'work-state.json': 'work-state.json',
  'continuity.json': 'continuity.json',
  'recovery.json': 'recovery.json',
  'execution-receipt.json': 'execution-receipt.json',
  'workspace-binding.json': 'workspace-binding.json',
  'responsibility.json': 'responsibility.json',
  'verification-scope.json': 'verification-scope.json',
  'session.json': 'session.json',
  'policy-snapshot.json': 'policy-snapshot.json',
  'capabilities.json': 'policy/capabilities.json',
};

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function eventHash(event) {
  const { hash: _hash, ...body } = event;
  return createHash('sha256').update(JSON.stringify(canonicalize(body))).digest('hex');
}

function isInsideRoot(root, candidate) {
  const resolved = resolve(root, candidate);
  return resolved === root || resolved.startsWith(`${root}${sep}`);
}

function listTaskDirs(forgeLoopRoot) {
  const taskStateDir = join(forgeLoopRoot, 'task-state');
  if (!existsSync(taskStateDir)) return [];
  return readdirSync(taskStateDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name);
}

export function verifyDemoProject(root) {
  const errors = [];
  const warn = (message) => errors.push(message);

  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    return { ok: false, errors: [`demo directory does not exist at ${root}`], stats: {} };
  }

  for (const required of REQUIRED_FILES) {
    if (!existsSync(join(root, required))) warn(`required file missing: ${required}`);
  }
  if (errors.length > 0) return { ok: false, errors, stats: {} };

  const forgeLoopRoot = join(root, '.forgeloop');

  // No symlink bypass anywhere under the demo project.
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) warn(`symlink bypass detected: ${relative(root, join(dir, entry.name))}`);
      else if (entry.isDirectory()) walk(join(dir, entry.name));
    }
  };
  walk(root);

  // Project detection + protocol compatibility.
  let config;
  try {
    config = JSON.parse(readFileSync(join(forgeLoopRoot, 'config.json'), 'utf8'));
  } catch (error) {
    return { ok: false, errors: [`config.json does not parse: ${error.message}`], stats: {} };
  }
  assertSchemaValid('config.json', config);
  if (config.protocolVersion !== 1) warn(`unsupported protocolVersion: ${config.protocolVersion}`);

  // Every JSON artifact parses and validates against the trusted schemas.
  const represented = new Set(['config.json', 'sources.json']);
  const sessionFiles = readdirSync(join(forgeLoopRoot, 'sessions')).filter((name) => name.endsWith('.json'));
  if (sessionFiles.length > 0) represented.add('session.json');
  for (const name of sessionFiles) {
    const value = JSON.parse(readFileSync(join(forgeLoopRoot, 'sessions', name), 'utf8'));
    assertSchemaValid('session.json', value);
  }
  for (const [name, artifact] of [['rules.json', 'policy/rules.json'], ['discovery.json', 'policy/discovery.json'], ['baseline.json', 'policy/baseline.json'], ['policy.lock', 'policy/policy.lock'], ['capabilities.json', 'policy/capabilities.json']]) {
    const value = JSON.parse(readFileSync(join(forgeLoopRoot, 'policy', name), 'utf8'));
    assertSchemaValid(artifact, value);
    represented.add(artifact);
  }

  // Task state.
  const seenTaskIds = new Map();
  const phases = new Set();
  let eventCount = 0;
  const pathReferences = [];

  for (const taskKey of listTaskDirs(forgeLoopRoot)) {
    if (!/^[a-f0-9]{64}$/.test(taskKey)) warn(`task directory is not a sha256 hex key: ${taskKey}`);
    const taskDir = join(forgeLoopRoot, 'task-state', taskKey);
    const artifacts = {};
    for (const entry of readdirSync(taskDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'gates') {
          for (const gateFile of readdirSync(join(taskDir, 'gates')).filter((name) => name.endsWith('.json'))) {
            const value = JSON.parse(readFileSync(join(taskDir, 'gates', gateFile), 'utf8'));
            assertSchemaValid('gate.json', value);
            represented.add('gate.json');
            for (const artifactRef of value.artifacts ?? []) pathReferences.push({ taskId: value.taskId, path: artifactRef.path });
          }
        }
        if (entry.name === 'executions') {
          for (const execFile of readdirSync(join(taskDir, 'executions')).filter((name) => /^exec-.*\.json$/.test(name))) {
            const value = JSON.parse(readFileSync(join(taskDir, 'executions', execFile), 'utf8'));
            assertSchemaValid('execution.json', value);
            represented.add('execution.json');
          }
        }
        if (entry.name === 'actions' || entry.name === 'approvals' || entry.name === 'evaluations') {
          const schemaName = entry.name === 'actions' ? 'action.json' : entry.name === 'approvals' ? 'approval.json' : 'trajectory-evaluation.json';
          for (const collectionFile of readdirSync(join(taskDir, entry.name)).filter((name) => name.endsWith('.json'))) {
            const value = JSON.parse(readFileSync(join(taskDir, entry.name, collectionFile), 'utf8'));
            assertSchemaValid(schemaName, value);
            represented.add(schemaName);
          }
        }
        if (entry.name === 'handoffs') {
          for (const handoffFile of readdirSync(join(taskDir, 'handoffs')).filter((name) => /^handoff-.*\.json$/.test(name))) {
            const value = JSON.parse(readFileSync(join(taskDir, 'handoffs', handoffFile), 'utf8'));
            assertSchemaValid('handoff.json', value);
            represented.add('handoff.json');
          }
        }
        if (entry.name === 'attestations') {
          for (const attestationFile of readdirSync(join(taskDir, 'attestations'))) {
            const target = join(taskDir, 'attestations', attestationFile);
            if (attestationFile === 'code-manifest.json') {
              assertSchemaValid('code-manifest.json', JSON.parse(readFileSync(target, 'utf8')));
              represented.add('code-manifest.json');
            } else if (attestationFile === 'statement.json') {
              assertSchemaValid('attestation-statement.json', JSON.parse(readFileSync(target, 'utf8')));
              represented.add('attestation-statement.json');
            } else if (attestationFile === 'statement.sigstore.json') {
              const bundle = JSON.parse(readFileSync(target, 'utf8'));
              if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) warn(`task ${taskKey}: attestation bundle must be a JSON object`);
            }
          }
        }
        continue;
      }
      if (!entry.name.endsWith('.json')) continue;
      const value = JSON.parse(readFileSync(join(taskDir, entry.name), 'utf8'));
      const schemaName = SCHEMA_BY_FILE[entry.name];
      if (schemaName) {
        assertSchemaValid(schemaName, value);
        represented.add(schemaName);
      }
      artifacts[entry.name] = value;
    }

    const descriptor = artifacts['task.json'];
    if (!descriptor) {
      warn(`task ${taskKey} has no task.json`);
      continue;
    }
    const expectedKey = createHash('sha256').update(descriptor.taskId).digest('hex');
    if (descriptor.taskKey !== expectedKey) warn(`task ${descriptor.taskId}: taskKey is not sha256(taskId)`);
    if (taskKey !== expectedKey) warn(`task directory ${taskKey} does not match sha256(taskId)`);
    if (seenTaskIds.has(descriptor.taskId)) warn(`duplicate task id: ${descriptor.taskId}`);
    seenTaskIds.set(descriptor.taskId, { taskKey, phase: artifacts['work-state.json']?.phase });

    const workState = artifacts['work-state.json'];
    if (typeof workState?.phase === 'string') phases.add(workState.phase);
    if (descriptor.taskId && workState && workState.taskId !== descriptor.taskId) warn(`task ${descriptor.taskId}: work-state taskId mismatch`);

    // Completed tasks must carry an execution receipt.
    if (workState?.phase === 'COMPLETE' && !artifacts['execution-receipt.json']) {
      warn(`task ${descriptor.taskId}: COMPLETE without execution-receipt.json`);
    }

    // Contract and continuity references resolve inside the demo project.
    for (const ref of artifacts['contract.json']?.sourceRefs ?? []) {
      pathReferences.push({ taskId: descriptor.taskId, path: ref });
    }
    for (const ref of [...(artifacts['continuity.json']?.changedAreas ?? []), ...(artifacts['continuity.json']?.inspectFirst ?? [])]) {
      pathReferences.push({ taskId: descriptor.taskId, path: ref });
    }
    for (const ref of artifacts['execution-receipt.json']?.changedPaths ?? []) {
      pathReferences.push({ taskId: descriptor.taskId, path: ref });
    }

    // Event ledger integrity (same canonical hash chain as the ForgeLoopAudit reader).
    const ledgerPath = join(taskDir, 'events.ndjson');
    if (!existsSync(ledgerPath)) {
      warn(`task ${descriptor.taskId} has no events.ndjson`);
      continue;
    }
    represented.add('event');
    const lines = readFileSync(ledgerPath, 'utf8').split('\n').filter((line) => line.trim());
    if (lines.length === 0) warn(`task ${descriptor.taskId}: empty event ledger`);
    let previous;
    lines.forEach((line, index) => {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        warn(`event ledger ${descriptor.taskId} line ${index + 1}: invalid JSON`);
        return;
      }
      try {
        assertSchemaValid('event', parsed);
      } catch (error) {
        warn(`event ledger ${descriptor.taskId} line ${index + 1}: ${error.message}`);
        return;
      }
      if (parsed.taskId !== descriptor.taskId) warn(`event ledger ${descriptor.taskId} line ${index + 1}: foreign taskId ${parsed.taskId}`);
      if (!previous && (parsed.seq !== 1 || parsed.previousHash !== null)) warn(`event ledger ${descriptor.taskId} line 1: invalid first sequence`);
      if (previous && parsed.seq !== previous.seq + 1) warn(`event ledger ${descriptor.taskId}: sequence gap at seq ${parsed.seq}`);
      if (previous && parsed.previousHash !== previous.hash) warn(`event ledger ${descriptor.taskId}: previousHash mismatch at seq ${parsed.seq}`);
      if (parsed.hash !== eventHash(parsed)) warn(`event ledger ${descriptor.taskId}: stored hash mismatch at seq ${parsed.seq}`);
      previous = parsed;
      eventCount++;
    });
  }

  if (seenTaskIds.size < 6) warn(`expected at least 6 tasks, found ${seenTaskIds.size}`);
  for (const phase of EXPECTED_PHASES) {
    if (!phases.has(phase)) warn(`expected lifecycle phase not represented: ${phase}`);
  }

  // Demo must represent every registered ForgeLoop artifact category.
  const missingArtifactTypes = REGISTERED_ARTIFACT_TYPES.filter((artifact) => !represented.has(artifact));
  for (const artifact of missingArtifactTypes) {
    warn(`demo does not represent registered artifact category: ${artifact}`);
  }

  // Policy lock digests recompute from the locked artifacts.
  const rulesText = readFileSync(join(forgeLoopRoot, 'policy', 'rules.json'), 'utf8');
  const baselineText = readFileSync(join(forgeLoopRoot, 'policy', 'baseline.json'), 'utf8');
  const lock = JSON.parse(readFileSync(join(forgeLoopRoot, 'policy', 'policy.lock'), 'utf8'));
  const digestOf = (text) => createHash(lock.algorithm || 'sha256').update(text).digest('hex');
  if (lock.rulesDigest !== digestOf(rulesText)) warn('policy.lock rulesDigest mismatch');
  if (lock.baselineDigest !== digestOf(baselineText)) warn('policy.lock baselineDigest mismatch');
  if (lock.digest !== digestOf(rulesText + baselineText)) warn('policy.lock combined digest mismatch');

  // Referenced paths exist and never escape the demo root.
  const unresolved = [];
  for (const reference of pathReferences) {
    if (!isInsideRoot(root, reference.path)) {
      unresolved.push(`${reference.taskId}: ${reference.path} escapes the demo root`);
      continue;
    }
    if (!existsSync(join(root, reference.path))) unresolved.push(`${reference.taskId}: ${reference.path} does not exist`);
  }
  for (const message of unresolved.slice(0, 10)) warn(`unresolved reference — ${message}`);

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      tasks: seenTaskIds.size,
      events: eventCount,
      phases: [...phases].sort(),
      sessions: sessionFiles.length,
      checkedReferences: pathReferences.length,
      taskIds: [...seenTaskIds.keys()].sort(),
      artifactCoverage: {
        represented: REGISTERED_ARTIFACT_TYPES.length - missingArtifactTypes.length,
        total: REGISTERED_ARTIFACT_TYPES.length,
        missing: missingArtifactTypes,
      },
    },
  };
}

/**
 * Expected canonical ownership per demo scenario. The
 * recovered scenario stays mutation-blocked until a canonical resume.
 */
const EXPECTED_OWNERSHIP = {
  'TASK-001': { phase: 'COMPLETE', claimState: 'RELEASED_BY_COMPLETION', mutationAllowed: false, ownershipValid: true, effectiveClaimsEmpty: true },
  'TASK-002': { phase: 'VERIFYING', claimState: 'ACTIVE', mutationAllowed: true, ownershipValid: true },
  'TASK-003': { phase: 'EXECUTING', claimState: 'ACTIVE', mutationAllowed: true, ownershipValid: true, effectiveClaimsPresent: true },
  'TASK-004': { phase: 'BLOCKED', claimState: 'RELEASED_BY_RECOVERY', mutationAllowed: false, ownershipValid: true, effectiveClaimsEmpty: true, resumeRequired: true },
  'TASK-005': { phase: 'PLANNED', claimState: 'ACTIVE', mutationAllowed: true, ownershipValid: true },
  'TASK-006': { phase: 'COMPLETE', claimState: 'RELEASED_BY_COMPLETION', mutationAllowed: false, ownershipValid: true, effectiveClaimsEmpty: true },
  'TASK-007': { phase: 'PLANNED', claimState: 'RELEASED_BY_RECOVERY', mutationAllowed: false, ownershipValid: true, effectiveClaimsEmpty: true, resumeRequired: true },
  'TASK-008': { phase: 'ROUTED', claimState: 'ACTIVE', mutationAllowed: true, ownershipValid: true },
};

/**
 * Assert the demo's canonical ownership semantics through the bundled
 * ForgeLoop Integration API. Raw artifacts alone are never authority; this
 * check mirrors exactly what the ForgeLoopAudit shows at runtime.
 */
export async function verifyCanonicalDemoSemantics(root) {
  const errors = [];
  const { readForgeLoopIntegrationResource } = await import('@cassiomc1/forgeloop/integration');
  const list = await readForgeLoopIntegrationResource('project/tasks', { projectPath: root });
  const canonicalById = new Map(list.data.tasks.map((task) => [task.taskId, task]));

  for (const [taskId, expected] of Object.entries(EXPECTED_OWNERSHIP)) {
    if (!canonicalById.has(taskId)) {
      errors.push(`canonical discovery missing ${taskId}`);
      continue;
    }
    let ownership;
    try {
      ownership = (await readForgeLoopIntegrationResource('task/ownership', { projectPath: root, taskId })).data;
    } catch (error) {
      errors.push(`${taskId}: task/ownership unavailable: ${error.message}`);
      continue;
    }
    if (ownership.claimState !== expected.claimState) {
      errors.push(`${taskId}: expected claimState ${expected.claimState}, got ${ownership.claimState}`);
    }
    if (Boolean(ownership.ownershipValid) !== expected.ownershipValid) {
      errors.push(`${taskId}: expected ownershipValid ${expected.ownershipValid}`);
    }
    if (Boolean(ownership.mutationAllowed) !== expected.mutationAllowed) {
      errors.push(`${taskId}: expected mutationAllowed ${expected.mutationAllowed}`);
    }
    if (expected.effectiveClaimsEmpty && ownership.effectiveWriteClaims.length > 0) {
      errors.push(`${taskId}: expected empty effective claims, got ${JSON.stringify(ownership.effectiveWriteClaims)}`);
    }
    if (expected.effectiveClaimsPresent && ownership.effectiveWriteClaims.length === 0) {
      errors.push(`${taskId}: expected non-empty effective claims`);
    }
    if (expected.resumeRequired && !(ownership.claimState === 'RELEASED_BY_RECOVERY' && ownership.mutationAllowed === false)) {
      errors.push(`${taskId}: expected recovery resume-required projection`);
    }
    if (expected.claimState !== 'RELEASED_BY_RECOVERY' && ownership.historicalWriteClaims.length > 0
      && ownership.claimState === 'ACTIVE' && ownership.effectiveWriteClaims.length === 0) {
      errors.push(`${taskId}: historical claims leaked into an active state without effective claims`);
    }
  }

  const actionData = await readForgeLoopIntegrationResource('task/actions', { projectPath: root, taskId: 'TASK-002' });
  if (!Array.isArray(actionData.data.actions) || actionData.data.actions.length < 2) {
    errors.push('TASK-002: canonical task/actions showcase is missing its action projections');
  }
  const approvalData = await readForgeLoopIntegrationResource('task/approvals', { projectPath: root, taskId: 'TASK-002' });
  if (!Array.isArray(approvalData.data.approvals) || approvalData.data.approvals.length < 1) {
    errors.push('TASK-002: canonical task/approvals showcase is missing its approval projection');
  }
  const metricsData = await readForgeLoopIntegrationResource('task/metrics', { projectPath: root, taskId: 'TASK-002' });
  if (!metricsData.data || typeof metricsData.data !== 'object' || !metricsData.data.actions) {
    errors.push('TASK-002: canonical task/metrics showcase is missing action metrics');
  }
  const evaluationsData = await readForgeLoopIntegrationResource('task/evaluations', { projectPath: root, taskId: 'TASK-002' });
  if (!Array.isArray(evaluationsData.data.evaluations) || evaluationsData.data.evaluations.length < 1) {
    errors.push('TASK-002: canonical task/evaluations showcase is missing its evaluation projection');
  }
  const capabilityPolicy = await readForgeLoopIntegrationResource('project/capability-policy', { projectPath: root });
  if (!capabilityPolicy.data || typeof capabilityPolicy.data !== 'object') {
    errors.push('project/capability-policy showcase is missing');
  }

  const workspace = await readForgeLoopIntegrationResource('task/workspace-binding', { projectPath: root, taskId: 'TASK-003' });
  if (!['MATCH', 'MISMATCH', 'UNAVAILABLE', 'INVALID'].includes(workspace.data.status)) {
    errors.push(`TASK-003: expected a persisted workspace binding projection, got ${workspace.data.status}`);
  }
  const responsibility = await readForgeLoopIntegrationResource('task/responsibility', { projectPath: root, taskId: 'TASK-003' });
  if (!['VALID', 'INVALID'].includes(responsibility.data.status)) {
    errors.push(`TASK-003: expected a responsibility projection, got ${responsibility.data.status}`);
  }
  const scope = await readForgeLoopIntegrationResource('task/verification-scope', { projectPath: root, taskId: 'TASK-002' });
  if (scope.data.scope?.resolvedMode !== 'CHANGED') {
    errors.push(`TASK-002: expected persisted CHANGED verification scope, got ${scope.data.scope?.resolvedMode}`);
  }
  const handoffs = await readForgeLoopIntegrationResource('task/handoffs', { projectPath: root, taskId: 'TASK-004' });
  if (!Array.isArray(handoffs.data.handoffs) || handoffs.data.handoffs.length !== 1) {
    errors.push('TASK-004: canonical handoff showcase is missing');
  } else {
    const [handoff] = handoffs.data.handoffs;
    if (!handoff.acceptance || !['OPEN', 'ACCEPTED', 'UNBOUND', 'INCONSISTENT'].includes(handoff.acceptance.status)) {
      errors.push('TASK-004: canonical handoff acceptance projection is missing or unknown');
    }
    if (handoff.acceptance?.status === 'ACCEPTED' && handoff.evidence?.acceptance !== undefined) {
      errors.push('TASK-004: handoff acceptance was promoted into evidence');
    }
  }
  const attestation = await readForgeLoopIntegrationResource('task/attestation', { projectPath: root, taskId: 'TASK-001' });
  if (attestation.data.status !== 'DISABLED') {
    errors.push(`TASK-001: expected disabled unsigned attestation policy showcase, got ${attestation.data.status}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    stats: { tasksChecked: canonicalById.size, featureShowcaseTask: 'TASK-002' },
  };
}
