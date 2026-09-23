/**
 * Deterministic execution-profile selection.
 *
 * Profiles are an efficiency and guidance dimension only. They do not alter
 * compliance mode, lifecycle transitions, evidence requirements, authority,
 * or completion validation. A safety floor always wins over an explicit
 * lower request.
 */

export const EXECUTION_PROFILES = Object.freeze(["light", "balanced", "full"]);
export const EXECUTION_PROFILE_REQUESTS = Object.freeze(["auto", ...EXECUTION_PROFILES]);
export const LEGACY_EXECUTION_PROFILE = "balanced";

const PROFILE_RANK = Object.freeze({ light: 0, balanced: 1, full: 2 });
const FULL_WORK_TYPES = new Set(["infrastructure", "security-review", "release", "api-auth"]);
const BALANCED_WORK_TYPES = new Set([
  "code", "bug", "refactor", "backend", "api", "dependency-update", "performance", "accessibility",
]);
const FULL_SURFACES = new Set(["auth", "critical-path"]);
const BALANCED_SURFACES = new Set(["data", "database", "ci", "config"]);
const FULL_RISKS = new Set([
  "secrets", "personal-data", "publication", "critical-path", "destructive", "irreversible",
  "production-deployment", "credentials", "payment", "migration",
]);
const BALANCED_RISKS = new Set(["untrusted-input", "performance", "accessibility", "external-service"]);

function profileError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeRequestedProfile(value, label) {
  const normalized = value ?? "auto";
  if (typeof normalized !== "string" || !EXECUTION_PROFILE_REQUESTS.includes(normalized)) {
    throw profileError("E_EXECUTION_PROFILE_INVALID", `${label} must be one of ${EXECUTION_PROFILE_REQUESTS.join(", ")}`);
  }
  return normalized;
}

function uniqueReasons(reasons) {
  return [...new Set(reasons.filter((reason) => typeof reason === "string" && reason))];
}

function normalizedRouteInput(routeInput = {}) {
  return {
    workType: typeof routeInput.workType === "string" ? routeInput.workType : null,
    surfaces: Array.isArray(routeInput.surfaces) ? [...routeInput.surfaces] : [],
    risks: Array.isArray(routeInput.risks) ? [...routeInput.risks] : [],
    platforms: Array.isArray(routeInput.platforms) ? [...routeInput.platforms] : [],
    behaviorChange: routeInput.behaviorChange === true,
    executableChange: routeInput.executableChange === true,
  };
}

function contractCollections(contract) {
  const source = contract && typeof contract === "object" && !Array.isArray(contract) ? contract : {};
  return {
    deliverables: Array.isArray(source.deliverables) ? source.deliverables : [],
    successCriteria: Array.isArray(source.successCriteria) ? source.successCriteria : [],
    risks: Array.isArray(source.risks) ? source.risks : [],
    constraints: Array.isArray(source.constraints) ? source.constraints : [],
    stopConditions: Array.isArray(source.stopConditions) ? source.stopConditions : [],
  };
}

function contractSignals(contract) {
  const collections = contractCollections(contract);
  const obligations = [];
  const types = new Set();
  function collect(requirement) {
    if (typeof requirement === "string") obligations.push(requirement);
    else if (requirement && typeof requirement === "object") {
      if (typeof requirement.text === "string") obligations.push(requirement.text);
      types.add(requirement.type);
      if (Array.isArray(requirement.requirements)) requirement.requirements.forEach(collect);
    }
  }
  collections.successCriteria.forEach(collect);
  if (Array.isArray(contract?.verification)) contract.verification.forEach(collect);
  const riskText = collections.risks.join(" ").toLowerCase();
  // Constraints and stop conditions describe boundaries, not obligations.
  // Declared route risks remain authoritative even when a constraint excludes
  // an operation; do not try to interpret prose negation as authorization.
  const allText = [
    ...collections.deliverables,
    ...obligations,
  ].join(" ").toLowerCase();
  const combinedText = `${riskText} ${allText}`;
  const signals = {
    secrets: /\bsecrets?\b|\bcredentials?\b|\bpasswords?\b|\bprivate keys?\b/.test(combinedText),
    personalData: /\bpersonal[- ]data\b|\bpii\b|\bsensitive data\b/.test(combinedText),
    publication: types.has("PUBLICATION") || /\bpublication\b|\bpublish(?:ing|ed)?\b|\bdeploy(?:ment|ed)?\b/.test(combinedText),
    destructive: /\bdestructive\b|\birreversible\b|\bdrop database\b|\bdelete production\b/.test(combinedText),
    migration: /\bmigration\b|\bmigrate\b|\bschema change\b|\birreversible persistence\b/.test(combinedText),
    payment: /\bpayments?\b|\bcheckout\b|\bbilling\b/.test(combinedText),
    externalMutation: /\bexternal mutation\b|\bmutate(?:s|d)? external\b|\bpublish(?:ing|ed)?\b/.test(combinedText),
    authoritySensitiveExternalMutation: /\bauthority[- ]sensitive\b|\bhost[- ]authorized external\b|\bexternal mutation requiring authority\b/.test(combinedText),
    broadProductionValidation: types.has("PRODUCTION_READINESS") || /\bbroad production validation\b|\bproduction validation\b|\bvalidate in production\b/.test(combinedText),
  };
  return signals;
}

