import { GUIDE_IDS, PROTOCOL_VERSION } from "./protocol.js";
import { assertExecutionProfile, resolveExecutionProfile } from "./execution-profile.js";
import { PROJECT_EVIDENCE_SCOPES } from "./project-detection.js";

export const ROUTING_SCHEMA_VERSION = 1;

const WORK_TYPES = new Set([
  "documentation",
  "ui-copy",
  "code",
  "bug",
  "refactor",
  "backend",
  "api",
  "api-auth",
  "complete-website",
  "mobile-ui",
  "web-game",
  "html-video",
  "infrastructure",
  "security-review",
  "performance",
  "accessibility",
  "test-only",
  "dependency-update",
  "release",
]);

const SIGNALS = Object.freeze({
  surfaces: new Set([
    "ui",
    "forms",
    "api",
    "auth",
    "data",
    "database",
    "mobile",
    "desktop",
    "game",
    "video",
    "ci",
    "config",
    "critical-path",
    "documentation",
  ]),
  risks: new Set([
    "untrusted-input",
    "personal-data",
    "secrets",
    "external-service",
    "publication",
    "critical-path",
    "performance",
    "accessibility",
    "destructive",
    "irreversible",
    "production-deployment",
    "credentials",
    "payment",
    "migration",
  ]),
  platforms: new Set(["web", "mobile", "desktop", "server", "ci", "cross-platform"]),
});

const PROJECT_FRAMEWORKS = new Set(["flutter"]);

export const PLATFORM_SEMANTICS = Object.freeze({
  web: Object.freeze({
    mode: "informational-only",
    description: "Web is recorded as context; surface, risk, and work signals select guides.",
  }),
  mobile: Object.freeze({
    mode: "contextual",
    reason: "PLATFORM_MOBILE",
    description: "Mobile UI context adds performance guidance and reinforces design/accessibility.",
  }),
  desktop: Object.freeze({
    mode: "contextual",
    reason: "PLATFORM_DESKTOP",
    description: "Desktop UI context reinforces design and accessibility guidance.",
  }),
  server: Object.freeze({
    mode: "contextual",
    reason: "PLATFORM_SERVER",
    description: "Server authentication context adds testing and reinforces the trust boundary.",
  }),
  ci: Object.freeze({
    mode: "contextual",
    reason: "PLATFORM_CI",
    description: "Executable CI changes add security review to the existing change checks.",
  }),
  "cross-platform": Object.freeze({
    mode: "informational-only",
    description: "Cross-platform is recorded as context; it does not select a guide by itself.",
  }),
});

const WORK_GUIDES = Object.freeze({
  "complete-website": ["premium", "design", "taste", "accessibility", "clean", "test", "security", "performance"],
  "api-auth": ["clean", "test", "security", "performance"],
  api: ["clean", "test"],
  backend: ["clean", "test"],
  code: ["clean", "test"],
  bug: ["clean", "test"],
  refactor: ["clean", "test"],
  "dependency-update": ["clean", "test"],
  release: ["clean", "test"],
  "mobile-ui": ["clean", "test", "design", "accessibility", "security", "performance"],
  "web-game": ["games", "clean", "test", "security", "performance", "accessibility"],
  "html-video": ["design", "accessibility", "performance", "test", "security"],
  infrastructure: ["security", "test"],
  "security-review": ["security"],
  performance: ["performance", "test"],
  accessibility: ["accessibility", "test"],
  "test-only": ["test"],
  documentation: ["documentation"],
  "ui-copy": ["design", "accessibility"],
});

const PRIMARY_GUIDES = Object.freeze({
  "complete-website": "premium",
  "web-game": "games",
  documentation: "documentation",
  "ui-copy": "design",
});

function hasFlutterWorkContext(workType) {
  return !["documentation", "ui-copy"].includes(workType);
}

