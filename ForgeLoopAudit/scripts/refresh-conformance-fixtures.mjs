import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const outputRoot = resolve(process.argv[2] || 'tests/fixtures');
const timestamp = '2026-01-01T00:00:00.000Z';
const fingerprint = 'a'.repeat(64);
const branch = 'main';
const head = 'b'.repeat(40);

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function taskKeyFor(taskId) {
  return createHash('sha256').update(taskId).digest('hex');
}

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

class Ledger {
  constructor(taskId) {
    this.taskId = taskId;
    this.events = [];
  }

  append(event, details = {}) {
    const previous = this.events[this.events.length - 1];
    const record = {
      seq: this.events.length + 1,
      schemaVersion: 1,
      protocolVersion: 1,
      taskId: this.taskId,
      event,
      at: new Date(Date.parse(timestamp) + this.events.length * 60_000).toISOString(),
      previousHash: previous ? previous.hash : null,
      details,
    };
    record.hash = eventHash(record);
    this.events.push(record);
    return record;
  }

  serialize() {
    return `${this.events.map((event) => JSON.stringify(event)).join('\n')}\n`;
  }
}

function demoCheck({ id, requirement, status = 'passed', evidenceKind = 'OBSERVED', source = 'fixture' }) {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    id,
    kind: 'command',
    requirement,
    status,
    evidenceKind,
    source,
    ...(evidenceKind === 'OBSERVED' ? { provenance: 'FORGELOOP_EXECUTED', exitCode: 0 } : {}),
  };
}

function cov(requirement, mode = 'not-verified') {
  const requiredEvidence = [requirement];
  const observedEvidence = mode === 'observed' ? [requirement] : [];
  const status = mode === 'observed' ? 'COVERED' : mode === 'blocked' ? 'BLOCKED' : 'NOT_VERIFIED';
  return { schemaVersion: 1, protocolVersion: 1, requirement, requiredEvidence, observedEvidence, status };
}

/**
 * ForgeLoop 1.5 conformance fixture set.
 *
 * Every protocol-valid fixture is schema-valid AND carries the artifacts
 * needed for canonical claim resolution (descriptor, work state, ledger).
 * Scenarios separate schema validity from operational consistency:
 * ownership-inconsistent and corrupt-recovery are schema-valid JSON whose
 * canonical semantics must fail closed.
 */
const SCENARIOS = [
  {
    name: 'received',
    phase: 'RECEIVED',
    ledger: ['TASK_CREATED'],
  },
  {
    name: 'executing',
    phase: 'EXECUTING',
    executionChain: true,
  },
  {
    name: 'verifying',
    phase: 'VERIFYING',
    previousPhase: 'EXECUTING',
    executionChain: true,
    verifyingChain: true,
  },
  {
    name: 'diagnosing',
    phase: 'DIAGNOSING',
    previousPhase: 'VERIFYING',
    executionChain: true,
    verifyingChain: true,
  },
  {
    name: 'blocked',
    phase: 'BLOCKED',
    previousPhase: 'EXECUTING',
    blockers: [{ id: 'fixture-blocker', reason: 'FIXTURE_BLOCKED', detail: 'Intentional blocked scenario.' }],
    executionChain: true,
    blockedChain: true,
  },
  {
    name: 'planned',
    phase: 'PLANNED',
    ledger: ['TASK_CREATED', 'PLANNING_STARTED'],
  },
  {
    name: 'active-claims',
    phase: 'EXECUTING',
    writeClaims: ['src/feature.ts'],
    ledger: ['TASK_CREATED', 'CONTRACT_VALIDATED', 'ROUTE_VALIDATED', 'GATE_SATISFIED', 'PREFLIGHT_READY', 'EXECUTION_STARTED'],
    gateDetails: true,
    expectedClaimState: 'ACTIVE',
    expectedEffectiveClaims: ['src/feature.ts'],
  },
  {
    name: 'complete-released',
    phase: 'COMPLETE',
    writeClaims: [],
    checks: [
      demoCheck({ id: 'unit-tests', requirement: 'Fixture unit tests pass' }),
    ],
    verificationEvidence: [{ id: 'verif-fixture-cycle-1', summary: 'Fixture criteria observed.', status: 'OBSERVED', timestamp }],
    coverage: [cov('Fixture success criterion', 'observed')],
    complete: true,
    executionChain: true,
    verifyingChain: true,
    expectedClaimState: 'RELEASED_BY_COMPLETION',
    expectedMutationAllowed: false,
  },
  {
    name: 'recovered-resume-required',
    phase: 'BLOCKED',
    writeClaims: ['src/feature.ts'],
    blockers: [{ id: 'fixture-blocker', reason: 'FIXTURE_STALE_LOCK', detail: 'Recovered from a stale lock.' }],
    recovery: {
      recoveryId: 'recovery-fixture-stale-lock',
      classification: 'STALE',
      reasonCodes: ['E_TASK_CLAIM_STALE'],
    },
    blockedLedgerOnly: true,
    expectedClaimState: 'RELEASED_BY_RECOVERY',
    expectedMutationAllowed: false,
    resumeRequired: true,
  },
  {
    name: 'ownership-inconsistent',
    phase: 'COMPLETE',
    // COMPLETE lifecycle without canonical completion proof in the ledger:
    // schema-valid, but canonical ownership must fail closed to INCONSISTENT.
    checks: [
      demoCheck({ id: 'unit-tests', requirement: 'Fixture unit tests pass' }),
    ],
    verificationEvidence: [{ id: 'verif-fixture-cycle-1', summary: 'Fixture criteria observed.', status: 'OBSERVED', timestamp }],
    coverage: [cov('Fixture success criterion', 'observed')],
    incompleteLedger: true,
    expectedClaimState: 'INCONSISTENT',
    expectedOwnershipValid: false,
  },
  {
    name: 'corrupt-recovery',
    phase: 'BLOCKED',
    writeClaims: ['src/feature.ts'],
    blockers: [{ id: 'fixture-blocker', reason: 'FIXTURE_STALE_LOCK', detail: 'Recovered from a stale lock.' }],
    corruptRecovery: true,
    blockedLedgerOnly: true,
    expectArtifactErrors: true,
    expectedClaimState: 'INCONSISTENT',
  },
];

