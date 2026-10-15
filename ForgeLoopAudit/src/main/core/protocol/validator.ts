import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ForgeLoopAuditError } from '@shared/errors';
import { parseJsonSafely } from '@main/security/resource-limits';
import { getMissingArtifactSchemas } from './artifact-registry';

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export class SchemaValidator {
  private readonly ajv: Ajv2020;
  private readonly schemaCache: Map<string, object> = new Map();
  private readonly validatorCache: Map<string, ReturnType<Ajv2020['compile']>> = new Map();

  constructor(private readonly schemasDir: string) {
    this.ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(this.ajv);
  }

  hasSchema(schemaName: string): boolean {
    return existsSync(join(this.schemasDir, schemaName));
  }

  getSchemasDir(): string {
    return this.schemasDir;
  }

  private loadSchema(schemaName: string): object {
    if (this.schemaCache.has(schemaName)) {
      return this.schemaCache.get(schemaName)!;
    }

    const schemaPath = join(this.schemasDir, schemaName);
    try {
      const content = readFileSync(schemaPath, 'utf8');
      const schema = parseJsonSafely<object>(content);
      this.schemaCache.set(schemaName, schema);
      return schema;
    } catch (error) {
      throw ForgeLoopAuditError.artifactUnreadable(schemaName, `Failed to load schema: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  validate(schemaName: string, data: unknown): ValidationResult {
    try {
      const schema = this.loadSchema(schemaName);
      const validate = this.validatorCache.get(schemaName) || this.ajv.compile(schema);
      this.validatorCache.set(schemaName, validate);
      const valid = validate(data);

      if (!valid) {
        return {
          valid: false,
          errors: validate.errors?.map((e) => `${e.instancePath} ${e.message}`),
        };
      }

      return { valid: true };
    } catch (error) {
      if (error instanceof ForgeLoopAuditError) {
        throw error;
      }
      return {
        valid: false,
        errors: [`Validation error: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  validateOrThrow<T = unknown>(schemaName: string, data: unknown): T {
    const result = this.validate(schemaName, data);
    if (!result.valid) {
      throw ForgeLoopAuditError.artifactInvalid(schemaName, result.errors?.join('; ') || 'Unknown validation error');
    }
    return data as T;
  }
}

export function createValidator(schemasDir: string): SchemaValidator {
  return new SchemaValidator(schemasDir);
}

export function resolveTrustedSchemaDirectory(options: {
  allowEnvironmentOverride?: boolean;
  appPath?: string;
  resourcesPath?: string;
  cwd?: string;
  moduleDir?: string;
} = {}): string {
  const candidates = [
    options.allowEnvironmentOverride ? process.env.FORGELOOP_SCHEMA_DIR : undefined,
    options.appPath ? join(options.appPath, 'schemas') : undefined,
    options.resourcesPath ? join(options.resourcesPath, 'schemas') : undefined,
    options.allowEnvironmentOverride && options.cwd ? join(options.cwd, 'schemas') : undefined,
    options.allowEnvironmentOverride && options.moduleDir ? join(options.moduleDir, '..', '..', 'schemas') : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));

  const schemaDir = candidates.find((candidate) => existsSync(candidate));
  if (!schemaDir) {
    throw ForgeLoopAuditError.artifactUnreadable('schemas', 'Trusted ForgeLoop protocol schemas are not installed');
  }

  const missing = getMissingArtifactSchemas(schemaDir);
  if (missing.length > 0) {
    throw ForgeLoopAuditError.artifactUnreadable('schemas', `Missing trusted schemas: ${missing.join(', ')}`);
  }

  return schemaDir;
}
