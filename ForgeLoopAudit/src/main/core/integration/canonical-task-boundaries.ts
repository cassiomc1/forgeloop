import type { ForgeLoopIntegrationAdapter } from './forgeloop-integration';
import {
  attestationReadPolicyError,
  readAttestationReadPolicy,
} from './attestation-read-policy';
import type {
  AttestationReadPolicy,
  AttestationStatus,
  AttestationTrustLevel,
  CanonicalHandoffView,
  CanonicalProjectionError,
  ForgeLoopFeatureSupport,
  HandoffAcceptanceStatus,
  HandoffAcceptanceView,
  ResponsibilityStatus,
  ResponsibilityView,
  TaskAttestationView,
  TaskHandoffsView,
  VerificationScopeRequestedMode,
  VerificationScopeResolvedMode,
  VerificationScopeView,
  WorkspaceBindingStatus,
  WorkspaceBindingView,
} from '@shared/domain';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

const HANDOFF_ACCEPTANCE_STATUSES: readonly HandoffAcceptanceStatus[] = ['OPEN', 'ACCEPTED', 'UNBOUND', 'INCONSISTENT'];

function normalizeHandoffAcceptance(value: unknown): HandoffAcceptanceView | null {
  if (!isRecord(value)) return null;
  const rawStatus = stringValue(value.status);
  return {
    status: HANDOFF_ACCEPTANCE_STATUSES.includes(rawStatus as HandoffAcceptanceStatus)
      ? rawStatus as HandoffAcceptanceStatus
      : 'UNKNOWN',
    consumerId: stringValue(value.consumerId),
    harness: stringValue(value.harness),
    acceptedAt: stringValue(value.acceptedAt),
    reasonCodes: stringArray(value.reasonCodes),
  };
}

function projectionError(value: unknown, fallbackCode: string, fallbackMessage: string): CanonicalProjectionError {
  if (!isRecord(value)) return { code: fallbackCode, message: fallbackMessage };
  return {
    code: stringValue(value.code) ?? fallbackCode,
    message: stringValue(value.message) ?? fallbackMessage,
    ...(stringValue(value.next) ? { next: stringValue(value.next)! } : {}),
  };
}

function thrownError(error: unknown, fallbackCode: string): CanonicalProjectionError {
  if (isRecord(error)) {
    return projectionError(error, fallbackCode, 'Canonical ForgeLoop resource read failed.');
  }
  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message : String(error),
  };
}

function featureUnavailable(feature: string): CanonicalProjectionError {
  return {
    code: 'E_FEATURE_UNAVAILABLE',
    message: `${feature} is not advertised by this ForgeLoop build.`,
  };
}

function isMissingVerificationScope(error: unknown): boolean {
  const value = isRecord(error) ? error : {};
  const code = stringValue(value.code);
  const message = stringValue(value.message) ?? '';
  return code === 'ARTIFACT_MISSING'
    || (code === 'E_VERIFICATION_SCOPE_INVALID' && /missing/i.test(message));
}

const WORKSPACE_STATUSES: readonly WorkspaceBindingStatus[] = [
  'UNBOUND', 'MATCH', 'MISMATCH', 'INVALID', 'UNAVAILABLE',
];
const RESPONSIBILITY_STATUSES: readonly ResponsibilityStatus[] = ['NOT_APPLICABLE', 'VALID', 'INVALID'];
const REQUESTED_VERIFICATION_MODES: readonly VerificationScopeRequestedMode[] = ['AUTO', 'CHANGED', 'CLAIMED', 'FULL'];
const RESOLVED_VERIFICATION_MODES: readonly VerificationScopeResolvedMode[] = ['CHANGED', 'CLAIMED', 'FULL', 'UNRESOLVED'];
const ATTESTATION_STATUSES: readonly AttestationStatus[] = ['DISABLED', 'MISSING', 'VALID', 'INVALID'];
const ATTESTATION_LEVELS: readonly AttestationTrustLevel[] = ['PROCESSED', 'VERIFIED', 'ATTESTED'];

function workspaceViewUnavailable(featureSupport?: ForgeLoopFeatureSupport): WorkspaceBindingView {
  return {
    available: false,
    source: 'UNAVAILABLE',
    status: 'UNAVAILABLE',
    taskId: null,
    path: null,
    bindingFingerprint: null,
    mode: null,
    branchAtBind: null,
    headAtBind: null,
    error: featureSupport?.workspaceBinding === false
      ? featureUnavailable('Workspace binding')
      : { code: 'E_CANONICAL_WORKSPACE_BINDING_UNAVAILABLE', message: 'Canonical workspace binding resource is not available.' },
  };
}

