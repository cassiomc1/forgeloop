import { describe, expect, it } from 'vitest';
import type { ExecutionRecord } from '@shared/domain';
import {
  executionKindLabel,
  executionIsolationDetails,
  executionProvenanceDetails,
  isolationModeLabel,
  isVerificationExecutionIsolationAvailable,
} from './execution-display';

const LEGACY_EXECUTION = {} as ExecutionRecord;

const ISOLATED_EXECUTION = {
  executionKind: 'VERIFICATION',
  protocolProjectRoot: '/repo',
  cwd: '/repo/.forgeloop-isolation/worktree',
  executionIsolation: 'PROJECT_ISOLATED',
  isolation: {
    mode: 'PROJECT_ISOLATED',
    isolated: true,
    liveProjectWritable: false,
    networkPolicy: 'INHERITED',
    environmentPolicy: 'SANITIZED',
  },
} as unknown as ExecutionRecord;

describe('execution display helpers', () => {
  it('labels absent execution provenance explicitly', () => {
    expect(executionKindLabel(LEGACY_EXECUTION)).toBe('Not recorded by this artifact');
    expect(isolationModeLabel(LEGACY_EXECUTION)).toBe('Not recorded by this artifact');
  });

  it('formats persisted isolation provenance without inferring semantics', () => {
    expect(executionKindLabel(ISOLATED_EXECUTION)).toBe('VERIFICATION');
    expect(isolationModeLabel(ISOLATED_EXECUTION)).toBe('PROJECT_ISOLATED');
    expect(executionProvenanceDetails(ISOLATED_EXECUTION)).toEqual([
      { label: 'Execution kind', value: 'VERIFICATION' },
      { label: 'Protocol project root', value: '/repo' },
      { label: 'Execution cwd', value: '/repo/.forgeloop-isolation/worktree' },
    ]);
    expect(executionIsolationDetails(ISOLATED_EXECUTION, true)).toEqual([
      { label: 'Isolation mode', value: 'PROJECT_ISOLATED' },
      { label: 'Isolated', value: 'Yes' },
      { label: 'Live project writable', value: 'No' },
      { label: 'Network policy', value: 'INHERITED' },
      { label: 'Environment policy', value: 'SANITIZED' },
    ]);
  });

  it('keeps generic provenance while withholding isolation details when capability is unavailable', () => {
    expect(isVerificationExecutionIsolationAvailable({ verificationExecutionIsolation: false })).toBe(false);
    expect(isVerificationExecutionIsolationAvailable(undefined)).toBe(false);
    expect(executionProvenanceDetails(ISOLATED_EXECUTION)).toEqual([
      { label: 'Execution kind', value: 'VERIFICATION' },
      { label: 'Protocol project root', value: '/repo' },
      { label: 'Execution cwd', value: '/repo/.forgeloop-isolation/worktree' },
    ]);
    expect(executionIsolationDetails(ISOLATED_EXECUTION, false)).toEqual([]);
  });

  it('does not infer execution kind or isolation mode for legacy records', () => {
    expect(executionKindLabel(LEGACY_EXECUTION)).toBe('Not recorded by this artifact');
    expect(isolationModeLabel(LEGACY_EXECUTION)).toBe('Not recorded by this artifact');
    expect(executionIsolationDetails(LEGACY_EXECUTION, true)).toEqual([
      { label: 'Isolation mode', value: 'Not recorded by this artifact' },
      { label: 'Isolated', value: 'Not recorded by this artifact' },
      { label: 'Live project writable', value: 'Not recorded by this artifact' },
      { label: 'Network policy', value: 'Not recorded by this artifact' },
      { label: 'Environment policy', value: 'Not recorded by this artifact' },
    ]);
  });

  it('accepts only an explicitly negotiated isolation capability', () => {
    expect(isVerificationExecutionIsolationAvailable({ verificationExecutionIsolation: true })).toBe(true);
    expect(isVerificationExecutionIsolationAvailable({ verificationExecutionIsolation: 1 as unknown as boolean })).toBe(false);
  });

  it('requires an explicit availability decision before returning isolation details', () => {
    expect(executionIsolationDetails(ISOLATED_EXECUTION, undefined as unknown as boolean)).toEqual([]);
  });
});
