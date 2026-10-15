import type {
  AuditDiff,
  AuditExportOptions,
  AuditExportResult,
  AuditFinding,
  AuditFindingFilter,
  AuditSnapshotMetadata,
  ProjectAuditSnapshot,
  StructuralQualityAuditView,
  TaskAuditSnapshot,
} from './audit';
import type { AuditRuntimeDiagnostics } from './diagnostics';

export type ForgeLoopPhase =
  | 'RECEIVED'
  | 'DISCOVERING'
  | 'CONTRACT_READY'
  | 'ROUTED'
  | 'DESIGNING'
  | 'PLANNED'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'DIAGNOSING'
  | 'CORRECTING'
  | 'REVIEWING'
  | 'COMPLETE'
  | 'BLOCKED';

export const FORGELOOP_PHASES: ForgeLoopPhase[] = [
  'RECEIVED',
  'DISCOVERING',
  'CONTRACT_READY',
  'ROUTED',
  'DESIGNING',
  'PLANNED',
  'EXECUTING',
  'VERIFYING',
  'DIAGNOSING',
  'CORRECTING',
  'REVIEWING',
  'COMPLETE',
  'BLOCKED',
];

export const PHASE_ORDER: Record<ForgeLoopPhase, number> = {
  RECEIVED: 0,
  DISCOVERING: 1,
  CONTRACT_READY: 2,
  ROUTED: 3,
  DESIGNING: 4,
  PLANNED: 5,
  EXECUTING: 6,
  VERIFYING: 7,
  DIAGNOSING: 8,
  CORRECTING: 9,
  REVIEWING: 10,
  COMPLETE: 11,
  BLOCKED: 99,
};

export type PhaseState = 'completed' | 'current' | 'pending' | 'blocked' | 'failed';

export type ProjectKind = 'PROJECT' | 'DEMO';

export type ForgeLoopCompatibilityMode =
  | 'INTEGRATION_V1'
  | 'ARTIFACT_ONLY'
  | 'INCOMPATIBLE';

export interface ProjectDetectionResult {
  projectRoot: string;
  forgeLoopRoot: string;
  protocolVersion: number;
  schemaVersion: number;
  forgeLoopVersion?: string;
  compatible: boolean;
  warnings: string[];
  projectKind: ProjectKind;
  compatibilityMode?: ForgeLoopCompatibilityMode;
}

export interface ProjectSummary {
  name: string;
  rootPath: string;
  branch?: string;
  head?: string;
}

export interface ProtocolSummary {
  protocolVersion: number;
  schemaVersion: number;
  packageVersion?: string;
  compatible: boolean;
  compatibilitySource?: 'PROTOCOL_INFO' | 'ARTIFACT_ONLY';
  compatibilityMode?: ForgeLoopCompatibilityMode;
  featureSupport?: ForgeLoopFeatureSupport;
}

export interface ForgeLoopFeatureSupport {
  canonicalOwnership: boolean;
  observability: boolean;
  structuredDiagnostics: boolean;
  durableActions: boolean;
  approvals: boolean;
  capabilityPolicy: boolean;
  trajectoryMetrics: boolean;
  trajectoryEvaluations: boolean;
  verificationExecutionIsolation: boolean;
  workspaceBinding: boolean;
  canonicalHandoffs: boolean;
  responsibilityConstraints: boolean;
  differentialVerificationScope: boolean;
  codeAttestation: boolean;
  advisoryContextProviders: boolean;
  adaptiveExecutionProfiles?: boolean;
  executionProfileContext?: boolean;
  contextUsageObservability?: boolean;
  structuralQuality?: boolean;
  repositoryIndex?: boolean;
  /** Bounded, read-only Audit UX read model (`task/audit-view`) is advertised. */
  auditUx?: boolean;
  /** Provider-neutral providerExtensions v1 advertisement (observation metadata only). */
  providerExtensions?: boolean;
}

/** One bounded timeline entry from the canonical Audit UX read model. */
export interface AuditUxTimelineItemView {
  id: string;
  sequence: number;
  timestamp: string | null;
  timestampQuality: 'authoritative' | 'unknown';
  kind: string;
  phase: string | null;
  status: string | null;
  title: string;
  summary: string;
  category: string;
}

/**
 * Presentation projection of the canonical, bounded `task/audit-view` read
 * model. Every field is read-only canonical context; nothing here carries
 * lifecycle, evidence, ownership, completion, or mutation authority.
 */
export interface TaskAuditViewProjection {
  available: boolean;
  authority: 'CANONICAL_READ_ONLY' | 'UNAVAILABLE';
  reason?: string;
  schemaVersion?: number;
  auditStatus?: string;
  phase?: string | null;
  status?: string | null;
  nextAction?: string | null;
  terminal?: boolean;
  completion?: { state: string; valid: boolean };
  ownership?: { claimState: string | null; mutationAllowed: boolean; ownershipValid: boolean };
  verification?: { checkCount: number; totalAttempts: number; failedAttempts: number };
  integrity?: { valid: boolean; reasonCodes: string[] };
  timeline?: { totalAvailable: number; truncated: boolean; items: AuditUxTimelineItemView[] };
}

export type RepositoryIndexHealth =
  | 'READY'
  | 'INDEXING'
  | 'NOT_INITIALIZED'
  | 'ENGINE_MISSING'
  | 'ENGINE_INVALID'
  | 'SERVER_DOWN'
  | 'SERVER_UNHEALTHY'
  | 'ERROR'
  | 'UNAVAILABLE';

