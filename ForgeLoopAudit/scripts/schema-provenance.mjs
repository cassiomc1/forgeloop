import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';

const REQUIRED_TRUSTED_SCHEMAS = [
  'workspace-binding.schema.json',
  'handoff-envelope.schema.json',
  'responsibility.schema.json',
  'verification-scope.schema.json',
  'code-manifest.schema.json',
  'in-toto-statement.schema.json',
  'code-attestation.schema.json',
  'attestation-verification-result.schema.json',
];

function findSchemaReferences(value, references = []) {
  if (Array.isArray(value)) {
    for (const entry of value) findSchemaReferences(entry, references);
    return references;
  }
  if (!value || typeof value !== 'object') return references;
  for (const [key, child] of Object.entries(value)) {
    if (key === '$ref' && typeof child === 'string') references.push(child);
    else findSchemaReferences(child, references);
  }
  return references;
}

function resolveLocalReference(schemaName, reference, schemaRoot) {
  if (reference.startsWith('#')) return null;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(reference) || reference.startsWith('/')) {
    throw new Error(`Remote or absolute schema $ref is not trusted: ${schemaName} -> ${reference}`);
  }
  const referencePath = reference.split('#', 1)[0];
  if (!referencePath) return null;
  const candidate = normalize(resolve(schemaRoot, dirname(schemaName), referencePath));
  const rootRelative = relative(resolve(schemaRoot), candidate);
  if (rootRelative.startsWith('..') || isAbsolute(rootRelative)) {
    throw new Error(`Schema $ref escapes the trusted schema directory: ${schemaName} -> ${reference}`);
  }
  return rootRelative.split('\\').join('/');
}

function resolveTrustedSchemaPath(schemaName, schemaRoot) {
  if (typeof schemaName !== 'string' || !schemaName || schemaName.startsWith('/') || /^[a-z][a-z0-9+.-]*:/iu.test(schemaName)) {
    throw new Error(`Remote or absolute trusted schema path is not allowed: ${String(schemaName)}`);
  }
  const candidate = resolve(schemaRoot, schemaName);
  const rootRelative = relative(resolve(schemaRoot), candidate);
  if (rootRelative.startsWith('..') || isAbsolute(rootRelative)) {
    throw new Error(`Trusted schema path escapes the schema directory: ${schemaName}`);
  }
  return candidate;
}

export function getTrustedSchemaNames(repoRoot = process.cwd(), schemaRoot = join(repoRoot, 'schemas')) {
  const registry = JSON.parse(readFileSync(join(repoRoot, 'src/main/core/protocol/artifact-registry.json'), 'utf8'));
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) throw new Error('Artifact registry must be an object');
  const pending = [...new Set([...Object.values(registry), ...REQUIRED_TRUSTED_SCHEMAS])].sort();
  const trusted = new Set();
  while (pending.length > 0) {
    const schemaName = pending.shift();
    if (trusted.has(schemaName)) continue;
    const schemaPath = resolveTrustedSchemaPath(schemaName, schemaRoot);
    let schema;
    try {
      schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    } catch (error) {
      throw new Error(`Unable to load trusted schema ${schemaName}: ${error instanceof Error ? error.message : String(error)}`);
    }
    trusted.add(schemaName);
    for (const reference of findSchemaReferences(schema)) {
      const dependency = resolveLocalReference(schemaName, reference, schemaRoot);
      if (dependency && !trusted.has(dependency)) pending.push(dependency);
    }
  }
  return [...trusted].sort();
}

export function assertManifestShape(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Schema provenance must be an object');
  if (typeof manifest.forgeLoopPackageVersion !== 'string' || !manifest.forgeLoopPackageVersion) {
    throw new Error('Schema provenance is missing forgeLoopPackageVersion');
  }
  if (!/^[0-9a-f]{40}$/.test(manifest.forgeLoopGitCommit)) {
    throw new Error('Schema provenance has an invalid forgeLoopGitCommit');
  }
  if (manifest.protocolVersion !== 1) throw new Error('Unsupported schema provenance protocolVersion');
  if (typeof manifest.generatedAt !== 'string' || Number.isNaN(Date.parse(manifest.generatedAt))) {
    throw new Error('Schema provenance has an invalid generatedAt');
  }
  if (!manifest.schemas || typeof manifest.schemas !== 'object' || Array.isArray(manifest.schemas)) {
    throw new Error('Schema provenance is missing schemas');
  }
}
