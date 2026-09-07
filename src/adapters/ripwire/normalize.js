import path from "node:path";

import {
  isPathWithin,
} from "../../core/filesystem.js";
import {
  ADVISORY_CONTEXT_LIMITS,
  normalizeAdvisoryRecallOptions,
} from "../../core/advisory-context/constants.js";
import {
  E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
  E_ADVISORY_CONTEXT_RESULT_INVALID,
} from "../../core/error-codes.js";

const METADATA_KEYS = Object.freeze([
  "at",
  "bundle",
  "capped",
  "confidence",
  "corpus",
  "est_tokens",
  "kept",
  "lens",
  "margin_pct",
  "parse_health",
  "scored",
  "sigs_capped",
  "sigs_shown",
  "sigs_total",
  "truncated",
  "unindexed",
  "ambiguous",
  "unresolved",
  "unsupported_languages",
]);

function adapterError(code, message) {
  const error = new Error(message);
  error.name = "RipwireAdapterError";
  error.code = code;
  return error;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value, maxLength = 240) {
  if (typeof value !== "string") return null;
  if (value.length === 0 || /\p{Cc}/u.test(value)) return null;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(1, maxLength - 1))}…`;
}

function safeString(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return String(value);
  } catch {
    return null;
  }
}

function fitText(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(1, maxLength - 1))}…`;
}

function metadataValue(value) {
  if (typeof value === "string") return boundedText(value, 160);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return null;
}

function extractCandidateRows(raw) {
  if (Array.isArray(raw.sigs)) return raw.sigs;
  return null;
}

function normalizeReportedPath(reportedPath, projectPath) {
  if (typeof reportedPath !== "string" || reportedPath.trim() === "" || /\p{Cc}/u.test(reportedPath)) {
    return null;
  }
  const slashPath = reportedPath.replaceAll("\\", "/");
  const windowsAbsolute = /^[A-Za-z]:\//u.test(slashPath) || slashPath.startsWith("//");
  const posixAbsolute = slashPath.startsWith("/");
  let relative = slashPath;

  if (windowsAbsolute || posixAbsolute) {
    if (!projectPath) return null;
    const absolute = windowsAbsolute && process.platform !== "win32"
      ? path.win32.normalize(slashPath)
      : path.resolve(slashPath);
    if (!isPathWithin(path.resolve(projectPath), absolute)) return null;
    relative = path.relative(path.resolve(projectPath), absolute).replaceAll(path.sep, "/");
  }

  const segments = relative.split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) return null;
  const normalized = path.posix.normalize(relative);
  if (normalized === "." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) return null;
  if (projectPath && !isPathWithin(path.resolve(projectPath), path.resolve(projectPath, normalized))) return null;
  return normalized;
}

function rowPath(row) {
  if (!isRecord(row)) return undefined;
  return row.p ?? row.path ?? row.file ?? row.source ?? row.filePath;
}

function rowLine(row) {
  const value = row.l ?? row.line ?? row.lineNumber;
  if (value === undefined || value === null || value === "") return null;
  if (!Number.isSafeInteger(value) || value < 1) return null;
  return value;
}

function rowName(row) {
  return row.n ?? row.name ?? row.symbol ?? row.id;
}

function rowSignature(row) {
  return row.sig ?? row.signature ?? row.doc ?? row.text ?? row.annotation ?? row.body;
}

