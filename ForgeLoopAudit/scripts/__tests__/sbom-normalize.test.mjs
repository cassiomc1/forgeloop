import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

const script = join(process.cwd(), 'scripts', 'normalize-release-sbom.mjs');
const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
const roots = [];

function sandbox(sbom) {
  const root = mkdtempSync(join(tmpdir(), 'forgeloop-sbom-'));
  roots.push(root);
  const path = join(root, 'SBOM-cyclonedx.json');
  writeFileSync(path, `${JSON.stringify(sbom, null, 2)}\n`);
  return path;
}

function run(path) {
  return execFileSync(process.execPath, [script, path], { cwd: process.cwd(), encoding: 'utf8' });
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test('rewrites the SBOM application name to the package name', () => {
  const path = sandbox({ bomFormat: 'CycloneDX', specVersion: '1.5', metadata: { component: { type: 'application', name: 'ForgeLoopAudit', version: pkg.version } }, components: [{ name: 'dep' }] });
  assert.match(run(path), new RegExp(`"ForgeLoopAudit".*->.*"${pkg.name}"`));
  const normalized = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(normalized.metadata.component.name, pkg.name);
  assert.equal(normalized.metadata.component.version, pkg.version);
  assert.equal(normalized.components.length, 1);
});

test('keeps an SBOM whose application name already matches the package name', () => {
  const path = sandbox({ bomFormat: 'CycloneDX', specVersion: '1.5', metadata: { component: { type: 'application', name: pkg.name, version: pkg.version } } });
  assert.match(run(path), new RegExp(`"${pkg.name}".*->.*"${pkg.name}"`));
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).metadata.component.name, pkg.name);
});

test('fails closed on a document that is not CycloneDX', () => {
  const path = sandbox({ bomFormat: 'SPDX', specVersion: '1.5' });
  assert.throws(() => run(path), /is not a CycloneDX document/);
});

test('fails closed when the metadata component is missing', () => {
  const path = sandbox({ bomFormat: 'CycloneDX', specVersion: '1.5' });
  assert.throws(() => run(path), /has no metadata\.component/);
});