export interface RepositoryIndexProjection {
  schemaVersion: 1 | null;
  available: boolean;
  source: 'FORGELOOP_INTEGRATION' | 'UNAVAILABLE';
  required: boolean | null;
  engine: string | null;
  engineVersion: string | null;
  managedBinary: boolean | null;
  overridden: boolean | null;
  index: {
    present: boolean | null;
    complete: boolean | null;
    files: number | null;
    trigrams: number | null;
    createdAt: number | null;
    updatedAt: number | null;
  };
  policy: {
    maxFileSize: string | number | null;
    maxCpuPercent: number | null;
    watcherQueueCap: number | null;
    autoSaveMutations: number | null;
  };
  server: {
    running: boolean | null;
    owned: boolean | null;
    pid: number | null;
    port: number | null;
    watcher: string | null;
    indexing: string | null;
    files: number | null;
  };
  health: RepositoryIndexHealth;
  diagnostics: Array<{ code: string; message: string }>;
  message?: string;
}

export interface RepositorySearchRequest {
  pattern: string;
  globs?: string[];
  types?: string[];
  fixedStrings?: boolean;
  ignoreCase?: boolean;
  smartCase?: boolean;
  wordRegexp?: boolean;
  context?: number | null;
  beforeContext?: number | null;
  afterContext?: number | null;
  maxCount?: number | null;
  filesWithMatches?: boolean;
  stats?: boolean;
}

export interface RepositorySearchMatch {
  path: string;
  line: number;
  column: number | null;
  offset: number | null;
  text: string;
  submatches: Array<{ start: number; end: number; match: string | null }>;
}

export interface RepositorySearchResult {
  available: boolean;
  source: 'FORGELOOP_INTEGRATION' | 'UNAVAILABLE';
  query: RepositorySearchRequest & { globs: string[]; types: string[] };
  repositoryIndex: { engine: string; engineVersion: string | null; indexed: boolean; server: boolean } | null;
  matches: RepositorySearchMatch[];
  contexts: RepositorySearchMatch[];
  files: string[];
  stats: Record<string, number>;
  metrics: {
    queryDurationMs: number | null;
    nativeDurationMs: number | null;
    matchCount: number;
    matchedFileCount: number;
    engine: string | null;
    engineVersion: string | null;
    serverUsed: boolean | null;
    exitCode: number | null;
    ignoredNativeEvents: number | null;
    bytesSearched?: number;
    matchedLines?: number;
  } | null;
  trust: 'DISCOVERY_ONLY';
  message?: string;
}

export type ExecutionProfileName = 'light' | 'balanced' | 'full';
export type ExecutionProfileRequest = 'auto' | ExecutionProfileName;
export type ExecutionProfileContextStatus = 'CANONICAL' | 'COMPATIBILITY_FALLBACK' | 'UNAVAILABLE';

export interface ExecutionProfileProjectionView {
  requested: ExecutionProfileRequest | null;
  floor: ExecutionProfileName | null;
  resolved: ExecutionProfileName | null;
  reasons: string[];
  escalated: boolean | null;
}

export interface ContextPolicyView {
  contextDepth: string;
  output: string;
  planDepth: string;
  guideStrategy: string;
  verificationStrategy: string;
  optionalArtifacts: string;
  requiredSections: string[];
  excludedContext: string[];
  allowedOptionalContext: string[];
}

export interface ContextUsageView {
  source: 'PROVIDER_REPORTED' | 'HOST_REPORTED' | 'ACTOR_REPORTED' | 'UNKNOWN';
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  model: string | null;
  provider: string | null;
}

export interface ExecutionProfileContextView {
  available: boolean;
  source: 'FORGELOOP_INTEGRATION' | 'COMPATIBILITY_FALLBACK' | 'UNAVAILABLE';
  status: ExecutionProfileContextStatus;
  taskId: string | null;
  executionProfile: ExecutionProfileProjectionView;
  contextPolicy: ContextPolicyView | null;
  objective: string | null;
  deliverables: string[];
  constraints: string[];
  selectedGuideIds: string[];
  verificationRequirements: Array<{ id: string | null; text: string | null; type: string | null }>;
  optionalContext: { available: string[]; loaded: string[] };
  invariants: Record<string, boolean> | null;
  usage: ContextUsageView | null;
  error: CanonicalProjectionError | null;
}

export interface BlockerSummary {
  id: string;
  message: string;
  phase?: ForgeLoopPhase;
}

export interface FailureSummary {
  id: string;
  message: string;
  phase?: ForgeLoopPhase;
  verificationCycle?: number;
}

export interface CheckSummary {
  id: string;
  requirement: string;
  status: 'passed' | 'failed' | 'blocked' | 'not-run';
  evidenceKind: EvidenceKind;
  verificationCycle?: number;
  timestamp?: string;
}

export interface GateSummary {
  id: string;
  name: string;
  status: 'satisfied' | 'unverified' | 'blocked';
  requiredBy?: string[];
  decisions?: string[];
  unknowns?: string[];
  approvedAssumptions?: string[];
  artifacts?: Array<{ path: string; sha256: string }>;
  evidence?: Array<Record<string, unknown>>;
}

export type EvidenceKind = 'OBSERVED' | 'INFERRED' | 'NOT_VERIFIED' | 'BLOCKED' | 'HYPOTHESIS';

export interface EvidenceCoverageSummary {
  total: number;
  covered: number;
  partial: number;
  notVerified: number;
  blocked: number;
  coveragePercent: number;
}

export interface NextActionSummary {
  type: 'progress' | 'recovery' | 'blocker' | 'inconsistency' | 'terminal';
  action: string;
  currentPhase?: ForgeLoopPhase;
  terminal?: boolean;
  reasonCodes?: string[];
  reasons?: Array<{ code: string; message: string; artifacts?: string[]; resolution?: unknown }>;
  missingArtifacts?: string[];
  commandSynopses?: string[];
  expectedPhase?: ForgeLoopPhase;
  details?: string;
}

