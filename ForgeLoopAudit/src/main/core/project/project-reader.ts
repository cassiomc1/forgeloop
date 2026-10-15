import { readFileSync, readdirSync, lstatSync, existsSync, openSync, readSync, closeSync, fstatSync } from 'fs';
import { join } from 'path';
import { ForgeLoopAuditError } from '@shared/errors';
import { parseJsonSafely, RESOURCE_LIMITS } from '@main/security/resource-limits';
import { PathBoundary } from '@main/security/path-boundary';
import { CONFIG_FILE, SOURCES_FILE, MANIFEST_FILE, LEGACY_MANIFEST_FILE, TASK_STATE_DIR, SESSIONS_DIR, POLICY_DIR } from '@shared/constants';
import type { ProjectDetectionResult, RawCollectionArtifactRequest } from '@shared/domain';
import { checkProtocolCompatibility } from '@main/core/protocol/compatibility';
import { SchemaValidator } from '@main/core/protocol/validator';
import { ARTIFACT_SCHEMAS } from '@main/core/protocol/artifact-registry';

export interface ForgeLoopConfig {
  schemaVersion: number;
  protocolVersion: number;
  projectName?: string;
  complianceMode?: string;
  attestation?: {
    mode?: 'off' | 'optional' | 'required' | string;
    signing?: {
      provider?: string;
      required?: boolean;
    };
  };
}

