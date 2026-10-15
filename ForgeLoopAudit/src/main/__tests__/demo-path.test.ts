import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBundledDemoPath } from '@main/demo/demo-path';

function makeAppWithDemo(): string {
  const appRoot = mkdtempSync(join(tmpdir(), 'forgeloop-demo-path-'));
  mkdirSync(join(appRoot, 'demo', '.forgeloop'), { recursive: true });
  writeFileSync(join(appRoot, 'demo', '.forgeloop', 'config.json'), JSON.stringify({ schemaVersion: 1, protocolVersion: 1, complianceMode: 'standard' }));
  return appRoot;
}

describe('resolveBundledDemoPath', () => {
  it('resolves <appPath>/demo in development mode', () => {
    const appPath = makeAppWithDemo();
    try {
      expect(resolveBundledDemoPath({ isBundled: false, appPath })).toBe(join(appPath, 'demo'));
    } finally {
      rmSync(appPath, { recursive: true, force: true });
    }
  });

  it('prefers the packaged resources directory when bundled', () => {
    const resourcesPath = makeAppWithDemo();
    const appPath = makeAppWithDemo();
    try {
      expect(resolveBundledDemoPath({ isBundled: true, appPath, resourcesPath })).toBe(join(resourcesPath, 'demo'));
    } finally {
      rmSync(resourcesPath, { recursive: true, force: true });
      rmSync(appPath, { recursive: true, force: true });
    }
  });

  it('falls back to the app path in packaged mode without a resources copy', () => {
    const appPath = makeAppWithDemo();
    try {
      expect(resolveBundledDemoPath({ isBundled: true, appPath, resourcesPath: join(tmpdir(), 'does-not-exist-resources') })).toBe(join(appPath, 'demo'));
    } finally {
      rmSync(appPath, { recursive: true, force: true });
    }
  });

  it('returns null when no bundled demo exists', () => {
    const empty = mkdtempSync(join(tmpdir(), 'forgeloop-demo-empty-'));
    try {
      expect(resolveBundledDemoPath({ isBundled: false, appPath: empty })).toBeNull();
      expect(resolveBundledDemoPath({ isBundled: true, appPath: empty, resourcesPath: empty })).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('rejects directories that only look like a demo project', () => {
    const imposter = mkdtempSync(join(tmpdir(), 'forgeloop-demo-imposter-'));
    mkdirSync(join(imposter, 'demo', '.forgeloop'), { recursive: true });
    try {
      expect(resolveBundledDemoPath({ isBundled: false, appPath: imposter })).toBeNull();
    } finally {
      rmSync(imposter, { recursive: true, force: true });
    }
  });
});