export interface ContinuitySummary {
  taskId?: string;
  phase?: string;
  updatedAt?: string;
  currentFocus?: unknown;
  remainingWork?: ContinuityWorkItem[];
  knownIssues?: ContinuityWorkItem[];
  changedAreas?: string[];
  inspectFirst?: string[];
  resumeNote?: string;
  repositoryFingerprint?: unknown;
  verificationCycle?: number;
  diagnosticContext?: DiagnosticContextSummary;
  /** @deprecated Canonical continuity no longer exposes harness/session fields. */
  previousHarness?: never;
  previousSession?: never;
  currentHarness?: never;
  currentSession?: never;
  lastCompletedWork?: never;
  nextIntendedStep?: never;
  knownBlockers?: never;
  reconciliationRequired?: never;
}

export interface DiagnosticContextSummary {
  present: boolean;
  activeFailureSignatures: string[];
  activeFailedRequirements: string[];
  openHypotheses: string[];
  latestIntervention: string | null;
  nextExperiment: string | null;
  doNotRepeat: Array<{ id?: string; summary: string; reason?: string }>;
}

export type CanonicalProjectionSource = 'FORGELOOP_INTEGRATION' | 'UNAVAILABLE';

export interface CanonicalProjectionError {
  code: string;
  message: string;
  next?: string;
}

export type ContinuityLintStatus = 'PASS' | 'WARN';

export interface ContinuityLintFindingView {
  code: string;
  severity: 'INFO' | 'WARN' | 'UNKNOWN';
  field: string | null;
  itemId: string | null;
}

export interface ContinuityLintView {
  available: boolean;
  source: CanonicalProjectionSource;
  classification: string | null;
  status: ContinuityLintStatus | null;
  findings: ContinuityLintFindingView[];
  reasonCodes: string[];
  authority: 'OPERATIONAL_CONTEXT_ONLY';
  evidenceAuthority: 'NONE';
  error: CanonicalProjectionError | null;
}

export type WorkspaceBindingStatus =
  | 'UNBOUND'
  | 'MATCH'
  | 'MISMATCH'
  | 'INVALID'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

export interface WorkspaceBindingView {
  available: boolean;
  source: CanonicalProjectionSource;
  status: WorkspaceBindingStatus;
  taskId: string | null;
  path: string | null;
  bindingFingerprint: string | null;
  mode: string | null;
  branchAtBind: string | null;
  headAtBind: string | null;
  error: CanonicalProjectionError | null;
}

export type HandoffAcceptanceStatus = 'OPEN' | 'ACCEPTED' | 'UNBOUND' | 'INCONSISTENT' | 'UNKNOWN';

export interface HandoffAcceptanceView {
  status: HandoffAcceptanceStatus;
  consumerId: string | null;
  harness: string | null;
  acceptedAt: string | null;
  reasonCodes: string[];
}

export interface CanonicalHandoffView {
  handoffId: string | null;
  taskId: string | null;
  phase: string | null;
  revision: number | null;
  verificationCycle: number | null;
  createdAt: string | null;
  digest: string | null;
  recipientHint: string | null;
  note: string | null;
  intent: Record<string, unknown> | null;
  state: Record<string, unknown> | null;
  evidence: Record<string, unknown> | null;
  continuity: Record<string, unknown> | null;
  acceptance: HandoffAcceptanceView | null;
}

export interface TaskHandoffsView {
  available: boolean;
  source: CanonicalProjectionSource;
  count: number | null;
  handoffs: CanonicalHandoffView[];
  error: CanonicalProjectionError | null;
}

export type ResponsibilityStatus = 'NOT_APPLICABLE' | 'VALID' | 'INVALID' | 'UNKNOWN';

export interface ResponsibilityView {
  available: boolean;
  source: CanonicalProjectionSource;
  status: ResponsibilityStatus;
  label: string | null;
  allowedPaths: string[];
  readOnlyPaths: string[];
  requiredCheckIds: string[];
  frozenInputs: { contract: boolean; route: boolean; claims: boolean } | null;
  changedPaths: string[];
  fingerprint: string | null;
  errors: CanonicalProjectionError[];
}

export type VerificationScopeRequestedMode = 'AUTO' | 'CHANGED' | 'CLAIMED' | 'FULL' | 'UNKNOWN';
export type VerificationScopeResolvedMode = 'CHANGED' | 'CLAIMED' | 'FULL' | 'UNRESOLVED' | 'UNKNOWN';

export interface VerificationScopeView {
  available: boolean;
  source: CanonicalProjectionSource;
  requestedMode: VerificationScopeRequestedMode;
  resolvedMode: VerificationScopeResolvedMode;
  verificationCycle: number | null;
  changedPaths: string[];
  claimedPaths: string[];
  selectedPaths: string[];
  reasons: string[];
  fallback: Record<string, unknown> | null;
  fingerprint: string | null;
  checkerCapabilityFingerprint: string | null;
  createdAt: string | null;
  error: CanonicalProjectionError | null;
}

export type AttestationStatus = 'DISABLED' | 'MISSING' | 'VALID' | 'INVALID' | 'UNKNOWN';
export type AttestationTrustLevel = 'PROCESSED' | 'VERIFIED' | 'ATTESTED' | 'UNKNOWN';

export type AttestationReadPolicyReason =
  | 'DISABLED'
  | 'NO_EXTERNAL_SIGNING_PROVIDER'
  | 'EXTERNAL_SIGNING_PROVIDER'
  | 'UNKNOWN_PROVIDER'
  | 'CONFIG_UNAVAILABLE';

export interface AttestationReadPolicy {
  automaticCanonicalReadAllowed: boolean;
  reason: AttestationReadPolicyReason;
  signingProvider: string | null;
  signingRequired: boolean | null;
}

export interface TaskAttestationView {
  available: boolean;
  source: CanonicalProjectionSource;
  status: AttestationStatus;
  level: AttestationTrustLevel;
  content: string | null;
  receipt: string | null;
  ledger: string | null;
  signature: string | null;
  signer: Record<string, unknown> | null;
  files: number | null;
  subject: string | null;
  errors: CanonicalProjectionError[];
  readPolicy?: AttestationReadPolicy;
}

