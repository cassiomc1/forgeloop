import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runBrandConformance } from '../check-brand-conformance.mjs';

const legacyProductName = ['ForgeLoop', ' Studio'].join('');
const legacyIdentifier = ['ForgeLoop', 'Studio'].join('');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'forgeloop-audit-brand-'));
  await mkdir(join(root, 'docs', 'superpowers', 'plans'), { recursive: true });
  await writeFile(join(root, 'README.md'), '# ForgeLoopAudit\n');
  await writeFile(join(root, 'docs', 'superpowers', 'plans', 'historical.md'), legacyProductName + '\n');
  return root;
}

test('brand conformance allows legacy identity only in historical roots', async () => {
  const root = await fixture();
  const result = runBrandConformance(root);
  assert.equal(result.violations.length, 0);
  assert.equal(result.filesChecked, 1);
});

test('brand conformance rejects legacy identity in active files', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src.md'), legacyIdentifier + ' is obsolete here.\n');

  assert.throws(
    () => runBrandConformance(root),
    (error) => error instanceof Error && error.message.includes('src.md') && error.message.includes(legacyIdentifier),
  );
});
