import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walkTsx(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walkTsx(full));
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) files.push(full);
  }
  return files;
}

test('renderer UI carries no hard-coded release version literal', () => {
  const rendererDir = join(process.cwd(), 'src', 'renderer');
  const offenders = [];
  for (const file of walkTsx(rendererDir)) {
    const content = readFileSync(file, 'utf8');
    const match = content.match(/v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?/);
    if (match) offenders.push(`${file}: ${match[0]}`);
  }
  assert.deepEqual(offenders, [], `hard-coded versions must be replaced with runtime app.getVersion():\n${offenders.join('\n')}`);
});

test('package.json declares the runtime version surfaced by app.getVersion()', () => {
  const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  assert.match(version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'package.json version must be valid semver');
});
