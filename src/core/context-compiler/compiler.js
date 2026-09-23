import { contextBudget } from "./budget.js";
import { normalizeContextCandidates } from "./candidates.js";
import { contextPlanFingerprint } from "./fingerprint.js";
import { canonicalFingerprint } from "../artifacts.js";
import { assertContextCompilerPolicy, candidatePriority } from "./policy.js";
import { contextPlanResult } from "./result.js";

function orderCandidates(candidates, rankedIds = []) {
  const ranks = new Map(rankedIds.map((id, index) => [id, rankedIds.length - index]));
  return [...candidates].sort((a, b) => (b.mandatory - a.mandatory)
    || (b.required - a.required)
    || ((ranks.get(b.id) ?? 0) - (ranks.get(a.id) ?? 0))
    || (candidatePriority(b) - candidatePriority(a))
    || a.id.localeCompare(b.id));
}

export function compileContext({ candidates = [], profile = "balanced", mandatoryIds = [], semanticRanker = null } = {}) {
  const policy = assertContextCompilerPolicy({ profile, mandatoryIds });
  const normalized = normalizeContextCandidates(candidates);
  const candidateSetFingerprint = canonicalFingerprint(normalized.map((candidate) => ({
    id: candidate.id,
    sourceRef: candidate.sourceRef,
    summary: candidate.summary,
    required: candidate.required,
    mandatory: candidate.mandatory,
  })));
  const mandatory = new Set(policy.mandatoryIds);
  const marked = normalized.map((candidate) => ({ ...candidate, mandatory: candidate.mandatory || mandatory.has(candidate.id) }));
  const semantic = typeof semanticRanker === "function" ? semanticRanker(marked.filter((item) => !item.promptInjection).map((item) => ({ id: item.id, summary: item.summary }))) : [];
  const rankedIds = Array.isArray(semantic) ? semantic : (semantic?.rankedIds ?? []);
  const excludedIds = new Set(Array.isArray(semantic) ? [] : (semantic?.excludedIds ?? []));
  const ordered = orderCandidates(marked, Array.isArray(rankedIds) ? rankedIds : []);
  const budget = contextBudget(profile);
  const selected = [];
  const omitted = [];
  let chars = 0;
  for (const candidate of ordered) {
    const mustKeep = candidate.mandatory || candidate.required;
    if (excludedIds.has(candidate.id) && !mustKeep) {
      omitted.push(candidate);
      continue;
    }
    const fits = selected.length < budget.maxItems && chars + candidate.chars <= budget.maxChars;
    if (fits || mustKeep) {
      selected.push(candidate);
      chars += candidate.chars;
    } else omitted.push(candidate);
  }
  const promptInjectionIds = marked.filter((item) => item.promptInjection).map((item) => item.id).sort();
  const result = contextPlanResult({
    profile,
    candidates: marked,
    selected,
    omitted,
    mandatoryIds: [...new Set([...policy.mandatoryIds, ...marked.filter((item) => item.mandatory).map((item) => item.id)])].sort(),
    promptInjectionIds,
    fingerprint: null,
    budget,
    candidateSetFingerprint,
  });
  result.decisionFingerprint = contextPlanFingerprint(result);
  return result;
}
