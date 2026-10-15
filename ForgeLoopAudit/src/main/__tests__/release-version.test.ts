import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts', 'assert-release-version.mjs');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;

describe('release version guard', () => {
  it('uses the next immutable release-candidate identity', () => {
    expect(version).toBe('0.3.0-rc.3');
  });

  it('accepts the tag that exactly matches package.json', () => {
    expect(() => execFileSync(process.execPath, [script, `v${version}`])).not.toThrow();
  });

  it('rejects a tag that does not match package.json', () => {
    expect(() => execFileSync(process.execPath, [script, 'v9.9.9'])).toThrow();
  });
});