export interface TaskBoundariesView {
  workspace: WorkspaceBindingView;
  responsibility: ResponsibilityView;
  handoffs: TaskHandoffsView;
  verificationScope: VerificationScopeView;
  attestation: TaskAttestationView;
}

export interface CanonicalProjectionView<T = Record<string, unknown>> {
  available: boolean;
  source: CanonicalProjectionSource;
  feature: string;
  data: T | null;
  result: T | null;
  exitCode: number | null;
  error: CanonicalProjectionError | null;
}

export interface CanonicalTaskProjectionViewModel {
  id: string | null;
  phase: string | null;
  status: string | null;
  revision: number | null;
  verificationCycle: number | null;
  present: boolean;
}

export interface CanonicalHistorySummaryViewModel {
  eventCount: number | null;
  totalEventCount: number | null;
  checkAttemptCount: number | null;
  failedAttemptCount: number | null;
  diagnosticCaseCount: number | null;
  interventionCount: number | null;
}

export interface CanonicalHistoryQualityViewModel {
  level: 'COMPLETE' | 'PARTIAL' | 'MINIMAL' | 'UNKNOWN';
  reasons: string[];
}

export interface CanonicalHistoryViewModel {
  task: CanonicalTaskProjectionViewModel;
  summary: CanonicalHistorySummaryViewModel;
  historyQuality: CanonicalHistoryQualityViewModel;
}

export interface CanonicalFailureSurfaceViewModel {
  verificationCycle: number | null;
  surface: string[];
  size: number | null;
}

export interface CanonicalFailureSignatureViewModel {
  signature: string | null;
  cycles: number[];
  requirements: string[];
}

export interface CanonicalDiagnosticCaseViewModel {
  sequence: number | null;
  at: string | null;
  verificationCycle: number | null;
  diagnosticRevision: number | null;
  failureClass: string | null;
  hypothesisIds: string[];
  nextSafeAction: string | null;
  diagnosticFingerprint: string | null;
}

export type TraceInterventionKind =
  | 'CODE_CHANGE'
  | 'CONFIG_CHANGE'
  | 'TEST_CHANGE'
  | 'FIXTURE_CHANGE'
  | 'ENVIRONMENT_CHANGE'
  | 'DEPENDENCY_CHANGE'
  | 'ROLLBACK'
  | 'ISOLATION'
  | 'INSTRUMENTATION'
  | 'NO_MUTATION_EXPERIMENT'
  | 'OTHER'
  | 'UNKNOWN';

export interface TraceInterventionViewModel {
  id: string | null;
  kind: TraceInterventionKind;
  statement: string | null;
  hypothesisRefs: string[];
  reversible: boolean | null;
}

export interface CanonicalTraceInterventionViewModel {
  sequence: number | null;
  at: string | null;
  verificationCycle: number | null;
  intervention: TraceInterventionViewModel;
}

export interface CanonicalHypothesisDispositionViewModel {
  sequence: number | null;
  at: string | null;
  verificationCycle: number | null;
  hypothesisRef: string | null;
  status: string | null;
}

export interface CanonicalTraceDiagnosticsViewModel {
  cases: CanonicalDiagnosticCaseViewModel[];
  interventions: CanonicalTraceInterventionViewModel[];
  dispositions: CanonicalHypothesisDispositionViewModel[];
}

export interface CanonicalTraceActionsViewModel {
  total: number | null;
  ambiguous: number | null;
}

export interface CanonicalTraceViewModel {
  task: CanonicalTaskProjectionViewModel;
  failureSurfaces: CanonicalFailureSurfaceViewModel[];
  failureSignatures: CanonicalFailureSignatureViewModel[];
  diagnostics: CanonicalTraceDiagnosticsViewModel;
  actions: CanonicalTraceActionsViewModel;
}

export interface CanonicalHypothesisSummaryViewModel {
  created: number | null;
  supported: number | null;
  weakened: number | null;
  falsified: number | null;
  superseded: number | null;
  unresolved: number | null;
  open: number | null;
}

export interface CanonicalReflectionStallAnalysisViewModel {
  latestNoGain: boolean | null;
  consecutiveNoGainCycles: number | null;
  sameStrategyAsPrevious: boolean | null;
  sameFailureSurfaceAsPrevious: boolean | null;
  sameFailureSignaturesAsPrevious: boolean | null;
}

export interface CanonicalReflectionInformationGainViewModel {
  cyclesWithoutEffectiveGain: number[];
}

export interface CanonicalReflectionViewModel {
  status: 'ADVANCING' | 'WATCH' | 'STALLED' | 'UNKNOWN';
  verificationCycles: number | null;
  hypotheses: CanonicalHypothesisSummaryViewModel;
  stallAnalysis: CanonicalReflectionStallAnalysisViewModel;
  informationGain: CanonicalReflectionInformationGainViewModel;
  recommendedProtocolAction: string | null;
}

export interface CanonicalInspectionViewModel {
  ok: boolean | null;
  task: {
    id: string | null;
    phase: string | null;
  };
  progress: {
    status: string | null;
  };
  next: {
    command: string | null;
  };
}

export type TaskHistoryView = CanonicalProjectionView<CanonicalHistoryViewModel>;
export type TaskTraceView = CanonicalProjectionView<CanonicalTraceViewModel>;
export type TaskReflectionView = CanonicalProjectionView<CanonicalReflectionViewModel>;
export type TaskInspectionView = CanonicalProjectionView<CanonicalInspectionViewModel>;

export type DurableActionState =
  | 'PROPOSED'
  | 'AUTHORIZED'
  | 'STARTED'
  | 'COMMITTED'
  | 'VERIFIED'
  | 'FAILED'
  | 'COMMIT_UNKNOWN'
  | 'CANCELLED'
  | 'UNKNOWN';

