import {
  ADVISORY_CONTEXT_LIMITS,
  normalizeAdvisoryRecallOptions,
} from "../../core/advisory-context/constants.js";
import {
  E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
  E_ADVISORY_CONTEXT_RESULT_INVALID,
} from "../../core/error-codes.js";

function adapterError(code, message) {
  const error = new Error(message);
  error.name = "OpenSrcAdapterError";
  error.code = code;
  return error;
}

function fitText(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(1, maxLength - 1))}…`;
}

function lineRangeLabel(startLine, endLine) {
  return startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;
}

function normalizeMatch(match) {
  if (!match || typeof match !== "object" || Array.isArray(match)) return null;
  const { sourceSpec, relativePath, snippet, snippetStartLine, snippetEndLine } = match;
  if (typeof sourceSpec !== "string" || sourceSpec === "") return null;
  if (typeof relativePath !== "string" || relativePath === "" || relativePath.startsWith("/")) return null;
  if (typeof snippet !== "string") return null;
  if (!Number.isSafeInteger(snippetStartLine) || snippetStartLine < 1) return null;
  if (!Number.isSafeInteger(snippetEndLine) || snippetEndLine < snippetStartLine) return null;
  const range = lineRangeLabel(snippetStartLine, snippetEndLine);
  const flatSnippet = snippet.replace(/\s+/gu, " ").trim();
  return {
    title: `${sourceSpec} — ${relativePath}`,
    summary: flatSnippet === "" ? range : `${range} | ${flatSnippet}`,
    sourceRef: `opensrc:${sourceSpec}:${relativePath}#${range}`,
    identity: [sourceSpec, relativePath, range, snippet].join(" "),
  };
}

/**
 * Convert bounded deterministic search matches into ForgeLoop advisory items.
 *
 * Titles, summaries, and source references carry only portable relative
 * paths; absolute cache locations never leave this boundary.
 */
export function normalizeOpenSrcResult(matches, {
  limit,
  maxItemChars,
  maxTotalChars,
  timeoutMs,
} = {}) {
  if (!Array.isArray(matches)) {
    throw adapterError(E_ADVISORY_CONTEXT_RESULT_INVALID, "OpenSrc search matches must be an array");
  }
  if (matches.length > ADVISORY_CONTEXT_LIMITS.maxProviderReturnedItems) {
    throw adapterError(
      E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
      `OpenSrc returned ${matches.length} matches, exceeding the raw item ceiling of ${ADVISORY_CONTEXT_LIMITS.maxProviderReturnedItems}`,
    );
  }
  const options = normalizeAdvisoryRecallOptions({ limit, maxItemChars, maxTotalChars, timeoutMs });
  const prepared = [];
  const seen = new Set();
  for (const match of matches) {
    const normalized = normalizeMatch(match);
    if (!normalized) continue;
    if (seen.has(normalized.identity)) continue;
    seen.add(normalized.identity);
    const summary = fitText(normalized.summary, options.maxItemChars);
    prepared.push({ title: normalized.title, summary, sourceRef: normalized.sourceRef });
  }

  const items = [];
  let totalChars = 0;
  for (const candidate of prepared) {
    if (items.length >= options.limit) break;
    const chars = candidate.title.length + candidate.summary.length + candidate.sourceRef.length;
    if (totalChars + chars > options.maxTotalChars) break;
    totalChars += chars;
    items.push(candidate);
  }
  if (items.length === 0 && prepared.length > 0) {
    throw adapterError(E_ADVISORY_CONTEXT_OUTPUT_LIMIT, "OpenSrc matches cannot fit the requested output budget");
  }
  return { items };
}
