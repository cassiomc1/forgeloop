import { realpath } from "node:fs/promises";
import path from "node:path";

import { REPOSITORY_INDEX_ERROR_CODES, repositoryIndexError } from "./errors.js";

function invalid(message, details = {}) {
  return repositoryIndexError(REPOSITORY_INDEX_ERROR_CODES.OUTPUT_INVALID, message, details);
}

function finiteInteger(value, label, { min = 0, optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return null;
    throw invalid(`tgrep JSON field ${label} is required`);
  }
  if (!Number.isSafeInteger(value) || value < min) throw invalid(`tgrep JSON field ${label} is invalid`);
  return value;
}

function extractData(event) {
  return event && typeof event === "object" && event.data && typeof event.data === "object"
    ? event.data
    : event;
}

function usesWindowsPath(value, repositoryRoot, pathStyle) {
  return pathStyle === "win32"
    || /^[A-Za-z]:[\\/]/u.test(value)
    || /^\\\\/u.test(value)
    || /^[A-Za-z]:[\\/]/u.test(repositoryRoot)
    || /^\\\\/u.test(repositoryRoot);
}

async function normalizePath(value, repositoryRoot, { pathStyle = null } = {}) {
  if (typeof value !== "string" || value.length === 0) throw invalid("tgrep JSON match path is missing");
  const windows = usesWindowsPath(value, repositoryRoot, pathStyle);
  const pathApi = windows ? path.win32 : path;
  const normalizedRoot = pathApi.normalize(repositoryRoot);
  const normalizedValue = value.replaceAll("/", pathApi.sep);
  const candidate = pathApi.isAbsolute(normalizedValue)
    ? pathApi.normalize(normalizedValue)
    : pathApi.resolve(normalizedRoot, normalizedValue);
  const comparisonRoot = windows ? normalizedRoot.toLowerCase() : normalizedRoot;
  const comparisonCandidate = windows ? candidate.toLowerCase() : candidate;
  const relative = pathApi.relative(comparisonRoot, comparisonCandidate);
  if (relative === ".." || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) {
    throw invalid(`tgrep JSON path escapes the repository root: ${value}`);
  }
  return relative ? relative.split(pathApi.sep).join("/") : ".";
}

function pathText(data) {
  if (typeof data.path === "string") return data.path;
  if (data.path && typeof data.path.text === "string") return data.path.text;
  return null;
}

function lineText(data) {
  if (typeof data.text === "string") return data.text;
  if (data.lines && typeof data.lines.text === "string") return data.lines.text;
  return "";
}

function normalizeSubmatches(data) {
  if (data.submatches === undefined) return [];
  if (!Array.isArray(data.submatches)) throw invalid("tgrep JSON submatches must be an array");
  return data.submatches.map((submatch, index) => {
    if (!submatch || typeof submatch !== "object") throw invalid(`tgrep JSON submatch ${index} is invalid`);
    const start = finiteInteger(submatch.start, `submatches[${index}].start`);
    const end = finiteInteger(submatch.end, `submatches[${index}].end`);
    if (end < start) throw invalid(`tgrep JSON submatch ${index} has a reversed range`);
    const match = typeof submatch.match === "string" ? submatch.match : submatch.match?.text;
    return { start, end, match: typeof match === "string" ? match : null };
  });
}

async function normalizeMatch(event, repositoryRoot, options) {
  const data = extractData(event);
  const relativePath = await normalizePath(pathText(data), repositoryRoot, options);
  const lineNumber = finiteInteger(data.line_number ?? data.lineNumber, "line_number", { min: 1 });
  const absoluteOffset = finiteInteger(data.absolute_offset ?? data.absoluteOffset, "absolute_offset", { optional: true });
  return {
    path: relativePath,
    line: lineNumber,
    column: finiteInteger(data.column, "column", { min: 1, optional: true }),
    offset: absoluteOffset,
    text: lineText(data),
    submatches: normalizeSubmatches(data),
  };
}

function addStats(target, data) {
  const stats = data?.stats && typeof data.stats === "object" ? data.stats : data;
  if (!stats || typeof stats !== "object") return;
  const values = {
    bytesSearched: stats.bytes_searched,
    bytesPrinted: stats.bytes_printed,
    matchedLines: stats.matched_lines,
    matches: stats.matches,
    searches: stats.searches,
    searchesWithMatch: stats.searches_with_match,
    elapsedNanos: stats.elapsed?.nanos,
  };
  for (const [key, value] of Object.entries(values)) {
    if (Number.isSafeInteger(value) && value >= 0) target[key] = value;
  }
}

function looksLikeStatsLine(line) {
  return /^(?:Query plan:|Search completed in |Walking |Found \d+ text files|Extracting trigrams|Writing index|Index built successfully|Indexed in )/i.test(line.trim());
}

async function parseFileLines(lines, repositoryRoot, options) {
  const files = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (looksLikeStatsLine(line)) continue;
    let value;
    try { value = JSON.parse(line); } catch {
      files.push(await normalizePath(line.trim(), repositoryRoot, options));
      continue;
    }
    const text = pathText(extractData(value));
    if (value.type === "match" || value.type === "context") {
      files.push(await normalizePath(text, repositoryRoot, options));
    } else if (text) {
      files.push(await normalizePath(text, repositoryRoot));
    }
  }
  return [...new Set(files)].sort();
}

/**
 * Converts tgrep's versioned JSON-lines stream into ForgeLoop's stable,
 * provider-neutral repository-search result. Native output is never treated
 * as evidence or lifecycle state; malformed lines fail closed.
 */
export async function normalizeTgrepJson(stdout, {
  repositoryRoot,
  filesWithMatches = false,
  realpathImpl = realpath,
  pathStyle = null,
} = {}) {
  if (typeof stdout !== "string" || typeof repositoryRoot !== "string") throw invalid("tgrep JSON output requires text and repositoryRoot");
  const canonicalRoot = await realpathImpl(repositoryRoot);
  const pathOptions = { pathStyle };
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim());
  if (filesWithMatches) {
    return {
      matches: [],
      contexts: [],
      files: await parseFileLines(lines, canonicalRoot, pathOptions),
      stats: {},
      events: { begin: 0, match: 0, context: 0, end: 0, summary: 0 },
      ignoredEvents: 0,
    };
  }

  const matches = [];
  const contexts = [];
  const stats = {};
  const files = new Set();
  const events = { begin: 0, match: 0, context: 0, end: 0, summary: 0 };
  let ignoredEvents = 0;
  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch {
      if (looksLikeStatsLine(line)) continue;
      throw invalid("tgrep emitted a non-JSON line in JSON search mode", { line: line.slice(0, 500) });
    }
    if (!event || typeof event !== "object" || typeof event.type !== "string") {
      throw invalid("tgrep emitted a JSON value without an event type");
    }
    if (!Object.hasOwn(events, event.type)) {
      ignoredEvents += 1;
      continue;
    }
    events[event.type] += 1;
    if (event.type === "match" || event.type === "context") {
      const normalized = await normalizeMatch(event, canonicalRoot, pathOptions);
      files.add(normalized.path);
      (event.type === "match" ? matches : contexts).push(normalized);
    } else if (event.type === "end" || event.type === "summary") {
      addStats(stats, extractData(event));
    }
  }
  return { matches, contexts, files: [...files].sort(), stats, events, ignoredEvents };
}
