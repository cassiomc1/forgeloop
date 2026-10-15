import type {
  AuditProjectOptions,
  CanonicalTaskAudit,
  ProjectAuditSnapshot,
  StructuralQualityAuditView,
  TaskAuditSnapshot,
} from '@shared/audit';
import type { ForgeLoopCompatibilityMode, ForgeLoopFeatureSupport, ProjectSnapshot, TaskReflectionView } from '@shared/domain';
import {
  FORGELOOP_PACKAGE_VERSION,
  FORGELOOP_UPSTREAM_COMMIT,
  type ForgeLoopIntegrationAdapter,
} from '@main/core/integration/forgeloop-integration';
import { normalizeCanonicalTaskAudit } from './audit-normalizer';
import { createCanonicalAuditService, type CanonicalAuditService } from './canonical-audit-service';
import { createStructuralQualityAuditService, type StructuralQualityAuditService } from './structural-quality-service';
import { canonicalErrorToFinding, structuralQualityToFinding } from './finding-factory';
import { deriveAuditFindings } from './finding-rules';
import { aggregateProjectAudit } from './audit-aggregator';
import { createProjectAuditFingerprint } from './audit-fingerprint';
import type { CanonicalObservabilityService } from '@main/core/integration/canonical-observability';

export interface ProjectAuditService {
  auditProject(options?: AuditProjectOptions): Promise<ProjectAuditSnapshot>;
  auditTask(taskId: string): Promise<TaskAuditSnapshot>;
}

export interface ProjectAuditServiceOptions {
  projectRoot: string;
  snapshotBuilder?: { build(): Promise<ProjectSnapshot> };
  getSnapshot?: () => Promise<ProjectSnapshot>;
  integration?: ForgeLoopIntegrationAdapter | null;
  observability?: CanonicalObservabilityService | null;
  compatibilityMode: ForgeLoopCompatibilityMode;
  featureSupport?: ForgeLoopFeatureSupport;
  forgeLoopPackageVersion?: string;
  forgeLoopCommit?: string;
  integrationApiVersion?: number | null;
  auditEngineVersion?: string;
}

function unavailableAudit(taskId: string): CanonicalTaskAudit {
  return normalizeCanonicalTaskAudit({
    ok: false,
    command: 'audit',
    taskId,
    error: { code: 'E_CANONICAL_AUDIT_UNAVAILABLE', message: 'Canonical ForgeLoop audit is unavailable in artifact-only mode.' },
  }, null);
}

async function inBatches<T>(items: string[], worker: (item: string) => Promise<T>, batchSize = 4): Promise<T[]> {
  const output: T[] = [];
  for (let offset = 0; offset < items.length; offset += batchSize) {
    output.push(...await Promise.all(items.slice(offset, offset + batchSize).map(worker)));
  }
  return output;
}

