import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../tests/fixtures/audit');
const requiredScenarios = [
  'valid',
  'incomplete',
  'stale',
  'invalid-ownership',
  'receipt-mismatch',
  'policy-drift',
  'action-ambiguous',
  'quality-observe-fail',
  'quality-gate-fail',
  'attestation-invalid',
  'artifact-only',
  'incompatible',
];

describe('audit fixture contract', () => {
  it('keeps every named scenario deterministic and explicitly expected', async () => {
    const entries = (await readdir(fixtureRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(entries).toEqual(requiredScenarios.slice().sort());
    for (const scenario of requiredScenarios) {
      const fixture = JSON.parse(await readFile(join(fixtureRoot, scenario, 'fixture.json'), 'utf8')) as {
        schemaVersion: number;
        scenario: string;
        compatibilityMode: string;
        expected: Record<string, unknown>;
      };
      expect(fixture).toMatchObject({ schemaVersion: 1, scenario, expected: expect.any(Object) });
      expect(['INTEGRATION_V1', 'ARTIFACT_ONLY', 'INCOMPATIBLE']).toContain(fixture.compatibilityMode);
      expect(Object.keys(fixture.expected).length).toBeGreaterThan(0);
    }
  });
});
