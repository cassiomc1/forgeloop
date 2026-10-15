import { DEMO_PROJECT_ID, assertSchemaValid, canonicalFingerprint, fingerprint, serializeJson, sha256FileBytes, taskKeyFor } from './fixtures.mjs';
import { EventLedgerBuilder } from './event-builder.mjs';

const BRANCH = 'main';
const HEAD = '3f9c1d2e77a4b5089c6e12ab34f5d6e7890abcde';

function repositoryFingerprint() {
  return { branch: BRANCH, head: HEAD };
}

function baseArtifact(taskId) {
  return { schemaVersion: 1, protocolVersion: 1, taskId };
}

function taskDescriptor(taskId, createdAt, updatedAt, writeClaims = []) {
  return { ...baseArtifact(taskId), taskKey: taskKeyFor(taskId), createdAt, updatedAt, writeClaims };
}

function contract(taskId, shape) {
  return {
    ...baseArtifact(taskId),
    objective: shape.objective,
    deliverables: shape.deliverables,
    constraints: shape.constraints,
    risks: shape.risks,
    verification: shape.verification,
    successCriteria: shape.successCriteria,
    stopConditions: shape.stopConditions,
    unresolvedDecisions: shape.unresolvedDecisions,
    sourceRefs: shape.sourceRefs,
  };
}

function routingResult(taskId, primary, guides, reasons) {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    contractFingerprint: fingerprint(`contract:${taskId}`),
    input: { taskId, project: DEMO_PROJECT_ID },
    primary,
    guides,
    reasons,
    excluded: {},
  };
}

function preflight(taskId, { status = 'READY', requiredGates = [], satisfiedGates = [], errors = [] } = {}) {
  return {
    ...baseArtifact(taskId),
    status,
    profile: { languages: ['typescript'], framework: 'vite-react', packageManager: 'npm' },
    contract: { fingerprint: fingerprint(`contract:${taskId}`), objectivePresent: true },
    routing: { primary: 'implementation', guidesSelected: true },
    requiredGates,
    satisfiedGates,
    errors,
  };
}

const WORK_STATE_OPTIONAL_FIELDS = [
  'routeFingerprint',
  'previousPhase',
  'diagnosedHypothesis',
  'verificationCycle',
  'lastCompletionAttempt',
  'publicationStatus',
  'revision',
];

function workState(taskId, shape) {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    contractFingerprint: fingerprint(`contract:${taskId}`),
    routeFingerprint: fingerprint(`route:${taskId}`),
    repositoryFingerprint: repositoryFingerprint(),
    phase: shape.phase,
    revision: shape.revision ?? 0,
    selectedGuides: shape.selectedGuides ?? [],
    requiredGates: shape.requiredGates ?? [],
    satisfiedGates: shape.satisfiedGates ?? [],
    complianceMode: 'standard',
    completedSteps: shape.completedSteps ?? [],
    pendingSteps: shape.pendingSteps ?? [],
    checks: shape.checks ?? [],
    failures: shape.failures ?? [],
    blockers: shape.blockers ?? [],
    verificationEvidence: shape.verificationEvidence ?? [],
    evidenceCoverage: shape.evidenceCoverage ?? [],
    lastUpdated: shape.lastUpdated,
    ...Object.fromEntries(
      WORK_STATE_OPTIONAL_FIELDS.filter((field) => shape[field] !== undefined).map((field) => [field, shape[field]]),
    ),
  };
}

function continuity(taskId, phase, updatedAt, shape) {
  return {
    ...baseArtifact(taskId),
    workStateFingerprint: fingerprint(`work-state:${taskId}`),
    contractFingerprint: fingerprint(`contract:${taskId}`),
    phase,
    repositoryFingerprint: repositoryFingerprint(),
    updatedAt,
    remainingWork: shape.remainingWork,
    knownIssues: shape.knownIssues,
    changedAreas: shape.changedAreas,
    inspectFirst: shape.inspectFirst,
    ...(shape.currentFocus ? { currentFocus: shape.currentFocus } : {}),
    ...(shape.resumeNote ? { resumeNote: shape.resumeNote } : {}),
  };
}

function executionReceipt(taskId, shape) {
  return {
    ...baseArtifact(taskId),
    contractFingerprint: fingerprint(`contract:${taskId}`),
    routeFingerprint: fingerprint(`route:${taskId}`),
    stateFingerprint: fingerprint(`work-state:${taskId}`),
    selectedGuides: shape.selectedGuides,
    changedPaths: shape.changedPaths,
    checks: shape.checks,
    review: shape.review,
    limitations: shape.limitations,
    ...(shape.actions ? { actions: shape.actions } : {}),
    publication: shape.publication ?? { committed: true, pushed: true, pullRequest: null, deployed: false },
    status: shape.status ?? 'complete',
    taskStatus: shape.taskStatus ?? 'complete',
    verificationStatus: shape.verificationStatus ?? 'valid',
    publicationStatus: shape.publicationStatus ?? 'pushed',
    productionReadiness: shape.productionReadiness ?? 'not-verified',
    evidence: shape.evidence,
    evidenceCoverage: shape.evidenceCoverage,
  };
}

function gate(taskId, gateName, status, evidence, decisions = [], artifactPath = 'src/catalog.ts') {
  return {
    ...baseArtifact(taskId),
    gate: gateName,
    status,
    requiredBy: [`policy:${gateName}`],
    artifacts: [{ path: artifactPath, sha256: fingerprint(`artifact:${taskId}:${gateName}`) }],
    decisions,
    unknowns: [],
    approvedAssumptions: [],
    evidence,
  };
}

// ForgeLoop protocol-v1 lifecycle helpers -----------------------------------------

/**
 * Canonical protocol-v1 check entry: versioned, typed, sourced, and — for observed
 * command evidence — backed by execution provenance.
 */
function demoCheck({ id, requirement, status, evidenceKind = 'NOT_VERIFIED', kind = 'command', source = 'demo-fixture', timestamp, executionRef, exitCode }) {
  if (kind === 'command' && evidenceKind === 'OBSERVED' && !executionRef) evidenceKind = 'NOT_VERIFIED';
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    id,
    kind,
    requirement,
    status,
    evidenceKind,
    source,
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(executionRef !== undefined ? { executionRef } : {}),
    ...(kind === 'command' && evidenceKind === 'OBSERVED' ? { provenance: 'FORGELOOP_EXECUTED' } : {}),
  };
}

/**
 * Canonical protocol-v1 evidence coverage entry: status must be derivable from the
 * required/observed evidence lists (PARTIAL carries readiness details).
 */
function cov(requirement, mode = 'not-verified') {
  const requiredEvidence = [requirement];
  const observedEvidence = mode === 'observed' || mode === 'partial' ? [requirement] : [];
  const status =
    mode === 'blocked' ? 'BLOCKED'
      : mode === 'partial' ? 'PARTIAL'
        : mode === 'observed' ? 'COVERED'
          : 'NOT_VERIFIED';
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    requirement,
    requiredEvidence,
    observedEvidence,
    ...(mode === 'partial' ? { details: { readinessStatus: 'PARTIAL' } } : {}),
    status,
  };
}

/** Gate satisfaction ledger event keyed by details.gate. */
function gateSatisfied(ledger, gateName) {
  return ledger.append('GATE_SATISFIED', { gate: gateName });
}

function recoveryRecorded(ledger, details) {
  return ledger.append('TASK_RECOVERY_RECORDED', details);
}

/**
 * Canonical protocol-v1 execution provenance artifact (executions/exec-*.json).
 */
function executionRecord({
  executionId,
  taskId,
  checkId,
  requirement,
  argv,
  startedAt,
  finishedAt,
  status = 'passed',
  exitCode = 0,
  executionKind = 'VERIFICATION',
  protocolProjectRoot = `/workspace/${DEMO_PROJECT_ID}`,
  cwd = protocolProjectRoot,
  isolation = {
    mode: 'NATIVE_PROJECT',
    isolated: false,
    liveProjectWritable: true,
    networkPolicy: 'INHERITED',
    environmentPolicy: 'INHERITED',
  },
}) {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    executionId,
    taskId,
    checkId,
    requirement,
    verificationCycle: 1,
    kind: 'COMMAND_EXECUTION',
    executionKind,
    argv,
    protocolProjectRoot,
    cwd,
    executionIsolation: isolation.mode,
    isolation,
    resolution: { resolutionMode: 'direct', mayInstall: false, installer: null, tool: null },
    startedAt,
    finishedAt,
    durationMs: 42_000,
    termination: 'exit',
    signal: null,
    stdoutSha256: fingerprint(`stdout:${executionId}`),
    stderrSha256: fingerprint(`stderr:${executionId}`),
    status,
    exitCode,
  };
}

function workspaceBinding(taskId) {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    mode: 'GIT_WORKTREE',
    // The portable demo deliberately uses a deterministic identity. On a
    // user's checkout ForgeLoop will therefore surface the real MATCH,
    // MISMATCH or UNAVAILABLE result instead of the fixture pretending to
    // know the user's worktree.
    repositoryIdentity: fingerprint('demo-repository-identity'),
    workspaceIdentity: fingerprint(`demo-workspace:${taskId}`),
    branchAtBind: BRANCH,
    headAtBind: HEAD,
    boundAt: '2026-08-05T08:20:00.000Z',
    metadata: { fixture: true },
  };
}

function responsibility(taskId, label) {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    label,
    createdAt: '2026-08-05T08:25:00.000Z',
    // A demo-wide boundary keeps the fixture valid regardless of which
    // generated source files the host repository reports as changed.
    allowedPaths: ['.'],
    readOnlyPaths: [],
    requiredCheckIds: [],
    frozenInputs: { contract: false, route: false, claims: false },
    baseline: {
      contractFingerprint: fingerprint(`responsibility-contract:${taskId}`),
      routeFingerprint: fingerprint(`responsibility-route:${taskId}`),
      claimsFingerprint: fingerprint(`responsibility-claims:${taskId}`),
    },
  };
}

function verificationScope(taskId, changedPaths, resolvedMode = 'CHANGED') {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    requestedMode: 'AUTO',
    resolvedMode,
    verificationCycle: 1,
    changedPaths,
    claimedPaths: changedPaths,
    selectedPaths: resolvedMode === 'FULL' ? [] : changedPaths,
    reasons: resolvedMode === 'FULL'
      ? ['The fixture records an explicit full verification fallback.']
      : ['Selected exact canonical changed paths inside effective task claims.'],
    fallback: resolvedMode === 'FULL' ? { from: 'CHANGED', to: 'FULL', reason: 'Fixture fallback example.' } : null,
    contractFingerprint: fingerprint(`contract:${taskId}`),
    repositoryFingerprint: repositoryFingerprint(),
    claimsFingerprint: fingerprint(`claims:${taskId}`),
    checkerCapabilityFingerprint: fingerprint('checker-capability:unit-tests'),
    createdAt: '2026-08-04T11:05:00.000Z',
  };
}

