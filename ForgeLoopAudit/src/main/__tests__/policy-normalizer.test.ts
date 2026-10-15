import { describe, expect, it } from 'vitest';
import { normalizePolicyStatus } from '@main/core/project/project-snapshot';

describe('normalizePolicyStatus', () => {
  it('preserves task drift dimensions from ForgeLoop output', () => {
    const result = normalizePolicyStatus({
      status: 'VALID',
      rules: [{ ruleId: 'r1' }],
      provenRules: 1,
      inertRules: 0,
      unsupportedRules: 0,
      baselineViolations: 2,
      newViolations: [{}],
      lock: { digest: 'sha256:current' },
      drift: { detected: true, classification: 'STRENGTHEN', changes: [{}], snapshotDigest: 'old', currentDigest: 'new' },
      errors: [],
      warnings: [],
    }, 'strict', 'POLICY_STATUS');

    expect(result.overallStatus).toBe('valid');
    expect(result.lockStatus).toBe('valid');
    expect(result.baselineViolations).toBe(2);
    expect(result.newViolations).toBe(1);
    expect(result.drift).toMatchObject({ detected: true, classification: 'STRENGTHEN', changeCount: 1 });
  });

  it('does not infer lock failure from an unrelated invalid policy status', () => {
    const result = normalizePolicyStatus({ status: 'INVALID', lock: { digest: 'sha256:valid' }, errors: [{ code: 'NEW_VIOLATION' }] });
    expect(result.overallStatus).toBe('invalid');
    expect(result.lockStatus).toBe('valid');
  });

  it('maps an explicit invalid policy lock to invalid', () => {
    const result = normalizePolicyStatus({
      status: 'INVALID',
      lock: { status: 'INVALID' },
      errors: [{ code: 'E_POLICY_INVALID' }],
    });
    expect(result.lockStatus).toBe('invalid');
  });
});
