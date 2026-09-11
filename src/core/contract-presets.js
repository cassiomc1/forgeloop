import { createContract } from "./contract.js";

const PRESET_DEFINITIONS = Object.freeze({
  documentation: Object.freeze({
    objective: "Complete the requested documentation change with verified project facts.",
    constraints: ["Preserve repository-local instructions and existing public documentation contracts."],
    risks: [],
    verification: [{ id: "verify-documentation", text: "Relevant documentation checks pass.", type: "VERIFICATION" }],
    successCriteria: [{ id: "complete-documentation", text: "The requested documentation change is complete and accurate.", type: "PRODUCT" }],
    stopConditions: ["A required project fact or source cannot be confirmed."],
  }),
  bug: Object.freeze({
    objective: "Diagnose and correct the requested bug without changing unrelated behavior.",
    constraints: ["Preserve the existing public contract unless a breaking change is explicitly requested."],
    risks: [],
    verification: [{ id: "verify-bug-fix", text: "A focused regression check and proportional regression checks pass.", type: "VERIFICATION" }],
    successCriteria: [{ id: "complete-bug-fix", text: "The reported behavior is corrected and the regression is covered.", type: "PRODUCT" }],
    stopConditions: ["The failure cannot be reproduced or narrowed with available evidence."],
  }),
  feature: Object.freeze({
    objective: "Implement the requested feature within the confirmed project scope.",
    constraints: ["Preserve existing architecture and public contracts unless a change is explicitly requested."],
    risks: [],
    verification: [{ id: "verify-feature", text: "Focused behavior checks and proportional regression checks pass.", type: "VERIFICATION" }],
    successCriteria: [{ id: "complete-feature", text: "The requested feature behavior is implemented and documented where applicable.", type: "PRODUCT" }],
    stopConditions: ["Required product behavior or acceptance facts remain unresolved."],
  }),
  release: Object.freeze({
    objective: "Prepare the requested release with independently verified artifact and publication evidence.",
    constraints: [
      "Do not publish, deploy, or mutate external release state without explicit authority.",
      "Separate local checks, repository integration, publication, and deployment evidence.",
    ],
    risks: ["publication"],
    verification: [{ id: "verify-release", text: "Release identity, package/artifact integrity, and required checks are independently verified.", type: "VERIFICATION" }],
    successCriteria: [{
      id: "publish-release",
      text: "The requested release publication status is independently verified.",
      type: "PUBLICATION",
      requiredPublicationStatus: "published",
    }],
    stopConditions: ["Publication authority, target, or identity evidence is not available."],
  }),
});

export const CONTRACT_PRESET_IDS = Object.freeze(Object.keys(PRESET_DEFINITIONS));

function normalizedClaims(claims) {
  return [...new Set((Array.isArray(claims) ? claims : [])
    .filter((claim) => typeof claim === "string" && claim.trim() !== "")
    .map((claim) => claim.trim()))];
}

export function createPresetContract({ taskId, preset, claims = [] } = {}) {
  if (!Object.prototype.hasOwnProperty.call(PRESET_DEFINITIONS, preset)) {
    const error = new Error(`Unknown contract preset: ${preset}. Expected one of ${CONTRACT_PRESET_IDS.join(", ")}`);
    error.code = "E_CONTRACT_PRESET_UNKNOWN";
    throw error;
  }
  const definition = PRESET_DEFINITIONS[preset];
  const confirmedClaims = normalizedClaims(claims);
  const unresolvedDecisions = confirmedClaims.length > 0
    ? []
    : ["Confirm the concrete deliverables and affected behavior before implementation."];
  return createContract({
    taskId,
    objective: definition.objective,
    deliverables: confirmedClaims.length > 0 ? confirmedClaims : ["Deliverables confirmed by task scope."],
    constraints: definition.constraints,
    risks: definition.risks,
    verification: definition.verification,
    successCriteria: definition.successCriteria,
    stopConditions: definition.stopConditions,
    unresolvedDecisions,
    sourceRefs: [`contract-preset:${preset}`],
  });
}

export function contractPresetDefinition(preset) {
  if (!Object.prototype.hasOwnProperty.call(PRESET_DEFINITIONS, preset)) return null;
  return structuredClone(PRESET_DEFINITIONS[preset]);
}
