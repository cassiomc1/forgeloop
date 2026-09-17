import { sha256 } from "./manifest.js";
import { validateVerificationAuthority } from "./verification-capability.js";

export const E_COMMAND_PROVENANCE_UNATTESTED = "E_COMMAND_PROVENANCE_UNATTESTED";

export function validateCommandProvenance(check) {
  if (check?.kind !== "command" || check.evidenceKind !== "OBSERVED") {
    return { valid: true, error: null };
  }
  if (check.provenance !== "FORGELOOP_EXECUTED" || typeof check.executionRef !== "string" || check.executionRef.trim() === "") {
    return {
      valid: false,
      error: {
        code: E_COMMAND_PROVENANCE_UNATTESTED,
        message: "Observed command evidence requires a ForgeLoop execution artifact",
      },
    };
  }
  return { valid: true, error: null };
}

export const REQUIREMENT_TYPES = Object.freeze([
  "PRODUCT",
  "VERIFICATION",
  "LIFECYCLE",
  "PUBLICATION",
  "PRODUCTION_READINESS",
]);

export const TERMINAL_OWNED_TYPES = Object.freeze([
  "LIFECYCLE",
  "PUBLICATION",
  "PRODUCTION_READINESS",
]);

const LIFECYCLE_TERMS = /\b(?:lifecycle reaches|forgeloop reaches|complete returns|validator-backed complete|completion validated|review is approved)\b/i;
const PUBLICATION_TERMS = /\b(?:publication succeeds|release (?:is )?published|package (?:is )?published|published to|published package)\b/i;
const PRODUCTION_TERMS = /\b(?:deployment succeeds|production deployment|production readiness|production validation|production smoke|deployed to)\b/i;
const NON_TERMINAL_TERMS = /\b(?:tests?|lint|build|typecheck|types?|coverage|keyboard|zoom|contrast|motion|checks?|unit|e2e|integration|suite|regression|browser|responsive|html|css|js|component|api)\b/i;
const CONJUNCTION_TERMS = /\b(?:and|with|then|plus|also|after)\b/i;

export function isMixedTerminalRequirement(text) {
  if (typeof text !== "string") return false;
  const hasTerminal = LIFECYCLE_TERMS.test(text) || PUBLICATION_TERMS.test(text) || PRODUCTION_TERMS.test(text);
  if (!hasTerminal) return false;
  return NON_TERMINAL_TERMS.test(text) || CONJUNCTION_TERMS.test(text);
}

function stableId(text) {
  return `REQ_${sha256(Buffer.from(text.trim().replace(/\s+/g, " ").toLowerCase())).slice(0, 16).toUpperCase()}`;
}

export function isPublicationStatusSatisfied(actual, required) {
  if (required === "committed") {
    return ["committed", "pushed", "published"].includes(actual);
  }
  if (required === "pushed") {
    return ["pushed", "published"].includes(actual);
  }
  if (required === "published") {
    return actual === "published";
  }
  if (required === "deployed") {
    return actual === "deployed";
  }
  return actual === required;
}

