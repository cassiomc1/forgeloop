export const CONTEXT_BUDGETS = Object.freeze({
  light: Object.freeze({ maxItems: 12, maxChars: 24_000 }),
  balanced: Object.freeze({ maxItems: 32, maxChars: 64_000 }),
  full: Object.freeze({ maxItems: 96, maxChars: 160_000 }),
});

export function contextBudget(profile = "balanced") {
  return CONTEXT_BUDGETS[profile] ?? CONTEXT_BUDGETS.balanced;
}
