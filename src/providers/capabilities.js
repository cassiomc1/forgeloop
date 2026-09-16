export const PROVIDER_KINDS = Object.freeze([
  "ADVISORY_CONTEXT",
  "VERIFICATION_EXECUTION",
  "BROWSER_VERIFICATION",
  "SECURITY_REVIEW",
  "PRESENTATION",
]);

export const PROVIDER_CAPABILITIES = Object.freeze({
  ADVISORY_CONTEXT: Object.freeze({
    lifecycleAuthority: false,
    completionAuthority: false,
    executableAuthority: false,
    evidenceAuthority: false,
  }),
  VERIFICATION_EXECUTION: Object.freeze({
    lifecycleAuthority: false,
    completionAuthority: false,
    canProduceExecutionObservation: true,
    evidenceAuthority: false,
  }),
  BROWSER_VERIFICATION: Object.freeze({
    lifecycleAuthority: false,
    completionAuthority: false,
    evidenceRequiresForgeLoopValidation: true,
    evidenceAuthority: false,
  }),
  SECURITY_REVIEW: Object.freeze({
    lifecycleAuthority: false,
    completionAuthority: false,
    evidenceRequiresForgeLoopValidation: true,
    evidenceAuthority: false,
  }),
  PRESENTATION: Object.freeze({
    lifecycleAuthority: false,
    completionAuthority: false,
    executableAuthority: false,
    evidenceAuthority: false,
    mayMutateProtocolState: false,
  }),
});

export function capabilityFor(kind) {
  if (!PROVIDER_KINDS.includes(kind)) return null;
  return PROVIDER_CAPABILITIES[kind] ?? null;
}
