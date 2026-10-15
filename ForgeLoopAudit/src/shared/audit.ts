import type {
  CanonicalProjectionError,
  ForgeLoopCompatibilityMode,
  ProjectSummary,
  ProtocolSummary,
} from './domain';

export type AuditFindingSeverity =
  | 'CRITICAL'
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'INFO'
  | 'UNKNOWN';

export type AuditFindingSource =
  | 'FORGELOOP_CANONICAL_AUDIT'
  | 'FORGELOOP_CANONICAL_RESOURCE'
  | 'FORGELOOP_AUDIT_DERIVED'
  | 'LOCAL_APP_DIAGNOSTIC';

export type AuditFindingDomain =
  | 'PROTOCOL'
  | 'OWNERSHIP'
  | 'RECOVERY'
  | 'COMPLETION'
  | 'EVIDENCE'
  | 'RECEIPT'
  | 'ACTIONS'
  | 'POLICY'
  | 'HANDOFF'
  | 'RESPONSIBILITY'
  | 'WORKSPACE'
  | 'ATTESTATION'
  | 'STRUCTURAL_QUALITY'
  | 'EXECUTION'
  | 'CONTINUITY'
  | 'EFFICIENCY'
  | 'COMPATIBILITY'
  | 'APPLICATION';

export interface AuditEvidenceRef {
  ref: string;
  kind?: string;
  label?: string;
  source?: AuditFindingSource;
  status?: string;
}

export type AuditRemediationKind = 'CANONICAL_NEXT' | 'AUDIT_SUGGESTION';

export interface AuditRemediation {
  kind: AuditRemediationKind;
  text: string;
  command?: string;
  reasonCodes?: string[];
}

export interface AuditFinding {
  id: string;
  fingerprint: string;
  taskId: string | null;
  severity: AuditFindingSeverity;
  domain: AuditFindingDomain;
  source: AuditFindingSource;
  code: string;
  title: string;
  summary: string;
  /** The message as supplied by ForgeLoop, kept separate from UI wording. */
  canonicalMessage?: string;
  /** A short auditor-facing summary; it never replaces canonicalMessage. */
  presentationSummary?: string;
  canonical: boolean;
  affectsIntegrity: boolean;
  affectsCompletion: boolean;
  /**
   * Present and true only when ForgeLoop reported a canonical error whose code
   * this Audit build cannot classify. The integrity and completion impact is
   * then unknown rather than absent, so the finding blocks a positive integrity
   * or trust verdict instead of being read as harmless.
   */
  unclassifiedCanonicalError?: boolean;
  evidence: AuditEvidenceRef[];
  artifactRefs: string[];
  reasonCodes: string[];
  remediation: AuditRemediation | null;
  firstSeenAt?: string;
  lastSeenAt?: string;
  ruleVersion?: string;
}

export interface AuditFindingFilter {
  taskId?: string | null;
  severity?: AuditFindingSeverity | AuditFindingSeverity[];
  domain?: AuditFindingDomain | AuditFindingDomain[];
  source?: AuditFindingSource | AuditFindingSource[];
  canonical?: boolean;
  limit?: number;
}

export type CanonicalTaskAuditStatus = 'VALID' | 'INCOMPLETE' | 'STALE' | 'INVALID' | 'UNKNOWN';