export function classifyRequirement(input) {
  if (typeof input === "string") {
    const text = input.trim();
    const isMixed = isMixedTerminalRequirement(text);
    const type = isMixed
      ? "VERIFICATION"
      : LIFECYCLE_TERMS.test(text)
        ? "LIFECYCLE"
        : PUBLICATION_TERMS.test(text)
          ? "PUBLICATION"
          : PRODUCTION_TERMS.test(text)
            ? "PRODUCTION_READINESS"
            : "VERIFICATION";
    let requiredPublicationStatus = undefined;
    if (type === "PUBLICATION") {
      if (/\b(?:publish|published|release published|published package)\b/i.test(text)) {
        requiredPublicationStatus = "published";
      } else if (/\b(?:deploy|deployed)\b/i.test(text)) {
        requiredPublicationStatus = "deployed";
      } else if (/\b(?:push|pushed)\b/i.test(text)) {
        requiredPublicationStatus = "pushed";
      } else if (/\b(?:commit|committed)\b/i.test(text)) {
        requiredPublicationStatus = "committed";
      } else {
        requiredPublicationStatus = "published";
      }
    }
    return {
      id: stableId(text),
      text,
      type,
      operator: "SINGLE",
      lifecycleOwned: type === "LIFECYCLE",
      terminalOwned: TERMINAL_OWNED_TYPES.includes(type),
      mixedTerminal: isMixed,
      requiredEvidenceKind: "OBSERVED",
      requiredPublicationStatus,
      requirements: [],
    };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Requirement must be a string or object");
  }
  const text = input.text ?? input.id;
  const classified = classifyRequirement(text);
  const type = input.type ?? classified.type;
  const isMixed = input.mixedTerminal ?? (typeof text === "string" && isMixedTerminalRequirement(text));
  return {
    ...classified,
    ...structuredClone(input),
    id: input.id ?? classified.id,
    text,
    type,
    operator: input.operator ?? (input.requirements?.length ? "ALL" : "SINGLE"),
    lifecycleOwned: input.lifecycleOwned ?? type === "LIFECYCLE",
    terminalOwned: input.terminalOwned ?? TERMINAL_OWNED_TYPES.includes(type),
    mixedTerminal: isMixed,
    requiredEvidenceKind: input.requiredEvidenceKind ?? "OBSERVED",
    requiredPublicationStatus: input.requiredPublicationStatus ?? classified.requiredPublicationStatus,
    requirements: (input.requirements ?? []).map(classifyRequirement),
  };
}