export function createProjectAuditService(options: ProjectAuditServiceOptions): ProjectAuditService {
  let canonical: CanonicalAuditService | null = null;
  let structural: StructuralQualityAuditService | null = null;
  if (options.integration && options.compatibilityMode === 'INTEGRATION_V1') {
    canonical = createCanonicalAuditService({ projectRoot: options.projectRoot, integration: options.integration });
    structural = createStructuralQualityAuditService({
      projectRoot: options.projectRoot,
      integration: options.integration,
      featureSupport: options.featureSupport,
    });
  }

  const loadSnapshot = async (): Promise<ProjectSnapshot> => {
    if (options.getSnapshot) return options.getSnapshot();
    if (options.snapshotBuilder) return options.snapshotBuilder.build();
    throw new Error('Project audit requires a snapshot provider.');
  };

  const auditTaskWithQuality = async (task: ProjectSnapshot['tasks'][number], includeStructuralQuality: boolean): Promise<{ audit: CanonicalTaskAudit; quality: StructuralQualityAuditView | null; findings: ReturnType<typeof canonicalErrorToFinding>[] }> => {
    const [audit, quality, reflectionView] = await Promise.all([
      canonical ? canonical.auditTask(task.taskId) : Promise.resolve(unavailableAudit(task.taskId)),
      includeStructuralQuality && structural ? structural.readTask(task.taskId) : Promise.resolve(null),
      options.observability && options.featureSupport?.observability === true
        ? options.observability.getReflection(options.projectRoot, task.taskId)
        : Promise.resolve<TaskReflectionView | null>(null),
    ]);
    // Errors and warnings keep their canonical channel so that an unclassified
    // error blocks a positive verdict while an advisory warning does not.
    const findings = [
      ...audit.errors.map((error) => canonicalErrorToFinding(error, {
        taskId: task.taskId,
        structuralQualityMode: quality?.mode,
        channel: 'ERROR',
      })),
      ...audit.warnings.map((warning) => canonicalErrorToFinding(warning, {
        taskId: task.taskId,
        structuralQualityMode: quality?.mode,
        channel: 'WARNING',
      })),
    ];
    const qualityFinding = quality ? structuralQualityToFinding(quality) : null;
    const derivedFindings = deriveAuditFindings({
      taskId: task.taskId,
      reflection: reflectionView?.available ? reflectionView.data : null,
      evidenceCoverage: task.evidenceCoverage,
    });
    return { audit, quality, findings: qualityFinding ? [...findings, qualityFinding, ...derivedFindings] : [...findings, ...derivedFindings] };
  };

  return {
    async auditProject(auditOptions: AuditProjectOptions = {}): Promise<ProjectAuditSnapshot> {
      const snapshot = await loadSnapshot();
      const taskIds = snapshot.tasks.map((task) => task.taskId).sort((left, right) => left.localeCompare(right));
      const includeStructuralQuality = auditOptions.includeStructuralQuality !== false
        && options.featureSupport?.structuralQuality === true;
      const results = await inBatches(taskIds, (taskId) => {
        const task = snapshot.tasks.find((entry) => entry.taskId === taskId);
        if (!task) throw new Error(`Task ${taskId} disappeared while auditing the project.`);
        return auditTaskWithQuality(task, includeStructuralQuality);
      });
      const taskAudits = results.map((result) => result.audit);
      const qualityViews = results.map((result) => result.quality).filter((view): view is StructuralQualityAuditView => view !== null);
      const findings = results.flatMap((result) => result.findings);
      const capabilities = options.integration?.getCapabilities();
      const canonicalAuditCovered = taskAudits.length === 0
        ? options.compatibilityMode === 'INTEGRATION_V1'
        : taskAudits.every((audit) => audit.available);
      return aggregateProjectAudit({
        project: snapshot.project,
        protocol: snapshot.protocol,
        taskAudits,
        qualityViews,
        findings,
        compatibilityMode: auditOptions.compatibilityMode ?? options.compatibilityMode,
        forgeLoopPackageVersion: options.forgeLoopPackageVersion ?? options.integration?.getPackageVersion() ?? FORGELOOP_PACKAGE_VERSION,
        forgeLoopCommit: options.forgeLoopCommit ?? FORGELOOP_UPSTREAM_COMMIT,
        integrationApiVersion: options.integrationApiVersion ?? capabilities?.integrationApiVersion ?? null,
        gitHead: snapshot.project.head ?? null,
        auditEngineVersion: options.auditEngineVersion,
        coverage: {
          canonicalAudit: canonicalAuditCovered,
          canonicalOwnership: options.featureSupport?.canonicalOwnership === true,
          structuredDiagnostics: options.featureSupport?.structuredDiagnostics === true,
          policy: options.featureSupport?.capabilityPolicy === true,
          structuralQuality: includeStructuralQuality && qualityViews.some((view) => view.available),
          codeAttestation: options.featureSupport?.codeAttestation === true,
          verificationScope: options.featureSupport?.differentialVerificationScope === true,
          executionProvenance: options.featureSupport?.verificationExecutionIsolation === true,
        },
      });
    },

    async auditTask(taskId: string): Promise<TaskAuditSnapshot> {
      const snapshot = await loadSnapshot();
      const task = snapshot.tasks.find((entry) => entry.taskId === taskId);
      const result = await auditTaskWithQuality(task ?? {
        taskId,
        taskKey: taskId,
        phase: 'RECEIVED',
        selectedGuides: [],
        completedSteps: [],
        pendingSteps: [],
        blockers: [],
        failures: [],
        checks: [],
        gates: [],
        evidenceCoverage: { total: 0, covered: 0, partial: 0, notVerified: 0, blocked: 0, coveragePercent: 0 },
        ownership: { claimState: 'UNKNOWN', mutationAllowed: null, ownershipValid: null, historicalWriteClaims: [], effectiveWriteClaims: [], reasonCodes: [], source: 'UNAVAILABLE' },
        operationalState: 'READ_ONLY_UNKNOWN',
      }, options.featureSupport?.structuralQuality === true);
      const generatedAt = new Date().toISOString();
      const base = {
        schemaVersion: 1 as const,
        auditEngineVersion: options.auditEngineVersion ?? '0.2.0-rc.1',
        taskId,
        canonical: result.audit,
        structuralQuality: result.quality,
        findings: result.findings,
        generatedAt,
      };
      return { ...base, fingerprint: createProjectAuditFingerprint({
        schemaVersion: 1,
        auditEngineVersion: base.auditEngineVersion,
        project: { name: taskId, rootPath: options.projectRoot },
        protocol: { protocolVersion: 1, schemaVersion: 1, compatible: result.audit.available },
        generatedAt,
        gitHead: null,
        verdict: { integrity: 'UNKNOWN', completionReadiness: result.audit.status, quality: result.quality?.current.status === 'PASS' ? 'PASS' : 'NOT_OBSERVED', trust: 'UNKNOWN' },
        coverage: { percent: result.audit.available ? 100 : 0, canonicalAudit: result.audit.available, canonicalOwnership: false, structuredDiagnostics: false, policy: false, structuralQuality: result.quality?.available === true, codeAttestation: false, verificationScope: false, executionProvenance: false, unavailable: [] },
        score: null,
        taskAudits: [],
        findings: result.findings,
        counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0, unknown: 0 },
        provenance: { forgeLoopPackageVersion: options.forgeLoopPackageVersion ?? 'unknown', forgeLoopCommit: options.forgeLoopCommit ?? 'unknown', integrationApiVersion: options.integrationApiVersion ?? null, auditRulesVersion: 'forgeloop-audit-rules/v1' },
      }) };
    },
  };
}
