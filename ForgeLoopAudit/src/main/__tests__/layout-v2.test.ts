import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { PathBoundary } from '@main/security/path-boundary';
import { ProjectDetector, ProjectReader } from '@main/core/project/project-reader';
import { SchemaValidator } from '@main/core/protocol/validator';
import { discoverForgeLoopProjects, resolveForgeLoopProjectRoot } from '@main/core/project/project-discovery';

const schemasDir = resolve(process.cwd(), 'schemas');

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'forgeloop-layout-v2-'));
}

function writeLayoutV2Manifest(root: string): void {
  mkdirSync(join(root, '.forgeloop', 'kit'), { recursive: true });
  mkdirSync(join(root, '.forgeloop', 'policy'), { recursive: true });
  writeFileSync(
    join(root, '.forgeloop', 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      layoutVersion: 2,
      packageName: '@cassiomc1/forgeloop',
      packageVersion: '1.6.5',
      files: {},
    }),
  );
}

describe('ForgeLoop layout v2 (manifest-based) projects', () => {
  it('discovers projects that carry manifest.json instead of config.json', async () => {
    const root = makeRoot();
    try {
      writeLayoutV2Manifest(root);

      await expect(discoverForgeLoopProjects(root)).resolves.toEqual([resolve(root)]);
      await expect(resolveForgeLoopProjectRoot(root)).resolves.toBe(resolve(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('discovers projects that carry the legacy .manifest.json marker', async () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, '.forgeloop'), { recursive: true });
      writeFileSync(
        join(root, '.forgeloop', '.manifest.json'),
        JSON.stringify({ schemaVersion: 1, layoutVersion: 2 }),
      );

      await expect(discoverForgeLoopProjects(root)).resolves.toEqual([resolve(root)]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not treat a bare .forgeloop directory without markers as a project', async () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, '.forgeloop'), { recursive: true });

      await expect(discoverForgeLoopProjects(root)).resolves.toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects layout v2 projects from the manifest with a layout warning', () => {
    const root = makeRoot();
    try {
      writeLayoutV2Manifest(root);
      const detector = new ProjectDetector(new PathBoundary(root), new SchemaValidator(schemasDir));

      expect(detector.detect()).toMatchObject({
        projectRoot: resolve(root),
        protocolVersion: 1,
        schemaVersion: 1,
        forgeLoopVersion: '1.6.5',
        compatible: true,
        projectKind: 'PROJECT',
      });
      const result = detector.detect();
      expect(result.warnings.some((warning) => warning.includes('manifest.json'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prefers config.json over the manifest when both exist (layout v1 projects)', () => {
    const root = makeRoot();
    try {
      writeLayoutV2Manifest(root);
      writeFileSync(
        join(root, '.forgeloop', 'config.json'),
        JSON.stringify({ schemaVersion: 1, protocolVersion: 1, complianceMode: 'strict' }),
      );
      const detector = new ProjectDetector(new PathBoundary(root), new SchemaValidator(schemasDir));

      const result = detector.detect();
      expect(result).toMatchObject({ protocolVersion: 1, schemaVersion: 1, compatible: true });
      expect(result.warnings.some((warning) => warning.includes('manifest.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a manifest that does not satisfy the canonical layout shape', () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, '.forgeloop'), { recursive: true });
      writeFileSync(join(root, '.forgeloop', 'manifest.json'), JSON.stringify({ layoutVersion: 2 }));
      const detector = new ProjectDetector(new PathBoundary(root), new SchemaValidator(schemasDir));

      expect(() => detector.detect()).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked manifest before trusting it', () => {
    const root = makeRoot();
    const outside = mkdtempSync(join(tmpdir(), 'forgeloop-manifest-outside-'));
    try {
      mkdirSync(join(root, '.forgeloop'), { recursive: true });
      writeFileSync(join(outside, 'manifest.json'), JSON.stringify({ schemaVersion: 1, layoutVersion: 2 }));
      symlinkSync(join(outside, 'manifest.json'), join(root, '.forgeloop', 'manifest.json'));
      const detector = new ProjectDetector(new PathBoundary(root), new SchemaValidator(schemasDir));

      expect(() => detector.detect()).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('fails closed when neither config.json nor a manifest exists', () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, '.forgeloop'), { recursive: true });
      const detector = new ProjectDetector(new PathBoundary(root), new SchemaValidator(schemasDir));

      let detected: unknown = null;
      try {
        detected = detector.detect();
      } catch (error) {
        expect(error).toMatchObject({ code: 'PROJECT_NOT_FORGELOOP' });
      }
      expect(detected).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads config tolerantly: tryReadConfig returns null without config.json', () => {
    const root = makeRoot();
    try {
      writeLayoutV2Manifest(root);
      const reader = new ProjectReader(new PathBoundary(root), new SchemaValidator(schemasDir));

      expect(reader.tryReadConfig()).toBeNull();
      // strict read still fails closed for callers that require the artifact
      expect(() => reader.readConfig()).toThrow();
      // empty task/session state is a valid steady state for fresh projects
      expect(reader.listTaskKeys()).toEqual([]);
      expect(reader.listSessions()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
