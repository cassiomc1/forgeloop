import type { StructuralQualityAuditView } from '@shared/audit';
import type { ForgeLoopFeatureSupport } from '@shared/domain';
import type { ForgeLoopIntegrationAdapter } from '@main/core/integration/forgeloop-integration';
import { normalizeStructuralQuality, unavailableStructuralQuality } from './audit-normalizer';

export interface StructuralQualityAuditService {
  readTask(taskId: string): Promise<StructuralQualityAuditView>;
}

export function createStructuralQualityAuditService(options: {
  projectRoot: string;
  integration: ForgeLoopIntegrationAdapter;
  featureSupport?: ForgeLoopFeatureSupport;
}): StructuralQualityAuditService {
  return {
    async readTask(taskId: string): Promise<StructuralQualityAuditView> {
      if (options.featureSupport?.structuralQuality !== true || !options.integration.readTaskStructuralQuality) {
        return unavailableStructuralQuality(taskId, 'Structural quality is not advertised by the bundled ForgeLoop integration.');
      }
      try {
        const projection = await options.integration.readTaskStructuralQuality(options.projectRoot, taskId);
        return normalizeStructuralQuality(projection, taskId);
      } catch (error) {
        return unavailableStructuralQuality(taskId, error instanceof Error ? error.message : 'Canonical structural quality is unavailable.');
      }
    },
  };
}
