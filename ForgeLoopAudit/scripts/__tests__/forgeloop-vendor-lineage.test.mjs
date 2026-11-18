import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('ForgeLoop vendor archive, lockfile, provenance, package contents and active docs share the 2.3.0 lineage', () => {
  const script = join(process.cwd(), 'scripts', 'verify-forgeloop-vendor-lineage.mjs');
  const output = execFileSync(process.execPath, [script], { cwd: process.cwd(), encoding: 'utf8' });
  assert.match(output, /ForgeLoop vendor lineage verified: @cassiomc1\/forgeloop@2.3.0/);
  assert.match(output, /8655d4288e1bf6cba307a2e0981627db8117c12c/);
  assert.match(output, /packagedGuides=/);
});
