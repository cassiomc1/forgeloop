import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('ForgeLoop vendor archive, lockfile, provenance, package contents and active docs share the 2.0.0-rc.4 lineage', () => {
  const script = join(process.cwd(), 'scripts', 'verify-forgeloop-vendor-lineage.mjs');
  const output = execFileSync(process.execPath, [script], { cwd: process.cwd(), encoding: 'utf8' });
  assert.match(output, /ForgeLoop vendor lineage verified: @cassiomc1\/forgeloop@2.0.0-rc.4/);
  assert.match(output, /d05c17cddda6a09581d526732b08eb0789b9734f/);
  assert.match(output, /packagedGuides=/);
});
