import { existsSync } from 'fs';
import { join } from 'path';
import registry from './artifact-registry.json';

export const ARTIFACT_SCHEMAS = registry as Record<ArtifactName, string>;

/** Schemas used by canonical provider/status payloads without being persisted as ForgeLoopAudit artifacts. */
export const AUXILIARY_TRUSTED_SCHEMAS = [
  'code-attestation.schema.json',
  'attestation-verification-result.schema.json',
] as const;

export type ArtifactScope = 'PROJECT' | 'TASK' | 'COLLECTION' | 'SESSION';

export interface AuditArtifactDefinition {
  key: ArtifactName;
  schema: string;
  scope: ArtifactScope;
  pattern?: RegExp;
  authoritative: boolean;
}

export type ArtifactName =
  | 'config.json'
  | 'sources.json'
  | 'task.json'
  | 'contract.json'
  | 'routing-result.json'
  | 'preflight.json'
  | 'work-state.json'
  | 'continuity.json'
  | 'recovery.json'
  | 'execution.json'
  | 'execution-receipt.json'
  | 'session.json'
  | 'gate.json'
  | 'event'
  | 'policy-snapshot.json'
  | 'policy/rules.json'
  | 'policy/discovery.json'
  | 'policy/baseline.json'
  | 'policy/policy.lock'
  | 'action.json'
  | 'approval.json'
  | 'policy/capabilities.json'
  | 'trajectory-evaluation.json'
  | 'workspace-binding.json'
  | 'responsibility.json'
  | 'verification-scope.json'
  | 'handoff.json'
  | 'code-manifest.json'
  | 'attestation-statement.json';

export const REQUIRED_ARTIFACTS: ArtifactName[] = [
  'config.json',
  'sources.json',
];

export const TASK_ARTIFACTS: ArtifactName[] = [
  'task.json',
  'contract.json',
  'routing-result.json',
  'preflight.json',
  'work-state.json',
  'continuity.json',
  'execution-receipt.json',
  'workspace-binding.json',
  'responsibility.json',
  'verification-scope.json',
];

export const OPTIONAL_TASK_ARTIFACTS: ArtifactName[] = [
  'policy-snapshot.json',
  'action.json',
  'approval.json',
  'trajectory-evaluation.json',
  'code-manifest.json',
  'attestation-statement.json',
  'handoff.json',
];