export type DurableActionEffectClass =
  | 'READ_ONLY'
  | 'REVERSIBLE_WRITE'
  | 'IRREVERSIBLE_WRITE'
  | 'EXTERNAL_PUBLICATION'
  | 'DESTRUCTIVE'
  | 'UNKNOWN';

export interface DurableActionView {
  actionId: string;
  actionFingerprint: string | null;
  effectClass: DurableActionEffectClass;
  capability: string | null;
  operation: string | null;
  target: string | null;
  idempotencyKey: string | null;
  requiredForCompletion: boolean;
  requirement: string | null;
  provenance: string | null;
  state: DurableActionState;
  revision: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastEvidenceRef: string | null;
  lastReconciliationAt: string | null;
  commitResultCode: string | null;
}

export type ActionReadinessStatus = 'SATISFIED' | 'PENDING' | 'FAILED' | 'AMBIGUOUS' | 'UNTRUSTED' | 'UNKNOWN';

export interface ActionReadinessSummary {
  total: number | null;
  satisfied: number | null;
  unresolved: number | null;
  failed: number | null;
  ambiguous: number | null;
  pending: number | null;
  untrusted: number | null;
  source: 'FORGELOOP_INTEGRATION' | 'UNAVAILABLE';
}

export interface DurableApprovalView {
  approvalId: string;
  actionId: string | null;
  actionFingerprint: string | null;
  contractFingerprint: string | null;
  taskRevision: number | null;
  capability: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'UNKNOWN';
  requestedAt: string | null;
  reason: string | null;
  decision: 'APPROVED' | 'REJECTED' | null;
  resolvedAt: string | null;
  authorityKind: 'CALLER_ACKNOWLEDGED' | 'HOST_ATTESTED' | null;
  hostGrantRef: string | null;
}

export interface TaskActionsView {
  available: boolean;
  source: CanonicalProjectionSource;
  actions: DurableActionView[];
  approvals: DurableApprovalView[];
  approvalsAvailable?: boolean;
  readinessAvailable?: boolean;
  readiness: ActionReadinessSummary | null;
  error: CanonicalProjectionError | null;
  warnings?: CanonicalProjectionError[];
}

export interface CapabilityPolicyRuleView {
  capability: string;
  decision: 'ALLOW' | 'DENY' | 'REQUIRE_AUTHORITY' | 'REQUIRE_APPROVAL' | 'UNKNOWN';
}

export interface CapabilityPolicyView {
  available: boolean;
  source: CanonicalProjectionSource;
  defaultDecision: 'ALLOW' | 'DENY' | null;
  rules: CapabilityPolicyRuleView[];
  fingerprint: string | null;
  path: string | null;
  error: CanonicalProjectionError | null;
}

export interface TrajectoryMetricsView {
  available: boolean;
  source: CanonicalProjectionSource;
  metrics: Record<string, unknown> | null;
  error: CanonicalProjectionError | null;
}

export interface TrajectoryEvaluationsView {
  available: boolean;
  source: CanonicalProjectionSource;
  evaluations: Array<Record<string, unknown>>;
  error: CanonicalProjectionError | null;
}

export type ContinuityWorkItem = { id: string; summary: string };

export const FORGELOOP_CLAIM_STATES = [
  'ACTIVE',
  'RELEASED_BY_COMPLETION',
  'RELEASED_BY_RECOVERY',
  'INCONSISTENT',
] as const;

export type ForgeLoopClaimState = (typeof FORGELOOP_CLAIM_STATES)[number];

export type ForgeLoopClaimStateView = ForgeLoopClaimState | 'UNKNOWN';

export function parseClaimState(value: unknown): ForgeLoopClaimStateView {
  return typeof value === 'string' && (FORGELOOP_CLAIM_STATES as readonly string[]).includes(value)
    ? (value as ForgeLoopClaimState)
    : 'UNKNOWN';
}

export function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export interface TaskOwnershipSummary {
  claimState: ForgeLoopClaimStateView;
  mutationAllowed: boolean | null;
  ownershipValid: boolean | null;
  historicalWriteClaims: string[];
  effectiveWriteClaims: string[];
  reasonCodes: string[];
  source: 'FORGELOOP_INTEGRATION' | 'UNAVAILABLE';
}

export interface TaskRecoverySummary {
  status: 'RECOVERED' | 'NONE' | 'UNKNOWN';
  recoveryId?: string;
  recoveredAt?: string;
  classificationAtRecovery?: string;
  releasedClaims: string[];
  reasonCodes: string[];
  previousPhase?: string;
  previousRevision?: number;
  authorityKind?: 'CALLER_ACKNOWLEDGED' | 'HOST_ATTESTED';
  grantRef?: string;
  resumeRequired: boolean;
  source: 'FORGELOOP_INTEGRATION' | 'RAW_ARTIFACT' | 'UNAVAILABLE';
}

export type TaskOperationalState =
  | 'ACTIVE'
  | 'RECOVERY_RESUME_REQUIRED'
  | 'COMPLETED_RELEASED'
  | 'BLOCKED'
  | 'OWNERSHIP_INCONSISTENT'
  | 'READ_ONLY_UNKNOWN';

export interface CanonicalTaskStatusSummary {
  status: string;
  reasons: string[];
  warnings: string[];
  repositoryComparison?: string;
  contractComparison?: string;
  artifactComparison?: string;
}

export interface ForgeLoopIntegrationCapabilitiesSummary {
  available: boolean;
  integrationApiVersion?: number;
  protocolVersion?: number;
  executorParity?: boolean;
  taskClaimRecovery?: {
    version: number;
    durableRecoveryState: boolean;
    explicitResume: boolean;
    validatedClaimProjection: boolean;
  };
  features?: ForgeLoopFeatureSupport;
  resources?: string[];
  commands?: Array<{
    name: string;
    baseRiskClass?: string;
    mayExecuteExternalProcess?: boolean;
  }>;
}