export function normalizeRequirements(requirements = []) {
  const byId = new Map();
  for (const raw of requirements) {
    const requirement = classifyRequirement(raw);
    if (!byId.has(requirement.id)) byId.set(requirement.id, requirement);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function ordinaryRequirements(requirements = []) {
  return normalizeRequirements(requirements).filter((requirement) => !requirement.terminalOwned);
}

export function ordinaryLeafRequirements(requirements = []) {
  const result = [];
  function visit(requirement) {
    if (requirement.terminalOwned) return;
    if (requirement.operator === "ALL" && Array.isArray(requirement.requirements) && requirement.requirements.length > 0) {
      for (const child of requirement.requirements) {
        visit(child);
      }
      return;
    }
    result.push(requirement);
  }
  for (const req of normalizeRequirements(requirements)) {
    visit(req);
  }
  return result;
}

export function terminalRequirements(requirements = []) {
  return normalizeRequirements(requirements).filter((requirement) => requirement.terminalOwned);
}

export function terminalRequirementsForContract(contractValue = {}, { additionalEvidence = [] } = {}) {
  const pool = [
    ...(contractValue.verification ?? []),
    ...(contractValue.successCriteria ?? []),
    ...additionalEvidence,
  ];
  return terminalRequirements(pool);
}

export function lifecycleRequirements(requirements = []) {
  return normalizeRequirements(requirements).filter((requirement) => requirement.type === "LIFECYCLE");
}

export function publicationRequirements(requirements = []) {
  return normalizeRequirements(requirements).filter((requirement) => requirement.type === "PUBLICATION");
}

export function productionReadinessRequirements(requirements = []) {
  return normalizeRequirements(requirements).filter((requirement) => requirement.type === "PRODUCTION_READINESS");
}

export function evaluateTerminalRequirements({ requirements = [], receipt = null } = {}) {
  const normalized = normalizeRequirements(requirements);
  const terminal = terminalRequirements(normalized);
  const result = {
    covered: [],
    pending: [],
    invalid: [],
    errors: [],
  };
  const pubStatus = receipt ? (receipt.publicationStatus ?? "not-published") : "not-published";
  const prodStatus = receipt ? (receipt.productionReadiness ?? "not-verified") : "not-verified";
  const receiptEvidence = Array.isArray(receipt?.evidence) ? receipt.evidence : [];

  for (const req of terminal) {
    if (req.type === "LIFECYCLE") {
      result.covered.push(req);
    } else if (req.type === "PUBLICATION") {
      const requiredLevel = req.requiredPublicationStatus ?? "published";
      const matchingEvidence = receiptEvidence
        .filter((item) => item.kind === "OBSERVED")
        .filter((item) => item.details?.requirementId === req.id)
        .filter((item) => item.details?.terminalType === "PUBLICATION");
      const latestEvidence = latestAuthoritativeCheck(matchingEvidence);
      const evidenceStatus = latestEvidence?.details?.terminalStatus;
      const evidenceSatisfied = isPublicationStatusSatisfied(evidenceStatus, requiredLevel);
      const globalSatisfied = isPublicationStatusSatisfied(pubStatus, requiredLevel);

      if (globalSatisfied && evidenceSatisfied) {
        result.covered.push(req);
      } else {
        result.pending.push(req);
        result.errors.push({
          code: "E_PUBLICATION_REQUIREMENT_PENDING",
          message: `The contract explicitly requires publication status '${requiredLevel}', but publication evidence/status is insufficient for requirement: ${req.text}`,
          requirementId: req.id,
        });
      }
    } else if (req.type === "PRODUCTION_READINESS") {
      const matchingEvidence = receiptEvidence
        .filter((item) => item.kind === "OBSERVED")
        .filter((item) => item.details?.requirementId === req.id)
        .filter((item) => item.details?.terminalType === "PRODUCTION_READINESS");
      const latestEvidence = latestAuthoritativeCheck(matchingEvidence);
      const evidenceStatus = latestEvidence?.details?.terminalStatus;
      const evidenceSatisfied = evidenceStatus === "ready" || evidenceStatus === "verified";
      const globalSatisfied = prodStatus === "ready" || prodStatus === "verified";

      if (globalSatisfied && evidenceSatisfied) {
        result.covered.push(req);
      } else {
        result.pending.push(req);
        result.errors.push({
          code: "E_PRODUCTION_REQUIREMENT_PENDING",
          message: `The contract explicitly requires production readiness, but production readiness evidence/status is insufficient for requirement: ${req.text}`,
          requirementId: req.id,
        });
      }
    }
  }
  return result;
}

export function matchesRequirement(check, requirement) {
  return check?.requirement === requirement.id || check?.requirement === requirement.text;
}

export function latestAuthoritativeCheck(candidates) {
  if (!candidates || candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const cycleA = a.details?.verificationCycle ?? a.verificationCycle ?? 1;
    const cycleB = b.details?.verificationCycle ?? b.verificationCycle ?? 1;
    if (cycleA !== cycleB) return cycleA - cycleB;
    const timeA = typeof a.timestamp === "string" ? a.timestamp : "";
    const timeB = typeof b.timestamp === "string" ? b.timestamp : "";
    if (timeA !== timeB) return timeA.localeCompare(timeB);
    return 0;
  }).at(-1);
}

export function authoritativeChecksForRequirements({ requirements = [], checks = [] } = {}) {
  return normalizeRequirements(requirements).map((requirement) => {
    const candidates = checks.filter((check) => matchesRequirement(check, requirement));
    return {
      requirement,
      check: latestAuthoritativeCheck(candidates),
    };
  });
}

function componentStatus(check, requirement, allChecks = [], options = {}) {
  if (requirement.operator !== "ALL" || !requirement.requirements?.length) return null;
  const components = check?.details?.components;
  const statuses = requirement.requirements.map((child) => {
    if (Array.isArray(components)) {
      const matchingComp = components.filter((item) => (
        item?.requirementId === child.id || item?.requirement === child.text
      )).at(-1);
      if (matchingComp) {
        const provenance = validateCommandProvenance(matchingComp);
        if (!provenance.valid) return { ...matchingComp, status: "failed", reasonCode: provenance.error.code };
        const auth = validateVerificationAuthority(matchingComp, options);
        if (!auth.valid) return { ...matchingComp, status: "failed", reasonCode: auth.error.code };
        return matchingComp;
      }
    }
    const childCandidates = allChecks.filter((candidate) => matchesRequirement(candidate, child));
    const childCheck = latestAuthoritativeCheck(childCandidates);
    if (childCheck) {
      const provenance = validateCommandProvenance(childCheck);
      if (!provenance.valid) return { ...childCheck, status: "failed", reasonCode: provenance.error.code };
      const auth = validateVerificationAuthority(childCheck, options);
      if (!auth.valid) return { ...childCheck, status: "failed", reasonCode: auth.error.code };
    }
    return childCheck;
  });
  if (statuses.some((item) => !item)) return "MISSING";
  if (statuses.some((item) => item.status === "failed")) return "INVALID";
  if (statuses.some((item) => item.status !== "passed" || item.evidenceKind !== "OBSERVED")) return "PARTIAL";
  return "COVERED";
}

export function evaluateRequiredEvidence({
  requirements = [],
  checks = [],
  target,
  taskId,
  authorities,
  options = {},
} = {}) {
  const authOptions = {
    ...(target ? { target } : {}),
    ...(taskId ? { taskId } : {}),
    ...(authorities ? { authorities } : {}),
    ...options,
  };
  const normalized = normalizeRequirements(requirements);
  const result = {
    ready: true,
    required: normalized,
    covered: [],
    missing: [],
    partial: [],
    invalid: [],
    lifecyclePending: [],
    reasonCodes: [],
  };
  for (const requirement of normalized) {
    if (requirement.mixedTerminal) {
      result.invalid.push({
        ...requirement,
        reasonCode: "E_CIRCULAR_COMPLETION_REQUIREMENT",
      });
      continue;
    }
    if (requirement.terminalOwned || requirement.lifecycleOwned) {
      result.lifecyclePending.push(requirement);
      continue;
    }
    const candidates = checks.filter((check) => matchesRequirement(check, requirement));
    const check = latestAuthoritativeCheck(candidates);
    const provenance = check ? validateCommandProvenance(check) : { valid: true };
    const auth = provenance.valid
      ? (check ? validateVerificationAuthority(check, authOptions) : { valid: true })
      : provenance;
    const compound = componentStatus(check, requirement, checks, authOptions);
    if (!auth.valid) {
      result.invalid.push({ ...requirement, reasonCode: auth.error.code });
    } else if (compound === "INVALID" || check?.status === "failed") {
      result.invalid.push(requirement);
    } else if (compound === "PARTIAL") {
      result.partial.push(requirement);
    } else if (compound === "MISSING") {
      result.missing.push(requirement);
    } else if (
      (check?.status === "passed" || compound === "COVERED")
      && (requirement.requiredEvidenceKind !== "OBSERVED" || check?.evidenceKind === "OBSERVED" || compound === "COVERED")
      && (compound === null || compound === "COVERED")
    ) {
      result.covered.push(requirement);
    } else if (check?.status === "passed" && check.evidenceKind !== "OBSERVED") {
      result.invalid.push({ ...requirement, reasonCode: "E_EVIDENCE_KIND_INVALID" });
    } else if (check) {
      result.partial.push(requirement);
    } else {
      result.missing.push(requirement);
    }
  }
  result.ready = result.missing.length === 0 && result.partial.length === 0 && result.invalid.length === 0;
  if (result.invalid.length) {
    const specificCodes = result.invalid
      .map((item) => item.reasonCode)
      .filter(Boolean);
    if (specificCodes.length > 0) {
      result.reasonCodes.push(...new Set(specificCodes));
    } else {
      result.reasonCodes.push("E_EVIDENCE_INVALID");
    }
  }
  if (result.missing.length) result.reasonCodes.push("E_EVIDENCE_REQUIRED");
  if (result.partial.length) result.reasonCodes.push("E_EVIDENCE_PARTIAL");
  const leaves = ordinaryLeafRequirements(normalized);
  const authoritativeLeaves = authoritativeChecksForRequirements({ requirements: leaves, checks });
  result.authoritativeFailures = authoritativeLeaves.filter(({ check }) => check?.status === "failed");
  result.authoritativeBlocked = authoritativeLeaves.filter(({ check }) => check?.status === "blocked");
  return result;
}
