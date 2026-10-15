import { describe, expect, it } from 'vitest';
import { ARTIFACT_SCHEMAS } from '@main/core/protocol/artifact-registry';
import {
  SUPPORTED_PROTOCOL,
  evaluateProtocolCompatibility,
} from '@main/core/protocol/compatibility-contract';

describe('ForgeLoop compatibility contract', () => {
  it('declares exactly the schemas used by the runtime artifact registry', () => {
    expect([...SUPPORTED_PROTOCOL.requiredSchemas].sort()).toEqual(
      [...new Set(Object.values(ARTIFACT_SCHEMAS))].sort(),
    );
  });

  it('returns an explicit failure for unsupported protocol versions', () => {
    expect(evaluateProtocolCompatibility({ protocolVersion: 2, schemaVersion: 1, compatible: true })).toEqual({
      compatible: false,
      reason: 'UNSUPPORTED_PROTOCOL_VERSION',
    });
  });

  it('returns an explicit failure for unsupported schema versions', () => {
    expect(evaluateProtocolCompatibility({ protocolVersion: 1, schemaVersion: 2, compatible: true })).toEqual({
      compatible: false,
      reason: 'UNSUPPORTED_SCHEMA_VERSION',
    });
  });
});
