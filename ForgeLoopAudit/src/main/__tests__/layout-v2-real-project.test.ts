import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PathBoundary } from '@main/security/path-boundary';
import { ProjectDetector, ProjectReader } from '@main/core/project/project-reader';
import { SchemaValidator } from '@main/core/protocol/validator';
import { ProjectSnapshotBuilder } from '@main/core/project/project-snapshot';
import { ForgeCli } from '@main/core/cli/forge-cli';
import { resolveForgeLoopProjectRoot } from '@main/core/project/project-discovery';

const schemasDir = resolve(process.cwd(), 'schemas');
// Opt-in regression check against a real layout v2 project. Set
// FORGELOOP_AUDIT_REAL_PROJECT to a forgeloop 1.6.x-initialized directory to
// exercise the pipeline that previously failed with
// "Path does not exist: .../config.json". Skipped when unset or absent.
const REAL_PROJECT = process.env.FORGELOOP_AUDIT_REAL_PROJECT ?? '';

describe.skipIf(!REAL_PROJECT || !existsSync(REAL_PROJECT))('real layout v2 project opens', () => {
  it('resolves the project root via discovery (manifest marker)', async () => {
    await expect(resolveForgeLoopProjectRoot(REAL_PROJECT)).resolves.toBe(resolve(REAL_PROJECT));
  });

  it('detect() no longer throws on missing config.json', () => {
    const detector = new ProjectDetector(new PathBoundary(REAL_PROJECT), new SchemaValidator(schemasDir));
    const result = detector.detect();
    expect(result.compatible).toBe(true);
    expect(result.protocolVersion).toBe(1);
    expect(result.schemaVersion).toBe(1);
    expect(result.warnings.some((w) => w.includes('manifest.json'))).toBe(true);
  });

  it('builds a project snapshot without throwing', async () => {
    const boundary = new PathBoundary(REAL_PROJECT);
    const validator = new SchemaValidator(schemasDir);
    const reader = new ProjectReader(boundary, validator);
    expect(reader.tryReadConfig()).toBeNull();
    const builder = new ProjectSnapshotBuilder(
      boundary,
      reader,
      new ForgeCli(REAL_PROJECT, '__fixture_cli_unavailable__'),
      { source: 'ARTIFACT_ONLY', protocolVersion: 1, schemaVersion: 1 },
      false,
    );
    const snapshot = await builder.build();
    expect(snapshot.project.rootPath).toBe(resolve(REAL_PROJECT));
    expect(Array.isArray(snapshot.tasks)).toBe(true);
  });
});