export interface TaskSummary {
  taskId: string;
  taskKey: string;
  objective?: string;
  phase: ForgeLoopPhase;
  canonicalStatus?: CanonicalTaskStatusSummary;
  previousPhase?: ForgeLoopPhase;
  selectedGuides: string[];
  completedSteps: string[];
  pendingSteps: string[];
  blockers: BlockerSummary[];
  failures: FailureSummary[];
  checks: CheckSummary[];
  gates: GateSummary[];
  evidenceCoverage: EvidenceCoverageSummary;
  verificationCycle?: number;
  publicationStatus?: string;
  lastUpdated?: string;
  nextAction?: NextActionSummary;
  continuity?: ContinuitySummary;
  /** @deprecated Historical raw artifact field. Never represents active ownership; use `ownership.effectiveWriteClaims`. */
  writeClaims?: string[];
  historicalWriteClaims?: string[];
  effectiveWriteClaims?: string[];
  ownership: TaskOwnershipSummary;
  recovery?: TaskRecoverySummary;
  operationalState: TaskOperationalState;
  policySnapshot?: Record<string, unknown>;
  artifactErrors?: string[];
  gateErrors?: string[];
  protocolConflicts?: Array<{ field: string; artifactValue: unknown; cliValue: unknown }>;
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  activationMarker?: string;
  taskId?: string;
  isActive?: boolean;
}

export interface PolicyDriftSummary {
  detected: boolean;
  classification?: string;
  changeCount?: number;
  snapshotDigest?: string;
  currentDigest?: string;
  changes?: unknown[];
}

export interface PolicySummary {
  overallStatus: 'valid' | 'invalid' | 'unknown';
  complianceMode: string;
  ruleCount?: number;
  provenRules?: number;
  inertRules?: number;
  unsupportedRules?: number;
  baselineViolations?: number;
  newViolations?: number;
  lockStatus: 'valid' | 'invalid' | 'not-applicable' | 'unknown';
  drift: PolicyDriftSummary | null;
  integritySource: 'POLICY_STATUS' | 'ARTIFACTS' | 'UNKNOWN';
  integrityMessage?: string;
  errors?: string[];
  warnings?: string[];
}

export type ForgeLoopHealthStatus = 'VALID' | 'INCOMPLETE' | 'STALE' | 'INCONSISTENT' | 'INVALID' | 'UNKNOWN';
export type ForgeLoopHealthSource = 'FORGELOOP_STATUS_AGGREGATE' | 'FORGELOOP_OWNERSHIP' | 'FORGELOOP_VALIDATE_STATE' | 'ARTIFACT_VALIDATION' | 'UNKNOWN';

export interface ProjectHealth {
  status: ForgeLoopHealthStatus;
  source: ForgeLoopHealthSource;
}

export interface ProjectObservations {
  taskCount: number;
  evidence: Pick<EvidenceCoverageSummary, 'covered' | 'partial' | 'notVerified' | 'blocked'>;
  continuity: { present: number; missing: number };
  artifactValidationErrors: number;
  ownership: {
    activeCount: number;
    recoveredResumeRequiredCount: number;
    inconsistentCount: number;
    unavailableCount: number;
  };
}

export interface ProjectSnapshot {
  project: ProjectSummary;
  protocol: ProtocolSummary;
  health: ProjectHealth;
  observations: ProjectObservations;
  tasks: TaskSummary[];
  activeTaskId?: string;
  sessions: SessionSummary[];
  policy?: PolicySummary;
  diagnostics?: string[];
  updatedAt: string;
}

export type ProjectTimelineEventType =
  | 'project'
  | 'language'
  | 'framework'
  | 'module'
  | 'dependency'
  | 'architecture'
  | 'git'
  | 'release'
  | 'analysis';

export type TimelineConfidence = 'high' | 'medium' | 'low';

export interface TimelineEvidence {
  type: 'git' | 'file' | 'package' | 'forgeloop';
  source: string;
  commit?: string;
}

export interface ProjectTimelineEvent {
  id: string;
  type: ProjectTimelineEventType;
  timestamp?: string;
  order: number;
  title: string;
  description?: string;
  source?: string;
  confidence: TimelineConfidence;
  evidence: TimelineEvidence[];
  metadata?: Record<string, unknown>;
  current?: boolean;
}

export interface ProjectTimelineGitSummary {
  available: boolean;
  head: string | null;
  shallow: boolean;
  commitCount: number | null;
  tagCount: number;
}

export interface ProjectTimelineAnalysisSummary {
  generatedAt: string | null;
  forgeLoopVersion: string | null;
  projectCount: number;
  languages: string[];
  frameworks: string[];
  modules: string[];
  relationships: number | null;
  architecture: string | null;
}

export interface ProjectTimeline {
  schemaVersion: 1;
  timelineSchemaVersion: 1;
  project: ProjectSummary;
  git: ProjectTimelineGitSummary;
  analysis: ProjectTimelineAnalysisSummary;
  events: ProjectTimelineEvent[];
  warnings: string[];
}

export interface EventRecord {
  seq: number;
  schemaVersion: number;
  protocolVersion: number;
  taskId: string;
  event: string;
  at: string;
  fingerprint?: string;
  previousHash: string | null;
  hash: string;
  details?: Record<string, unknown>;
}

export interface EventPage {
  events: EventRecord[];
  cursor?: string;
  hasMore: boolean;
  totalCount?: number;
  validation?: {
    schema: 'VALID' | 'INVALID' | 'NOT_RUN';
    chain: 'VALID' | 'INVALID' | 'NOT_RUN';
    cursor?: 'FOUND' | 'NOT_FOUND' | 'NOT_RUN';
    scope?: 'PAGE' | 'LEDGER';
    invalidLineCount?: number;
    errors?: string[];
  };
}

