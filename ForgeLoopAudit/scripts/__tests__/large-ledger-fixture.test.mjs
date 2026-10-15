import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveLedgerOutput, generateLedgerFixture } from '../generate-large-ledger-fixture.mjs';

test('rejects generation without an explicit --output path', () => {
  assert.throws(() => resolveLedgerOutput(['node', 'fixture.mjs', '--events', '2']), /Missing required --output/);
});

test('uses the explicit output path when --output is provided', () => {
  assert.equal(
    resolveLedgerOutput(['node', 'fixture.mjs', '--output', join(tmpdir(), 'events.ndjson')]),
    join(tmpdir(), 'events.ndjson')
  );
});

test('generated fixtures land in temporary storage and are cleaned up', () => {
  const root = mkdtempSync(join(tmpdir(), 'forgeloop-ledger-fixture-test-'));
  try {
    const output = join(root, 'events.ndjson');
    generateLedgerFixture({ count: 3, output });
    assert.ok(existsSync(output));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.equal(existsSync(root), false, 'temporary fixture directory must be removed');
});

test('benchmark leaves no generated fixture in the repository', () => {
  execFileSync(process.execPath, [join(process.cwd(), 'scripts', 'benchmark-large-project.mjs'), '--scenario', 'ledger'], { encoding: 'utf8' });
  assert.equal(
    existsSync(join(process.cwd(), 'tests', 'fixtures', 'large-project', 'events.ndjson')),
    false,
    'repository fixture path must not be created by benchmark runs'
  );
});
