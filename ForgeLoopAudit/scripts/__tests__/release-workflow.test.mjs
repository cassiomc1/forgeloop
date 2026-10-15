import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const workflow = (await readFile(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');

function jobBlock(name) {
  const match = new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][a-z-]*:\\n|$)`).exec(workflow);
  assert.ok(match, `workflow is missing ${name} job`);
  return match[1];
}

test('release workflow has one local web package job', () => {
  const job = jobBlock('web-package');
  assert.match(job, /npm ci/);
  assert.match(job, /npm run verify:full/);
  assert.match(job, /npm pack --pack-destination release-assets/);
  assert.doesNotMatch(job, /electron|native|fuse|dmg|AppImage|nsis/iu);
});

test('release workflow verifies tag identity when running from a tag', () => {
  const job = jobBlock('web-package');
  assert.match(job, /github\.ref_type == 'tag'/);
  assert.match(job, /scripts\/assert-release-version\.mjs/);
});

test('release workflow emits checksum and CycloneDX metadata', () => {
  const job = jobBlock('web-package');
  assert.match(job, /sha256sum release-assets\/\*\.tgz > release-assets\/SHA256SUMS/);
  assert.match(job, /npm sbom --sbom-format cyclonedx --sbom-type application > release-assets\/SBOM-cyclonedx\.json/);
  assert.match(job, /actions\/upload-artifact@/);
  assert.match(job, /path: release-assets\/\*/);
});

test('release publication remains separate from package verification', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /push:\n\s+tags: \['v\*'\]/);
  assert.doesNotMatch(workflow, /softprops\/action-gh-release|npm publish/);
});