export interface TaskSnapshot {
  summary: TaskSummary;
  contract?: Record<string, unknown>;
  routing?: Record<string, unknown>;
  preflight?: Record<string, unknown>;
  workState?: Record<string, unknown>;
  continuity?: Record<string, unknown>;
  executionReceipt?: Record<string, unknown>;
  events: EventRecord[];
  policySnapshot?: Record<string, unknown>;
  workspaceBinding?: WorkspaceBindingView;
  handoffs?: TaskHandoffsView;
  responsibility?: ResponsibilityView;
  verificationScope?: VerificationScopeView;
  attestation?: TaskAttestationView;
}

export type AuditAppErrorCode =
  | 'PROJECT_NOT_FORGELOOP'
  | 'PROJECT_DISCOVERY_AMBIGUOUS'
  | 'PROTOCOL_UNSUPPORTED'
  | 'ARTIFACT_INVALID'
  | 'ARTIFACT_UNREADABLE'
  | 'CLI_NOT_FOUND'
  | 'CLI_FAILED'
  | 'PATH_BOUNDARY_VIOLATION'
  | 'LEDGER_INVALID'
  | 'WATCHER_FAILED'
  | 'PROJECT_REMOVED'
  | 'PERMISSION_DENIED'
  | 'UNKNOWN_ERROR';

export interface AuditAppError {
  code: AuditAppErrorCode;
  message: string;
  recoverable: boolean;
  details?: string;
}

export interface RecentProject {
  path: string;
  name: string;
  lastOpenedAt: string;
  kind?: ProjectKind;
}

/**
 * A project registered in the local workspace. The workspace owns every
 * project the auditor tracks, not only the one currently open for deep
 * canonical inspection, so cross-project views stay live.
 */
export interface WorkspaceProjectSummary {
  path: string;
  /** Home-relative rendering of `path`; never used as a filesystem input. */
  displayPath: string;
  name: string;
  kind: ProjectKind;
  addedAt: string;
  lastOpenedAt: string;
  active: boolean;
  available: boolean;
  health: ForgeLoopHealthStatus;
  taskCount: number;
  blockedCount: number;
  completeCount: number;
  inProgressCount: number;
  branch?: string;
  head?: string;
  protocolVersion: number;
  forgeLoopVersion?: string;
  /** Present when the project cannot currently be read; never a silent pass. */
  error?: string;
  lastChangeAt?: string;
}

export interface ProjectWorkspace {
  projects: WorkspaceProjectSummary[];
  activeProjectPath: string | null;
  watching: number;
  updatedAt: string;
}

export type KanbanColumnId =
  | 'backlog'
  | 'ready'
  | 'in-progress'
  | 'review'
  | 'blocked'
  | 'complete';

export interface KanbanCard {
  taskId: string;
  projectPath: string;
  projectName: string;
  projectKind: ProjectKind;
  objective?: string;
  phase: ForgeLoopPhase;
  column: KanbanColumnId;
  /** Canonical coverage percentage reported by ForgeLoop, never an auditor estimate. */
  evidenceCoveragePercent: number;
  /** Observed artifact/gate validation errors; an observation, not a verdict. */
  validationErrors: number;
  canonicalStatus?: string;
  lastUpdated?: string;
  isActive: boolean;
}

export interface KanbanColumn {
  id: KanbanColumnId;
  label: string;
  description: string;
  cards: KanbanCard[];
}

export interface KanbanBoard {
  columns: KanbanColumn[];
  projects: Array<{ path: string; name: string; kind: ProjectKind; taskCount: number }>;
  filterProjectPath: string | null;
  totalTasks: number;
  generatedAt: string;
}

export type AllowedArtifact =
  | 'contract.json'
  | 'routing-result.json'
  | 'preflight.json'
  | 'work-state.json'
  | 'continuity.json'
  | 'recovery.json'
  | 'execution-receipt.json'
  | 'policy-snapshot.json'
  | 'events.ndjson'
  | 'task.json'
  | 'workspace-binding.json'
  | 'responsibility.json'
  | 'verification-scope.json';

export interface RawArtifactRequest {
  taskId: string;
  artifact: AllowedArtifact;
}

export type RawCollectionArtifactRequest =
  | { kind: 'action'; taskId: string; actionId: string }
  | { kind: 'approval'; taskId: string; approvalId: string }
  | { kind: 'evaluation'; taskId: string; evaluationId: string }
  | { kind: 'handoff'; taskId: string; handoffId: string }
  | { kind: 'code-manifest'; taskId: string }
  | { kind: 'attestation-statement'; taskId: string }
  | { kind: 'attestation-bundle'; taskId: string }
  | { kind: 'capability-policy' };

export type ExecutionKind = 'VERIFICATION' | 'DURABLE_ACTION';

export type VerificationIsolationMode =
  | 'NATIVE_PROJECT'
  | 'PROJECT_ISOLATED'
  | 'SYSTEM_ISOLATED';

export interface ExecutionIsolationMetadata {
  mode: VerificationIsolationMode;
  isolated: boolean;
  liveProjectWritable: boolean;
  networkPolicy: string;
  environmentPolicy: string;
}

export interface ExecutionRecord {
  executionId: string;
  taskId: string;
  checkId: string;
  requirement: string;
  verificationCycle: number;
  kind: string;
  argv: string[];
  cwd: string;
  executionKind?: ExecutionKind;
  protocolProjectRoot?: string;
  executionIsolation?: VerificationIsolationMode;
  isolation?: ExecutionIsolationMetadata;
  resolution: Record<string, unknown>;
  dispatch?: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
  status: 'passed' | 'failed';
  exitCode: number | null;
  durationMs?: number;
  termination?: string;
  signal?: string | null;
  stdoutSha256?: string;
  stderrSha256?: string;
}

