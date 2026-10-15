import type { ForgeLoopIntegrationAdapter } from './forgeloop-integration';
import type { ForgeLoopFeatureSupport, ExecutionProfileContextView, ExecutionProfileName, ExecutionProfileRequest } from '@shared/domain';

const PROFILE_NAMES: readonly ExecutionProfileName[] = ['light', 'balanced', 'full'];
const REQUIRED_INVARIANTS = [
  'lifecyclePhasesPreserved',
  'requiredGatesPreserved',
  'evidenceRequirementsPreserved',
  'verificationTruthPreserved',
  'authorityChecksPreserved',
  'provenancePreserved',
  'completionValidationPreserved',
  'safetyFloorPreserved',
  'lifecyclePhaseSkippingAllowed',
] as const;

const BALANCED_POLICY = {
  contextDepth: 'relevant',
  output: 'standard',
  planDepth: 'standard',
  guideStrategy: 'relevant',
  verificationStrategy: 'normal',
  optionalArtifacts: 'lazy',
  requiredSections: ['objective', 'scope', 'implementation', 'verification', 'relevant-history'],
  excludedContext: ['unrelated-repository-context'],
  allowedOptionalContext: ['task-history', 'relevant-artifacts'],
};

const BALANCED_INVARIANTS: Record<string, boolean> = Object.freeze({
  lifecyclePhasesPreserved: true,
  requiredGatesPreserved: true,
  evidenceRequirementsPreserved: true,
  verificationTruthPreserved: true,
  authorityChecksPreserved: true,
  provenancePreserved: true,
  completionValidationPreserved: true,
  safetyFloorPreserved: true,
  lifecyclePhaseSkippingAllowed: false,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function boundedString(value: unknown, label: string, nullable = false): string | null {
  if (value === null && nullable) return null;
  const result = stringValue(value);
  if (!result || result.length > 10_000) throw new Error(label + ' is not a bounded string');
  return result;
}

function boundedStringArray(value: unknown, label: string, max = 64): string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(label + ' is not a bounded string list');
  return value.map((entry) => boundedString(entry, label) as string);
}

function profileValue(value: unknown, label: string): ExecutionProfileName {
  if (!PROFILE_NAMES.includes(value as ExecutionProfileName)) {
    throw new Error(label + ' is not a supported execution profile');
  }
  return value as ExecutionProfileName;
}

function requestValue(value: unknown): ExecutionProfileRequest | null {
  if (value === null || value === undefined) return null;
  if (value === 'auto' || PROFILE_NAMES.includes(value as ExecutionProfileName)) {
    return value as ExecutionProfileRequest;
  }
  throw new Error('executionProfile.requested is not a supported profile request');
}

function normalizePolicy(value: unknown): ExecutionProfileContextView['contextPolicy'] {
  if (!isRecord(value)) throw new Error('contextPolicy is unavailable');
  return {
    contextDepth: boundedString(value.contextDepth, 'contextPolicy.contextDepth') as string,
    output: boundedString(value.output, 'contextPolicy.output') as string,
    planDepth: boundedString(value.planDepth, 'contextPolicy.planDepth') as string,
    guideStrategy: boundedString(value.guideStrategy, 'contextPolicy.guideStrategy') as string,
    verificationStrategy: boundedString(value.verificationStrategy, 'contextPolicy.verificationStrategy') as string,
    optionalArtifacts: boundedString(value.optionalArtifacts, 'contextPolicy.optionalArtifacts') as string,
    requiredSections: boundedStringArray(value.requiredSections, 'contextPolicy.requiredSections', 32),
    excludedContext: boundedStringArray(value.excludedContext, 'contextPolicy.excludedContext', 64),
    allowedOptionalContext: boundedStringArray(value.allowedOptionalContext, 'contextPolicy.allowedOptionalContext', 64),
  };
}

function normalizeProfile(value: unknown): ExecutionProfileContextView['executionProfile'] {
  if (!isRecord(value)) throw new Error('executionProfile is unavailable');
  const requested = requestValue(value.requested);
  const floor = profileValue(value.floor, 'executionProfile.floor');
  const resolved = profileValue(value.resolved, 'executionProfile.resolved');
  if (typeof value.escalated !== 'boolean') throw new Error('executionProfile.escalated is invalid');
  return {
    requested,
    floor,
    resolved,
    reasons: boundedStringArray(value.reasons ?? [], 'executionProfile.reasons', 32),
    escalated: value.escalated,
  };
}

function normalizeInvariants(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) throw new Error('invariants are unavailable');
  for (const key of REQUIRED_INVARIANTS) {
    if (typeof value[key] !== 'boolean') throw new Error('invariants.' + key + ' is invalid');
  }
  if (value.lifecyclePhaseSkippingAllowed !== false) {
    throw new Error('lifecycle phase skipping is not allowed');
  }
  return Object.fromEntries(REQUIRED_INVARIANTS.map((key) => [key, value[key] as boolean]));
}

function normalizeRequirements(value: unknown): ExecutionProfileContextView['verificationRequirements'] {
  if (!Array.isArray(value) || value.length > 64) throw new Error('verificationRequirements is not bounded');
  return value.map((entry) => {
    if (!isRecord(entry)) throw new Error('verificationRequirements contains an invalid entry');
    return {
      id: boundedString(entry.id, 'verificationRequirements.id', true),
      text: boundedString(entry.text, 'verificationRequirements.text', true),
      type: boundedString(entry.type, 'verificationRequirements.type', true),
    };
  });
}

