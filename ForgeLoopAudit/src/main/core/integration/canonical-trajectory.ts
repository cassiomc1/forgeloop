import type { ForgeLoopIntegrationAdapter } from './forgeloop-integration';
import type { TrajectoryEvaluationsView, TrajectoryMetricsView } from '@shared/domain';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function listFromResource(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data) && Array.isArray(data.evaluations)) return data.evaluations.filter(isRecord);
  return [];
}

export interface CanonicalTrajectoryService {
  getMetrics(projectRoot: string, taskId: string): Promise<TrajectoryMetricsView>;
  getEvaluations(projectRoot: string, taskId: string): Promise<TrajectoryEvaluationsView>;
}

export function createCanonicalTrajectoryService(options: {
  integration: ForgeLoopIntegrationAdapter;
  featureSupport?: { trajectoryMetrics?: boolean; trajectoryEvaluations?: boolean };
}): CanonicalTrajectoryService {
  const { integration, featureSupport } = options;

  return {
    async getMetrics(projectRoot, taskId): Promise<TrajectoryMetricsView> {
      if (featureSupport && featureSupport.trajectoryMetrics !== true) {
        return {
          available: false,
          source: 'UNAVAILABLE',
          metrics: null,
          error: { code: 'E_FEATURE_UNAVAILABLE', message: 'Not available with the bundled ForgeLoop capability set.' },
        };
      }
      try {
        if (!integration.readTaskMetrics) throw new Error('Canonical trajectory metrics resource is not available.');
        return {
          available: true,
          source: 'FORGELOOP_INTEGRATION',
          metrics: await integration.readTaskMetrics(projectRoot, taskId),
          error: null,
        };
      } catch (error) {
        return {
          available: false,
          source: 'UNAVAILABLE',
          metrics: null,
          error: { code: 'E_CANONICAL_METRICS_INVOCATION', message: error instanceof Error ? error.message : String(error) },
        };
      }
    },

    async getEvaluations(projectRoot, taskId): Promise<TrajectoryEvaluationsView> {
      if (featureSupport && featureSupport.trajectoryEvaluations !== true) {
        return {
          available: false,
          source: 'UNAVAILABLE',
          evaluations: [],
          error: { code: 'E_FEATURE_UNAVAILABLE', message: 'Not available with the bundled ForgeLoop capability set.' },
        };
      }
      try {
        if (!integration.readTaskEvaluations) throw new Error('Canonical trajectory evaluations resource is not available.');
        const data = await integration.readTaskEvaluations(projectRoot, taskId);
        return {
          available: true,
          source: 'FORGELOOP_INTEGRATION',
          evaluations: listFromResource(data),
          error: null,
        };
      } catch (error) {
        return {
          available: false,
          source: 'UNAVAILABLE',
          evaluations: [],
          error: { code: 'E_CANONICAL_EVALUATIONS_INVOCATION', message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
  };
}