function scopeSignals({ routeInput, contract, taskDescriptor }) {
  const collections = contractCollections(contract);
  const claims = Array.isArray(taskDescriptor?.writeClaims) ? taskDescriptor.writeClaims : [];
  const deliverableCount = collections.deliverables.length;
  const claimCount = claims.length;
  const successCriteriaCount = collections.successCriteria.length;
  const executableSurfaceCount = new Set([
    ...(routeInput.surfaces ?? []),
    ...(routeInput.platforms ?? []),
  ]).size;
  return {
    multiDeliverable: deliverableCount > 4,
    multiClaim: claimCount > 4,
    broad: successCriteriaCount > 6,
    multiSurfaceExecutableChange: (routeInput.behaviorChange || routeInput.executableChange)
      && executableSurfaceCount > 1,
  };
}

function assertResolvedProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw profileError("E_EXECUTION_PROFILE_INCONSISTENT", "executionProfile must be an object");
  }
  if (!EXECUTION_PROFILE_REQUESTS.includes(value.requested)
    || !EXECUTION_PROFILES.includes(value.floor)
    || !EXECUTION_PROFILES.includes(value.resolved)) {
    throw profileError("E_EXECUTION_PROFILE_INCONSISTENT", "executionProfile contains an unsupported profile value");
  }
  if (!Array.isArray(value.reasons) || value.reasons.length === 0
    || value.reasons.some((reason) => typeof reason !== "string" || !reason)) {
    throw profileError("E_EXECUTION_PROFILE_INCONSISTENT", "executionProfile.reasons must be a non-empty string array");
  }
  if (new Set(value.reasons).size !== value.reasons.length) {
    throw profileError("E_EXECUTION_PROFILE_INCONSISTENT", "executionProfile.reasons must not contain duplicates");
  }
  if (typeof value.escalated !== "boolean") {
    throw profileError("E_EXECUTION_PROFILE_INCONSISTENT", "executionProfile.escalated must be boolean");
  }
  if (PROFILE_RANK[value.resolved] < PROFILE_RANK[value.floor]) {
    throw profileError("E_EXECUTION_PROFILE_SAFETY_FLOOR_INVALID", "executionProfile.resolved cannot be below its safety floor");
  }
  if (value.requested !== "auto" && PROFILE_RANK[value.resolved] < PROFILE_RANK[value.requested]) {
    throw profileError("E_EXECUTION_PROFILE_INCONSISTENT", "executionProfile.resolved cannot be below its explicit request");
  }
  const expectedEscalated = value.requested !== "auto"
    && PROFILE_RANK[value.requested] < PROFILE_RANK[value.floor];
  if (value.escalated !== expectedEscalated) {
    throw profileError("E_EXECUTION_PROFILE_INCONSISTENT", "executionProfile.escalated does not match the requested profile and safety floor");
  }
  return value;
}

export function assertExecutionProfile(value) {
  return assertResolvedProfile(value);
}

export function projectExecutionProfile(route) {
  if (!route || typeof route !== "object") return null;
  return route.executionProfile?.resolved ?? LEGACY_EXECUTION_PROFILE;
}

function routeProfileSignals(normalizedRoute) {
  const fullReasons = [];
  const balancedReasons = [];
  if (FULL_WORK_TYPES.has(normalizedRoute.workType)) fullReasons.push(`WORK_${normalizedRoute.workType.toUpperCase().replaceAll("-", "_")}`);
  if (BALANCED_WORK_TYPES.has(normalizedRoute.workType)) balancedReasons.push(`WORK_${normalizedRoute.workType.toUpperCase().replaceAll("-", "_")}`);
  for (const surface of normalizedRoute.surfaces) {
    if (FULL_SURFACES.has(surface)) fullReasons.push(`SURFACE_${surface.toUpperCase().replaceAll("-", "_")}`);
    else if (BALANCED_SURFACES.has(surface)) balancedReasons.push(`SURFACE_${surface.toUpperCase().replaceAll("-", "_")}`);
  }
  for (const risk of normalizedRoute.risks) {
    if (FULL_RISKS.has(risk)) fullReasons.push(`RISK_${risk.toUpperCase().replaceAll("-", "_")}`);
    else if (BALANCED_RISKS.has(risk)) balancedReasons.push(`RISK_${risk.toUpperCase().replaceAll("-", "_")}`);
  }
  if (normalizedRoute.behaviorChange) balancedReasons.push("WORK_BEHAVIOR_CHANGE");
  if (normalizedRoute.executableChange) balancedReasons.push("WORK_EXECUTABLE_CHANGE");
  return { fullReasons, balancedReasons };
}