function canonicalHandoff(taskId) {
  const body = {
    schemaVersion: 1,
    protocolVersion: 1,
    handoffId: 'handoff-harness-a-to-b',
    taskId,
    createdAt: '2026-08-06T11:21:00.000Z',
    intent: {
      recipientHint: 'harness-b',
      note: 'Resume after the accessibility gate failure; keep mutations blocked until task-resume.',
    },
    state: {
      phase: 'BLOCKED',
      revision: 1,
      verificationCycle: 1,
      contractFingerprint: fingerprint(`contract:${taskId}`),
      routeFingerprint: fingerprint(`route:${taskId}`),
      repositoryFingerprint: repositoryFingerprint(),
      writeClaims: [],
      changedPaths: ['src/catalog.ts'],
    },
    evidence: {
      executionRefs: [],
      checkIds: ['accessibility-audit'],
    },
    continuity: {
      ref: 'continuity.json',
      fingerprint: fingerprint(`continuity:${taskId}`),
    },
  };
  return { ...body, artifactDigest: canonicalFingerprint(body) };
}

function codeManifest(taskId) {
  const entries = [];
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    verificationCycle: 1,
    capture: {
      mode: 'WORKTREE',
      revisionProvider: 'git',
      baseRevision: null,
      observedRevision: HEAD,
      providerMetadata: { fixture: true },
    },
    bindings: {
      contractFingerprint: fingerprint(`contract:${taskId}`),
      routeFingerprint: fingerprint(`route:${taskId}`),
      stateFingerprint: fingerprint(`state:${taskId}`),
      receiptFingerprint: fingerprint(`receipt:${taskId}`),
      ledgerSeq: 1,
      ledgerHash: fingerprint(`ledger:${taskId}`),
    },
    entries,
    contentDigest: canonicalFingerprint(entries),
  };
}

function attestationStatement(taskId, manifest) {
  return {
    schemaVersion: 1,
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: `forgeloop-task:${taskId}`, digest: { sha256: manifest.contentDigest } }],
    predicateType: 'https://forgeloop.dev/attestation/v1',
    predicate: {
      schemaVersion: 1,
      protocol: { name: 'ForgeLoop', protocolVersion: 1 },
      task: { taskId, verificationCycle: manifest.verificationCycle },
      content: {
        manifestFingerprint: canonicalFingerprint(manifest),
        contentDigest: manifest.contentDigest,
        coveredPaths: [],
      },
      evidence: { ...manifest.bindings },
      verification: { completion: 'VALID', audit: 'VALID' },
    },
  };
}

function normalizeDiagnosticText(value) {
  return String(value).trim().replace(/\s+/gu, ' ').toLowerCase();
}

function canonicalizeDiagnosticValue(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(canonicalizeDiagnosticValue))].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'id' && key !== 'createdAt')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalizeDiagnosticValue(child)]));
  }
  return typeof value === 'string' ? normalizeDiagnosticText(value) : value;
}