function handoffsUnavailable(featureSupport?: ForgeLoopFeatureSupport): TaskHandoffsView {
  return {
    available: false,
    source: 'UNAVAILABLE',
    count: null,
    handoffs: [],
    error: featureSupport?.canonicalHandoffs === false
      ? featureUnavailable('Canonical handoffs')
      : { code: 'E_CANONICAL_HANDOFFS_UNAVAILABLE', message: 'Canonical handoff resource is not available.' },
  };
}

function responsibilityUnavailable(featureSupport?: ForgeLoopFeatureSupport): ResponsibilityView {
  return {
    available: false,
    source: 'UNAVAILABLE',
    status: 'UNKNOWN',
    label: null,
    allowedPaths: [],
    readOnlyPaths: [],
    requiredCheckIds: [],
    frozenInputs: null,
    changedPaths: [],
    fingerprint: null,
    errors: [featureSupport?.responsibilityConstraints === false
      ? featureUnavailable('Responsibility constraints')
      : { code: 'E_CANONICAL_RESPONSIBILITY_UNAVAILABLE', message: 'Canonical responsibility resource is not available.' }],
  };
}

function verificationScopeUnavailable(featureSupport?: ForgeLoopFeatureSupport): VerificationScopeView {
  return {
    available: false,
    source: 'UNAVAILABLE',
    requestedMode: 'UNKNOWN',
    resolvedMode: 'UNKNOWN',
    verificationCycle: null,
    changedPaths: [],
    claimedPaths: [],
    selectedPaths: [],
    reasons: [],
    fallback: null,
    fingerprint: null,
    checkerCapabilityFingerprint: null,
    createdAt: null,
    error: featureSupport?.differentialVerificationScope === false
      ? featureUnavailable('Differential verification scope')
      : { code: 'E_CANONICAL_VERIFICATION_SCOPE_UNAVAILABLE', message: 'Canonical verification-scope resource is not available.' },
  };
}

function attestationUnavailable(featureSupport?: ForgeLoopFeatureSupport): TaskAttestationView {
  return {
    available: false,
    source: 'UNAVAILABLE',
    status: 'UNKNOWN',
    level: 'UNKNOWN',
    content: null,
    receipt: null,
    ledger: null,
    signature: null,
    signer: null,
    files: null,
    subject: null,
    errors: [featureSupport?.codeAttestation === false
      ? featureUnavailable('Code attestation')
      : { code: 'E_CANONICAL_ATTESTATION_UNAVAILABLE', message: 'Canonical attestation resource is not available.' }],
  };
}

function attestationReadBlocked(policy: AttestationReadPolicy): TaskAttestationView {
  return {
    ...attestationUnavailable(),
    status: policy.reason === 'DISABLED' ? 'DISABLED' : 'UNKNOWN',
    readPolicy: policy,
    errors: [attestationReadPolicyError(policy)],
  };
}

export function normalizeWorkspaceBinding(value: unknown): WorkspaceBindingView {
  if (!isRecord(value)) return workspaceViewUnavailable();
  const binding = recordValue(value.binding);
  const statusValue = stringValue(value.status);
  const status = WORKSPACE_STATUSES.includes(statusValue as WorkspaceBindingStatus)
    ? statusValue as WorkspaceBindingStatus
    : 'UNKNOWN';
  return {
    available: true,
    source: 'FORGELOOP_INTEGRATION',
    status,
    taskId: stringValue(value.taskId),
    path: stringValue(value.path),
    bindingFingerprint: stringValue(value.bindingFingerprint),
    mode: stringValue(binding?.mode),
    branchAtBind: stringValue(binding?.branchAtBind),
    headAtBind: stringValue(binding?.headAtBind),
    error: value.error ? projectionError(value.error, 'E_WORKSPACE_BINDING_INVALID', 'Workspace binding status is invalid.') : null,
  };
}

function normalizeHandoff(value: unknown): CanonicalHandoffView {
  const handoff = isRecord(value) ? value : {};
  const intent = recordValue(handoff.intent);
  const state = recordValue(handoff.state);
  return {
    handoffId: stringValue(handoff.handoffId),
    taskId: stringValue(handoff.taskId),
    phase: stringValue(state?.phase),
    revision: numberValue(state?.revision),
    verificationCycle: numberValue(state?.verificationCycle),
    createdAt: stringValue(handoff.createdAt),
    digest: stringValue(handoff.artifactDigest),
    recipientHint: stringValue(intent?.recipientHint),
    note: stringValue(intent?.note),
    intent,
    state,
    evidence: recordValue(handoff.evidence),
    continuity: recordValue(handoff.continuity),
    acceptance: normalizeHandoffAcceptance(handoff.acceptance),
  };
}

