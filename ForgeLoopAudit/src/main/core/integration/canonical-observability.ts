import { runAuditReadCommand } from './audit-read-commands';
import type { ForgeLoopIntegrationAdapter } from './forgeloop-integration';
import type {
  CanonicalHistoryViewModel,
  CanonicalInspectionViewModel,
  CanonicalProjectionView,
  CanonicalReflectionViewModel,
  CanonicalTraceViewModel,
  ForgeLoopFeatureSupport,
  TaskHistoryView,
  TaskInspectionView,
  TaskReflectionView,
  TaskTraceView,
} from '@shared/domain';
import {
  normalizeCanonicalHistory,
  normalizeCanonicalInspection,
  normalizeCanonicalReflection,
  normalizeCanonicalTrace,
} from './observability-models';

export type CanonicalObservabilityKind = 'history' | 'trace' | 'reflect' | 'inspect';

export interface CanonicalObservabilityService {
  getHistory(projectRoot: string, taskId: string): Promise<TaskHistoryView>;
  getTrace(projectRoot: string, taskId: string): Promise<TaskTraceView>;
  getReflection(projectRoot: string, taskId: string): Promise<TaskReflectionView>;
  getInspection(projectRoot: string, taskId: string): Promise<TaskInspectionView>;
}

type ProjectionMap = {
  history: CanonicalHistoryViewModel;
  trace: CanonicalTraceViewModel;
  reflect: CanonicalReflectionViewModel;
  inspect: CanonicalInspectionViewModel;
};

const NORMALIZERS: { [K in CanonicalObservabilityKind]: (value: unknown) => ProjectionMap[K] } = {
  history: normalizeCanonicalHistory,
  trace: normalizeCanonicalTrace,
  reflect: normalizeCanonicalReflection,
  inspect: normalizeCanonicalInspection,
};

function unavailable<T>(feature: CanonicalObservabilityKind, featureSupport?: ForgeLoopFeatureSupport): CanonicalProjectionView<T> {
  const supported = featureSupport?.observability === true;
  return {
    available: false,
    source: 'UNAVAILABLE',
    feature,
    data: null,
    result: null,
    exitCode: null,
    error: {
      code: supported ? 'E_CANONICAL_OBSERVABILITY_UNAVAILABLE' : 'E_FEATURE_UNAVAILABLE',
      message: supported
        ? `ForgeLoop did not provide the canonical ${feature} projection.`
        : 'Not available with the bundled ForgeLoop capability set.',
    },
  };
}

async function readProjection<K extends CanonicalObservabilityKind>(
  integration: ForgeLoopIntegrationAdapter,
  projectRoot: string,
  taskId: string,
  feature: K,
  featureSupport?: ForgeLoopFeatureSupport,
): Promise<CanonicalProjectionView<ProjectionMap[K]>> {
  if (featureSupport && featureSupport.observability !== true) return unavailable(feature, featureSupport);

  try {
    const outcome = await runAuditReadCommand<Record<string, unknown>>(
      integration,
      projectRoot,
      feature,
      { taskId },
    );
    if (outcome.kind === 'INVOCATION_FAILURE') {
      return {
        available: false,
        source: 'UNAVAILABLE',
        feature,
        data: null,
        result: null,
        exitCode: outcome.exitCode,
        error: outcome.error,
      };
    }
    const normalized = NORMALIZERS[feature](outcome.data);
    return {
      available: true,
      source: 'FORGELOOP_INTEGRATION',
      feature,
      data: normalized,
      result: normalized,
      exitCode: outcome.exitCode,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      source: 'UNAVAILABLE',
      feature,
      data: null,
      result: null,
      exitCode: -1,
      error: {
        code: 'E_CANONICAL_OBSERVABILITY_INVOCATION',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function createCanonicalObservabilityService(options: {
  integration: ForgeLoopIntegrationAdapter;
  featureSupport?: ForgeLoopFeatureSupport;
}): CanonicalObservabilityService {
  const { integration, featureSupport } = options;
  return {
    getHistory: (projectRoot, taskId) => readProjection(integration, projectRoot, taskId, 'history', featureSupport),
    getTrace: (projectRoot, taskId) => readProjection(integration, projectRoot, taskId, 'trace', featureSupport),
    getReflection: (projectRoot, taskId) => readProjection(integration, projectRoot, taskId, 'reflect', featureSupport),
    getInspection: (projectRoot, taskId) => readProjection(integration, projectRoot, taskId, 'inspect', featureSupport),
  };
}