export const ARTIFACT_DEFINITIONS: Record<ArtifactName, AuditArtifactDefinition> = {
  'config.json': { key: 'config.json', schema: ARTIFACT_SCHEMAS['config.json'], scope: 'PROJECT', authoritative: true },
  'sources.json': { key: 'sources.json', schema: ARTIFACT_SCHEMAS['sources.json'], scope: 'PROJECT', authoritative: true },
  'task.json': { key: 'task.json', schema: ARTIFACT_SCHEMAS['task.json'], scope: 'TASK', authoritative: true },
  'contract.json': { key: 'contract.json', schema: ARTIFACT_SCHEMAS['contract.json'], scope: 'TASK', authoritative: true },
  'routing-result.json': { key: 'routing-result.json', schema: ARTIFACT_SCHEMAS['routing-result.json'], scope: 'TASK', authoritative: true },
  'preflight.json': { key: 'preflight.json', schema: ARTIFACT_SCHEMAS['preflight.json'], scope: 'TASK', authoritative: true },
  'work-state.json': { key: 'work-state.json', schema: ARTIFACT_SCHEMAS['work-state.json'], scope: 'TASK', authoritative: true },
  'continuity.json': { key: 'continuity.json', schema: ARTIFACT_SCHEMAS['continuity.json'], scope: 'TASK', authoritative: true },
  'recovery.json': { key: 'recovery.json', schema: ARTIFACT_SCHEMAS['recovery.json'], scope: 'TASK', authoritative: false },
  'execution.json': { key: 'execution.json', schema: ARTIFACT_SCHEMAS['execution.json'], scope: 'COLLECTION', authoritative: false },
  'execution-receipt.json': { key: 'execution-receipt.json', schema: ARTIFACT_SCHEMAS['execution-receipt.json'], scope: 'TASK', authoritative: true },
  'session.json': { key: 'session.json', schema: ARTIFACT_SCHEMAS['session.json'], scope: 'SESSION', authoritative: true },
  'gate.json': { key: 'gate.json', schema: ARTIFACT_SCHEMAS['gate.json'], scope: 'COLLECTION', authoritative: false },
  'event': { key: 'event', schema: ARTIFACT_SCHEMAS.event, scope: 'COLLECTION', authoritative: true },
  'policy-snapshot.json': { key: 'policy-snapshot.json', schema: ARTIFACT_SCHEMAS['policy-snapshot.json'], scope: 'TASK', authoritative: true },
  'policy/rules.json': { key: 'policy/rules.json', schema: ARTIFACT_SCHEMAS['policy/rules.json'], scope: 'PROJECT', authoritative: true },
  'policy/discovery.json': { key: 'policy/discovery.json', schema: ARTIFACT_SCHEMAS['policy/discovery.json'], scope: 'PROJECT', authoritative: false },
  'policy/baseline.json': { key: 'policy/baseline.json', schema: ARTIFACT_SCHEMAS['policy/baseline.json'], scope: 'PROJECT', authoritative: true },
  'policy/policy.lock': { key: 'policy/policy.lock', schema: ARTIFACT_SCHEMAS['policy/policy.lock'], scope: 'PROJECT', authoritative: true },
  'action.json': { key: 'action.json', schema: ARTIFACT_SCHEMAS['action.json'], scope: 'COLLECTION', pattern: /^task-state\/[^/]+\/actions\/action-[A-Za-z0-9_-]+\.json$/, authoritative: true },
  'approval.json': { key: 'approval.json', schema: ARTIFACT_SCHEMAS['approval.json'], scope: 'COLLECTION', pattern: /^task-state\/[^/]+\/approvals\/approval-[A-Za-z0-9_-]+\.json$/, authoritative: true },
  'policy/capabilities.json': { key: 'policy/capabilities.json', schema: ARTIFACT_SCHEMAS['policy/capabilities.json'], scope: 'PROJECT', authoritative: true },
  'trajectory-evaluation.json': { key: 'trajectory-evaluation.json', schema: ARTIFACT_SCHEMAS['trajectory-evaluation.json'], scope: 'COLLECTION', pattern: /^task-state\/[^/]+\/evaluations\/eval-[A-Za-z0-9_-]+\.json$/, authoritative: true },
  'workspace-binding.json': { key: 'workspace-binding.json', schema: ARTIFACT_SCHEMAS['workspace-binding.json'], scope: 'TASK', authoritative: true },
  'responsibility.json': { key: 'responsibility.json', schema: ARTIFACT_SCHEMAS['responsibility.json'], scope: 'TASK', authoritative: true },
  'verification-scope.json': { key: 'verification-scope.json', schema: ARTIFACT_SCHEMAS['verification-scope.json'], scope: 'TASK', authoritative: true },
  'handoff.json': { key: 'handoff.json', schema: ARTIFACT_SCHEMAS['handoff.json'], scope: 'COLLECTION', pattern: /^task-state\/[^/]+\/handoffs\/handoff-[A-Za-z0-9_-]+\.json$/, authoritative: false },
  'code-manifest.json': { key: 'code-manifest.json', schema: ARTIFACT_SCHEMAS['code-manifest.json'], scope: 'COLLECTION', pattern: /^task-state\/[^/]+\/attestations\/code-manifest\.json$/, authoritative: true },
  'attestation-statement.json': { key: 'attestation-statement.json', schema: ARTIFACT_SCHEMAS['attestation-statement.json'], scope: 'COLLECTION', pattern: /^task-state\/[^/]+\/attestations\/statement\.json$/, authoritative: true },
};

export function getSchemaForArtifact(artifact: ArtifactName): string {
  return ARTIFACT_SCHEMAS[artifact];
}

export function getArtifactDefinition(artifact: ArtifactName): AuditArtifactDefinition {
  return ARTIFACT_DEFINITIONS[artifact];
}

export function isCollectionArtifact(artifact: ArtifactName): boolean {
  return ARTIFACT_DEFINITIONS[artifact].scope === 'COLLECTION';
}

export function isRequiredArtifact(artifact: ArtifactName): boolean {
  return REQUIRED_ARTIFACTS.includes(artifact);
}

export function isTaskArtifact(artifact: ArtifactName): boolean {
  return TASK_ARTIFACTS.includes(artifact) || OPTIONAL_TASK_ARTIFACTS.includes(artifact);
}

export function getMissingArtifactSchemas(schemasDir: string): string[] {
  return [...new Set([...Object.values(ARTIFACT_SCHEMAS), ...AUXILIARY_TRUSTED_SCHEMAS])].filter((schema) => {
    return !existsSync(join(schemasDir, schema));
  });
}
