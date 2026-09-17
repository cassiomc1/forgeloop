import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

export const OPENSRC_SEARCH_LIMITS = Object.freeze({
  maxSources: 8,
  maxFilesPerSource: 2000,
  maxFileBytes: 256 * 1024,
  maxTotalReadBytes: 8 * 1024 * 1024,
  maxMatchesPerSource: 32,
  maxSnippetLines: 7,
});

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  "build",
  "coverage",
]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".avif",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
  ".pdf", ".exe", ".dll", ".so", ".dylib", ".a", ".o",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".mov",
  ".pyc", ".pyo", ".class", ".wasm",
]);

function defaultHooks() {
  return { lstat, readdir, readFile, realpath };
}

function tokenizeQuery(query) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/u)
    .filter((token) => token.length > 0);
}

function isProbablyBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] === 0) return true;
  }
  return false;
}

function scoreLine(lowerLine, lowerQuery, queryTokens) {
  if (lowerLine.includes(lowerQuery)) return { fullMatch: true, tokenOverlap: queryTokens.length };
  let tokenOverlap = 0;
  for (const token of queryTokens) {
    if (token.length > 1 && lowerLine.includes(token)) tokenOverlap += 1;
  }
  return { fullMatch: false, tokenOverlap };
}

function buildSnippet(lines, matchIndex, maxSnippetLines) {
  const context = Math.max(0, Math.floor((maxSnippetLines - 1) / 2));
  const start = Math.max(0, matchIndex - context);
  const end = Math.min(lines.length, matchIndex + context + 1);
  return {
    startLine: start + 1,
    endLine: end,
    text: lines.slice(start, end).join("\n"),
  };
}

async function resolveEntryTarget(resolvedRoot, absolutePath, stat, { lstatImpl, realpathImpl }) {
  if (stat.isSymbolicLink()) {
    let resolved;
    try {
      resolved = await realpathImpl(absolutePath);
    } catch {
      return { kind: "skip", stat };
    }
    const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
    if (resolved !== resolvedRoot && !resolved.startsWith(rootWithSep)) return { kind: "skip", stat };
    try {
      stat = await lstatImpl(resolved);
    } catch {
      return { kind: "skip", stat };
    }
    return { kind: stat.isFile() ? "file" : "skip", stat };
  }
  if (stat.isDirectory()) return { kind: "directory", stat };
  if (stat.isFile()) return { kind: "file", stat };
  return { kind: "skip", stat };
}

async function processDirectoryEntry(resolvedRoot, relativePath, name, context) {
  const { sourceSpec, sourceIndex, lowerQuery, queryTokens, limits, matches, state, lstatImpl, realpathImpl, readFileImpl } = context;
  const absolutePath = path.join(resolvedRoot, relativePath);
  let stat;
  try {
    stat = await lstatImpl(absolutePath);
  } catch {
    return "skip";
  }
  const entry = await resolveEntryTarget(resolvedRoot, absolutePath, stat, { lstatImpl, realpathImpl });
  if (entry.kind === "directory") return "directory";
  if (entry.kind !== "file") return "skip";
  if (BINARY_EXTENSIONS.has(path.extname(name).toLowerCase())) return "skip";
  if (entry.stat.size > limits.maxFileBytes) return "skip";
  if (state.filesSeen >= limits.maxFilesPerSource) return "skip";
  if (state.totalBytes + entry.stat.size > limits.maxTotalReadBytes) return "skip";
  let buffer;
  try {
    buffer = await readFileImpl(absolutePath);
  } catch {
    return "skip";
  }
  state.filesSeen += 1;
  state.totalBytes += buffer.byteLength;
  if (isProbablyBinary(buffer)) return "skip";
  const text = buffer.toString("utf8");
  if (/\u0000/u.test(text)) return "skip";
  collectLineMatches(text.split("\n"), {
    sourceSpec,
    sourceIndex,
    relativePath: relativePath.split(path.sep).join("/"),
    lowerQuery,
    queryTokens,
    limits,
    matches,
  });
  return "file";
}

