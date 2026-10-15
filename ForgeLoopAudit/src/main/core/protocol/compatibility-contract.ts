import { ARTIFACT_SCHEMAS } from './artifact-registry';

export const SUPPORTED_PROTOCOL = Object.freeze({
  protocolVersion: 1,
  requiredSchemas: Object.freeze([...new Set(Object.values(ARTIFACT_SCHEMAS))].sort()),
  observedButNotAuthoritative: Object.freeze([] as string[]),
  intentionallyUnsupported: Object.freeze([] as string[]),
});

export type CompatibilityFailure = 'UNSUPPORTED_PROTOCOL_VERSION' | 'UNSUPPORTED_SCHEMA_VERSION' | 'CLI_ARTIFACT_CONFLICT';

export interface ProtocolCompatibilityInput {
  protocolVersion: number;
  schemaVersion: number;
  compatible: boolean;
}

export interface ProtocolCompatibilityContractResult {
  compatible: boolean;
  reason?: CompatibilityFailure;
}

export function evaluateProtocolCompatibility(input: ProtocolCompatibilityInput): ProtocolCompatibilityContractResult {
  if (input.protocolVersion !== SUPPORTED_PROTOCOL.protocolVersion) {
    return { compatible: false, reason: 'UNSUPPORTED_PROTOCOL_VERSION' };
  }
  if (input.schemaVersion !== 1) {
    return { compatible: false, reason: 'UNSUPPORTED_SCHEMA_VERSION' };
  }
  if (!input.compatible) return { compatible: false };
  return { compatible: true };
}