function buildScenario(scenario) {
  const taskId = `conformance-${scenario.name}`;
  const taskKey = taskKeyFor(taskId);
  // task-key-mismatch keeps valid content but a directory that is not sha256(taskId).
  const dirKey = scenario.name === 'task-key-mismatch' ? 'e'.repeat(64) : taskKey;
  const root = join(outputRoot, 'protocol-valid', scenario.name);
  rmSync(root, { recursive: true, force: true });
  const taskRoot = join(root, '.forgeloop', 'task-state', dirKey);
  mkdirSync(join(taskRoot, 'executions'), { recursive: true });

  writeJson(join(root, 'fixture.json'), {
    forgeloopVersion: '1.5.0',
    protocolVersion: 1,
    schemaVersion: 1,
    expectedAuditHealth: 'VALID',
    expectedPhase: scenario.phase,
    expectedClaimState: scenario.expectedClaimState ?? null,
    expectedArtifactErrors: Boolean(scenario.expectArtifactErrors),
    taskKeyMatchesDirectory: scenario.name !== 'task-key-mismatch',
    legacy: false,
  });

  writeJson(join(root, '.forgeloop', 'config.json'), { schemaVersion: 1, protocolVersion: 1, complianceMode: 'standard' });
  writeJson(join(root, '.forgeloop', 'sources.json'), { schemaVersion: 1, protocolVersion: 1, sources: {} });

  const descriptor = {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    taskKey,
    createdAt: timestamp,
    updatedAt: timestamp,
    writeClaims: scenario.writeClaims ?? [],
  };
  writeJson(join(taskRoot, 'task.json'), descriptor);

  const workState = {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    contractFingerprint: fingerprint,
    repositoryFingerprint: { branch, head },
    phase: scenario.phase,
    selectedGuides: [],
    requiredGates: [],
    satisfiedGates: [],
    complianceMode: 'standard',
    completedSteps: [],
    pendingSteps: [],
    checks: scenario.checks ?? [],
    failures: [],
    blockers: scenario.blockers ?? [],
    verificationEvidence: scenario.verificationEvidence ?? [],
    evidenceCoverage: scenario.coverage ?? [],
    lastUpdated: timestamp,
  };
  if (scenario.previousPhase) workState.previousPhase = scenario.previousPhase;
  writeJson(join(taskRoot, 'work-state.json'), workState);

  const gateDetails = (event) =>
    event === 'GATE_SATISFIED' ? { gate: 'unit-tests' }
      : event === 'PREFLIGHT_READY' ? { requiredGates: ['unit-tests'] }
        : {};
  const buildExecutionChain = (ledger) => {
    ledger.append('TASK_CREATED');
    ledger.append('CONTRACT_VALIDATED');
    ledger.append('ROUTE_VALIDATED');
    for (const event of ['GATE_SATISFIED', 'PREFLIGHT_READY', 'EXECUTION_STARTED']) {
      ledger.append(event, gateDetails(event));
    }
  };

  const ledger = new Ledger(taskId);
  if (scenario.blockedLedgerOnly) {
    ledger.append('TASK_CREATED');
  } else if (scenario.executionChain) {
    buildExecutionChain(ledger);
    if (scenario.verifyingChain) ledger.append('VERIFICATION_STARTED');
    if (scenario.blockedChain) ledger.append('TASK_BLOCKED', { reason: 'FIXTURE_BLOCKED' });
  } else {
    for (const event of scenario.ledger ?? []) {
      ledger.append(event, gateDetails(event));
    }
  }

  let recoveryEvent = null;
  let recovery = null;
  if (scenario.recovery || scenario.corruptRecovery) {
    recoveryEvent = ledger.append('TASK_RECOVERY_RECORDED', {
      recoveryId: scenario.recovery?.recoveryId ?? 'recovery-corrupt-fixture',
      classification: scenario.recovery?.classification ?? 'STALE',
      previousPhase: scenario.phase,
      previousRevision: 2,
      authorityKind: 'HOST_ATTESTED',
      reasonCodes: scenario.recovery?.reasonCodes ?? ['E_TASK_CLAIM_STALE'],
      releasedClaims: scenario.writeClaims ?? [],
      currentBranch: branch,
      currentHead: head,
    });
    recovery = {
      schemaVersion: 1,
      protocolVersion: 1,
      taskId,
      status: 'RECOVERED',
      recoveredAt: recoveryEvent.at,
      recoveryId: recoveryEvent.details.recoveryId,
      recoveryEventSeq: recoveryEvent.seq,
      classificationAtRecovery: recoveryEvent.details.classification,
      reasonCodes: recoveryEvent.details.reasonCodes,
      releasedClaims: recoveryEvent.details.releasedClaims,
      previousPhase: recoveryEvent.details.previousPhase,
      previousRevision: recoveryEvent.details.previousRevision,
      repositoryFingerprint: { branch, head },
      authority: { kind: 'HOST_ATTESTED', grantRef: 'host-attestation:fixture-lock-controller' },
    };
    if (scenario.corruptRecovery) recovery.status = 'NOT_RECOVERED';
  }
  if (recovery) writeJson(join(taskRoot, 'recovery.json'), recovery);

  if (scenario.complete && !scenario.incompleteLedger) {
    ledger.append('VERIFICATION_RECORDED', { verificationCycle: 1, outcome: 'passed' });
    ledger.append('COMPLETION_VALIDATED', { receipt: 'execution-receipt.json' });
  } else if (scenario.complete && scenario.incompleteLedger) {
    // Deliberately no VERIFICATION_RECORDED/COMPLETION_VALIDATED.
  }

  writeFileSync(join(taskRoot, 'events.ndjson'), ledger.serialize());
}