export interface ExecutionPage {
  executions: ExecutionRecord[];
  invalidCount: number;
  hasMore: boolean;
}

export interface WatcherStatus {
  active: boolean;
  lastEventAt?: string;
  lastEventType?: string;
  lastTaskId?: string;
  error?: string;
}

export interface ForgeLoopAuditAPI {
  selectProject(): Promise<ProjectDetectionResult | null>;
  openRecentProject(path: string): Promise<ProjectDetectionResult>;
  openDemoProject(): Promise<ProjectDetectionResult>;
  closeProject(): Promise<void>;
  getProjectAudit(): Promise<ProjectAuditSnapshot>;
  getTaskAudit(taskId: string): Promise<TaskAuditSnapshot>;
  getAuditFindings(filter?: AuditFindingFilter): Promise<AuditFinding[]>;
  getTaskStructuralQuality(taskId: string): Promise<StructuralQualityAuditView>;
  saveAuditBaseline(): Promise<AuditSnapshotMetadata>;
  listAuditHistory(): Promise<AuditSnapshotMetadata[]>;
  compareAudits(baseAuditId: string, currentAuditId?: string): Promise<AuditDiff>;
  exportAuditReport(options: AuditExportOptions): Promise<AuditExportResult>;
  getProjectState(): Promise<{ detection: ProjectDetectionResult; snapshot: ProjectSnapshot } | null>;
  getProjectSnapshot(): Promise<ProjectSnapshot>;
  getProjectTimeline(): Promise<ProjectTimeline>;
  getTask(taskId: string): Promise<TaskSnapshot>;
  getTaskEvents(taskId: string, cursor?: string, limit?: number): Promise<EventPage>;
  validateEventLedger(taskId: string): Promise<NonNullable<EventPage['validation']>>;
  getPolicyStatus(taskId?: string): Promise<PolicySummary | null>;
  getRawArtifact(request: RawArtifactRequest): Promise<string>;
  getRawCollectionArtifact(request: RawCollectionArtifactRequest): Promise<string>;
  getTaskHistory(taskId: string): Promise<TaskHistoryView>;
  getTaskTrace(taskId: string): Promise<TaskTraceView>;
  getTaskReflection(taskId: string): Promise<TaskReflectionView>;
  getTaskInspection(taskId: string): Promise<TaskInspectionView>;
  getTaskActions(taskId: string): Promise<TaskActionsView>;
  getTaskAction(taskId: string, actionId: string): Promise<DurableActionView | null>;
  getTaskApprovals(taskId: string): Promise<DurableApprovalView[]>;
  getTaskMetrics(taskId: string): Promise<TrajectoryMetricsView>;
  getTaskEvaluations(taskId: string): Promise<TrajectoryEvaluationsView>;
  getCapabilityPolicy(): Promise<CapabilityPolicyView>;
  getTaskWorkspaceBinding(taskId: string): Promise<WorkspaceBindingView>;
  getTaskHandoffs(taskId: string): Promise<TaskHandoffsView>;
  getTaskResponsibility(taskId: string): Promise<ResponsibilityView>;
  getTaskVerificationScope(taskId: string): Promise<VerificationScopeView>;
  getTaskAttestation(taskId: string): Promise<TaskAttestationView>;
  getTaskContinuityLint(taskId: string): Promise<ContinuityLintView>;
  getTaskExecutionProfileContext(taskId: string): Promise<ExecutionProfileContextView>;
  getTaskAuditView(taskId: string): Promise<TaskAuditViewProjection>;
  getTaskExecutions(taskId: string, limit?: number): Promise<ExecutionPage>;
  getDiagnostics(): Promise<AuditRuntimeDiagnostics>;
  getAppVersion(): Promise<string>;
  getRepositoryIndexStatus(): Promise<RepositoryIndexProjection>;
  searchRepository(request: RepositorySearchRequest): Promise<RepositorySearchResult>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<boolean>;
  getRecentProjects(): Promise<RecentProject[]>;
  addRecentProject(project: RecentProject): Promise<void>;
  removeRecentProject(path: string): Promise<void>;
  getProjectWorkspace(): Promise<ProjectWorkspace>;
  /** Register a project and make it the open project. */
  addWorkspaceProject(path: string): Promise<ProjectWorkspace>;
  /** Register a project and keep tracking it live without switching to it. */
  saveWorkspaceProject(path: string): Promise<ProjectWorkspace>;
  removeWorkspaceProject(path: string): Promise<ProjectWorkspace>;
  setActiveWorkspaceProject(path: string | null): Promise<ProjectWorkspace>;
  refreshWorkspaceProject(path: string): Promise<ProjectWorkspace>;
  getKanbanBoard(projectPath?: string | null): Promise<KanbanBoard>;
  getWorkspaceTimeline(path: string): Promise<ProjectTimeline>;
  notifyRendererReady(): Promise<void>;
  subscribeProjectUpdates(listener: (update: ProjectUpdate) => void): () => void;
}

export interface ProjectUpdate {
  type: 'task-added' | 'task-updated' | 'task-removed' | 'project-health-changed' | 'policy-changed' | 'session-changed' | 'action-changed' | 'approval-changed' | 'evaluation-changed' | 'capability-policy-changed' | 'workspace-binding-changed' | 'handoff-changed' | 'responsibility-changed' | 'verification-scope-changed' | 'attestation-changed' | 'audit-invalidated' | 'audit-refreshed' | 'finding-changed' | 'snapshot-refreshed' | 'project-opened' | 'watcher-status' | 'workspace-changed' | 'error';
  taskId?: string;
  snapshot?: ProjectSnapshot;
  detection?: ProjectDetectionResult;
  data?: unknown;
  timestamp: string;
  generation?: number;
  /** Identifies which registered project produced the update in multi-project workspaces. */
  projectPath?: string;
}
