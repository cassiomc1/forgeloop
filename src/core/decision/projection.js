export function projectSemanticDecisionStatus({ artifact = null, fresh = false, errorCodes = [] } = {}) {
  return {
    required: true,
    engine: "typesafe-jev",
    model: "jev-1.13.0",
    authority: "SEMANTIC_DECISION",
    evidenceAuthority: "NONE",
    lifecycleAuthority: false,
    completionAuthority: false,
    ownershipAuthority: false,
    installationAuthority: false,
    status: artifact ? (fresh ? "FRESH" : "STALE") : "ABSENT",
    decisionId: artifact?.decisionId ?? null,
    errorCodes: [...errorCodes],
  };
}