function addFlutterProjectGuides(input, add) {
  const projectEvidence = input.projectEvidence;
  if (!projectEvidence?.frameworks.includes("flutter")
    || !["MATCH", "UNSCOPED"].includes(projectEvidence.scope)
    || !hasFlutterWorkContext(input.workType)) return;
  add("flutter", "PROJECT_FLUTTER_SDK_DEPENDENCY");
  add("clean", "PROJECT_FLUTTER_BASELINE");
  add("test", "PROJECT_FLUTTER_BASELINE");
}

function flutterExclusionReason(projectEvidence, workType) {
  if (!projectEvidence) return "NO_FLUTTER_PROJECT_EVIDENCE";
  if (projectEvidence.scope === "NO_MATCH") return "NO_FLUTTER_SCOPE_MATCH";
  if (!projectEvidence.frameworks.includes("flutter")) return "NO_FLUTTER_PRIMARY_EVIDENCE";
  if (!hasFlutterWorkContext(workType)) return "NO_FLUTTER_EXECUTABLE_WORK";
  return "NO_FLUTTER_PRIMARY_EVIDENCE";
}

function exclusionReasonForGuide(guide, projectEvidence, workType) {
  if (guide === "security") return "NO_TRUST_BOUNDARY";
  if (guide === "performance") return "NO_MEASURABLE_PERFORMANCE_RISK";
  if (guide === "design" || guide === "accessibility") return "NO_UI_SURFACE";
  if (guide === "premium" || guide === "games") return "NO_PRIMARY_WORK_TYPE";
  if (guide === "taste") return "NO_TASTE_FRONTEND_CONTEXT";
  if (guide === "documentation") return "NO_DOCUMENTATION_SURFACE";
  if (guide === "flutter") return flutterExclusionReason(projectEvidence, workType);
  return "NO_BEHAVIOR_OR_EXECUTABLE_CHANGE";
}

export class RouteInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "RouteInputError";
    this.code = "ROUTING_FAILURE";
  }
}

function reasonForWorkType(workType) {
  return `WORK_${workType.toUpperCase().replaceAll("-", "_")}`;
}

function reasonForSignal(prefix, signal) {
  return `${prefix}_${signal.toUpperCase().replaceAll("-", "_")}`;
}

function normalizeArray(value, name, allowed) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new RouteInputError(`${name} must be an array`);
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item)) {
      throw new RouteInputError(`Unknown ${name.slice(0, -1)}: ${item}`);
    }
    if (seen.has(item)) throw new RouteInputError(`Duplicate ${name.slice(0, -1)}: ${item}`);
    seen.add(item);
  }
  return [...seen].sort();
}

function normalizeStringList(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new RouteInputError(`${name} must be an array`);
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new RouteInputError(`${name} must contain non-empty strings`);
    }
    if (seen.has(item)) throw new RouteInputError(`Duplicate ${name.slice(0, -1)}: ${item}`);
    seen.add(item);
  }
  return [...seen].sort();
}

function normalizeProjectEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RouteInputError("projectEvidence must be an object");
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== ROUTING_SCHEMA_VERSION) {
    throw new RouteInputError(`Unsupported projectEvidence schema version: ${value.schemaVersion}`);
  }
  const frameworks = normalizeArray(value.frameworks, "frameworks", PROJECT_FRAMEWORKS);
  const scope = value.scope ?? (frameworks.length > 0 ? "UNSCOPED" : "NONE");
  if (!PROJECT_EVIDENCE_SCOPES.includes(scope)) {
    throw new RouteInputError(`Unknown project evidence scope: ${scope}`);
  }
  return {
    schemaVersion: ROUTING_SCHEMA_VERSION,
    scope,
    frameworks,
    projectRoots: normalizeStringList(value.projectRoots, "projectRoots"),
    primarySignals: normalizeStringList(value.primarySignals, "primarySignals"),
    supportingSignals: normalizeStringList(value.supportingSignals, "supportingSignals"),
  };
}

