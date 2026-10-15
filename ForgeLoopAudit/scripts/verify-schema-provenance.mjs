import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertManifestShape, getTrustedSchemaNames } from './schema-provenance.mjs';

const repoRoot = process.cwd();
const manifestPath = join(repoRoot, 'schemas', 'provenance.json');
if (!existsSync(manifestPath)) throw new Error('Missing schemas/provenance.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assertManifestShape(manifest);

const expectedNames = getTrustedSchemaNames(repoRoot);
const actualNames = Object.keys(manifest.schemas).sort();
if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
  throw new Error(`Schema provenance set differs from artifact registry: expected ${expectedNames.join(', ')}, got ${actualNames.join(', ')}`);
}

for (const name of expectedNames) {
  const entry = manifest.schemas[name];
  if (!entry || !/^[0-9a-f]{64}$/.test(entry.sha256) || entry.upstreamPath !== `schemas/${name}`) {
    throw new Error(`Malformed provenance entry for ${name}`);
  }
  const schemaPath = join(repoRoot, 'schemas', name);
  if (!existsSync(schemaPath)) throw new Error(`Missing trusted schema ${name}`);
  const actualHash = createHash('sha256').update(readFileSync(schemaPath)).digest('hex');
  if (actualHash !== entry.sha256) throw new Error(`Hash mismatch for ${name}`);
}

console.log(`Schema provenance verified: ${expectedNames.length} schemas, ForgeLoop ${manifest.forgeLoopPackageVersion}`);