export function normalizeHandoffs(value: unknown): TaskHandoffsView {
  if (!isRecord(value)) return handoffsUnavailable();
  const handoffsValue = Array.isArray(value.handoffs) ? value.handoffs.map(normalizeHandoff) : [];
  const handoffs = handoffsValue.sort((left, right) =>
    (right.createdAt ?? '').localeCompare(left.createdAt ?? '')
      || (right.handoffId ?? '').localeCompare(left.handoffId ?? ''));
  return {
    available: true,
    source: 'FORGELOOP_INTEGRATION',
    count: numberValue(value.count) ?? handoffs.length,
    handoffs,
    error: value.error ? projectionError(value.error, 'E_HANDOFF_INVALID', 'Canonical handoff projection is invalid.') : null,
  };
}

function normalizeErrorList(value: unknown): CanonicalProjectionError[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => projectionError(entry, 'E_CANONICAL_PROJECTION_ERROR', 'Canonical projection reported an error.'));
}

export function normalizeResponsibility(value: unknown): ResponsibilityView {
  if (!isRecord(value)) return responsibilityUnavailable();
  const responsibility = recordValue(value.responsibility);
  const statusValue = stringValue(value.status);
  const status = RESPONSIBILITY_STATUSES.includes(statusValue as ResponsibilityStatus)
    ? statusValue as ResponsibilityStatus
    : 'UNKNOWN';
  const frozen = recordValue(responsibility?.frozenInputs);
  return {
    available: true,
    source: 'FORGELOOP_INTEGRATION',
    status,
    label: stringValue(responsibility?.label),
    allowedPaths: stringArray(responsibility?.allowedPaths),
    readOnlyPaths: stringArray(responsibility?.readOnlyPaths),
    requiredCheckIds: stringArray(responsibility?.requiredCheckIds),
    frozenInputs: frozen ? {
      contract: frozen.contract === true,
      route: frozen.route === true,
      claims: frozen.claims === true,
    } : null,
    changedPaths: stringArray(value.changedPaths),
    fingerprint: stringValue(value.fingerprint),
    errors: normalizeErrorList(value.errors),
  };
}

export function normalizeVerificationScope(value: unknown): VerificationScopeView {
  if (!isRecord(value)) return verificationScopeUnavailable();
  const scope = recordValue(value.scope);
  const requestedValue = stringValue(scope?.requestedMode);
  const resolvedValue = stringValue(scope?.resolvedMode);
  return {
    available: true,
    source: 'FORGELOOP_INTEGRATION',
    requestedMode: REQUESTED_VERIFICATION_MODES.includes(requestedValue as VerificationScopeRequestedMode)
      ? requestedValue as VerificationScopeRequestedMode : 'UNKNOWN',
    resolvedMode: RESOLVED_VERIFICATION_MODES.includes(resolvedValue as VerificationScopeResolvedMode)
      ? resolvedValue as VerificationScopeResolvedMode : 'UNKNOWN',
    verificationCycle: numberValue(scope?.verificationCycle),
    changedPaths: stringArray(scope?.changedPaths),
    claimedPaths: stringArray(scope?.claimedPaths),
    selectedPaths: stringArray(scope?.selectedPaths),
    reasons: stringArray(scope?.reasons),
    fallback: recordValue(scope?.fallback),
    fingerprint: stringValue(value.fingerprint),
    checkerCapabilityFingerprint: stringValue(scope?.checkerCapabilityFingerprint),
    createdAt: stringValue(scope?.createdAt),
    error: value.error ? projectionError(value.error, 'E_VERIFICATION_SCOPE_INVALID', 'Verification scope projection is invalid.') : null,
  };
}

export function normalizeAttestation(value: unknown): TaskAttestationView {
  if (!isRecord(value)) return attestationUnavailable();
  const statusValue = stringValue(value.status);
  const levelValue = stringValue(value.level);
  return {
    available: true,
    source: 'FORGELOOP_INTEGRATION',
    status: ATTESTATION_STATUSES.includes(statusValue as AttestationStatus) ? statusValue as AttestationStatus : 'UNKNOWN',
    level: ATTESTATION_LEVELS.includes(levelValue as AttestationTrustLevel) ? levelValue as AttestationTrustLevel : 'UNKNOWN',
    content: stringValue(value.content),
    receipt: stringValue(value.receipt),
    ledger: stringValue(value.ledger),
    signature: stringValue(value.signature),
    signer: recordValue(value.signer),
    files: numberValue(value.files),
    subject: stringValue(value.subject),
    errors: normalizeErrorList(value.errors),
  };
}

