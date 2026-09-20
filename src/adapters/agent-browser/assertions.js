export function actualValue(data) {
  if (typeof data === "string" || typeof data === "number" || typeof data === "boolean") return String(data);
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  for (const key of ["text", "value", "attribute", "url", "title", "visible"]) {
    if (data[key] !== undefined && data[key] !== null) return String(data[key]);
  }
  return "";
}

export function matchesAssertion(kind, actual, expected) {
  if (kind === "VISIBLE") return actual === "true";
  if (kind === "HIDDEN") return actual !== "true";
  if (kind === "TEXT_CONTAINS") return actual.includes(expected);
  if (kind === "TEXT_EQUALS" || kind === "VALUE_EQUALS" || kind === "ATTRIBUTE_EQUALS" || kind === "TITLE_EQUALS") return actual === expected;
  if (kind === "URL_IS") return actual === expected;
  if (kind === "URL_PREFIX") return actual.startsWith(expected);
  return false;
}

export function assertionResult(assertion, status, actual, message) {
  return {
    id: assertion.id,
    kind: assertion.kind,
    status,
    ...(actual !== undefined ? { actual: String(actual) } : {}),
    ...(message ? { message } : {}),
  };
}
