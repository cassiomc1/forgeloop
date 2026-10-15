import { describe, expect, it } from 'vitest';
import { normalizeCanonicalTaskAudit } from '@main/core/audit/audit-normalizer';
import { normalizeExecutionProfileContext } from '@main/core/integration/canonical-execution-profile';
import { SchemaValidator } from '@main/core/protocol/validator';

const canonicalRoute = {
  schemaVersion: 1,
  protocolVersion: 1,
  input: { workType: 'code', executableChange: true },
  primary: 'implementation',
  guides: ['flutter', 'clean', 'test', 'future-specialist'],
  reasons: { implementation: ['code task'] },
  excluded: {},
};

function canonicalContext() {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId: 'task-1',
    executionProfile: {
      requested: 'balanced',
      floor: 'balanced',
      resolved: 'balanced',
      reasons: ['DEFAULT_PROFILE'],
      escalated: false,
    },
    phase: 'EXECUTING',
    nextAction: 'START_VERIFICATION',
    objective: 'Implement the feature.',
    deliverables: ['lib/main.dart'],
    constraints: ['Use canonical ForgeLoop routing.'],
    selectedGuideIds: ['flutter', 'clean', 'test', 'future-specialist'],
    verificationRequirements: [{ id: 'flutter-tests', text: 'Run applicable checks', type: 'VERIFICATION' }],
    contextPolicy: {
      contextDepth: 'relevant',
      output: 'standard',
      planDepth: 'standard',
      guideStrategy: 'relevant',
      verificationStrategy: 'normal',
      optionalArtifacts: 'lazy',
      requiredSections: ['objective', 'verification'],
      excludedContext: [],
      allowedOptionalContext: [],
    },
    optionalContext: { available: [], loaded: [] },
    invariants: {
      lifecyclePhasesPreserved: true,
      requiredGatesPreserved: true,
      evidenceRequirementsPreserved: true,
      verificationTruthPreserved: true,
      authorityChecksPreserved: true,
      provenancePreserved: true,
      completionValidationPreserved: true,
      safetyFloorPreserved: true,
      lifecyclePhaseSkippingAllowed: false,
    },
  };
}

describe('ForgeLoop 1.12.0 routing compatibility', () => {
  it('accepts canonical flutter and future guide IDs without a closed local enum', () => {
    const validation = new SchemaValidator('schemas').validate('routing-result.schema.json', canonicalRoute);

    expect(validation).toEqual({ valid: true });
    expect(canonicalRoute.guides).toEqual(['flutter', 'clean', 'test', 'future-specialist']);
  });

  it('preserves selected guides while keeping lifecycle and verification semantics separate', () => {
    const view = normalizeExecutionProfileContext(canonicalContext(), 'task-1');

    expect(view.selectedGuideIds).toEqual(['flutter', 'clean', 'test', 'future-specialist']);
    expect(view.status).toBe('CANONICAL');
    expect(view.verificationRequirements).toEqual([
      { id: 'flutter-tests', text: 'Run applicable checks', type: 'VERIFICATION' },
    ]);
    expect(view.invariants?.verificationTruthPreserved).toBe(true);
    expect(view.invariants?.completionValidationPreserved).toBe(true);
  });

  it('does not turn a selected guide into completion or verification evidence', () => {
    const audit = normalizeCanonicalTaskAudit({
      ok: true,
      result: { status: 'INCOMPLETE', routing: canonicalRoute },
    });

    expect(audit.status).toBe('INCOMPLETE');
    expect(audit.result).toMatchObject({ status: 'INCOMPLETE' });
    expect(audit).not.toHaveProperty('evidence');
  });

  it('keeps bounded string validation for malformed selected guide entries', () => {
    expect(() => normalizeExecutionProfileContext({
      ...canonicalContext(),
      selectedGuideIds: ['flutter', 123],
    }, 'task-1')).toThrow('selectedGuideIds is not a bounded string');
  });
});