function normalizeUsage(value: unknown): ExecutionProfileContextView['usage'] {
  if (!isRecord(value)) return null;
  const source = value.source;
  if (source !== 'PROVIDER_REPORTED' && source !== 'HOST_REPORTED' && source !== 'ACTOR_REPORTED' && source !== 'UNKNOWN') {
    return null;
  }
  const integer = (entry: unknown): number | null => (
    entry === null || entry === undefined
      ? null
      : Number.isInteger(entry) && (entry as number) >= 0
        ? entry as number
        : null
  );
  const costUsd = value.costUsd === null || value.costUsd === undefined
    ? null
    : typeof value.costUsd === 'number' && Number.isFinite(value.costUsd) && value.costUsd >= 0
      ? value.costUsd
      : null;
  const normalizedSource = source as NonNullable<ExecutionProfileContextView['usage']>['source'];
  const usage = {
    source: normalizedSource,
    inputTokens: integer(value.inputTokens),
    outputTokens: integer(value.outputTokens),
    cacheReadTokens: integer(value.cacheReadTokens),
    cacheWriteTokens: integer(value.cacheWriteTokens),
    totalTokens: integer(value.totalTokens),
    costUsd,
    model: stringValue(value.model),
    provider: stringValue(value.provider),
  };
  return source === 'UNKNOWN'
    ? { ...usage, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, totalTokens: null, costUsd: null }
    : usage;
}

export function normalizeExecutionProfileContext(
  value: unknown,
  expectedTaskId?: string,
): ExecutionProfileContextView {
  const raw = isRecord(value) && isRecord(value.data) ? value.data : value;
  if (!isRecord(raw)) throw new Error('task/context did not return an object');
  const taskId = boundedString(raw.taskId, 'taskId') as string;
  if (expectedTaskId && taskId !== expectedTaskId) throw new Error('task/context taskId does not match the requested task');
  const executionProfile = normalizeProfile(raw.executionProfile);
  const optionalContext = isRecord(raw.optionalContext) ? raw.optionalContext : {};
  return {
    available: true,
    source: 'FORGELOOP_INTEGRATION',
    status: 'CANONICAL',
    taskId,
    executionProfile,
    contextPolicy: normalizePolicy(raw.contextPolicy),
    objective: boundedString(raw.objective, 'objective', true),
    deliverables: boundedStringArray(raw.deliverables ?? [], 'deliverables'),
    constraints: boundedStringArray(raw.constraints ?? [], 'constraints'),
    selectedGuideIds: boundedStringArray(raw.selectedGuideIds ?? [], 'selectedGuideIds'),
    verificationRequirements: normalizeRequirements(raw.verificationRequirements ?? []),
    optionalContext: {
      available: boundedStringArray(optionalContext.available ?? [], 'optionalContext.available'),
      loaded: boundedStringArray(optionalContext.loaded ?? [], 'optionalContext.loaded'),
    },
    invariants: normalizeInvariants(raw.invariants),
    usage: normalizeUsage(raw.usage ?? raw.contextUsage),
    error: null,
  };
}

export function balancedCompatibilityContext(reason = 'Canonical task/context is not advertised by this ForgeLoop build.'): ExecutionProfileContextView {
  return {
    available: true,
    source: 'COMPATIBILITY_FALLBACK',
    status: 'COMPATIBILITY_FALLBACK',
    taskId: null,
    executionProfile: {
      requested: 'balanced',
      floor: 'balanced',
      resolved: 'balanced',
      reasons: ['LEGACY_ROUTE_COMPATIBILITY'],
      escalated: false,
    },
    contextPolicy: { ...BALANCED_POLICY },
    objective: null,
    deliverables: [],
    constraints: [],
    selectedGuideIds: [],
    verificationRequirements: [],
    optionalContext: { available: [], loaded: [] },
    invariants: { ...BALANCED_INVARIANTS },
    usage: null,
    error: { code: 'E_COMPATIBILITY_FALLBACK', message: reason },
  };
}

function unavailable(reason: string, code = 'E_CANONICAL_CONTEXT_UNAVAILABLE'): ExecutionProfileContextView {
  return {
    available: false,
    source: 'UNAVAILABLE',
    status: 'UNAVAILABLE',
    taskId: null,
    executionProfile: { requested: null, floor: null, resolved: null, reasons: [], escalated: null },
    contextPolicy: null,
    objective: null,
    deliverables: [],
    constraints: [],
    selectedGuideIds: [],
    verificationRequirements: [],
    optionalContext: { available: [], loaded: [] },
    invariants: null,
    usage: null,
    error: { code, message: reason },
  };
}

export interface CanonicalExecutionProfileContextService {
  getContext(projectRoot: string, taskId: string): Promise<ExecutionProfileContextView>;
}

export function createCanonicalExecutionProfileContextService(options: {
  integration: ForgeLoopIntegrationAdapter;
  featureSupport?: Pick<ForgeLoopFeatureSupport, 'executionProfileContext'>;
}): CanonicalExecutionProfileContextService {
  const { integration, featureSupport } = options;
  return {
    async getContext(projectRoot, taskId): Promise<ExecutionProfileContextView> {
      if (featureSupport?.executionProfileContext === false) {
        return balancedCompatibilityContext();
      }
      if (!integration.readTaskContext) {
        return featureSupport?.executionProfileContext === true
          ? unavailable('The advertised task/context resource is not available.')
          : balancedCompatibilityContext();
      }
      try {
        return normalizeExecutionProfileContext(
          await integration.readTaskContext(projectRoot, taskId),
          taskId,
        );
      } catch (error) {
        return unavailable(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
