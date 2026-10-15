import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSchemaProvenance } from '@main/core/protocol/schema-provenance';
// @ts-expect-error The validation helper is an ESM script without a TypeScript declaration file.
import { getTrustedSchemaNames } from '../../../scripts/schema-provenance.mjs';

const manifestPath = 'schemas/provenance.json';

describe('trusted schema provenance', () => {
  it('matches every vendored schema byte-for-byte with its manifest hash', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      forgeLoopPackageVersion: string;
      forgeLoopGitCommit: string;
      protocolVersion: number;
      schemas: Record<string, { sha256: string; upstreamPath: string }>;
    };

    expect(manifest.forgeLoopPackageVersion).toBe('2.0.0-rc.4');
    expect(manifest.forgeLoopGitCommit).toBe('d05c17cddda6a09581d526732b08eb0789b9734f');
    expect(manifest.protocolVersion).toBe(1);

    for (const [name, entry] of Object.entries(manifest.schemas)) {
      const bytes = readFileSync(`schemas/${name}`);
      const actual = createHash('sha256').update(bytes).digest('hex');
      expect(actual, name).toBe(entry.sha256);
      expect(entry.upstreamPath).toBe(`schemas/${name}`);
    }
  });

  it('loads the committed manifest as an app-owned protocol contract', () => {
    const manifest = loadSchemaProvenance('schemas');
    expect(manifest.forgeLoopPackageVersion).toBe('2.0.0-rc.4');
    expect(Object.keys(manifest.schemas)).toHaveLength(31);
    expect(Object.keys(manifest.schemas)).toEqual(expect.arrayContaining([
      'workspace-binding.schema.json',
      'handoff-envelope.schema.json',
      'responsibility.schema.json',
      'verification-scope.schema.json',
      'code-manifest.schema.json',
      'in-toto-statement.schema.json',
      'code-attestation.schema.json',
      'attestation-verification-result.schema.json',
    ]));
  });

  it('includes safe local schema reference closure and rejects remote or escaping references', () => {
    const root = mkdtempSync(join(tmpdir(), 'forgeloop-schema-closure-'));
    const schemaDir = join(root, 'schemas');
    mkdirSync(join(root, 'src', 'main', 'core', 'protocol'), { recursive: true });
    mkdirSync(schemaDir, { recursive: true });
    const required = [
      'workspace-binding.schema.json',
      'handoff-envelope.schema.json',
      'responsibility.schema.json',
      'verification-scope.schema.json',
      'code-manifest.schema.json',
      'in-toto-statement.schema.json',
      'code-attestation.schema.json',
      'attestation-verification-result.schema.json',
    ];
    for (const name of required) writeFileSync(join(schemaDir, name), '{}');
    writeFileSync(join(root, 'src', 'main', 'core', 'protocol', 'artifact-registry.json'), JSON.stringify({ 'root.json': 'root.schema.json' }));
    writeFileSync(join(schemaDir, 'root.schema.json'), JSON.stringify({ $ref: 'child.schema.json' }));
    writeFileSync(join(schemaDir, 'child.schema.json'), '{}');
    expect(getTrustedSchemaNames(root, schemaDir)).toEqual(expect.arrayContaining(['root.schema.json', 'child.schema.json']));

    writeFileSync(join(schemaDir, 'root.schema.json'), JSON.stringify({ $ref: 'https://example.com/remote.json' }));
    expect(() => getTrustedSchemaNames(root, schemaDir)).toThrow(/Remote or absolute/);
    writeFileSync(join(schemaDir, 'root.schema.json'), JSON.stringify({ $ref: '../outside.schema.json' }));
    expect(() => getTrustedSchemaNames(root, schemaDir)).toThrow(/escapes/);
    writeFileSync(join(root, 'src', 'main', 'core', 'protocol', 'artifact-registry.json'), JSON.stringify({ 'root.json': '../outside.schema.json' }));
    expect(() => getTrustedSchemaNames(root, schemaDir)).toThrow(/escapes/);
    rmSync(root, { recursive: true, force: true });
  });
});
