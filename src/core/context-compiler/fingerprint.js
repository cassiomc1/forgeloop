import { canonicalFingerprint } from "../artifacts.js";

export function contextPlanFingerprint(plan) {
  return canonicalFingerprint({
    profile: plan.profile,
    selectedIds: plan.selected.map((item) => item.id),
    omittedIds: plan.omitted.map((item) => item.id),
    mandatoryIds: plan.mandatoryIds,
    promptInjectionIds: plan.promptInjectionIds,
  });
}