export interface CanonicalTaskBoundariesService {
  getWorkspaceBinding(projectRoot: string, taskId: string): Promise<WorkspaceBindingView>;
  getHandoffs(projectRoot: string, taskId: string): Promise<TaskHandoffsView>;
  getResponsibility(projectRoot: string, taskId: string): Promise<ResponsibilityView>;
  getVerificationScope(projectRoot: string, taskId: string): Promise<VerificationScopeView>;
  getAttestation(projectRoot: string, taskId: string): Promise<TaskAttestationView>;
}

export function createCanonicalTaskBoundariesService(options: {
  integration: ForgeLoopIntegrationAdapter;
  featureSupport?: ForgeLoopFeatureSupport;
  readAttestationConfig?: () => unknown;
}): CanonicalTaskBoundariesService {
  const { integration, featureSupport, readAttestationConfig } = options;

  return {
    async getWorkspaceBinding(projectRoot, taskId): Promise<WorkspaceBindingView> {
      if (featureSupport && featureSupport.workspaceBinding !== true) return workspaceViewUnavailable(featureSupport);
      if (!integration.readTaskWorkspaceBinding) return workspaceViewUnavailable(featureSupport);
      try {
        return normalizeWorkspaceBinding(await integration.readTaskWorkspaceBinding(projectRoot, taskId));
      } catch (error) {
        return {
          ...workspaceViewUnavailable(featureSupport),
          error: thrownError(error, 'E_CANONICAL_WORKSPACE_BINDING_INVOCATION'),
        };
      }
    },

    async getHandoffs(projectRoot, taskId): Promise<TaskHandoffsView> {
      if (featureSupport && featureSupport.canonicalHandoffs !== true) return handoffsUnavailable(featureSupport);
      if (!integration.readTaskHandoffs) return handoffsUnavailable(featureSupport);
      try {
        return normalizeHandoffs(await integration.readTaskHandoffs(projectRoot, taskId));
      } catch (error) {
        return {
          ...handoffsUnavailable(featureSupport),
          error: thrownError(error, 'E_CANONICAL_HANDOFFS_INVOCATION'),
        };
      }
    },

    async getResponsibility(projectRoot, taskId): Promise<ResponsibilityView> {
      if (featureSupport && featureSupport.responsibilityConstraints !== true) return responsibilityUnavailable(featureSupport);
      if (!integration.readTaskResponsibility) return responsibilityUnavailable(featureSupport);
      try {
        return normalizeResponsibility(await integration.readTaskResponsibility(projectRoot, taskId));
      } catch (error) {
        return {
          ...responsibilityUnavailable(featureSupport),
          errors: [thrownError(error, 'E_CANONICAL_RESPONSIBILITY_INVOCATION')],
        };
      }
    },

    async getVerificationScope(projectRoot, taskId): Promise<VerificationScopeView> {
      if (featureSupport && featureSupport.differentialVerificationScope !== true) return verificationScopeUnavailable(featureSupport);
      if (!integration.readTaskVerificationScope) return verificationScopeUnavailable(featureSupport);
      try {
        return normalizeVerificationScope(await integration.readTaskVerificationScope(projectRoot, taskId));
      } catch (error) {
        if (isMissingVerificationScope(error)) {
          return {
            ...verificationScopeUnavailable(featureSupport),
            available: true,
            source: 'FORGELOOP_INTEGRATION',
            error: null,
          };
        }
        return {
          ...verificationScopeUnavailable(featureSupport),
          error: thrownError(error, 'E_CANONICAL_VERIFICATION_SCOPE_INVOCATION'),
        };
      }
    },

    /**
     * This is intentionally selected-task/panel scoped. ForgeLoop may inspect
     * source content or a configured signing provider while resolving this
     * canonical resource; it is never part of project snapshot refresh.
     */
    async getAttestation(projectRoot, taskId): Promise<TaskAttestationView> {
      if (featureSupport && featureSupport.codeAttestation !== true) return attestationUnavailable(featureSupport);
      if (!integration.readTaskAttestation) return attestationUnavailable(featureSupport);
      const readPolicy = readAttestationReadPolicy(readAttestationConfig);
      if (!readPolicy.automaticCanonicalReadAllowed) return attestationReadBlocked(readPolicy);
      try {
        return { ...normalizeAttestation(await integration.readTaskAttestation(projectRoot, taskId)), readPolicy };
      } catch (error) {
        return {
          ...attestationUnavailable(featureSupport),
          readPolicy,
          errors: [thrownError(error, 'E_CANONICAL_ATTESTATION_INVOCATION')],
        };
      }
    },
  };
}