export interface CanonicalAuditError {
  code: string;
  message: string;
  next?: string | null;
  artifacts?: string[];
  reasonCodes?: string[];
  canonicalMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface CanonicalTaskAudit {
  available: boolean;
  source: 'FORGELOOP_INTEGRATION' | 'UNAVAILABLE';
  taskId: string | null;
  status: CanonicalTaskAuditStatus;
  errors: CanonicalAuditError[];
  warnings: CanonicalAuditError[];
  result: Record<string, unknown> | null;
  command: string;
  exitCode: number | null;
  error: CanonicalProjectionError | null;
}

export type StructuralQualityMode = 'off' | 'observe' | 'gate' | 'unknown';
export type StructuralQualityStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_OBSERVED' | 'UNKNOWN';

export interface StructuralQualityAuditView {
  available: boolean;
  source: 'FORGELOOP_INTEGRATION' | 'UNAVAILABLE';
  taskId: string | null;
  mode: StructuralQualityMode;
  provider: string | null;
  baseline: {
    status: string;
    qualitySignal: number | null;
    artifactRef: string | null;
    fingerprint: string | null;
  };
  current: {
    status: StructuralQualityStatus;
    verificationCycle: number | null;
    attempt: number | null;
    qualitySignal: number | null;
    delta: number | null;
    bottleneck: string | null;
    artifactRef: string | null;
  };
  comparable: boolean | null;
  completionRequired: boolean;
  reasonCodes: string[];
  next: string | null;
  evidenceKind: string | null;
  error: CanonicalProjectionError | null;
}

export interface TaskAuditSummary {
  taskId: string;
  status: CanonicalTaskAuditStatus;
  canonicalAvailable: boolean;
  structuralQualityStatus: StructuralQualityStatus;
  findingCount: number;
  criticalFindingCount: number;
  highFindingCount: number;
  fingerprint: string;
}

export interface TaskAuditSnapshot {
  schemaVersion: 1;
  auditEngineVersion: string;
  taskId: string;
  canonical: CanonicalTaskAudit;
  structuralQuality: StructuralQualityAuditView | null;
  findings: AuditFinding[];
  generatedAt: string;
  fingerprint: string;
}

export interface ProjectAuditVerdict {
  integrity: 'VALID' | 'INCONSISTENT' | 'INVALID' | 'UNKNOWN';
  completionReadiness: 'VALID' | 'INCOMPLETE' | 'STALE' | 'INVALID' | 'MIXED' | 'UNKNOWN';
  quality: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_OBSERVED' | 'MIXED' | 'UNKNOWN';
  trust: 'VALID' | 'DEGRADED' | 'INVALID' | 'UNKNOWN';
}

export interface AuditCoverage {
  percent: number;
  canonicalAudit: boolean;
  canonicalOwnership: boolean;
  structuredDiagnostics: boolean;
  policy: boolean;
  structuralQuality: boolean;
  codeAttestation: boolean;
  verificationScope: boolean;
  executionProvenance: boolean;
  unavailable: string[];
}

export interface AuditScore {
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | 'UNAVAILABLE';
  coveragePercent: number;
  observedDimensions: string[];
  unavailableDimensions: string[];
  blockedByCriticalFinding: boolean;
  methodologyVersion: string;
}

export interface AuditFindingCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  unknown: number;
}

export interface AuditProvenance {
  forgeLoopPackageVersion: string;
  forgeLoopCommit: string;
  integrationApiVersion: number | null;
  auditRulesVersion: string;
}

export interface ProjectAuditSnapshot {
  schemaVersion: 1;
  auditEngineVersion: string;
  project: ProjectSummary;
  protocol: ProtocolSummary;
  generatedAt: string;
  gitHead: string | null;
  verdict: ProjectAuditVerdict;
  coverage: AuditCoverage;
  score: AuditScore | null;
  taskAudits: TaskAuditSummary[];
  findings: AuditFinding[];
  counts: AuditFindingCounts;
  provenance: AuditProvenance;
  fingerprint: string;
  /** Stable local history identifier. It is optional for in-memory snapshots. */
  auditId?: string;
  compatibilityMode?: ForgeLoopCompatibilityMode;
}

export interface AuditSnapshotMetadata {
  auditId: string;
  generatedAt: string;
  gitHead: string | null;
  fingerprint: string;
  verdict: ProjectAuditVerdict;
  coveragePercent: number;
  counts: AuditFindingCounts;
  score: AuditScore | null;
}

export interface AuditTaskDiff {
  taskId: string;
  statusChanged: boolean;
  previousStatus: CanonicalTaskAuditStatus | null;
  currentStatus: CanonicalTaskAuditStatus | null;
  findingCountDelta: number;
}

export interface AuditDiff {
  baseAuditId: string;
  currentAuditId: string;
  verdictChanged: boolean;
  scoreDelta: number | null;
  newFindings: AuditFinding[];
  resolvedFindings: AuditFinding[];
  persistentFindings: AuditFinding[];
  changedFindings: AuditFinding[];
  taskChanges: AuditTaskDiff[];
}

export type AuditReportFormat = 'JSON' | 'MARKDOWN' | 'SARIF';

export interface AuditExportOptions {
  format: AuditReportFormat;
  destinationPath: string;
  includeDiff?: boolean;
  baseAuditId?: string;
  /** Explicit opt-in for writing inside the audited project's protocol directory. */
  allowProjectProtocolPath?: boolean;
}

export interface AuditExportResult {
  format: AuditReportFormat;
  destinationPath: string;
  auditId: string;
  fingerprint: string;
  bytes: number;
  sha256: string;
}

export interface AuditProjectOptions {
  compatibilityMode?: ForgeLoopCompatibilityMode;
  includeStructuralQuality?: boolean;
  saveHistory?: boolean;
}
