import { SUPPORTED_PROTOCOL_VERSIONS } from '@shared/constants';
import { ForgeLoopAuditError } from '@shared/errors';
import type { ProtocolSummary } from '@shared/domain';
import { evaluateProtocolCompatibility } from './compatibility-contract';

export interface ProtocolInfoResult {
  protocolVersion: number;
  schemaVersion: number;
  packageVersion?: string;
  compatible: boolean;
}

export function checkProtocolCompatibility(protocolInfo: ProtocolInfoResult): ProtocolSummary {
  const contract = evaluateProtocolCompatibility(protocolInfo);
  const isSupported = SUPPORTED_PROTOCOL_VERSIONS.includes(protocolInfo.protocolVersion as typeof SUPPORTED_PROTOCOL_VERSIONS[number]);

  if (!isSupported) {
    throw ForgeLoopAuditError.protocolUnsupported(protocolInfo.protocolVersion, 'unknown');
  }

  return {
    protocolVersion: protocolInfo.protocolVersion,
    schemaVersion: protocolInfo.schemaVersion,
    packageVersion: protocolInfo.packageVersion,
    compatible: contract.compatible && isSupported,
  };
}

export function getSupportedVersions(): number[] {
  return [...SUPPORTED_PROTOCOL_VERSIONS];
}

export function isVersionSupported(version: number): boolean {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version as typeof SUPPORTED_PROTOCOL_VERSIONS[number]);
}
