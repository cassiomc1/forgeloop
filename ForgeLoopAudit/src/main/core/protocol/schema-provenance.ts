import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForgeLoopAuditError } from '@shared/errors';

export interface SchemaProvenanceEntry {
  sha256: string;
  upstreamPath: string;
}

export interface SchemaProvenance {
  forgeLoopPackageVersion: string;
  forgeLoopGitCommit: string;
  protocolVersion: number;
  generatedAt: string;
  schemas: Record<string, SchemaProvenanceEntry>;
}

export function loadSchemaProvenance(schemasDir: string): SchemaProvenance {
  const manifestPath = join(schemasDir, 'provenance.json');
  try {
    if (!existsSync(manifestPath)) throw new Error('manifest is missing');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as SchemaProvenance;
    if (manifest.protocolVersion !== 1 || !/^[0-9a-f]{40}$/.test(manifest.forgeLoopGitCommit)) {
      throw new Error('manifest identity is invalid');
    }
    if (!manifest.schemas || typeof manifest.schemas !== 'object') throw new Error('schema entries are missing');

    for (const [name, entry] of Object.entries(manifest.schemas)) {
      if (!/^[A-Za-z0-9.-]+\.schema\.json$/.test(name) || entry.upstreamPath !== `schemas/${name}` || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
        throw new Error(`invalid entry ${name}`);
      }
      const schemaPath = join(schemasDir, name);
      const actualHash = createHash('sha256').update(readFileSync(schemaPath)).digest('hex');
      if (actualHash !== entry.sha256) throw new Error(`hash mismatch for ${name}`);
    }

    return manifest;
  } catch (error) {
    throw ForgeLoopAuditError.artifactUnreadable('schema-provenance', error instanceof Error ? error.message : String(error));
  }
}