export function normalizeRouteInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RouteInputError("Route input must be an object");
  }
  if (typeof input.workType !== "string" || !WORK_TYPES.has(input.workType)) {
    throw new RouteInputError(`Unknown work type: ${input.workType}`);
  }
  for (const key of ["behaviorChange", "executableChange"]) {
    if (input[key] !== undefined && typeof input[key] !== "boolean") {
      throw new RouteInputError(`${key} must be boolean`);
    }
  }
  const projectEvidence = input.projectEvidence === undefined
    ? undefined
    : normalizeProjectEvidence(input.projectEvidence);
  return {
    schemaVersion: ROUTING_SCHEMA_VERSION,
    workType: input.workType,
    surfaces: normalizeArray(input.surfaces, "surfaces", SIGNALS.surfaces),
    risks: normalizeArray(input.risks, "risks", SIGNALS.risks),
    platforms: normalizeArray(input.platforms, "platforms", SIGNALS.platforms),
    behaviorChange: input.behaviorChange ?? false,
    executableChange: input.executableChange ?? false,
    ...(projectEvidence ? { projectEvidence } : {}),
  };
}

export function evaluateRoute(input = {}, profileOptions = {}) {
  const normalized = normalizeRouteInput(input);
  const selected = new Map();
  const excluded = {};

  function add(guide, reason) {
    if (!GUIDE_IDS.includes(guide)) throw new RouteInputError(`Unknown guide: ${guide}`);
    const reasons = selected.get(guide) ?? [];
    if (!reasons.includes(reason)) reasons.push(reason);
    selected.set(guide, reasons);
  }

  const projectEvidence = normalized.projectEvidence;
  addFlutterProjectGuides(normalized, add);

  const workReason = reasonForWorkType(normalized.workType);
  for (const guide of WORK_GUIDES[normalized.workType]) add(guide, workReason);

  if (normalized.surfaces.includes("ui") || normalized.surfaces.includes("forms")) {
    add("design", "SURFACE_UI");
    add("accessibility", normalized.surfaces.includes("forms") ? "SURFACE_FORMS" : "SURFACE_UI");
  }
  if (normalized.surfaces.includes("mobile") || normalized.surfaces.includes("desktop")) {
    add("design", "SURFACE_PLATFORM_UI");
    add("accessibility", "SURFACE_PLATFORM_UI");
  }
  if (normalized.surfaces.includes("game")) add("games", "SURFACE_GAME");
  if (normalized.surfaces.includes("video")) {
    add("design", "SURFACE_VIDEO");
    add("accessibility", "SURFACE_VIDEO");
  }
  if (normalized.surfaces.includes("auth")) add("security", "SURFACE_AUTH");
  if (normalized.surfaces.includes("documentation")) {
    add("documentation", "SURFACE_DOCUMENTATION");
  }

  for (const risk of normalized.risks) {
    if (["untrusted-input", "personal-data", "secrets", "external-service", "publication"].includes(risk)) {
      add("security", reasonForSignal("RISK", risk));
    }
    if (["critical-path", "performance"].includes(risk)) {
      add("performance", reasonForSignal("RISK", risk));
    }
    if (risk === "accessibility") add("accessibility", "RISK_ACCESSIBILITY");
  }

  if (normalized.behaviorChange) {
    add("clean", "CHANGE_BEHAVIOR");
    add("test", "CHANGE_BEHAVIOR");
  }
  if (normalized.executableChange) {
    add("clean", "CHANGE_EXECUTABLE_CONFIG");
    add("test", "CHANGE_EXECUTABLE_CONFIG");
  }

  const hasUiContext = normalized.surfaces.some((surface) => ["ui", "forms", "mobile", "desktop"].includes(surface));
  if (normalized.platforms.includes("mobile") && hasUiContext) {
    add("design", "PLATFORM_MOBILE");
    add("accessibility", "PLATFORM_MOBILE");
    add("performance", "PLATFORM_MOBILE");
  }
  if (normalized.platforms.includes("desktop") && hasUiContext) {
    add("design", "PLATFORM_DESKTOP");
    add("accessibility", "PLATFORM_DESKTOP");
  }
  if (normalized.platforms.includes("server") && normalized.surfaces.includes("auth")) {
    add("security", "PLATFORM_SERVER");
    add("test", "PLATFORM_SERVER");
  }
  if (normalized.platforms.includes("ci") && normalized.executableChange) {
    add("security", "PLATFORM_CI");
  }

  for (const guide of GUIDE_IDS) {
    if (selected.has(guide)) continue;
    excluded[guide] = [exclusionReasonForGuide(guide, projectEvidence, normalized.workType)];
  }

  const guides = [...selected.keys()];
  const result = {
    schemaVersion: ROUTING_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    input: normalized,
    primary: Object.prototype.hasOwnProperty.call(PRIMARY_GUIDES, normalized.workType)
      ? PRIMARY_GUIDES[normalized.workType]
      : guides[0] ?? null,
    guides,
    reasons: Object.fromEntries(guides.map((guide) => [guide, selected.get(guide)])),
    excluded,
    executionProfile: resolveExecutionProfile({
      routeInput: normalized,
      contract: profileOptions.contract ?? input.contract ?? null,
      taskDescriptor: profileOptions.taskDescriptor ?? input.taskDescriptor ?? null,
      configuredProfile: profileOptions.configuredProfile ?? input.configuredProfile ?? "auto",
      requestedProfile: profileOptions.requestedProfile
        ?? (Object.prototype.hasOwnProperty.call(input, "executionProfile") ? input.executionProfile : null),
    }),
  };
  return assertRouteInvariants(result);
}