export interface ForgeLoopSources {
  schemaVersion: number;
  protocolVersion: number;
  sources: Record<string, { kind: string; summary: string; status: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCanonicalArtifact(name: string, value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (name === 'task.json') return typeof value.taskId === 'string' && value.taskId.length > 0;
  if (name === 'work-state.json') return value.phase === undefined || typeof value.phase === 'string';
  if (name === 'policy.lock') return typeof value.digest === 'string' || typeof value.rulesDigest === 'string' || typeof value.baselineDigest === 'string';
  return true;
}

function assertJsonFileSize(relativePath: string, size: number): void {
  if (size > RESOURCE_LIMITS.JSON_MAX_SIZE_BYTES) {
    throw ForgeLoopAuditError.artifactInvalid(
      relativePath,
      `JSON artifact exceeds maximum size of ${RESOURCE_LIMITS.JSON_MAX_SIZE_BYTES} bytes`,
    );
  }
}

const SCHEMA_BY_FILE: Record<string, string> = {
  'config.json': ARTIFACT_SCHEMAS['config.json'],
  'sources.json': ARTIFACT_SCHEMAS['sources.json'],
  'task.json': ARTIFACT_SCHEMAS['task.json'],
  'contract.json': ARTIFACT_SCHEMAS['contract.json'],
  'routing-result.json': ARTIFACT_SCHEMAS['routing-result.json'],
  'preflight.json': ARTIFACT_SCHEMAS['preflight.json'],
  'work-state.json': ARTIFACT_SCHEMAS['work-state.json'],
  'continuity.json': ARTIFACT_SCHEMAS['continuity.json'],
  'recovery.json': ARTIFACT_SCHEMAS['recovery.json'],
  'execution-receipt.json': ARTIFACT_SCHEMAS['execution-receipt.json'],
  'session.json': ARTIFACT_SCHEMAS['session.json'],
  'policy-snapshot.json': ARTIFACT_SCHEMAS['policy-snapshot.json'],
  'rules.json': ARTIFACT_SCHEMAS['policy/rules.json'],
  'discovery.json': ARTIFACT_SCHEMAS['policy/discovery.json'],
  'baseline.json': ARTIFACT_SCHEMAS['policy/baseline.json'],
  'policy.lock': ARTIFACT_SCHEMAS['policy/policy.lock'],
  'workspace-binding.json': ARTIFACT_SCHEMAS['workspace-binding.json'],
  'responsibility.json': ARTIFACT_SCHEMAS['responsibility.json'],
  'verification-scope.json': ARTIFACT_SCHEMAS['verification-scope.json'],
};

const TASK_JSON_ARTIFACTS = new Set([
  'task.json',
  'contract.json',
  'routing-result.json',
  'preflight.json',
  'work-state.json',
  'continuity.json',
  'recovery.json',
  'execution-receipt.json',
  'policy-snapshot.json',
  'workspace-binding.json',
  'responsibility.json',
  'verification-scope.json',
]);

const COLLECTION_ARTIFACTS = {
  action: { directory: 'actions', schema: 'action.schema.json' },
  approval: { directory: 'approvals', schema: 'approval.schema.json' },
  evaluation: { directory: 'evaluations', schema: 'trajectory-evaluation.schema.json' },
  handoff: { directory: 'handoffs', schema: 'handoff-envelope.schema.json' },
} as const;

const FIXED_COLLECTION_ARTIFACTS = {
  'code-manifest': { relativePath: 'attestations/code-manifest.json', schema: 'code-manifest.schema.json' },
  'attestation-statement': { relativePath: 'attestations/statement.json', schema: 'in-toto-statement.schema.json' },
  'attestation-bundle': { relativePath: 'attestations/statement.sigstore.json', schema: null },
} as const;

export interface ForgeLoopManifest {
  schemaVersion: number;
  layoutVersion?: number;
  packageName?: string;
  packageVersion?: string;
}

export class ProjectDetector {
  constructor(
    private readonly pathBoundary: PathBoundary,
    private readonly validator: SchemaValidator
  ) {}

  detect(): ProjectDetectionResult {
    const projectRoot = this.pathBoundary.getProjectRoot();
    const forgeLoopRoot = this.pathBoundary.validateForgeLoopPath('');

    const warnings: string[] = [];
    let forgeLoopVersion: string | undefined;
    let protocolVersion: number;
    let schemaVersion: number;

    const config = this.tryDetectFromConfig();
    if (config) {
      protocolVersion = config.protocolVersion;
      schemaVersion = config.schemaVersion;
    } else {
      // Layout v2 projects (forgeloop 1.6.x) ship manifest.json instead of
      // config.json. The manifest is the trusted identity marker; protocol
      // facts are later re-negotiated through the bundled integration.
      const manifest = this.readDetectionManifest();
      if (!manifest) {
        throw ForgeLoopAuditError.projectNotForgeLoop(projectRoot);
      }
      protocolVersion = 1;
      schemaVersion = manifest.schemaVersion;
      forgeLoopVersion = manifest.packageVersion;
      warnings.push('No config.json found; project detected from manifest.json (ForgeLoop layout v2).');
    }

    const protocolResult = checkProtocolCompatibility({
      protocolVersion,
      schemaVersion,
      compatible: true,
    });

    if (!protocolResult.compatible) {
      warnings.push(`Protocol version ${protocolVersion} may have limited support`);
    }

    return {
      projectRoot,
      forgeLoopRoot,
      protocolVersion,
      schemaVersion,
      forgeLoopVersion,
      compatible: protocolResult.compatible,
      warnings,
      projectKind: 'PROJECT',
    };
  }

  private tryDetectFromConfig(): ForgeLoopConfig | null {
    const candidate = this.pathBoundary.resolveForgeLoopPathLexically(CONFIG_FILE);
    if (!existsSync(candidate)) return null;
    try {
      const configPath = this.pathBoundary.validateForgeLoopPath(CONFIG_FILE);
      const configStat = lstatSync(configPath);
      if (!configStat.isFile() || configStat.isSymbolicLink()) {
        throw ForgeLoopAuditError.artifactInvalid(CONFIG_FILE, 'Symbolic links and non-file config artifacts are not allowed');
      }
      assertJsonFileSize(CONFIG_FILE, configStat.size);
      const content = readFileSync(configPath, 'utf8');
      const config = parseJsonSafely<ForgeLoopConfig>(content);
      const validation = this.validator.validate(ARTIFACT_SCHEMAS['config.json'], config);
      if (!validation.valid) {
        throw ForgeLoopAuditError.artifactInvalid(CONFIG_FILE, validation.errors?.join('; ') || 'Config schema validation failed');
      }
      return config;
    } catch (error) {
      if (error instanceof ForgeLoopAuditError) throw error;
      throw ForgeLoopAuditError.artifactInvalid(CONFIG_FILE, `Failed to parse config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private readDetectionManifest(): ForgeLoopManifest | null {
    for (const name of [MANIFEST_FILE, LEGACY_MANIFEST_FILE]) {
      const candidate = this.pathBoundary.resolveForgeLoopPathLexically(name);
      if (!existsSync(candidate)) continue;
      try {
        const stat = lstatSync(candidate);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw ForgeLoopAuditError.artifactInvalid(name, 'Symbolic links and non-file manifest artifacts are not allowed');
        }
        assertJsonFileSize(name, stat.size);
        const parsed = parseJsonSafely<Record<string, unknown>>(readFileSync(this.pathBoundary.validatePath(candidate), 'utf8'));
        if (!isRecord(parsed) || typeof parsed.schemaVersion !== 'number') {
          throw ForgeLoopAuditError.artifactInvalid(name, 'Manifest does not satisfy the canonical layout shape');
        }
        const manifest: ForgeLoopManifest = { schemaVersion: parsed.schemaVersion };
        if (typeof parsed.layoutVersion === 'number') manifest.layoutVersion = parsed.layoutVersion;
        if (typeof parsed.packageName === 'string') manifest.packageName = parsed.packageName;
        if (typeof parsed.packageVersion === 'string') manifest.packageVersion = parsed.packageVersion;
        return manifest;
      } catch (error) {
        if (error instanceof ForgeLoopAuditError) throw error;
        throw ForgeLoopAuditError.artifactInvalid(name, `Failed to parse manifest: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return null;
  }
}

export class ProjectReader {
  private readonly forgeLoopRoot: string;
  private readonly validator: SchemaValidator;
  private readonly artifactErrors = new Map<string, string[]>();
  private readonly lastValidArtifacts = new Map<string, Record<string, unknown>>();

  constructor(
    private readonly pathBoundary: PathBoundary,
    validator: SchemaValidator
  ) {
    this.forgeLoopRoot = pathBoundary.validateForgeLoopPath('');
    this.validator = validator;
  }

  getArtifactErrors(taskKey: string): string[] {
    return [...(this.artifactErrors.get(taskKey) || [])];
  }

  private validateArtifact(name: string, value: unknown): { value?: unknown; error?: string } {
    const schemaName = SCHEMA_BY_FILE[name];
    if (this.validator && schemaName && this.validator.hasSchema(schemaName)) {
      const result = this.validator.validate(schemaName, value);
      if (!result.valid) return { error: `${name}: ${result.errors?.join('; ') || 'schema validation failed'}` };
      return { value };
    }
    if (!isCanonicalArtifact(name, value)) return { error: `${name}: canonical artifact shape is invalid` };
    return { value };
  }

  readConfig(): ForgeLoopConfig {
    const configPath = join(this.forgeLoopRoot, CONFIG_FILE);
    const validatedPath = this.pathBoundary.validatePath(configPath);
    const stat = lstatSync(validatedPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw ForgeLoopAuditError.artifactInvalid(CONFIG_FILE, 'Symbolic links and non-file config artifacts are not allowed');
    }
    assertJsonFileSize(CONFIG_FILE, stat.size);
    const content = readFileSync(validatedPath, 'utf8');
    const config = parseJsonSafely<ForgeLoopConfig>(content);
    const validated = this.validateArtifact('config.json', config);
    if (validated.error) throw ForgeLoopAuditError.artifactInvalid(CONFIG_FILE, validated.error);
    if (typeof config.protocolVersion !== 'number' || typeof config.schemaVersion !== 'number') {
      throw ForgeLoopAuditError.artifactInvalid(CONFIG_FILE, 'Config does not satisfy the canonical protocol shape');
    }
    return config;
  }

  /** Layout v2 projects carry no config.json until tasks run; callers that
   *  only need best-effort config metadata use this tolerant variant. */
  tryReadConfig(): ForgeLoopConfig | null {
    const candidate = this.pathBoundary.resolveForgeLoopPathLexically(CONFIG_FILE);
    if (!existsSync(candidate)) return null;
    return this.readConfig();
  }

  readSources(): ForgeLoopSources {
    const sourcesPath = join(this.forgeLoopRoot, SOURCES_FILE);
    const validatedPath = this.pathBoundary.validatePath(sourcesPath);
    const stat = lstatSync(validatedPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw ForgeLoopAuditError.artifactInvalid(SOURCES_FILE, 'Symbolic links and non-file source artifacts are not allowed');
    }
    assertJsonFileSize(SOURCES_FILE, stat.size);
    const content = readFileSync(validatedPath, 'utf8');
    const sources = parseJsonSafely<ForgeLoopSources>(content);
    const validated = this.validateArtifact('sources.json', sources);
    if (validated.error) throw ForgeLoopAuditError.artifactInvalid(SOURCES_FILE, validated.error);
    return validated.value as ForgeLoopSources;
  }

  listTaskKeys(): string[] {
    const taskStateDir = join(this.forgeLoopRoot, TASK_STATE_DIR);
    if (!existsSync(taskStateDir)) {
      return [];
    }

    const entries = readdirSync(taskStateDir);
    return entries.filter((entry) => {
      const fullPath = join(taskStateDir, entry);
      try {
        return lstatSync(fullPath).isDirectory() && this.pathBoundary.validatePath(fullPath) !== '';
      } catch {
        return false;
      }
    });
  }

  readTaskSummaryArtifacts(taskKey: string): Record<string, unknown> {
    // Native operational records are owned by ForgeLoop's Integration API.
    // Retained JSON exports must never replace the selected database.
    if (this.hasNativeStorage()) return {};
    return this.readTaskArtifactsForSummary(taskKey);
  }

  hasNativeStorage(): boolean {
    return ['state.sqlite', 'storage-version.json'].some((name) => {
      const candidate = this.pathBoundary.resolveForgeLoopPathLexically(name);
      let stat;
      try { stat = lstatSync(candidate); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw ForgeLoopAuditError.artifactInvalid(name, 'Native storage must be a regular project file');
      }
      this.pathBoundary.validateForgeLoopPath(name);
      return true;
    });
  }

  readTaskDescriptor(taskKey: string): Record<string, unknown> {
    const taskPath = join(this.forgeLoopRoot, TASK_STATE_DIR, taskKey, 'task.json');
    const stat = lstatSync(taskPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw ForgeLoopAuditError.artifactInvalid('task.json', 'Symbolic links and non-file descriptors are not allowed');
    assertJsonFileSize('task.json', stat.size);
    const parsed = parseJsonSafely(readFileSync(this.pathBoundary.validatePath(taskPath), 'utf8'));
    const validated = this.validateArtifact('task.json', parsed);
    if (validated.error) throw ForgeLoopAuditError.artifactInvalid('task.json', validated.error);
    return validated.value as Record<string, unknown>;
  }

  private readTaskArtifactsForSummary(taskKey: string): Record<string, unknown> {
    const taskDir = join(this.forgeLoopRoot, TASK_STATE_DIR, taskKey);
    const validatedPath = this.pathBoundary.validatePath(taskDir);

    if (!existsSync(validatedPath)) {
      throw ForgeLoopAuditError.artifactUnreadable(`task-state/${taskKey}`, 'Task directory not found');
    }

    const artifacts: Record<string, unknown> = {};
    const errors: string[] = [];
    const entries = readdirSync(validatedPath);

    for (const entry of entries) {
      const filePath = join(validatedPath, entry);
      if (!entry.endsWith('.json')) continue;
      if (entry.endsWith('.json') && !TASK_JSON_ARTIFACTS.has(entry)) continue;
      try {
        const stat = lstatSync(filePath);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          errors.push(`${entry}: symbolic links and non-file artifacts are not allowed`);
          continue;
        }
        assertJsonFileSize(entry, stat.size);
        const safePath = this.pathBoundary.validatePath(filePath);
        const content = readFileSync(safePath, 'utf8');
        if (entry.endsWith('.json')) {
          const parsed = parseJsonSafely(content);
          const validated = this.validateArtifact(entry, parsed);
          if (validated.error) errors.push(validated.error);
          else artifacts[entry] = validated.value;
        } else {
          artifacts[entry] = content;
        }
      } catch (error) {
        errors.push(`${entry}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length > 0) {
      const previous = this.lastValidArtifacts.get(taskKey);
      if (previous) {
        for (const [name, value] of Object.entries(previous)) {
          if (artifacts[name] === undefined) artifacts[name] = value;
        }
      }
      artifacts.artifactErrors = errors;
      this.artifactErrors.set(taskKey, errors);
    } else {
      this.lastValidArtifacts.set(taskKey, { ...artifacts });
      this.artifactErrors.delete(taskKey);
    }

    return artifacts;
  }

  listSessions(): string[] {
    const sessionsDir = join(this.forgeLoopRoot, SESSIONS_DIR);
    if (!existsSync(sessionsDir)) {
      return [];
    }

    return readdirSync(sessionsDir)
      .filter((entry) => {
        if (!entry.endsWith('.json')) return false;
        try {
          const candidate = join(sessionsDir, entry);
          return lstatSync(candidate).isFile() && !lstatSync(candidate).isSymbolicLink() && Boolean(this.pathBoundary.validatePath(candidate));
        } catch { return false; }
      })
      .map((entry) => entry.replace('.json', ''));
  }

  readSession(sessionId: string): Record<string, unknown> {
    const sessionPath = join(this.forgeLoopRoot, SESSIONS_DIR, `${sessionId}.json`);
    const validatedPath = this.pathBoundary.validatePath(sessionPath);
    const stat = lstatSync(validatedPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw ForgeLoopAuditError.artifactInvalid('session.json', 'Symbolic links and non-file session artifacts are not allowed');
    }
    assertJsonFileSize('session.json', stat.size);
    const content = readFileSync(validatedPath, 'utf8');
    const parsed = parseJsonSafely(content);
    const validated = this.validateArtifact('session.json', parsed);
    if (validated.error) throw ForgeLoopAuditError.artifactInvalid('session.json', validated.error);
    return validated.value as Record<string, unknown>;
  }

  readEventPreview(taskKey: string, maxBytes = 64 * 1024): string {
    const eventPath = this.pathBoundary.resolveForgeLoopPathLexically(join(TASK_STATE_DIR, taskKey, 'events.ndjson'));
    if (!existsSync(eventPath)) return '';
    if (lstatSync(eventPath).isSymbolicLink()) throw ForgeLoopAuditError.artifactInvalid('events.ndjson', 'Symbolic links are not allowed');
    const validatedPath = this.pathBoundary.validatePath(eventPath);
    const fd = openSync(validatedPath, 'r');
    const size = fstatSync(fd).size;
    const bounded = Math.max(1024, maxBytes);
    const headBytes = Math.min(size, Math.floor(bounded / 2));
    const tailBytes = Math.min(size - headBytes, Math.floor(bounded / 2));
    const headBuffer = Buffer.alloc(headBytes);
    const tailBuffer = Buffer.alloc(tailBytes);
    try {
      readSync(fd, headBuffer, 0, headBuffer.length, 0);
      if (tailBytes > 0) readSync(fd, tailBuffer, 0, tailBuffer.length, size - tailBytes);
    } finally { closeSync(fd); }
    if (size <= bounded) return Buffer.concat([headBuffer, tailBuffer]).toString('utf8');
    const head = headBuffer.toString('utf8');
    const tail = tailBuffer.toString('utf8');
    return `${head}\n... [Truncated preview] ...\n${tail}`;
  }

  readPolicySnapshot(taskKey: string): Record<string, unknown> | null {
    const policyDir = this.pathBoundary.resolveForgeLoopPathLexically(join(TASK_STATE_DIR, taskKey));
    if (!existsSync(policyDir)) {
      return null;
    }

    const snapshotPath = join(policyDir, 'policy-snapshot.json');
    if (!existsSync(snapshotPath)) {
      return null;
    }

    if (lstatSync(snapshotPath).isSymbolicLink()) throw ForgeLoopAuditError.artifactInvalid('policy-snapshot.json', 'Symbolic links are not allowed');
    const validatedPath = this.pathBoundary.validatePath(snapshotPath);
    assertJsonFileSize('policy-snapshot.json', lstatSync(snapshotPath).size);
    const parsed = parseJsonSafely(readFileSync(validatedPath, 'utf8'));
    const validated = this.validateArtifact('policy-snapshot.json', parsed);
    if (validated.error) throw ForgeLoopAuditError.artifactInvalid('policy-snapshot.json', validated.error);
    return validated.value as Record<string, unknown>;
  }

  readRawCollectionArtifact(
    taskKey: string,
    request: Exclude<RawCollectionArtifactRequest, { kind: 'capability-policy' }>,
  ): string {
    if (request.kind in FIXED_COLLECTION_ARTIFACTS) {
      const definition = FIXED_COLLECTION_ARTIFACTS[request.kind as keyof typeof FIXED_COLLECTION_ARTIFACTS];
      const relativePath = join(TASK_STATE_DIR, taskKey, definition.relativePath);
      const candidate = this.pathBoundary.resolveForgeLoopPathLexically(relativePath);
      let stat;
      try {
        stat = lstatSync(candidate);
      } catch {
        throw ForgeLoopAuditError.artifactUnreadable(relativePath, 'Artifact not found');
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw ForgeLoopAuditError.artifactInvalid(relativePath, 'Symbolic links and non-file artifacts are not allowed');
      }
      assertJsonFileSize(relativePath, stat.size);
      const validatedPath = this.pathBoundary.validatePath(candidate);
      const content = readFileSync(validatedPath, 'utf8');
      const parsed = parseJsonSafely(content);
      if (definition.schema) {
        const validation = this.validator.validate(definition.schema, parsed);
        if (!validation.valid) {
          throw ForgeLoopAuditError.artifactInvalid(relativePath, validation.errors?.join('; ') || 'Collection artifact schema validation failed');
        }
      }
      return content;
    }

    const collectionKind = request.kind as keyof typeof COLLECTION_ARTIFACTS;
    const definition = COLLECTION_ARTIFACTS[collectionKind];
    let id: string;
    let idPattern: RegExp;
    switch (request.kind) {
      case 'action':
        id = request.actionId;
        idPattern = /^action-[A-Za-z0-9_-]+$/;
        break;
      case 'approval':
        id = request.approvalId;
        idPattern = /^approval-[A-Za-z0-9_-]+$/;
        break;
      case 'evaluation':
        id = request.evaluationId;
        idPattern = /^eval-[A-Za-z0-9_-]+$/;
        break;
      case 'handoff':
        id = request.handoffId;
        idPattern = /^handoff-[A-Za-z0-9_-]+$/;
        break;
      default:
        throw ForgeLoopAuditError.pathBoundaryViolation(String(request.kind), 'unsupported collection artifact kind');
    }
    if (!idPattern.test(id) || id.includes('/') || id.includes('\\') || id.includes('..')) {
      throw ForgeLoopAuditError.pathBoundaryViolation(id, `invalid ${request.kind} artifact identifier`);
    }

    const relativePath = join(TASK_STATE_DIR, taskKey, definition.directory, `${id}.json`);
    const candidate = this.pathBoundary.resolveForgeLoopPathLexically(relativePath);
    let stat;
    try {
      stat = lstatSync(candidate);
    } catch {
      throw ForgeLoopAuditError.artifactUnreadable(relativePath, 'Artifact not found');
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw ForgeLoopAuditError.artifactInvalid(relativePath, 'Symbolic links and non-file artifacts are not allowed');
    }
    assertJsonFileSize(relativePath, stat.size);
    const validatedPath = this.pathBoundary.validatePath(candidate);
    const content = readFileSync(validatedPath, 'utf8');
    const parsed = parseJsonSafely(content);
    const validation = this.validator.validate(definition.schema, parsed);
    if (!validation.valid) {
      throw ForgeLoopAuditError.artifactInvalid(relativePath, validation.errors?.join('; ') || 'Collection artifact schema validation failed');
    }
    return content;
  }

  readRawCapabilityPolicy(): string {
    const relativePath = join(POLICY_DIR, 'capabilities.json');
    const candidate = this.pathBoundary.resolveForgeLoopPathLexically(relativePath);
    let stat;
    try {
      stat = lstatSync(candidate);
    } catch {
      throw ForgeLoopAuditError.artifactUnreadable(relativePath, 'Artifact not found');
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw ForgeLoopAuditError.artifactInvalid(relativePath, 'Symbolic links and non-file artifacts are not allowed');
    }
    assertJsonFileSize(relativePath, stat.size);
    const validatedPath = this.pathBoundary.validatePath(candidate);
    const content = readFileSync(validatedPath, 'utf8');
    const parsed = parseJsonSafely(content);
    const validation = this.validator.validate('capability-policy.schema.json', parsed);
    if (!validation.valid) {
      throw ForgeLoopAuditError.artifactInvalid(relativePath, validation.errors?.join('; ') || 'Capability policy schema validation failed');
    }
    return content;
  }

  readGlobalPolicy(): Record<string, unknown> {
    const policyRoot = this.pathBoundary.resolveForgeLoopPathLexically(POLICY_DIR);
    const result: Record<string, unknown> = {};
    if (!existsSync(policyRoot)) return result;
    for (const name of ['rules.json', 'discovery.json', 'baseline.json', 'policy.lock']) {
      const candidate = join(policyRoot, name);
      if (!existsSync(candidate)) continue;
      try {
        const stat = lstatSync(candidate);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('symbolic links and non-file artifacts are not allowed');
        assertJsonFileSize(join(POLICY_DIR, name), stat.size);
        const parsed = parseJsonSafely(readFileSync(this.pathBoundary.validatePath(candidate), 'utf8'));
        const validated = this.validateArtifact(name, parsed);
        result[name] = validated.error ? { _invalid: true, _schemaInvalid: true, _error: validated.error } : validated.value;
      } catch { result[name] = { _invalid: true }; }
    }
    return result;
  }
}

export function createProjectDetector(pathBoundary: PathBoundary, validator: SchemaValidator): ProjectDetector {
  return new ProjectDetector(pathBoundary, validator);
}

export function createProjectReader(pathBoundary: PathBoundary, validator: SchemaValidator): ProjectReader {
  return new ProjectReader(pathBoundary, validator);
}
