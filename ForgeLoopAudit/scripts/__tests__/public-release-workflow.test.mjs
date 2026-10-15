import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const workflow = (await readFile(new URL('../../.github/workflows/public-release-verification.yml', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');

test('verifies only published releases and explicit manual dispatches', () => {
  assert.match(workflow, /release:\s*\n\s+types:\s*\[published\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request|^\s+push:/m);
});

test('checks out the exact tagged source before running the web contract', () => {
  assert.match(workflow, /ref: \$\{\{ format\('refs\/tags\/\{0\}', inputs\.tag \|\| github\.event\.release\.tag_name\) \}\}/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /npm run verify:full/);
});

test('manual dispatch validates an explicit tag without a stale default', () => {
  assert.match(workflow, /tag:[\s\S]*?required:\s*true/);
  assert.doesNotMatch(workflow, /tag:[\s\S]*?default:/);
  assert.match(workflow, /TAG=.*inputs\.tag \|\| github\.event\.release\.tag_name/);
});

test('tag verification rebuilds the npm package and release metadata', () => {
  assert.match(workflow, /npm pack --pack-destination release-assets/);
  assert.match(workflow, /sha256sum release-assets\/\*\.tgz > release-assets\/SHA256SUMS/);
  assert.match(workflow, /npm sbom --sbom-format cyclonedx --sbom-type application > release-assets\/SBOM-cyclonedx\.json/);
  assert.doesNotMatch(workflow, /GITHUB_TOKEN|electron|AppImage|dmg|nsis/iu);
});