export function assertRouteInvariants(result) {
  const invariantError = (code, message) => {
    const error = new RouteInputError(message);
    error.code = code;
    return error;
  };
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw invariantError("E_ROUTE_INVALID", "Route result must be an object");
  }
  if (!Array.isArray(result.guides) || new Set(result.guides).size !== result.guides.length) {
    throw invariantError("E_ROUTE_INVALID", "Route result contains duplicate guides");
  }
  if (result.contractFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(result.contractFingerprint)) {
    throw invariantError("E_ROUTE_INVALID", "Route contractFingerprint must be a lowercase SHA-256 fingerprint");
  }
  if (result.executionProfile !== undefined) {
    try {
      assertExecutionProfile(result.executionProfile);
    } catch (error) {
      throw invariantError(error.code ?? "E_EXECUTION_PROFILE_INCONSISTENT", error.message);
    }
  }
  for (const guide of result.guides) {
    if (!GUIDE_IDS.includes(guide)) throw invariantError("E_ROUTE_INVALID", `Route result contains unknown guide: ${guide}`);
    if (!Array.isArray(result.reasons?.[guide]) || result.reasons[guide].length === 0) {
      throw invariantError("E_ROUTE_REASON_MISSING", `Selected guide has no reason: ${guide}`);
    }
  }
  for (const [guide, reasons] of Object.entries(result.excluded ?? {})) {
    if (!GUIDE_IDS.includes(guide)) {
      throw invariantError("E_ROUTE_INVALID", `Route result contains unknown excluded guide: ${guide}`);
    }
    if (result.guides.includes(guide)) {
      throw invariantError("E_ROUTE_INVALID", `Guide cannot be selected and excluded: ${guide}`);
    }
    if (!Array.isArray(reasons) || reasons.length === 0) {
      throw invariantError("E_ROUTE_REASON_MISSING", `Excluded guide has no exclusion reason: ${guide}`);
    }
  }
  if (result.primary !== null && !result.guides.includes(result.primary)) {
    throw invariantError("E_ROUTE_INVALID", "Primary guide must be null or selected");
  }
  return result;
}

export const ROUTING_SIGNALS = Object.freeze({
  workTypes: Object.freeze([...WORK_TYPES].sort()),
  surfaces: Object.freeze([...SIGNALS.surfaces].sort()),
  risks: Object.freeze([...SIGNALS.risks].sort()),
  platforms: Object.freeze([...SIGNALS.platforms].sort()),
});
