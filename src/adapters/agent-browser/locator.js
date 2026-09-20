import { E_BROWSER_VERIFICATION_RESULT_INVALID } from "../../core/error-codes.js";

function locatorError(message) {
  const error = new Error(message);
  error.code = E_BROWSER_VERIFICATION_RESULT_INVALID;
  error.kind = "BLOCKED";
  return error;
}

function refsFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const refs = snapshot.refs;
  if (!refs || typeof refs !== "object" || Array.isArray(refs)) return [];
  return Object.entries(refs).map(([ref, value]) => ({ ref, ...(value && typeof value === "object" ? value : { name: value }) }));
}

function candidateText(value) {
  return [value?.name, value?.text, value?.label, value?.value].filter((item) => typeof item === "string");
}

export function resolveSnapshotLocator(locator, snapshot) {
  if (!locator || typeof locator !== "object") throw locatorError("Browser locator is invalid");
  if (locator.kind === "CSS") return locator.value;
  const refs = refsFromSnapshot(snapshot);
  const needle = locator.value;
  const matches = refs.filter((entry) => {
    const values = candidateText(entry);
    if (locator.kind === "TEXT" || locator.kind === "LABEL") return values.some((value) => value === needle);
    if (locator.kind === "ROLE") {
      return entry.role === needle || values.some((value) => `${entry.role ?? ""} ${value}`.trim() === needle);
    }
    return false;
  });
  if (matches.length !== 1) {
    throw locatorError(matches.length === 0 ? "Browser locator was not found" : "Browser locator was ambiguous");
  }
  return matches[0].ref;
}

export function snapshotRefs(snapshot) { return refsFromSnapshot(snapshot); }