function rowRank(row) {
  const value = row.r ?? row.rank;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function rowScore(row) {
  const value = row.k ?? row.score ?? row.relevance;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validConfidence(value) {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= 1;
}

function hasInvalidReportedLine(row, line) {
  const reportedLine = row.l ?? row.line ?? row.lineNumber;
  const lineWasReported = reportedLine !== undefined && reportedLine !== null && reportedLine !== "";
  return lineWasReported && line === null;
}

function candidateSummary(row, signatureValue) {
  const signature = boundedText(signatureValue, 1000);
  const rank = rowRank(row);
  const score = rowScore(row);
  const annotations = [
    rank === null ? null : `rank=${rank}`,
    score === null ? null : `ranking_score=${score}`,
    row.ambiguous === true ? "ambiguous=true" : null,
    row.unresolved === true ? "unresolved=true" : null,
  ].filter(Boolean);
  const parts = [signature, ...annotations].filter(Boolean);
  return parts.join(" | ") || "Ripwire returned a candidate without a signature";
}

function statusDetails(raw, totalCandidates, acceptedCandidates, rejectedCandidates, returnedCandidates) {
  const details = [];
  for (const key of METADATA_KEYS) {
    const value = metadataValue(raw[key]);
    if (value !== null) details.push(`${key}=${value}`);
  }

  const reportedTotal = Number.isSafeInteger(raw.sigs_total) ? raw.sigs_total : null;
  const reportedShown = Number.isSafeInteger(raw.sigs_shown) ? raw.sigs_shown : null;
  const capped = raw.capped === true || raw.truncated === true || raw.sigs_capped === true
    || (reportedTotal !== null && reportedShown !== null && reportedShown < reportedTotal);
  if (capped) details.push("output_capped_or_truncated=true");
  if (raw.lens) details.push("unreported_lenses_remain_unknown=true");
  if (raw.unindexed !== undefined) details.push("unindexed_content_is_not_proven_complete=true");
  if (raw.ambiguous !== undefined || raw.unresolved !== undefined) details.push("ambiguous_or_unresolved_edges_may_be_missing=true");
  if (rejectedCandidates > 0) details.push(`rejected_candidates=${rejectedCandidates}`);
  if (totalCandidates === 0) details.push("no_symbol_candidates_returned; absence_is_not_proof_of_no_impact=true");
  if (returnedCandidates === 0 && totalCandidates > 0) details.push("no_symbol_candidates_fit_the_requested_safety_or_budget=true");
  return details;
}

function compactNotice(notice) {
  return notice
    .replace(/^adapter_omitted_candidates=/u, "omitted=")
    .replace(/^candidate_text_shortened=/u, "shortened=");
}

function fitStatusWithSuffix(notices, suffix, maxLength) {
  if (suffix.length > maxLength) return fitText(suffix, maxLength);
  const prefix = notices.map(compactNotice).filter(Boolean).join("; ");
  if (!prefix) return suffix;
  const full = `${prefix}; ${suffix}`;
  if (full.length <= maxLength) return full;
  const first = `${prefix.split("; ", 1)[0]}; ${suffix}`;
  return first.length <= maxLength ? first : suffix;
}

function buildStatusSummary(raw, totalCandidates, acceptedCandidates, rejectedCandidates, returnedCandidates, maxLength, notices = [], { noFit = false } = {}) {
  const details = statusDetails(raw, totalCandidates, acceptedCandidates, rejectedCandidates, returnedCandidates);
  const mandatory = `Ripwire advisory; approximate graph guidance only; no authority/evidence/action; index_completeness=unknown; candidates=${totalCandidates}; accepted=${acceptedCandidates}; returned=${returnedCandidates}`;
  const complete = `${[...notices, mandatory, ...details].join("; ")}.`;
  if (!noFit && complete.length <= maxLength) return complete;

  const compactBase = noFit
    ? "No symbol items fit; Ripwire advisory; approximate; completeness=unknown; diagnostics omitted."
    : `Ripwire advisory; approximate; completeness=unknown; diagnostics_omitted=true; candidates=${totalCandidates}; returned=${returnedCandidates}.`;
  if (compactBase.length <= maxLength) return fitStatusWithSuffix(notices, compactBase, maxLength);

  const minimalBase = "Advisory; approximate; completeness=unknown; diagnostics omitted.";
  return fitStatusWithSuffix(notices, minimalBase, maxLength);
}

function normalizeCandidate(row, {
  projectPath,
  sourcePathValidator,
} = {}) {
  if (!isRecord(row)) return { candidate: null, rejected: true };
  const rawPath = rowPath(row);
  const relativePath = normalizeReportedPath(rawPath, projectPath);
  if (rawPath !== undefined && relativePath === null) return { candidate: null, rejected: true };
  if (relativePath && sourcePathValidator) {
    let safe = false;
    try {
      safe = sourcePathValidator(relativePath) === true;
    } catch {
      safe = false;
    }
    if (!safe) return { candidate: null, rejected: true };
  }
  const line = rowLine(row);
  if (hasInvalidReportedLine(row, line)) return { candidate: null, rejected: true };
  const sourceRef = relativePath ? `${relativePath}${line === null ? "" : `:${line}`}` : undefined;
  const rawName = rowName(row);
  const normalizedName = rawName === undefined || rawName === null ? "Ripwire candidate" : safeString(rawName);
  const normalizedSignature = safeString(rowSignature(row) ?? "");
  if (normalizedName === null || normalizedSignature === null) return { candidate: null, rejected: true };
  const title = boundedText(normalizedName, 180)
    ?? "Ripwire candidate";
  const summary = candidateSummary(row, normalizedSignature);
  const confidence = validConfidence(row.confidence) ? row.confidence : undefined;
  return {
    rejected: false,
    candidate: {
      title,
      summary,
      ...(sourceRef ? { sourceRef } : {}),
      ...(confidence === undefined ? {} : { confidence }),
    },
  };
}

/**
 * Convert Ripwire's documented --for --json shape into ForgeLoop advisory
 * items. The status card is deliberate: the approximate graph, caps, omitted
 * lenses, and unknown completeness must remain visible after core allowlist
 * normalization discards provider-specific metadata.
 */
export function normalizeRipwireResult(raw, {
  projectPath,
  limit,
  maxItemChars,
  maxTotalChars,
  timeoutMs,
  sourcePathValidator,
} = {}) {
  if (!isRecord(raw)) {
    throw adapterError(E_ADVISORY_CONTEXT_RESULT_INVALID, "Ripwire JSON result must be an object");
  }
  const rows = extractCandidateRows(raw);
  if (!rows) {
    throw adapterError(E_ADVISORY_CONTEXT_RESULT_INVALID, "Ripwire JSON result did not contain the supported flat sigs array");
  }
  if (rows.length > ADVISORY_CONTEXT_LIMITS.maxProviderReturnedItems) {
    throw adapterError(
      E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
      `Ripwire returned ${rows.length} candidates, exceeding the raw item ceiling of ${ADVISORY_CONTEXT_LIMITS.maxProviderReturnedItems}`,
    );
  }
  const options = normalizeAdvisoryRecallOptions({ limit, maxItemChars, maxTotalChars, timeoutMs });
  const normalizedCandidates = [];
  const seen = new Set();
  let rejectedCandidates = 0;

  for (const row of rows) {
    const normalized = normalizeCandidate(row, { projectPath, sourcePathValidator });
    if (normalized.rejected || !normalized.candidate) {
      rejectedCandidates += 1;
      continue;
    }
    const key = [normalized.candidate.title, normalized.candidate.summary, normalized.candidate.sourceRef ?? ""].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedCandidates.push(normalized.candidate);
  }

  const preparedCandidates = normalizedCandidates.map((candidate) => {
    const summary = fitText(candidate.summary, options.maxItemChars);
    return {
      ...candidate,
      summary,
      summaryShortened: summary.length < candidate.summary.length,
    };
  });

  const itemChars = (item) => (item.title?.length ?? 0) + item.summary.length + (item.sourceRef?.length ?? 0);
  let selectedCount = -1;
  let selectedStatus = null;
  const maxCandidateCount = Math.min(preparedCandidates.length, Math.max(0, options.limit - 1));
  for (let count = maxCandidateCount; count >= 0; count -= 1) {
    const returnedCandidates = preparedCandidates.slice(0, count);
    const notices = [];
    if (preparedCandidates.length > count) notices.push(`adapter_omitted_candidates=${preparedCandidates.length - count}`);
    const shortenedCandidates = returnedCandidates.filter((candidate) => candidate.summaryShortened).length;
    if (shortenedCandidates > 0) notices.push(`candidate_text_shortened=${shortenedCandidates}`);
    if (rejectedCandidates > 0) notices.push(`rejected_candidates=${rejectedCandidates}`);
    const noFit = count === 0 && rows.length > 0;
    const status = {
      title: "Ripwire advisory status",
      summary: buildStatusSummary(
        raw,
        rows.length,
        preparedCandidates.length,
        rejectedCandidates,
        count,
        options.maxItemChars,
        notices,
        { noFit },
      ),
    };
    const totalChars = status.title.length + status.summary.length
      + returnedCandidates.reduce((total, candidate) => total + itemChars(candidate), 0);
    if (totalChars <= options.maxTotalChars) {
      selectedCount = count;
      selectedStatus = status;
      break;
    }
  }

  if (selectedCount < 0 || !selectedStatus) {
    throw adapterError(E_ADVISORY_CONTEXT_OUTPUT_LIMIT, "Ripwire advisory status cannot fit the requested output budget");
  }

  const items = [selectedStatus, ...preparedCandidates.slice(0, selectedCount)];
  for (const item of items) delete item.summaryShortened;
  return { items };
}

export { extractCandidateRows, normalizeReportedPath, rowPath as getRipwireRowPath };
