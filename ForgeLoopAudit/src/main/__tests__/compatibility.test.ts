import { describe, it, expect } from 'vitest';
import { checkProtocolCompatibility, isVersionSupported, getSupportedVersions } from '@main/core/protocol/compatibility';
import { ForgeLoopAuditError } from '@shared/errors';

describe('protocol/compatibility', () => {
  describe('checkProtocolCompatibility', () => {
    it('should return compatible summary for supported version', () => {
      const result = checkProtocolCompatibility({
        protocolVersion: 1,
        schemaVersion: 1,
        compatible: true,
      });

      expect(result).toEqual({
        protocolVersion: 1,
        schemaVersion: 1,
        packageVersion: undefined,
        compatible: true,
      });
    });

    it('should throw for unsupported protocol version', () => {
      expect(() =>
        checkProtocolCompatibility({
          protocolVersion: 999,
          schemaVersion: 1,
          compatible: true,
        })
      ).toThrow(ForgeLoopAuditError);
    });

    it('should include packageVersion when provided', () => {
      const result = checkProtocolCompatibility({
        protocolVersion: 1,
        schemaVersion: 1,
        packageVersion: '1.0.0',
        compatible: true,
      });

      expect(result.packageVersion).toBe('1.0.0');
    });
  });

  describe('isVersionSupported', () => {
    it('should return true for version 1', () => {
      expect(isVersionSupported(1)).toBe(true);
    });

    it('should return false for unsupported versions', () => {
      expect(isVersionSupported(0)).toBe(false);
      expect(isVersionSupported(2)).toBe(false);
      expect(isVersionSupported(999)).toBe(false);
    });
  });

  describe('getSupportedVersions', () => {
    it('should return an array of supported versions', () => {
      const versions = getSupportedVersions();
      expect(versions).toBeInstanceOf(Array);
      expect(versions).toContain(1);
    });

    it('should return a copy, not the original array', () => {
      const v1 = getSupportedVersions();
      const v2 = getSupportedVersions();
      expect(v1).not.toBe(v2);
      expect(v1).toEqual(v2);
    });
  });
});