function diagnosticFingerprint(details) {
  return canonicalFingerprint({
    verificationCycle: details.verificationCycle,
    failureClass: details.failureClass,
    observations: details.observations.map(({ kind, evidenceRef, statement, provenance }) => canonicalizeDiagnosticValue({ kind, evidenceRef, statement, provenance })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    contributors: details.contributors.map(({ type, statement, basis, status }) => canonicalizeDiagnosticValue({ type, statement, basis, status })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    hypotheses: details.hypotheses.map(({ statement, contributorRefs, evidenceRefs, settledBy }) => canonicalizeDiagnosticValue({ statement, contributorRefs, evidenceRefs, settledBy })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    nextSafeAction: canonicalizeDiagnosticValue(details.nextSafeAction?.statement ?? null),
  });
}

function interventionFingerprint(intervention) {
  return canonicalFingerprint({
    kind: intervention.kind,
    statement: normalizeDiagnosticText(intervention.statement),
    targets: [...new Set((intervention.targets ?? []).map((target) => target.trim()))].sort(),
    hypothesisRefs: [...new Set((intervention.hypothesisRefs ?? []).map((ref) => ref.trim()))].sort(),
  });
}

function durableAction(taskId, shape) {
  const identity = {
    taskId,
    actionId: shape.actionId,
    effectClass: shape.effectClass,
    capability: shape.capability,
    target: shape.target ?? null,
    operation: shape.operation ?? null,
    idempotencyKey: shape.idempotencyKey ?? null,
    requiredForCompletion: Boolean(shape.requiredForCompletion),
    requirement: shape.requirement ?? null,
  };
  return {
    schemaVersion: 1,
    taskId,
    actionId: shape.actionId,
    actionFingerprint: canonicalFingerprint(identity),
    effectClass: shape.effectClass,
    capability: shape.capability,
    operation: shape.operation,
    target: shape.target,
    idempotencyKey: shape.idempotencyKey ?? null,
    requiredForCompletion: Boolean(shape.requiredForCompletion),
    requirement: shape.requirement ?? null,
    provenance: shape.provenance,
    state: shape.state,
    revision: shape.revision,
    createdAt: shape.createdAt,
    updatedAt: shape.updatedAt,
    ...(shape.lastEvidenceRef !== undefined ? { lastEvidenceRef: shape.lastEvidenceRef } : {}),
    ...(shape.lastReconciliationAt !== undefined ? { lastReconciliationAt: shape.lastReconciliationAt } : {}),
    ...(shape.commitResultCode !== undefined ? { commitResultCode: shape.commitResultCode } : {}),
  };
}

function durableApproval(taskId, shape) {
  return {
    schemaVersion: 1,
    taskId,
    approvalId: shape.approvalId,
    actionId: shape.actionId,
    actionFingerprint: shape.actionFingerprint,
    contractFingerprint: fingerprint(`contract:${taskId}`),
    taskRevision: shape.taskRevision,
    capability: shape.capability,
    status: shape.status,
    requestedAt: shape.requestedAt,
    reason: shape.reason,
  };
}

function trajectoryEvaluation(taskId) {
  const base = {
    schemaVersion: 1,
    evaluationId: 'eval-cart-hydration',
    scenarioId: 'cart-hydration-recovery',
    scenarioFingerprint: fingerprint('scenario:cart-hydration-recovery'),
    taskId,
    result: 'FAIL',
    completionValid: false,
    safetyValid: true,
    missingMilestones: ['COMPLETION_VALIDATED'],
    limits: { verificationCycles: { actual: 1, max: 3, pass: true } },
    efficiency: { referenceComparableSteps: 4, actualComparableSteps: 6, ratio: 0.6666666667 },
    computedAt: '2026-08-04T11:05:00.000Z',
    source: 'PROJECT_LOCAL_REFERENCE',
  };
  return { ...base, evaluationFingerprint: canonicalFingerprint(base) };
}

function finalizeTaskArtifacts(artifacts, ledger) {
  const contract = artifacts['contract.json'];
  const state = artifacts['work-state.json'];
  const continuityArtifact = artifacts['continuity.json'];
  if (contract && state) {
    const contractFingerprint = canonicalFingerprint(contract);
    state.contractFingerprint = contractFingerprint;
    const routeArtifact = artifacts['routing-result.json'];
    if (routeArtifact) routeArtifact.contractFingerprint = contractFingerprint;
    const routeFingerprint = routingFingerprint(artifacts);
    state.routeFingerprint = routeFingerprint;
    const stateFingerprint = canonicalFingerprint(state);
    if (continuityArtifact) {
      continuityArtifact.contractFingerprint = contractFingerprint;
      continuityArtifact.workStateFingerprint = stateFingerprint;
    }
    if (artifacts['execution-receipt.json']) artifacts['execution-receipt.json'].stateFingerprint = stateFingerprint;
    if (artifacts['verification-scope.json']) {
      artifacts['verification-scope.json'].contractFingerprint = contractFingerprint;
    }
    if (artifacts['responsibility.json']) {
      artifacts['responsibility.json'].baseline.contractFingerprint = contractFingerprint;
      artifacts['responsibility.json'].baseline.routeFingerprint = routingFingerprint(artifacts);
    }
    const manifest = artifacts['attestations/code-manifest.json'];
    const receipt = artifacts['execution-receipt.json'];
    if (manifest) {
      manifest.bindings.contractFingerprint = contractFingerprint;
      manifest.bindings.routeFingerprint = routeFingerprint;
      manifest.bindings.stateFingerprint = stateFingerprint;
      manifest.bindings.receiptFingerprint = receipt ? canonicalFingerprint(receipt) : manifest.bindings.receiptFingerprint;
    }
    const handoff = artifacts['handoffs/handoff-harness-a-to-b.json'];
    if (handoff) {
      handoff.state.workStateFingerprint = stateFingerprint;
      handoff.state.contractFingerprint = contractFingerprint;
      handoff.state.routeFingerprint = routeFingerprint;
      if (continuityArtifact) handoff.continuity.fingerprint = canonicalFingerprint(continuityArtifact);
      const { artifactDigest: _previousDigest, ...handoffBody } = handoff;
      handoff.artifactDigest = canonicalFingerprint(handoffBody);
      if (ledger) {
        for (const event of ledger.events) {
          if (event.details?.handoffId !== handoff.handoffId) continue;
          if (event.event === 'HANDOFF_CREATED') event.details.digest = handoff.artifactDigest;
          if (event.event === 'HANDOFF_ACCEPTED') event.details.handoffDigest = handoff.artifactDigest;
        }
        ledger.recomputeHashes();
      }
    }
  }
  return artifacts;
}

function routingFingerprint(artifacts) {
  return artifacts['routing-result.json'] ? canonicalFingerprint(artifacts['routing-result.json']) : null;
}

function finalizeAttestationArtifacts(artifacts, ledger) {
  const manifest = artifacts['attestations/code-manifest.json'];
  const statement = artifacts['attestations/statement.json'];
  if (!manifest || !statement) return artifacts;
  const completion = [...ledger.events].reverse().find((event) => event.event === 'COMPLETION_VALIDATED');
  if (completion) {
    manifest.bindings.ledgerSeq = completion.seq;
    manifest.bindings.ledgerHash = completion.hash;
  }
  manifest.contentDigest = canonicalFingerprint(manifest.entries);
  statement.subject[0].digest.sha256 = manifest.contentDigest;
  statement.predicate.content.manifestFingerprint = canonicalFingerprint(manifest);
  statement.predicate.content.contentDigest = manifest.contentDigest;
  statement.predicate.evidence = { ...manifest.bindings };
  return artifacts;
}

const TASKS = {
  catalog: {
    id: 'TASK-001',
    title: 'Implement premium product catalog',
    startAt: '2026-08-03T09:00:00.000Z',
    phase: 'COMPLETE',
  },
  cart: {
    id: 'TASK-002',
    title: 'Add shopping cart persistence',
    startAt: '2026-08-04T09:30:00.000Z',
    phase: 'VERIFYING',
  },
  checkout: {
    id: 'TASK-003',
    title: 'Implement checkout API integration',
    startAt: '2026-08-05T08:15:00.000Z',
    phase: 'EXECUTING',
  },
  a11y: {
    id: 'TASK-004',
    title: 'Accessibility and keyboard navigation audit',
    startAt: '2026-08-06T10:00:00.000Z',
    phase: 'BLOCKED',
  },
  perf: {
    id: 'TASK-005',
    title: 'Improve image loading performance',
    startAt: '2026-08-07T11:45:00.000Z',
    phase: 'PLANNED',
  },
  security: {
    id: 'TASK-006',
    title: 'Security review of checkout flow',
    startAt: '2026-08-07T14:00:00.000Z',
    phase: 'COMPLETE',
  },
  abandoned: {
    id: 'TASK-007',
    title: 'Explore server-side rendering migration',
    startAt: '2026-08-08T09:00:00.000Z',
    phase: 'PLANNED',
  },
  revision: {
    id: 'TASK-008',
    title: 'Rework checkout contract after the retry policy change',
    startAt: '2026-08-08T13:00:00.000Z',
    phase: 'ROUTED',
  },
};

function buildCatalogTask() {
  const t = TASKS.catalog;
  const taskId = t.id;
  const ledger = new EventLedgerBuilder(taskId, { startAt: t.startAt });
  ledger.append('TASK_CREATED', { title: t.title });
  ledger.append('CONTRACT_VALIDATED', { objective: t.title });
  ledger.append('ROUTE_VALIDATED', { primary: 'implementation' });
  gateSatisfied(ledger, 'unit-tests');
  gateSatisfied(ledger, 'typecheck');
  gateSatisfied(ledger, 'lint');
  ledger.append('PREFLIGHT_READY', { requiredGates: ['unit-tests', 'typecheck', 'lint'] });
  ledger.append('PLAN_CREATED', { steps: ['models', 'filtering', 'grid view'] });
  ledger.append('EXECUTION_STARTED', { area: 'src/catalog.ts' });
  ledger.append('CHECK_PASSED', { check: 'unit-tests', result: 'catalog unit tests: 14 passed' });
  ledger.append('CHECK_PASSED', { check: 'typecheck', result: 'tsc --noEmit clean' });
  ledger.append('CHECK_PASSED', { check: 'lint', result: 'eslint clean' });
  ledger.append('VERIFICATION_STARTED', { verificationCycle: 1 });
  ledger.append('REVIEW_STARTED', { verificationCycle: 1, reviewer: 'harness-a' });
  ledger.append('VALIDATION_PASSED', { coverage: '100% of success criteria observed' });
  ledger.append('VERIFICATION_RECORDED', { verificationCycle: 1, outcome: 'passed' });
  ledger.append('TASK_COMPLETED', { receipt: 'execution-receipt.json' });
  ledger.append('COMPLETION_VALIDATED', { receipt: 'execution-receipt.json' });

  const checks = [
    demoCheck({ id: 'catalog-unit-tests', requirement: 'Catalog unit tests pass', status: 'passed', evidenceKind: 'OBSERVED', source: 'vitest run', exitCode: 0, timestamp: '2026-08-03T09:35:00.000Z', executionRef: 'exec-catalog-unit-tests' }),
    demoCheck({ id: 'typecheck', requirement: 'TypeScript compiles without errors', status: 'passed', evidenceKind: 'OBSERVED', source: 'tsc --noEmit', exitCode: 0, timestamp: '2026-08-03T09:40:00.000Z', executionRef: 'exec-catalog-typecheck' }),
    demoCheck({ id: 'lint', requirement: 'Lint passes on changed files', status: 'passed', evidenceKind: 'OBSERVED', source: 'eslint', exitCode: 0, timestamp: '2026-08-03T09:42:00.000Z', executionRef: 'exec-catalog-lint' }),
  ];
  const coverage = [
    cov('Products render in a responsive grid', 'observed'),
    cov('Filters combine category and price range', 'observed'),
    cov('Catalog unit tests pass (14 cases)', 'observed'),
    cov('Filtering logic covered by table-driven tests', 'observed'),
  ];
  const artifacts = {};
  artifacts['task.json'] = taskDescriptor(taskId, t.startAt, '2026-08-03T10:05:00.000Z', []);
  artifacts['contract.json'] = contract(taskId, {
    objective: 'Implement the premium product catalog with filtering and a responsive grid view.',
    deliverables: ['Product data model with typed catalog entries', 'Category and price filtering', 'Responsive product grid component'],
    constraints: ['No new runtime dependencies', 'Must render read-only in ForgeLoopAudit demo scope'],
    risks: ['Large catalogs could slow initial render'],
    verification: ['Catalog unit tests pass (14 cases)', 'Filtering logic covered by table-driven tests'],
    successCriteria: ['Products render in a responsive grid', 'Filters combine category and price range'],
    stopConditions: ['Any failing unit test blocks completion'],
    unresolvedDecisions: [],
    sourceRefs: ['src/catalog.ts', 'tests/catalog.test.ts'],
  });
  artifacts['routing-result.json'] = routingResult(taskId, 'implementation', ['test', 'clean'], { implementation: ['Direct feature work with test coverage'] });
  artifacts['preflight.json'] = preflight(taskId, { requiredGates: ['unit-tests', 'typecheck', 'lint'], satisfiedGates: ['unit-tests', 'typecheck', 'lint'] });
  artifacts['work-state.json'] = workState(taskId, {
    phase: 'COMPLETE',
    selectedGuides: ['test', 'clean'],
    requiredGates: ['unit-tests', 'typecheck', 'lint'],
    satisfiedGates: ['unit-tests', 'typecheck', 'lint'],
    completedSteps: ['Model product entries', 'Implement filtering', 'Build grid view', 'Verify with unit tests'],
    pendingSteps: [],
    checks,
    publicationStatus: 'pushed',
    revision: 3,
    verificationCycle: 1,
    verificationEvidence: [
      { id: 'verif-catalog-cycle-1', summary: 'Every success criterion observed during verification cycle 1.', status: 'OBSERVED', timestamp: '2026-08-03T10:00:00.000Z' },
    ],
    evidenceCoverage: coverage,
    lastUpdated: '2026-08-03T10:05:00.000Z',
  });
  artifacts['continuity.json'] = continuity(taskId, 'COMPLETE', '2026-08-03T10:06:00.000Z', {
    remainingWork: [{ id: 'follow-up-seo', summary: 'Consider SEO metadata for catalog routes in a future task' }],
    knownIssues: [],
    changedAreas: ['src/catalog.ts', 'tests/catalog.test.ts'],
    inspectFirst: [],
    resumeNote: 'Completed; kept as reference lifecycle for the ForgeShop demo.',
  });
  artifacts['execution-receipt.json'] = executionReceipt(taskId, {
    selectedGuides: ['test', 'clean'],
    changedPaths: ['src/catalog.ts', 'tests/catalog.test.ts'],
    checks,
    review: { reviewer: 'harness-a', outcome: 'approved', notes: 'Grid keyboard focus order verified manually.' },
    limitations: ['Demo fixture only; no real storefront is built.'],
    evidence: [
      { kind: 'OBSERVED', source: 'vitest run', result: 'catalog unit tests: 14 passed' },
      { kind: 'OBSERVED', source: 'tsc --noEmit', result: 'no type errors' },
    ],
    evidenceCoverage: coverage,
  });
  const manifest = codeManifest(taskId);
  artifacts['attestations/code-manifest.json'] = manifest;
  artifacts['attestations/statement.json'] = attestationStatement(taskId, manifest);
  artifacts['gates/unit-tests.json'] = gate(taskId, 'unit-tests', 'satisfied', [{ kind: 'OBSERVED', source: 'vitest run', result: '14 passed' }]);
  artifacts['gates/typecheck.json'] = gate(taskId, 'typecheck', 'satisfied', [{ kind: 'OBSERVED', source: 'tsc --noEmit', result: 'clean' }]);
  artifacts['gates/lint.json'] = gate(taskId, 'lint', 'satisfied', [{ kind: 'OBSERVED', source: 'eslint', result: 'clean' }]);
  const executions = [
    executionRecord({
      executionId: 'exec-catalog-unit-tests',
      taskId,
      checkId: 'catalog-unit-tests',
      requirement: 'Catalog unit tests pass',
      argv: ['npx', 'vitest', 'run', 'tests/catalog.test.ts'],
      startedAt: '2026-08-03T09:33:00.000Z',
      finishedAt: '2026-08-03T09:35:00.000Z',
      cwd: '/tmp/forgeloop/forgeshop-checkout',
      isolation: {
        mode: 'PROJECT_ISOLATED',
        isolated: true,
        liveProjectWritable: false,
        networkPolicy: 'INHERITED',
        environmentPolicy: 'SANITIZED',
      },
    }),
    executionRecord({ executionId: 'exec-catalog-typecheck', taskId, checkId: 'typecheck', requirement: 'TypeScript compiles without errors', argv: ['npx', 'tsc', '--noEmit'], startedAt: '2026-08-03T09:38:00.000Z', finishedAt: '2026-08-03T09:40:00.000Z' }),
    executionRecord({ executionId: 'exec-catalog-lint', taskId, checkId: 'lint', requirement: 'Lint passes on changed files', argv: ['npx', 'eslint', 'src/catalog.ts'], startedAt: '2026-08-03T09:41:00.000Z', finishedAt: '2026-08-03T09:42:00.000Z' }),
  ].map((record) => [`executions/${record.executionId}.json`, record]);
  return { taskId, ledger, artifacts, executions };
}

function buildCartTask() {
  const t = TASKS.cart;
  const taskId = t.id;
  const ledger = new EventLedgerBuilder(taskId, { startAt: t.startAt });
  ledger.append('TASK_CREATED', { title: t.title });
  ledger.append('CONTRACT_VALIDATED', { objective: t.title });
  ledger.append('ROUTE_VALIDATED', { primary: 'implementation' });
  gateSatisfied(ledger, 'unit-tests');
  gateSatisfied(ledger, 'typecheck');
  ledger.append('PREFLIGHT_READY', { requiredGates: ['unit-tests', 'typecheck'] });
  ledger.append('PLAN_CREATED', { steps: ['cart store', 'localStorage adapter', 'hydration on launch'] });
  ledger.append('EXECUTION_STARTED', { area: 'src/cart.ts' });
  ledger.append('CHECK_PASSED', { check: 'unit-tests', result: 'cart unit tests: 8 passed' });
  ledger.append('EXECUTION_COMPLETED', { area: 'src/cart.ts' });
  ledger.append('VERIFICATION_STARTED', { verificationCycle: 1 });
  ledger.append('CHECK_WARNING', { check: 'hydration-edge-case', note: 'Hydration edge case found for corrupted stored carts' });
  ledger.append('VERIFICATION_RECORDED', {
    id: 'corrupt-cart-hydration',
    checkId: 'corrupt-cart-hydration',
    requirement: 'Corrupted persisted carts are discarded safely',
    status: 'failed',
    verificationCycle: 1,
    exitCode: 1,
    failureToken: 'HYDRATION_CORRUPT_PAYLOAD',
  });
  const diagnosticCase = {
    schemaVersion: 1,
    verificationCycle: 1,
    diagnosticRevision: 1,
    failureClass: 'VERIFICATION_FAILURE',
    observations: [{ id: 'obs-cart-hydration', kind: 'CHECK_RESULT', evidenceRef: 'corrupt-cart-hydration', statement: 'Corrupted persisted cart payload throws during hydration.', provenance: 'FORGELOOP_EXECUTED' }],
    contributors: [{ id: 'contributor-cart-parser', type: 'CODE', statement: 'The cart hydration parser does not discard malformed persisted data.', basis: ['obs-cart-hydration'], status: 'SUSPECTED' }],
    hypotheses: [{ id: 'h-cart-parser', statement: 'Hydration needs a guarded parse-and-discard path for malformed carts.', contributorRefs: ['contributor-cart-parser'], evidenceRefs: ['corrupt-cart-hydration'], settledBy: { type: 'CHECK_STATUS', checkId: 'corrupt-cart-hydration', expectedStatus: 'passed' } }],
    nextSafeAction: { statement: 'Add a reversible guard around persisted cart parsing, then run the hydration regression check.' },
    previousDiagnosticFingerprint: null,
  };
  diagnosticCase.diagnosticFingerprint = diagnosticFingerprint(diagnosticCase);
  ledger.append('DIAGNOSTIC_CASE_RECORDED', diagnosticCase);
  ledger.append('HYPOTHESIS_DISPOSITION_RECORDED', {
    schemaVersion: 1,
    verificationCycle: 1,
    hypothesisRef: 'h-cart-parser',
    status: 'WEAKENED',
    evidenceRefs: ['corrupt-cart-hydration'],
    reason: 'The failed hydration check weakens the parser hypothesis until the regression is fixed and re-verified.',
  });
  const intervention = {
    schemaVersion: 1,
    verificationCycle: 1,
    intervention: {
      id: 'intervention-cart-guard',
      kind: 'CODE_CHANGE',
      statement: 'Add a guarded parse-and-discard path for malformed persisted carts.',
      hypothesisRefs: ['h-cart-parser'],
      targets: ['src/cart.ts'],
      expectedObservation: 'The hydration regression check passes without throwing.',
      reversible: true,
    },
  };
  intervention.interventionSemanticFingerprint = interventionFingerprint(intervention.intervention);
  ledger.append('INTERVENTION_RECORDED', intervention);

  const checks = [
    demoCheck({ id: 'cart-unit-tests', requirement: 'Cart unit tests pass', status: 'passed', evidenceKind: 'OBSERVED', source: 'vitest run', exitCode: 0, timestamp: '2026-08-04T10:20:00.000Z' }),
    demoCheck({ id: 'corrupt-cart-hydration', requirement: 'Corrupted persisted carts are discarded safely', status: 'failed', evidenceKind: 'NOT_VERIFIED', source: 'manual observation', timestamp: '2026-08-04T10:55:00.000Z' }),
    demoCheck({ id: 'typecheck', requirement: 'TypeScript compiles without errors', status: 'passed', evidenceKind: 'OBSERVED', source: 'tsc --noEmit', exitCode: 0, timestamp: '2026-08-04T10:58:00.000Z' }),
  ];
  const coverage = [
    cov('Cart survives a simulated restart', 'observed'),
    cov('Corrupted carts are dropped with a warning', 'partial'),
    cov('Cart unit tests pass (8 cases)', 'observed'),
    cov('Hydration edge case regression test exists', 'not-verified'),
  ];
  const artifacts = {};
  artifacts['task.json'] = taskDescriptor(taskId, t.startAt, '2026-08-04T11:00:00.000Z', ['src/cart.ts']);
  artifacts['contract.json'] = contract(taskId, {
    objective: 'Persist the shopping cart across sessions using a local storage adapter.',
    deliverables: ['Typed cart store', 'Storage adapter with corruption handling', 'Hydration on application launch'],
    constraints: ['Storage quota must stay under 1 MiB', 'No personal data may be persisted'],
    risks: ['Corrupted storage payloads could break hydration'],
    verification: ['Cart unit tests pass (8 cases)', 'Corrupted payloads are discarded safely'],
    successCriteria: ['Cart survives a simulated restart', 'Corrupted carts are dropped with a warning'],
    stopConditions: ['Data loss beyond the current cart must halt execution'],
    unresolvedDecisions: ['Whether to version the storage payload format'],
    sourceRefs: ['src/cart.ts', 'tests/cart.test.ts'],
  });
  artifacts['routing-result.json'] = routingResult(taskId, 'implementation', ['test', 'design'], { implementation: ['Store plus adapter pattern'] });
  artifacts['preflight.json'] = preflight(taskId, { requiredGates: ['unit-tests', 'typecheck'], satisfiedGates: ['unit-tests', 'typecheck'] });
  artifacts['work-state.json'] = workState(taskId, {
    phase: 'VERIFYING',
    previousPhase: 'EXECUTING',
    selectedGuides: ['test', 'design'],
    requiredGates: ['unit-tests', 'typecheck'],
    satisfiedGates: ['unit-tests', 'typecheck'],
    completedSteps: ['Cart store', 'Storage adapter', 'Launch hydration'],
    pendingSteps: ['Harden hydration against corrupted payloads', 'Re-run verification cycle'],
    checks,
    verificationCycle: 1,
    lastCompletionAttempt: {
      status: 'REJECTED',
      reasonCodes: ['MISSING_VERIFICATION_EVIDENCE'],
      missingRequirementIds: ['corrupt-cart-hydration'],
      verificationCycle: 1,
      receiptFingerprint: null,
      timestamp: '2026-08-04T11:00:00.000Z',
    },
    evidenceCoverage: coverage,
    lastUpdated: '2026-08-04T11:02:00.000Z',
  });
  artifacts['continuity.json'] = continuity(taskId, 'VERIFYING', '2026-08-04T11:03:00.000Z', {
    verificationCycle: 1,
    currentFocus: { id: 'harden-hydration', summary: 'Discard corrupted carts and surface a user-visible warning' },
    remainingWork: [
      { id: 'harden-hydration', summary: 'Discard corrupted carts and surface a user-visible warning' },
      { id: 'reverify', summary: 'Run verification cycle 2 with new hydration tests' },
    ],
    knownIssues: [{ id: 'corrupt-cart-hydration', summary: 'Corrupted payload currently throws instead of being discarded' }],
    changedAreas: ['src/cart.ts', 'tests/cart.test.ts'],
    inspectFirst: ['src/cart.ts', 'tests/cart.test.ts'],
    resumeNote: 'Verification cycle 1 rejected: hydration edge case still open. Resume in VERIFYING.',
  });
  const inspectAction = durableAction(taskId, {
    actionId: 'action-cart-inspect',
    effectClass: 'READ_ONLY',
    capability: 'filesystem.read',
    operation: 'Inspect persisted cart payload',
    target: 'src/cart.ts',
    requiredForCompletion: false,
    requirement: null,
    provenance: 'EXTERNAL_OBSERVED',
    state: 'VERIFIED',
    revision: 1,
    createdAt: '2026-08-04T10:45:00.000Z',
    updatedAt: '2026-08-04T10:46:00.000Z',
    lastEvidenceRef: 'cart-unit-tests',
  });
  const repairAction = durableAction(taskId, {
    actionId: 'action-cart-repair',
    effectClass: 'REVERSIBLE_WRITE',
    capability: 'filesystem.write',
    operation: 'Discard malformed persisted cart payload',
    target: 'src/cart.ts',
    idempotencyKey: 'forgeshop:TASK-002:cart-repair:v1',
    requiredForCompletion: true,
    requirement: 'Corrupted persisted carts are discarded safely',
    provenance: 'CALLER_REPORTED',
    state: 'COMMIT_UNKNOWN',
    revision: 2,
    createdAt: '2026-08-04T10:50:00.000Z',
    updatedAt: '2026-08-04T11:01:00.000Z',
    commitResultCode: 'AMBIGUOUS',
  });
  artifacts['actions/action-cart-inspect.json'] = inspectAction;
  artifacts['actions/action-cart-repair.json'] = repairAction;
  artifacts['approvals/approval-cart-repair.json'] = durableApproval(taskId, {
    approvalId: 'approval-cart-repair',
    actionId: repairAction.actionId,
    actionFingerprint: repairAction.actionFingerprint,
    taskRevision: repairAction.revision,
    capability: repairAction.capability,
    status: 'PENDING',
    requestedAt: '2026-08-04T11:01:30.000Z',
    reason: 'The completion-critical repair action needs an explicit decision before any external mutation.',
  });
  artifacts['evaluations/eval-cart-hydration.json'] = trajectoryEvaluation(taskId);
  artifacts['execution-receipt.json'] = executionReceipt(taskId, {
    selectedGuides: ['test', 'design'],
    changedPaths: ['src/cart.ts', 'tests/cart.test.ts'],
    checks,
    status: 'complete-with-concerns',
    taskStatus: 'incomplete',
    verificationStatus: 'invalid',
    publicationStatus: 'local-only',
    publication: { committed: true, pushed: false, pullRequest: null, deployed: false },
    review: { reviewer: 'harness-a', outcome: 'rejected', notes: 'Hydration failure remains unresolved.' },
    limitations: ['Completion-critical repair has an unknown external commit outcome.'],
    actions: { count: 2, required: 1, verified: 1, trustedSatisfied: 0, unresolvedRequired: 1, failed: 0, ambiguous: 1, pending: 0, actionRefs: [inspectAction.actionId, repairAction.actionId] },
    evidence: [{ kind: 'OBSERVED', source: 'vitest run', result: 'cart unit tests: 8 passed' }, { kind: 'NOT_VERIFIED', source: 'manual observation', result: 'Corrupted persisted carts are not yet discarded safely.' }],
    evidenceCoverage: coverage,
  });
  artifacts['verification-scope.json'] = verificationScope(taskId, ['src/cart.ts', 'tests/cart.test.ts']);
  return { taskId, ledger, artifacts };
}

function buildCheckoutTask() {
  const t = TASKS.checkout;
  const taskId = t.id;
  const ledger = new EventLedgerBuilder(taskId, { startAt: t.startAt });
  ledger.append('TASK_CREATED', { title: t.title });
  ledger.append('CONTRACT_VALIDATED', { objective: t.title });
  ledger.append('ROUTE_VALIDATED', { primary: 'implementation' });
  gateSatisfied(ledger, 'integration-tests');
  ledger.append('PREFLIGHT_READY', { requiredGates: ['integration-tests'] });
  ledger.append('PLAN_APPROVED', { steps: ['client', 'error mapping', 'retry policy'] });
  ledger.append('EXECUTION_STARTED', { area: 'src/checkout.ts' });
  ledger.append('CHECK_PASSED', { check: 'integration-tests', result: 'checkout integration tests: 6 passed' });

  const checks = [
    demoCheck({ id: 'checkout-integration-tests', requirement: 'Checkout integration tests pass', status: 'passed', evidenceKind: 'OBSERVED', source: 'vitest run', exitCode: 0, timestamp: '2026-08-05T09:10:00.000Z', executionRef: 'exec-checkout-integration-tests' }),
    demoCheck({ id: 'retry-policy-tests', requirement: 'Retry policy handles transient failures', status: 'not-run', evidenceKind: 'NOT_VERIFIED', source: 'planned', timestamp: '2026-08-05T09:12:00.000Z' }),
  ];
  const coverage = [
    cov('Orders submit through the client', 'observed'),
    cov('Transient errors retry with backoff', 'not-verified'),
    cov('Checkout integration tests pass (6 cases)', 'partial'),
  ];
  const artifacts = {};
  artifacts['task.json'] = taskDescriptor(taskId, t.startAt, '2026-08-05T09:15:00.000Z', ['src/checkout.ts']);
  artifacts['contract.json'] = contract(taskId, {
    objective: 'Integrate the checkout API client with error mapping and a retry policy.',
    deliverables: ['Checkout API client', 'Typed error mapping', 'Retry policy for transient failures'],
    constraints: ['No secrets in demo code', 'All network calls mocked in tests'],
    risks: ['Payment provider outages could hang checkout'],
    verification: ['Checkout integration tests pass (6 cases)', 'Retry policy handles transient failures'],
    successCriteria: ['Orders submit through the client', 'Transient errors retry with backoff'],
    stopConditions: ['Any leaked credential stops execution immediately'],
    unresolvedDecisions: ['Final retry backoff ceiling'],
    sourceRefs: ['src/checkout.ts', 'tests/checkout.test.ts'],
  });
  artifacts['routing-result.json'] = routingResult(taskId, 'implementation', ['security', 'test'], { implementation: ['Client with explicit error taxonomy'] });
  artifacts['preflight.json'] = preflight(taskId, { requiredGates: ['integration-tests', 'security-review'], satisfiedGates: ['integration-tests'] });
  artifacts['work-state.json'] = workState(taskId, {
    phase: 'EXECUTING',
    selectedGuides: ['security', 'test'],
    requiredGates: ['integration-tests', 'security-review'],
    satisfiedGates: ['integration-tests'],
    completedSteps: ['API client skeleton', 'Error mapping'],
    pendingSteps: ['Retry policy', 'Security review'],
    checks,
    evidenceCoverage: coverage,
    lastUpdated: '2026-08-05T09:15:00.000Z',
  });
  artifacts['continuity.json'] = continuity(taskId, 'EXECUTING', '2026-08-05T09:16:00.000Z', {
    currentFocus: { id: 'retry-policy', summary: 'Implement exponential backoff retry for transient checkout failures' },
    remainingWork: [
      { id: 'retry-policy', summary: 'Implement exponential backoff retry for transient checkout failures' },
      { id: 'security-review', summary: 'Pass the checkout security review gate' },
    ],
    knownIssues: [],
    changedAreas: ['src/checkout.ts'],
    inspectFirst: ['src/checkout.ts'],
    resumeNote: 'Execution in progress; integration tests green, retry policy next.',
  });
  artifacts['workspace-binding.json'] = workspaceBinding(taskId);
  artifacts['responsibility.json'] = responsibility(taskId, 'checkout implementation');
  const executions = [
    executionRecord({ executionId: 'exec-checkout-integration-tests', taskId, checkId: 'checkout-integration-tests', requirement: 'Checkout integration tests pass', argv: ['npx', 'vitest', 'run', 'tests/checkout.test.ts'], startedAt: '2026-08-05T09:07:00.000Z', finishedAt: '2026-08-05T09:10:00.000Z' }),
  ].map((record) => [`executions/${record.executionId}.json`, record]);
  return { taskId, ledger, artifacts, executions };
}

function buildA11yTask() {
  const t = TASKS.a11y;
  const taskId = t.id;
  const releasedClaims = ['src/catalog.ts'];
  const handoff = canonicalHandoff(t.id);
  const ledger = new EventLedgerBuilder(taskId, { startAt: t.startAt });
  ledger.append('TASK_CREATED', { title: t.title });
  ledger.append('CONTRACT_VALIDATED', { objective: t.title });
  ledger.append('ROUTE_VALIDATED', { primary: 'diagnosis' });
  ledger.append('SESSION_ACTIVATED', { harness: 'harness-a' });
  ledger.append('EXECUTION_REVIEWED', { area: 'audit:keyboard-navigation' });
  ledger.append('CHECK_FAILED', { check: 'keyboard-navigation', finding: '2 keyboard navigation findings in grid pagination' });
  ledger.append('TASK_BLOCKED', { reason: 'ACCESSIBILITY_GATE_FAILED' });
  ledger.append('RECOVERY_ROUTE_SELECTED', { route: 'correct-and-resume', decidedBy: 'harness-a' });
  ledger.append('HANDOFF_CREATED', {
    from: 'harness-a',
    to: 'harness-b',
    note: 'Resume after fixing grid pagination focus trap',
    handoffId: handoff.handoffId,
    artifact: `handoffs/${handoff.handoffId}.json`,
    digest: handoff.artifactDigest,
  });
  ledger.append('SESSION_ACTIVATED', { harness: 'harness-b' });
  ledger.append('HANDOFF_ACCEPTED', {
    handoffId: handoff.handoffId,
    handoffDigest: handoff.artifactDigest,
    consumerId: 'consumer-forgeshop-harness-b',
    harness: 'harness-b',
  });
  ledger.append('RESUMED_FROM_CONTINUITY', { harness: 'harness-b', phase: 'CORRECTING' });
  const recoveryEvent = recoveryRecorded(ledger, {
    recoveryId: 'recovery-a11y-stale-lock',
    classification: 'STALE',
    previousPhase: 'BLOCKED',
    previousRevision: 2,
    authorityKind: 'HOST_ATTESTED',
    reasonCodes: ['E_TASK_CLAIM_STALE'],
    releasedClaims,
    currentBranch: BRANCH,
    currentHead: HEAD,
  });

  const recovery = {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    status: 'RECOVERED',
    recoveredAt: recoveryEvent.at,
    recoveryId: recoveryEvent.details.recoveryId,
    recoveryEventSeq: recoveryEvent.seq,
    classificationAtRecovery: recoveryEvent.details.classification,
    reasonCodes: recoveryEvent.details.reasonCodes,
    releasedClaims,
    previousPhase: recoveryEvent.details.previousPhase,
    previousRevision: recoveryEvent.details.previousRevision,
    repositoryFingerprint: repositoryFingerprint(),
    authority: { kind: recoveryEvent.details.authorityKind, grantRef: 'host-attestation:forgeshop-demo-lock-controller' },
  };

  const checks = [
    demoCheck({ id: 'keyboard-navigation', requirement: 'All interactive controls are reachable by keyboard', status: 'failed', evidenceKind: 'BLOCKED', kind: 'audit', source: 'audit:keyboard-navigation', timestamp: '2026-08-06T10:40:00.000Z' }),
    demoCheck({ id: 'screen-reader-labels', requirement: 'Dynamic regions expose accessible names', status: 'passed', evidenceKind: 'OBSERVED', kind: 'audit', source: 'axe scan', timestamp: '2026-08-06T10:38:00.000Z' }),
  ];
  const coverage = [
    cov('Every interactive control is reachable by keyboard', 'blocked'),
    cov('Focus order matches visual order', 'blocked'),
  ];
  const artifacts = {};
  artifacts['task.json'] = taskDescriptor(taskId, t.startAt, '2026-08-06T11:20:00.000Z', releasedClaims);
  artifacts['contract.json'] = contract(taskId, {
    objective: 'Audit and fix accessibility gaps with emphasis on keyboard navigation.',
    deliverables: ['Keyboard navigation audit report', 'Fixes for all blocking findings', 'Regression checks for focus order'],
    constraints: ['WCAG 2.1 AA targets', 'No visual regressions allowed'],
    risks: ['Focus fixes could introduce tab loops'],
    verification: ['axe scan reports no critical findings', 'Keyboard-only walkthrough completes checkout'],
    successCriteria: ['Every interactive control is reachable by keyboard', 'Focus order matches visual order'],
    stopConditions: ['A regression in screen-reader labels halts the audit'],
    unresolvedDecisions: [],
    sourceRefs: ['src/app.ts', 'src/catalog.ts'],
  });
  artifacts['routing-result.json'] = routingResult(taskId, 'diagnosis', ['accessibility', 'test'], { diagnosis: ['Failed audit requires correction before resuming'] });
  artifacts['preflight.json'] = preflight(taskId, { status: 'READY', requiredGates: ['accessibility-audit'], satisfiedGates: [] });
  artifacts['recovery.json'] = recovery;
  artifacts['work-state.json'] = workState(taskId, {
    phase: 'BLOCKED',
    previousPhase: 'VERIFYING',
    selectedGuides: ['accessibility', 'test'],
    requiredGates: ['accessibility-audit'],
    satisfiedGates: [],
    completedSteps: ['Automated axe scan', 'Manual keyboard walkthrough (partial)'],
    pendingSteps: ['Fix grid pagination focus trap', 'Re-run accessibility audit'],
    checks,
    failures: [{ id: 'keyboard-navigation-finding', description: 'Pagination next button traps focus and skips filters', severity: 'HIGH' }],
    blockers: [{ id: 'accessibility-gate', reason: 'ACCESSIBILITY_GATE_FAILED', detail: '2 keyboard navigation findings block completion' }],
    diagnosedHypothesis: 'Pagination control renders a div with a click handler instead of a button, trapping sequential focus.',
    evidenceCoverage: coverage,
    lastUpdated: '2026-08-06T11:20:00.000Z',
  });
  artifacts['continuity.json'] = continuity(taskId, 'BLOCKED', '2026-08-06T11:25:00.000Z', {
    currentFocus: { id: 'fix-focus-trap', summary: 'Replace pagination div with a real button and restore filter focus flow' },
    remainingWork: [
      { id: 'fix-focus-trap', summary: 'Replace pagination div with a real button and restore filter focus flow' },
      { id: 'rerun-audit', summary: 'Re-run keyboard walkthrough and axe scan' },
    ],
    knownIssues: [{ id: 'keyboard-navigation-finding', summary: '2 keyboard navigation findings in grid pagination' }],
    changedAreas: ['src/catalog.ts'],
    inspectFirst: ['src/catalog.ts'],
    resumeNote: 'Recovered from a stale claim lock after the harness-a → harness-b handoff; mutations stay blocked until an authorized harness performs task-resume.',
  });
  artifacts['handoffs/handoff-harness-a-to-b.json'] = handoff;
  artifacts['policy-snapshot.json'] = {
    schemaVersion: 1,
    policyDigest: fingerprint('policy:' + DEMO_PROJECT_ID),
    rules: ['accessibility-keyboard-navigation', 'testing-required-checks'],
    capturedAt: '2026-08-06T10:05:00.000Z',
  };
  artifacts['gates/accessibility-audit.json'] = gate(
    taskId,
    'accessibility-audit',
    'blocked',
    [{ kind: 'BLOCKED', source: 'audit:keyboard-navigation', result: '2 keyboard navigation findings in grid pagination' }],
    ['Correction required before the audit can be re-run'],
  );
  return { taskId, ledger, artifacts };
}

function buildPerfTask() {
  const t = TASKS.perf;
  const taskId = t.id;
  const ledger = new EventLedgerBuilder(taskId, { startAt: t.startAt });
  ledger.append('TASK_CREATED', { title: t.title });
  ledger.append('PLANNING_STARTED', { baseline: 'LCP 3.1s on the seeded catalog page' });

  const artifacts = {};
  artifacts['task.json'] = taskDescriptor(taskId, t.startAt, '2026-08-07T11:50:00.000Z', []);
  artifacts['contract.json'] = contract(taskId, {
    objective: 'Improve image loading performance so the largest contentful paint stays under 2 seconds.',
    deliverables: ['Lazy-loaded product imagery', 'Responsive image sizes', 'Performance budget check'],
    constraints: ['No layout shifts above 0.1 CLS', 'Keep bundle size neutral'],
    risks: ['Lazy loading could delay above-the-fold images'],
    verification: ['Measured LCP improves from 3.1s to at most 1.8s', 'CLS stays under 0.1'],
    successCriteria: ['LCP at most 1.8s on the seeded catalog page'],
    stopConditions: ['A CLS regression above 0.1 stops optimization work'],
    unresolvedDecisions: ['CDN choice for demo imagery'],
    sourceRefs: ['src/catalog.ts'],
  });
  artifacts['routing-result.json'] = routingResult(taskId, 'planning', ['performance', 'design'], { planning: ['Baseline measurement before optimization'] });
  artifacts['preflight.json'] = preflight(taskId, { requiredGates: ['performance-budget'], satisfiedGates: [] });
  artifacts['work-state.json'] = workState(taskId, {
    phase: 'PLANNED',
    selectedGuides: ['performance', 'design'],
    requiredGates: ['performance-budget'],
    satisfiedGates: [],
    completedSteps: ['Baseline measurement'],
    pendingSteps: ['Lazy loading', 'Responsive sizes', 'Budget verification'],
    checks: [],
    evidenceCoverage: [cov('LCP at most 1.8s on the seeded catalog page')],
    lastUpdated: '2026-08-07T11:50:00.000Z',
  });
  artifacts['continuity.json'] = continuity(taskId, 'PLANNED', '2026-08-07T11:55:00.000Z', {
    remainingWork: [{ id: 'lazy-loading', summary: 'Add lazy loading and responsive sizes to catalog imagery' }],
    knownIssues: [],
    changedAreas: [],
    inspectFirst: ['src/catalog.ts'],
    resumeNote: 'Planned; baseline LCP 3.1s recorded, target 1.8s.',
  });
  return { taskId, ledger, artifacts };
}

function buildSecurityTask() {
  const t = TASKS.security;
  const taskId = t.id;
  const ledger = new EventLedgerBuilder(taskId, { startAt: t.startAt });
  ledger.append('TASK_CREATED', { title: t.title });
  ledger.append('CONTRACT_VALIDATED', { objective: t.title });
  ledger.append('ROUTE_VALIDATED', { primary: 'review' });
  gateSatisfied(ledger, 'security-review');
  ledger.append('PREFLIGHT_READY', { requiredGates: ['security-review'] });
  ledger.append('PLAN_CREATED', { steps: ['threat model', 'dependency scan', 'flow review'] });
  ledger.append('EXECUTION_STARTED', { area: 'audit:checkout-security' });
  ledger.append('CHECK_PASSED', { check: 'security-scan', result: 'security scan: no critical findings' });
  ledger.append('CHECK_PASSED', { check: 'secret-scan', result: 'no secrets detected in checkout flow' });
  ledger.append('VERIFICATION_STARTED', { verificationCycle: 1 });
  ledger.append('REVIEW_STARTED', { verificationCycle: 1, reviewer: 'harness-b' });
  ledger.append('VERIFICATION_RECORDED', { verificationCycle: 1, outcome: 'passed' });
  ledger.append('TASK_COMPLETED', { receipt: 'execution-receipt.json' });
  ledger.append('COMPLETION_VALIDATED', { receipt: 'execution-receipt.json' });

  const checks = [
    demoCheck({ id: 'security-scan', requirement: 'Dependency and flow scan reports no critical findings', status: 'passed', evidenceKind: 'OBSERVED', source: 'node tests/security-scan.mjs', exitCode: 0, timestamp: '2026-08-07T14:40:00.000Z', executionRef: 'exec-security-scan' }),
    demoCheck({ id: 'secret-scan', requirement: 'No secrets committed in checkout flow', status: 'passed', evidenceKind: 'OBSERVED', source: 'node tests/secret-scan.mjs', exitCode: 0, timestamp: '2026-08-07T14:45:00.000Z', executionRef: 'exec-secret-scan' }),
  ];
  const coverage = [
    cov('No critical or high findings remain untriaged', 'observed'),
    cov('Security scan reports no critical findings', 'observed'),
    cov('Checkout flow reviewed against the threat model', 'observed'),
  ];
  const artifacts = {};
  artifacts['task.json'] = taskDescriptor(taskId, t.startAt, '2026-08-07T15:00:00.000Z', []);
  artifacts['contract.json'] = contract(taskId, {
    objective: 'Review the checkout flow for security weaknesses before integration ships.',
    deliverables: ['Threat model for checkout', 'Scan results with dispositions', 'Sign-off for TASK-003 integration'],
    constraints: ['Findings must map to OWASP categories', 'No real credentials anywhere in the demo'],
    risks: ['Review fatigue could miss injection paths'],
    verification: ['Security scan reports no critical findings', 'Checkout flow reviewed against the threat model'],
    successCriteria: ['No critical or high findings remain untriaged'],
    stopConditions: ['Any critical finding halts the review until triaged'],
    unresolvedDecisions: [],
    sourceRefs: ['src/checkout.ts'],
  });
  artifacts['routing-result.json'] = routingResult(taskId, 'review', ['security'], { review: ['Read-only audit with scan evidence'] });
  artifacts['preflight.json'] = preflight(taskId, { requiredGates: ['security-review'], satisfiedGates: ['security-review'] });
  artifacts['work-state.json'] = workState(taskId, {
    phase: 'COMPLETE',
    selectedGuides: ['security'],
    requiredGates: ['security-review'],
    satisfiedGates: ['security-review'],
    completedSteps: ['Threat model', 'Dependency scan', 'Flow review', 'Sign-off'],
    pendingSteps: [],
    checks,
    publicationStatus: 'committed',
    revision: 2,
    verificationCycle: 1,
    verificationEvidence: [
      { id: 'verif-security-cycle-1', summary: 'Security review sign-off recorded during verification cycle 1.', status: 'OBSERVED', timestamp: '2026-08-07T14:55:00.000Z' },
    ],
    evidenceCoverage: coverage,
    lastUpdated: '2026-08-07T15:00:00.000Z',
  });
  artifacts['continuity.json'] = continuity(taskId, 'COMPLETE', '2026-08-07T15:01:00.000Z', {
    remainingWork: [{ id: 'recheck-after-retry', summary: 'Re-run the security review once TASK-003 adds its retry policy' }],
    knownIssues: [],
    changedAreas: [],
    inspectFirst: [],
    resumeNote: 'Review complete; revisit after checkout retry policy lands.',
  });
  artifacts['execution-receipt.json'] = executionReceipt(taskId, {
    selectedGuides: ['security'],
    changedPaths: [],
    checks,
    review: { reviewer: 'harness-b', outcome: 'approved', notes: 'Checkout flow cleared for integration continuation.' },
    limitations: ['Static review only; no live payment traffic is exercised in the demo.'],
    evidence: [
      { kind: 'OBSERVED', source: 'audit:security-scan', result: 'no critical findings' },
      { kind: 'OBSERVED', source: 'audit:secret-scan', result: 'no secrets detected' },
    ],
    evidenceCoverage: coverage,
  });
  artifacts['policy-snapshot.json'] = {
    schemaVersion: 1,
    policyDigest: fingerprint('policy:' + DEMO_PROJECT_ID),
    rules: ['security-no-critical-findings', 'security-no-secrets'],
    capturedAt: '2026-08-07T14:05:00.000Z',
  };
  artifacts['gates/security-review.json'] = gate(taskId, 'security-review', 'satisfied', [{ kind: 'OBSERVED', source: 'audit:security-scan', result: 'no critical findings' }], [], 'src/checkout.ts');
  const executions = [
    executionRecord({ executionId: 'exec-security-scan', taskId, checkId: 'security-scan', requirement: 'Dependency and flow scan reports no critical findings', argv: ['node', 'tests/security-scan.mjs'], startedAt: '2026-08-07T14:38:00.000Z', finishedAt: '2026-08-07T14:40:00.000Z' }),
    executionRecord({ executionId: 'exec-secret-scan', taskId, checkId: 'secret-scan', requirement: 'No secrets committed in checkout flow', argv: ['node', 'tests/secret-scan.mjs'], startedAt: '2026-08-07T14:43:00.000Z', finishedAt: '2026-08-07T14:45:00.000Z' }),
  ].map((record) => [`executions/${record.executionId}.json`, record]);
  return { taskId, ledger, artifacts, executions };
}

function buildAbandonedTask() {
  const t = TASKS.abandoned;
  const taskId = t.id;
  const releasedClaims = ['worker-implementer-3'];
  const ledger = new EventLedgerBuilder(taskId, { startAt: t.startAt });
  ledger.append('TASK_CREATED', { title: t.title });
  ledger.append('CONTRACT_VALIDATED', { objective: t.title });
  ledger.append('ROUTE_VALIDATED', { primary: 'research' });
  ledger.append('PLAN_CREATED', { steps: ['measure hydration cost', 'prototype streaming render'] });
  // Canonical ForgeLoop task-abandon boundary: the caller explicitly abandoned
  // the task. This is not completion, not publication, and not evidence; the
  // ledger records the exact abandonment details and releases claims.
  const abandoned = ledger.append('TASK_ABANDONED', {
    recoveryId: 'recovery-ssr-exploration-abandoned',
    classification: 'ABANDONED',
    reasonCodes: ['CALLER_ABANDONED'],
    previousPhase: 'PLANNED',
    previousRevision: 1,
    previousHead: HEAD,
    previousBranch: BRANCH,
    currentHead: HEAD,
    currentBranch: BRANCH,
    releasedClaims,
    authorityKind: 'CALLER_ACKNOWLEDGED',
  });

  const coverage = [
    cov('Streaming render removes the hydration cliff on the catalog route'),
    cov('No layout shift above 0.1 CLS after the migration'),
  ];
  const artifacts = {};
  artifacts['task.json'] = taskDescriptor(taskId, t.startAt, '2026-08-08T09:40:00.000Z', releasedClaims);
  artifacts['contract.json'] = contract(taskId, {
    objective: 'Explore a server-side rendering migration for the storefront without shipping a partial cutover.',
    deliverables: ['Rendering cost baseline', 'Prototype streaming render', 'Rollout and rollback plan'],
    constraints: ['No breaking changes to existing client routes', 'Must preserve current SEO metadata'],
    risks: ['Streaming could complicate the cart hydration boundary'],
    verification: ['Prototype keeps LCP under 2 seconds', 'Cart hydration remains functional'],
    successCriteria: ['A measured decision on whether to adopt server-side rendering'],
    stopConditions: ['Abort the exploration if hydration cost cannot be reduced measurably'],
    unresolvedDecisions: ['Renderer vendor choice'],
    sourceRefs: ['src/app.ts'],
  });
  artifacts['routing-result.json'] = routingResult(taskId, 'planning', ['design', 'performance'], { planning: ['Read-only exploration before any cutover decision'] });
  artifacts['preflight.json'] = preflight(taskId, { requiredGates: ['unit-tests'], satisfiedGates: [] });
  artifacts['recovery.json'] = {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId,
    status: 'RECOVERED',
    recoveredAt: abandoned.at,
    recoveryId: abandoned.details.recoveryId,
    recoveryEventSeq: abandoned.seq,
    classificationAtRecovery: abandoned.details.classification,
    reasonCodes: abandoned.details.reasonCodes,
    releasedClaims,
    previousPhase: abandoned.details.previousPhase,
    previousRevision: abandoned.details.previousRevision,
    repositoryFingerprint: repositoryFingerprint(),
    authority: { kind: abandoned.details.authorityKind },
  };
  artifacts['work-state.json'] = workState(taskId, {
    phase: 'PLANNED',
    previousPhase: 'ROUTED',
    selectedGuides: ['design', 'performance'],
    requiredGates: ['unit-tests'],
    satisfiedGates: [],
    completedSteps: ['Hydration cost baseline'],
    pendingSteps: ['Prototype streaming render', 'Rollout decision'],
    checks: [],
    evidenceCoverage: coverage,
    revision: 1,
    lastUpdated: '2026-08-08T09:40:00.000Z',
  });
  artifacts['continuity.json'] = continuity(taskId, 'PLANNED', '2026-08-08T09:45:00.000Z', {
    remainingWork: [{ id: 'ssr-prototype', summary: 'Prototype the streaming render before revisiting the decision' }],
    knownIssues: [],
    changedAreas: [],
    inspectFirst: ['src/app.ts'],
    resumeNote: 'Abandoned by the caller: keep the baseline, do not resume without an explicit new task.',
  });
  return { taskId, ledger, artifacts };
}

function buildRevisionTask() {
  const t = TASKS.revision;
  const taskId = t.id;
  const revisedHead = 'b7c4e0d92a1f5b3c8e6d0a24f91b7c3d5e8f0a12';
  const coverage = [
    cov('Checkout tests pass against the revised contract'),
    cov('Idempotency key is verified in tests'),
  ];

  // The pre-revision contract identity is the fingerprint of the contract that
  // ForgeLoop validated before the revision, exactly like a real ledger.
  const originalContract = contract(taskId, {
    objective: 'Improve checkout error mapping and retry behaviour.',
    deliverables: ['Error mapping', 'Retry policy'],
    constraints: ['No contract change after execution starts'],
    risks: ['Retries can duplicate orders without an idempotency key'],
    verification: ['Checkout tests pass'],
    successCriteria: ['Retry policy is covered by tests'],
    stopConditions: ['Any execution start freezes the contract'],
    unresolvedDecisions: [],
    sourceRefs: ['src/checkout.ts'],
  });
  const previousContractFingerprint = canonicalFingerprint(originalContract);
  const revisedContract = contract(taskId, {
    objective: 'Rework the checkout contract so the retry policy and idempotency key are part of the agreed scope.',
    deliverables: ['Revised checkout contract', 'Idempotency key requirement', 'Revised verification plan'],
    constraints: ['Revision must stay pre-execution', 'No client code changes in this task'],
    risks: ['Downstream planning artifacts are invalidated by the revision'],
    verification: ['Checkout tests pass against the revised contract', 'Idempotency key is verified in tests'],
    successCriteria: ['Revised contract is routed with fresh plan and preflight evidence'],
    stopConditions: ['Any execution-start before the revision blocks the task'],
    unresolvedDecisions: [],
    sourceRefs: ['src/checkout.ts'],
  });
  const revisedContractFingerprint = canonicalFingerprint(revisedContract);
  const revisedRoute = routingResult(taskId, 'implementation', ['typescript', 'test'], { implementation: ['Revised scope needs a fresh route and plan'] });
  revisedRoute.contractFingerprint = revisedContractFingerprint;
  const routeFingerprint = canonicalFingerprint(revisedRoute);
  const finalWorkState = workState(taskId, {
    phase: 'ROUTED',
    selectedGuides: ['typescript', 'test'],
    requiredGates: ['unit-tests'],
    satisfiedGates: [],
    completedSteps: ['Retry policy decision', 'Revised checkout contract'],
    pendingSteps: ['Implement revised checkout client', 'Re-run checkout tests'],
    checks: [],
    evidenceCoverage: coverage,
    revision: 2,
    lastUpdated: '2026-08-08T14:05:00.000Z',
    routeFingerprint,
  });
  // The revalidated checkpoint binds the current work-state, exactly like
  // ForgeLoop's own checkpoint-revalidate command.
  finalWorkState.contractFingerprint = revisedContractFingerprint;
  finalWorkState.repositoryFingerprint = { branch: BRANCH, head: revisedHead };
  const revalidatedStateFingerprint = canonicalFingerprint(finalWorkState);

  const ledger = new EventLedgerBuilder(taskId, { startAt: t.startAt });
  ledger.append('TASK_CREATED', { title: t.title });
  ledger.append('CONTRACT_VALIDATED', { objective: 'Improve checkout error mapping and retry behaviour.' }, previousContractFingerprint);
  ledger.append('ROUTE_VALIDATED', { primary: 'implementation' }, routeFingerprint);
  ledger.append('PLAN_CREATED', { steps: ['idempotency key', 'retry policy client'] });
  // Canonical pre-execution contract revision: the revision event carries the
  // PLANNED -> ROUTED rewind proof and invalidates dependent artifacts.
  ledger.append('CONTRACT_REVISED', {
    previousContractFingerprint,
    contractFingerprint: revisedContractFingerprint,
    previousPhase: 'PLANNED',
    phase: 'ROUTED',
    previousStateRevision: 0,
    revisedStateRevision: 1,
    previousStateFingerprint: fingerprint(`work-state:${taskId}:pre-revision`),
    revisedStateFingerprint: fingerprint(`work-state:${taskId}:post-revision`),
    previousRouteFingerprint: routeFingerprint,
  });
  ledger.append('TRANSACTION_COMMITTED', { transactionId: 'txn-revise-checkout-contract', operation: 'contract-revise' });
  // Canonical checkpoint revalidation for safe repository-only drift. It
  // refreshes the checkpoint; it is not new execution and not completion.
  ledger.append('CHECKPOINT_REVALIDATED', {
    phase: 'ROUTED',
    previousRepositoryFingerprint: { branch: BRANCH, head: HEAD },
    repositoryFingerprint: { branch: BRANCH, head: revisedHead },
    contractFingerprint: revisedContractFingerprint,
    routeFingerprint,
    previousStateRevision: 1,
    revalidatedStateRevision: 2,
    previousStateFingerprint: fingerprint(`work-state:${taskId}:post-revision`),
    revalidatedStateFingerprint,
  });
  ledger.append('TRANSACTION_COMMITTED', { transactionId: 'txn-revalidate-checkout-checkpoint', operation: 'checkpoint-revalidate' });

  const artifacts = {};
  artifacts['task.json'] = taskDescriptor(taskId, t.startAt, '2026-08-08T14:05:00.000Z', []);
  artifacts['contract.json'] = revisedContract;
  artifacts['routing-result.json'] = revisedRoute;
  const revisionPreflight = preflight(taskId, { requiredGates: ['unit-tests'], satisfiedGates: [] });
  revisionPreflight.contract.fingerprint = revisedContractFingerprint;
  artifacts['preflight.json'] = revisionPreflight;
  artifacts['work-state.json'] = finalWorkState;
  artifacts['continuity.json'] = continuity(taskId, 'ROUTED', '2026-08-08T14:10:00.000Z', {
    remainingWork: [{ id: 'checkout-client', summary: 'Implement the revised checkout client against the revised contract' }],
    knownIssues: [],
    changedAreas: [],
    inspectFirst: ['src/checkout.ts'],
    resumeNote: 'Contract revised and checkpoint revalidated; earlier plan artifacts were invalidated by the revision.',
  });
  artifacts['continuity.json'].contractFingerprint = revisedContractFingerprint;
  artifacts['continuity.json'].repositoryFingerprint = { branch: BRANCH, head: revisedHead };
  return { taskId, ledger, artifacts };
}

function buildPolicyFiles() {
  const rules = {
    schemaVersion: 1,
    rules: [
      {
        id: 'security-no-critical-findings',
        severity: 'HIGH',
        source: 'project',
        blocking: true,
        why: 'Critical security findings must never ship in the checkout flow.',
        fix: 'Triage and fix every critical finding, then re-run the security scan.',
        confidence: 'HIGH',
        scope: { includes: ['src/checkout.ts'], excludes: [] },
        check: { type: 'command', command: ['node', 'tests/security-scan.mjs'], threshold: 0 },
      },
      {
        id: 'security-no-secrets',
        severity: 'HIGH',
        source: 'project',
        blocking: true,
        why: 'Secrets in source control are irreversible exposure.',
        fix: 'Remove the secret, rotate it, and add a scanning guard.',
        confidence: 'HIGH',
        scope: { includes: ['src/**', 'tests/**'], excludes: [] },
        check: { type: 'command', command: ['node', 'tests/secret-scan.mjs'] },
      },
      {
        id: 'accessibility-keyboard-navigation',
        severity: 'HIGH',
        source: 'project',
        blocking: true,
        why: 'Keyboard users must reach every interactive control.',
        fix: 'Use native focusable elements and verify tab order in the walkthrough.',
        confidence: 'MEDIUM',
        scope: { includes: ['src/**'], excludes: [] },
        check: { type: 'audit', adapter: 'axe', parameters: { standard: 'WCAG 2.1 AA' } },
      },
      {
        id: 'testing-required-checks',
        severity: 'HIGH',
        source: 'project',
        blocking: true,
        why: 'Unit and integration tests are the executable specification.',
        fix: 'Add or repair the failing tests before requesting review.',
        confidence: 'HIGH',
        scope: { includes: ['tests/**'], excludes: [] },
        check: { type: 'command', command: ['npm', 'test'] },
      },
      {
        id: 'performance-lcp-budget',
        severity: 'MEDIUM',
        source: 'project',
        blocking: false,
        why: 'Perceived performance is part of the premium positioning.',
        fix: 'Optimize loading until LCP is at most 1.8 seconds.',
        confidence: 'MEDIUM',
        scope: { includes: ['src/catalog.ts'], excludes: [] },
        check: { type: 'metric', adapter: 'lighthouse', threshold: 1800 },
      },
      {
        id: 'clean-code-no-dead-code',
        severity: 'LOW',
        source: 'project',
        blocking: false,
        why: 'Dead code obscures intent for future tasks.',
        fix: 'Delete unused exports during touch-and-improve passes.',
        confidence: 'LOW',
        scope: { includes: ['src/**'], excludes: [] },
        check: { type: 'lint', adapter: 'eslint' },
      },
      {
        id: 'design-consistent-tokens',
        severity: 'INFO',
        source: 'project',
        blocking: false,
        why: 'Consistent design tokens keep the storefront premium.',
        fix: 'Prefer shared tokens over ad-hoc colors and spacing.',
        confidence: 'LOW',
        scope: { includes: ['src/**'], excludes: [] },
        check: { type: 'review', parameters: { checklist: 'design-tokens' } },
      },
    ],
  };
  const discovery = {
    schemaVersion: 1,
    languages: ['typescript'],
    testing: { detected: true, framework: 'vitest', command: ['npx', 'vitest', 'run'], confidence: 'HIGH' },
    linting: { detected: true, tool: 'eslint', command: ['npx', 'eslint', '.'], confidence: 'HIGH' },
    architecture: { value: 'feature-modules', confidence: 'MEDIUM', enforcement: 'ADVISORY' },
    discoveredRules: [
      { id: 'clean-code-no-dead-code', origin: 'eslint config inspection' },
      { id: 'design-consistent-tokens', origin: 'design token inventory review' },
    ],
  };
  const baseline = {
    schemaVersion: 1,
    createdAt: '2026-08-01T09:00:00.000Z',
    entries: [
      {
        ruleId: 'performance-lcp-budget',
        fingerprints: [fingerprint('baseline:lcp-3.1s')],
        details: [{ note: 'Baseline captured before optimization work started.' }],
      },
    ],
  };
  const rulesText = serializeJson(rules);
  const baselineText = serializeJson(baseline);
  const lock = {
    schemaVersion: 1,
    algorithm: 'sha256',
    digest: sha256FileBytes(rulesText + baselineText),
    rulesDigest: sha256FileBytes(rulesText),
    baselineDigest: sha256FileBytes(baselineText),
    capturedAt: '2026-08-01T09:00:00.000Z',
  };
  const capabilities = {
    schemaVersion: 1,
    defaultDecision: 'DENY',
    rules: [
      { capability: 'filesystem.read', decision: 'ALLOW' },
      { capability: 'filesystem.write', decision: 'REQUIRE_APPROVAL' },
      { capability: 'process.execute', decision: 'REQUIRE_AUTHORITY' },
      { capability: 'external.publish', decision: 'DENY' },
    ],
  };
  return { rules, discovery, baseline, lock, capabilities };
}

export function buildForgeShopProject() {
  const files = new Map();

  function put(relativePath, value, artifactName) {
    if (artifactName) assertSchemaValid(artifactName, value);
    files.set(relativePath, typeof value === 'string' ? value : serializeJson(value));
  }

  put('.forgeloop/config.json', {
    schemaVersion: 1,
    protocolVersion: 1,
    complianceMode: 'standard',
    requiredGates: ['unit-tests', 'typecheck', 'lint'],
    requiredEvidence: ['OBSERVED'],
    verification: {
      checkers: [{
        checkId: 'unit-tests',
        scopeMode: 'PATH_ARGUMENTS',
        argvPrefix: ['npx', 'vitest', 'run'],
        pathInsertion: 'APPEND',
      }],
    },
    attestation: {
      mode: 'off',
      revisionProvider: 'git',
      requireCompleteCoverage: false,
      coverage: { exclude: ['.forgeloop/**'] },
      signing: {
        provider: 'none',
        required: false,
        policy: { identities: [], requireTransparencyLog: false },
      },
    },
  }, 'config.json');

  put('.forgeloop/sources.json', {
    schemaVersion: 1,
    protocolVersion: 1,
    sources: {
      [`user-request-${DEMO_PROJECT_ID}`]: { kind: 'user-request', summary: 'Build ForgeShop, a small premium e-commerce web application, through ForgeLoop.' },
      'repository-fact-stack': { kind: 'repository-fact', summary: 'TypeScript sources under src/ with vitest tests under tests/.', path: 'package.json' },
      'observation-catalog-lcp': { kind: 'observation', summary: 'Seeded catalog page measured LCP 3.1s before optimization.' },
      'agent-decision-task-order': { kind: 'agent-decision', summary: 'Security review of checkout runs before checkout integration completes.' },
    },
  }, 'sources.json');

  put('.forgeloop/sessions/session-harness-a.json', {
    schemaVersion: 1,
    protocolVersion: 1,
    sessionId: 'session-harness-a',
    activationMarker: `${DEMO_PROJECT_ID}:harness-a:2026-08-06`,
    createdAt: '2026-08-06T10:05:00.000Z',
  }, 'session.json');
  put('.forgeloop/sessions/session-harness-b.json', {
    schemaVersion: 1,
    protocolVersion: 1,
    sessionId: 'session-harness-b',
    activationMarker: `${DEMO_PROJECT_ID}:harness-b:2026-08-06`,
    createdAt: '2026-08-06T11:22:00.000Z',
  }, 'session.json');

  const policy = buildPolicyFiles();
  put('.forgeloop/policy/rules.json', policy.rules, 'policy/rules.json');
  put('.forgeloop/policy/discovery.json', policy.discovery, 'policy/discovery.json');
  put('.forgeloop/policy/baseline.json', policy.baseline, 'policy/baseline.json');
  put('.forgeloop/policy/policy.lock', policy.lock, 'policy/policy.lock');
  put('.forgeloop/policy/capabilities.json', policy.capabilities, 'policy/capabilities.json');

  const builders = [buildCatalogTask, buildCartTask, buildCheckoutTask, buildA11yTask, buildPerfTask, buildSecurityTask, buildAbandonedTask, buildRevisionTask];
  let eventCount = 0;
  for (const build of builders) {
    const { taskId, ledger, artifacts: rawArtifacts, executions = [] } = build();
    const artifacts = finalizeAttestationArtifacts(finalizeTaskArtifacts(rawArtifacts, ledger), ledger);
    const key = taskKeyFor(taskId);
    for (const [name, value] of Object.entries(artifacts)) {
      const artifactName = name === 'events.ndjson'
        ? 'event'
        : name.startsWith('gates/')
          ? 'gate.json'
          : name.startsWith('actions/')
            ? 'action.json'
            : name.startsWith('approvals/')
              ? 'approval.json'
              : name.startsWith('evaluations/')
                ? 'trajectory-evaluation.json'
                : name.startsWith('handoffs/')
                  ? 'handoff.json'
                : name === 'attestations/code-manifest.json'
                  ? 'code-manifest.json'
                : name === 'attestations/statement.json'
                  ? 'attestation-statement.json'
          : name;
      put(`.forgeloop/task-state/${key}/${name}`, value, artifactName);
    }
    for (const [relativePath, record] of executions) {
      put(`.forgeloop/task-state/${key}/${relativePath}`, record, 'execution.json');
    }
    for (const event of ledger.events) assertSchemaValid('event', event);
    eventCount += ledger.events.length;
    put(`.forgeloop/task-state/${key}/events.ndjson`, ledger.serialize());
  }

  return { files, eventCount };
}
