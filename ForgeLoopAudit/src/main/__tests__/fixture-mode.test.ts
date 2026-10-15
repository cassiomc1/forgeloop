import { describe, expect, it } from 'vitest';
import { isFixtureProjectMode } from '../../server/runtime/fixture-mode';

describe('fixture project mode', () => {
  it('stays disabled in packaged builds even when smoke variables are present', () => {
    expect(isFixtureProjectMode(true, {
      FORGELOOP_AUDIT_SMOKE: '1',
      FORGELOOP_AUDIT_FIXTURE_PROJECT: '/tmp/fixture-project',
    })).toBe(false);
    expect(isFixtureProjectMode(false, {
      FORGELOOP_AUDIT_SMOKE: '1',
      FORGELOOP_AUDIT_FIXTURE_PROJECT: '/tmp/fixture-project',
    })).toBe(true);
    expect(isFixtureProjectMode(false, {})).toBe(false);
  });
});
