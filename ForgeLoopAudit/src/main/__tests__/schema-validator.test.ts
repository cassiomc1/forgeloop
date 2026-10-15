import { describe, expect, it } from 'vitest';
import { SchemaValidator } from '@main/core/protocol/validator';
import { ARTIFACT_SCHEMAS, getMissingArtifactSchemas } from '@main/core/protocol/artifact-registry';
import { resolveTrustedSchemaDirectory } from '@main/core/protocol/validator';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

describe('SchemaValidator', () => {
  it('validates vendored protocol-v1 config schema', () => {
    const validator = new SchemaValidator('schemas');
    expect(validator.hasSchema('config.schema.json')).toBe(true);
    const valid = validator.validate('config.schema.json', { schemaVersion: 1, protocolVersion: 1, complianceMode: 'strict' });
    expect(valid.valid).toBe(true);
    expect(validator.validate('config.schema.json', { schemaVersion: 2, protocolVersion: 1, complianceMode: 'strict' }).valid).toBe(false);
  });

  it('has a vendored schema for every registered artifact', () => {
    expect(getMissingArtifactSchemas('schemas')).toEqual([]);
    const validator = new SchemaValidator('schemas');
    expect(validator.hasSchema('activation.schema.json')).toBe(true);
    expect(validator.hasSchema('gate.schema.json')).toBe(true);
    for (const schemaName of new Set(Object.values(ARTIFACT_SCHEMAS))) {
      expect(() => validator.validate(schemaName, {})).not.toThrow();
    }
  });

  it('ignores an environment schema override when production mode is selected', () => {
    const maliciousDir = mkdtempSync(join(tmpdir(), 'forgeloop-malicious-schemas-'));
    mkdirSync(join(maliciousDir, 'schemas'));
    writeFileSync(join(maliciousDir, 'schemas', 'config.schema.json'), '{}');
    const previous = process.env.FORGELOOP_SCHEMA_DIR;
    process.env.FORGELOOP_SCHEMA_DIR = join(maliciousDir, 'schemas');
    try {
      const trusted = resolveTrustedSchemaDirectory({
        allowEnvironmentOverride: false,
        appPath: resolve(process.cwd()),
        moduleDir: resolve(process.cwd(), 'src/main/core/protocol'),
      });
      expect(trusted).toBe(resolve(process.cwd(), 'schemas'));
    } finally {
      if (previous === undefined) delete process.env.FORGELOOP_SCHEMA_DIR;
      else process.env.FORGELOOP_SCHEMA_DIR = previous;
      rmSync(maliciousDir, { recursive: true, force: true });
    }
  });
});