function collectLineMatches(lines, { sourceSpec, sourceIndex, relativePath, lowerQuery, queryTokens, limits, matches }) {
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (matches.length >= limits.maxMatchesPerSource) break;
    const line = lines[lineIndex];
    const { fullMatch, tokenOverlap } = scoreLine(line.toLowerCase(), lowerQuery, queryTokens);
    if (!fullMatch && tokenOverlap === 0) continue;
    const snippet = buildSnippet(lines, lineIndex, limits.maxSnippetLines);
    matches.push({
      sourceSpec,
      sourceIndex,
      relativePath,
      line: lineIndex + 1,
      fullMatch,
      tokenOverlap,
      snippetStartLine: snippet.startLine,
      snippetEndLine: snippet.endLine,
      snippet: snippet.text,
    });
  }
}

function compareMatches(left, right) {
  if (left.fullMatch !== right.fullMatch) return left.fullMatch ? -1 : 1;
  if (left.tokenOverlap !== right.tokenOverlap) return right.tokenOverlap - left.tokenOverlap;
  if (left.sourceIndex !== right.sourceIndex) return left.sourceIndex - right.sourceIndex;
  if (left.relativePath !== right.relativePath) return left.relativePath < right.relativePath ? -1 : 1;
  return left.line - right.line;
}

/**
 * Deterministically search one resolved OpenSrc source root for query text.
 *
 * Traversal is lexicographically sorted, directory symlinks are never
 * followed, file symlinks must resolve inside the source root, and every
 * bound (file count, file size, total bytes, match count) is enforced before
 * further allocation or reads.
 */
export async function searchSourceRoot({
  sourceRoot,
  sourceSpec,
  sourceIndex = 0,
  query,
  limits = OPENSRC_SEARCH_LIMITS,
  hooks = {},
} = {}) {
  if (typeof sourceRoot !== "string" || sourceRoot === "" || typeof sourceSpec !== "string" || sourceSpec === "") {
    throw new Error("OpenSrc search requires a source root and source spec");
  }
  if (typeof query !== "string" || query.trim() === "") {
    throw new Error("OpenSrc search requires a non-empty query");
  }
  const { lstat: lstatImpl, readdir: readdirImpl, readFile: readFileImpl, realpath: realpathImpl } = {
    ...defaultHooks(),
    ...hooks,
  };
  let resolvedRoot = path.resolve(sourceRoot);
  try {
    resolvedRoot = await realpathImpl(resolvedRoot);
  } catch {
    // The root is stat'ed lazily below; keep the resolved form on failure.
  }
  const lowerQuery = query.toLowerCase();
  const queryTokens = tokenizeQuery(query);
  const matches = [];
  const state = { filesSeen: 0, totalBytes: 0 };

  const stack = ["."];
  while (stack.length > 0) {
    const relativeDir = stack.pop();
    const absoluteDir = path.join(resolvedRoot, relativeDir);
    let entries;
    try {
      entries = await readdirImpl(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }
    const names = entries.map((entry) => entry.name).sort();
    for (let index = names.length - 1; index >= 0; index -= 1) {
      const name = names[index];
      if (relativeDir === "." && SKIPPED_DIRECTORIES.has(name)) continue;
      const relativePath = relativeDir === "." ? name : `${relativeDir}/${name}`;
      const outcome = await processDirectoryEntry(resolvedRoot, relativePath, name, {
        sourceSpec, sourceIndex, lowerQuery, queryTokens, limits, matches, state,
        lstatImpl, realpathImpl, readFileImpl,
      });
      if (outcome === "directory") stack.push(relativePath);
    }
    if (matches.length >= limits.maxMatchesPerSource) break;
  }

  matches.sort(compareMatches);
  return matches;
}
