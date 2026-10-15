export interface AuthoritativeFacts {
  phase?: unknown;
  health?: unknown;
  nextAction?: unknown;
  policy?: unknown;
  continuity?: unknown;
}

export interface SemanticParityDifference {
  field: keyof AuthoritativeFacts;
  artifactValue: unknown;
  cliValue: unknown;
}

export interface SemanticParityResult {
  consistent: boolean;
  differences: SemanticParityDifference[];
}

const FACT_FIELDS: Array<keyof AuthoritativeFacts> = ['phase', 'health', 'nextAction', 'policy', 'continuity'];

export function compareAuthoritativeFacts(
  artifactFacts: AuthoritativeFacts,
  cliFacts: AuthoritativeFacts,
): SemanticParityResult {
  const differences = FACT_FIELDS.flatMap((field) => {
    if (artifactFacts[field] === undefined || cliFacts[field] === undefined || Object.is(artifactFacts[field], cliFacts[field])) return [];
    return [{ field, artifactValue: artifactFacts[field], cliValue: cliFacts[field] }];
  });
  return { consistent: differences.length === 0, differences };
}