function contractProfileSignals(textSignals, normalizedRoute) {
  const fullReasons = [];
  if (textSignals.secrets) fullReasons.push("RISK_SECRETS");
  if (textSignals.personalData) fullReasons.push("RISK_PERSONAL_DATA");
  if (textSignals.publication) fullReasons.push("RISK_PUBLICATION");
  if (textSignals.destructive) fullReasons.push("RISK_DESTRUCTIVE");
  if (textSignals.migration && normalizedRoute.surfaces.includes("database")) fullReasons.push("RISK_MIGRATION");
  if (textSignals.payment) fullReasons.push("RISK_PAYMENT");
  if (textSignals.externalMutation) fullReasons.push("RISK_EXTERNAL_MUTATION");
  if (textSignals.authoritySensitiveExternalMutation) fullReasons.push("RISK_AUTHORITY_SENSITIVE_EXTERNAL_MUTATION");
  if (textSignals.broadProductionValidation) fullReasons.push("RISK_PRODUCTION_VALIDATION");
  return fullReasons;
}

function scopeProfileSignals(scope) {
  const balancedReasons = [];
  if (scope.multiDeliverable) balancedReasons.push("SCOPE_MULTI_DELIVERABLE");
  if (scope.multiClaim) balancedReasons.push("SCOPE_MULTI_CLAIM");
  if (scope.broad || scope.multiSurfaceExecutableChange) balancedReasons.push("SCOPE_BROAD");
  return balancedReasons;
}

function profileSignals({ normalizedRoute, contract, taskDescriptor }) {
  const route = routeProfileSignals(normalizedRoute);
  const scope = scopeSignals({ routeInput: normalizedRoute, contract, taskDescriptor });
  return {
    fullReasons: [...route.fullReasons, ...contractProfileSignals(contractSignals(contract), normalizedRoute)],
    balancedReasons: [...route.balancedReasons, ...scopeProfileSignals(scope)],
    scope,
  };
}

export function resolveExecutionProfile({
  routeInput = {},
  contract = null,
  taskDescriptor = null,
  configuredProfile = "auto",
  requestedProfile = null,
  semanticRecommendation = null,
} = {}) {
  const normalizedRoute = normalizedRouteInput(routeInput);
  const configured = normalizeRequestedProfile(configuredProfile, "configuredProfile");
  const requested = requestedProfile === null || requestedProfile === undefined
    ? configured
    : normalizeRequestedProfile(requestedProfile, "requestedProfile");
  const reasons = [];

  if (requestedProfile !== null && requestedProfile !== undefined) reasons.push("PROFILE_EXPLICIT_REQUEST");
  else if (configured !== "auto") reasons.push("PROFILE_PROJECT_CONFIG");
  else reasons.push("PROFILE_DEFAULT_AUTO");

  let floor = "light";
  const { fullReasons, balancedReasons, scope } = profileSignals({ normalizedRoute, contract, taskDescriptor });

  if (fullReasons.length > 0) {
    floor = "full";
    reasons.push(...fullReasons);
  } else if (balancedReasons.length > 0) {
    floor = "balanced";
    reasons.push(...balancedReasons);
  } else {
    const lowRiskDocumentation = normalizedRoute.workType === "documentation"
      || normalizedRoute.surfaces.includes("documentation");
    const lowRiskUi = normalizedRoute.workType === "ui-copy"
      || normalizedRoute.surfaces.some((surface) => ["ui", "forms", "mobile", "desktop"].includes(surface));
    reasons.push(lowRiskDocumentation
      ? "WORK_LOW_RISK_DOCUMENTATION"
      : lowRiskUi
        ? "WORK_LOW_RISK_UI"
        : "NO_ESCALATION_SIGNAL");
    reasons.push("NO_HIGH_RISK_SIGNAL");
    reasons.push(scope.broad || scope.multiDeliverable || scope.multiClaim || scope.multiSurfaceExecutableChange
      ? "SCOPE_BROAD"
      : "NARROW_DELIVERABLE_SCOPE");
  }

  if (floor !== "full" && balancedReasons.length > 0 && fullReasons.length === 0) {
    // Keep scope/risk reasons in the same deterministic order as the inputs.
    for (const reason of balancedReasons) if (!reasons.includes(reason)) reasons.push(reason);
  }

  const requestedRank = requested === "auto" ? PROFILE_RANK[floor] : PROFILE_RANK[requested];
  let resolved = EXECUTION_PROFILES.find((profile) => PROFILE_RANK[profile] === Math.max(requestedRank, PROFILE_RANK[floor]));
  const semanticProfile = typeof semanticRecommendation === "string"
    ? semanticRecommendation
    : semanticRecommendation?.executionProfile?.recommendedProfile
      ?? semanticRecommendation?.recommendedProfile
      ?? null;
  if (["light", "balanced", "full"].includes(semanticProfile)
    && PROFILE_RANK[semanticProfile] > PROFILE_RANK[resolved]) {
    resolved = semanticProfile;
    reasons.push("PROFILE_ESCALATED_BY_JEV");
  }
  const escalated = requested !== "auto" && PROFILE_RANK[requested] < PROFILE_RANK[floor];
  if (escalated) reasons.push("PROFILE_ESCALATED_BY_SAFETY");

  return assertResolvedProfile({
    requested,
    floor,
    resolved,
    reasons: uniqueReasons(reasons),
    escalated,
  });
}