function buildInvalidFixtures() {
  const invalidNames = [
    { name: 'unknown-protocol', config: { schemaVersion: 1, protocolVersion: 2, complianceMode: 'advisory' }, metadataProtocol: 2 },
    { name: 'schema-mismatch', config: { schemaVersion: 2, protocolVersion: 1, complianceMode: 'advisory' }, metadataProtocol: 1 },
    { name: 'malformed-config', malformed: true, metadataProtocol: 1 },
  ];
  for (const scenario of invalidNames) {
    const root = join(outputRoot, 'protocol-invalid', scenario.name);
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, '.forgeloop'), { recursive: true });
    writeJson(join(root, 'fixture.json'), { forgeloopVersion: '1.5.0', protocolVersion: scenario.metadataProtocol, legacy: false });
    if (scenario.malformed) {
      writeFileSync(join(root, '.forgeloop', 'config.json'), '{"schemaVersion":');
      continue;
    }
    writeJson(join(root, '.forgeloop', 'config.json'), scenario.config);
  }
  return invalidNames.length;
}

for (const scenario of [...SCENARIOS, {
  name: 'task-key-mismatch',
  phase: 'EXECUTING',
  executionChain: true,
  // A directory key that does not match sha256(taskId) must fail closed:
  // canonical ownership resolves to INCONSISTENT (E_TASK_KEY_MISMATCH).
  expectedClaimState: 'INCONSISTENT',
}]) {
  buildScenario(scenario);
}
const invalidCount = buildInvalidFixtures();
console.log(`Generated ${SCENARIOS.length + 1} valid and ${invalidCount} invalid ForgeLoop 1.5 fixtures`);
