import type { AttestationReadPolicy, AttestationReadPolicyReason } from '@shared/domain';

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function policy(
  automaticCanonicalReadAllowed: boolean,
  reason: AttestationReadPolicyReason,
  signingProvider: string | null,
  signingRequired: boolean | null,
): AttestationReadPolicy {
  return { automaticCanonicalReadAllowed, reason, signingProvider, signingRequired };
}

export function attestationConfigUnavailablePolicy(): AttestationReadPolicy {
  return policy(false, 'CONFIG_UNAVAILABLE', null, null);
}

/**
 * Resolve only the ForgeLoopAudit automatic-read decision from the schema-validated
 * ForgeLoop config. Project config remains protocol policy, not host authority.
 */
export function resolveAttestationReadPolicy(config: unknown): AttestationReadPolicy {
  if (!isRecord(config) || !isRecord(config.attestation)) {
    return attestationConfigUnavailablePolicy();
  }

  const attestation = config.attestation;
  const mode = attestation.mode;
  const signing = isRecord(attestation.signing) ? attestation.signing : null;
  const signingProvider = typeof signing?.provider === 'string' ? signing.provider : null;
  const signingRequired = typeof signing?.required === 'boolean' ? signing.required : null;

  if (mode !== 'off' && mode !== 'optional' && mode !== 'required') {
    return policy(false, 'CONFIG_UNAVAILABLE', signingProvider, signingRequired);
  }
  if (!signing || signingProvider === null || signingRequired === null) {
    return policy(false, 'CONFIG_UNAVAILABLE', signingProvider, signingRequired);
  }
  if (mode === 'off') {
    return policy(false, 'DISABLED', signingProvider, signingRequired);
  }
  if (signingProvider === 'none' && signingRequired === false) {
    return policy(true, 'NO_EXTERNAL_SIGNING_PROVIDER', signingProvider, signingRequired);
  }
  if (signingProvider === 'none' || signingProvider === 'sigstore') {
    return policy(false, 'EXTERNAL_SIGNING_PROVIDER', signingProvider, signingRequired);
  }
  return policy(false, 'UNKNOWN_PROVIDER', signingProvider, signingRequired);
}

export function readAttestationReadPolicy(readConfig?: () => unknown): AttestationReadPolicy {
  if (!readConfig) return attestationConfigUnavailablePolicy();
  try {
    return resolveAttestationReadPolicy(readConfig());
  } catch {
    return attestationConfigUnavailablePolicy();
  }
}

export function attestationReadPolicyError(policyValue: AttestationReadPolicy): { code: string; message: string } {
  if (policyValue.reason === 'EXTERNAL_SIGNING_PROVIDER') {
    return {
      code: 'AUDIT_ATTESTATION_EXTERNAL_VERIFICATION_REQUIRED',
      message: 'This attestation uses an external signing provider. ForgeLoopAudit does not automatically execute signing-provider verification. Run the canonical ForgeLoop verification command explicitly.',
    };
  }
  if (policyValue.reason === 'UNKNOWN_PROVIDER') {
    return {
      code: 'AUDIT_ATTESTATION_EXTERNAL_VERIFICATION_REQUIRED',
      message: 'This attestation uses an unknown signing provider. ForgeLoopAudit fails closed and does not automatically execute signing-provider verification. Run the canonical ForgeLoop verification command explicitly.',
    };
  }
  if (policyValue.reason === 'DISABLED') {
    return {
      code: 'AUDIT_ATTESTATION_READ_DISABLED',
      message: 'Automatic attestation reads are disabled by the project policy.',
    };
  }
  return {
    code: 'AUDIT_ATTESTATION_CONFIG_UNAVAILABLE',
    message: 'ForgeLoopAudit could not validate the attestation signing policy, so automatic attestation reads are disabled.',
  };
}
