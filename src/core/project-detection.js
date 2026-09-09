import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const PROJECT_EVIDENCE_SCHEMA_VERSION = 1;

export const PROJECT_EVIDENCE_SCOPES = Object.freeze([
  "MATCH",
  "UNSCOPED",
  "NO_MATCH",
  "NONE",
]);

const MAX_MANIFESTS = 256;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_SOURCE_FILES = 256;
const MAX_SOURCE_BYTES = 512 * 1024;
const IGNORED_DIRECTORIES = new Set([
  ".dart_tool",
  ".forgeloop",
  ".git",
  ".idea",
  ".vscode",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "vendor",
]);
const FLUTTER_PROJECT_PATHS = new Set([
  ".metadata",
  "analysis_options.yaml",
  "android",
  "assets",
  "integration_test",
  "ios",
  "lib",
  "linux",
  "macos",
  "pubspec.yaml",
  "test",
  "tool",
  "web",
  "windows",
]);
const PLATFORM_DIRECTORIES = Object.freeze([
  "android",
  "ios",
  "linux",
  "macos",
  "web",
  "windows",
]);
const SOURCE_DIRECTORIES = Object.freeze([
  "integration_test",
  "lib",
  "test",
]);

function portableRelative(root, absolutePath) {
  const relative = path.relative(root, absolutePath).split(path.sep).join("/");
  return relative === "" ? "." : relative;
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}

function stripYamlComment(value) {
  let quote = null;
  let braceDepth = 0;
  let bracketDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === "\"") {
      if (character === "\\") index += 1;
      else if (character === "\"") quote = null;
      continue;
    }
    if (quote === "'") {
      if (character === "'" && value[index + 1] === "'") index += 1;
      else if (character === "'") quote = null;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") braceDepth += 1;
    else if (character === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (character === "[") bracketDepth += 1;
    else if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === "#" && braceDepth === 0 && bracketDepth === 0
      && (index === 0 || /\s/u.test(value[index - 1]))) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value.trimEnd();
}

function findTopLevelColon(value) {
  let quote = null;
  let braceDepth = 0;
  let bracketDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === "\"") {
      if (character === "\\") index += 1;
      else if (character === "\"") quote = null;
      continue;
    }
    if (quote === "'") {
      if (character === "'" && value[index + 1] === "'") index += 1;
      else if (character === "'") quote = null;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") braceDepth += 1;
    else if (character === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (character === "[") bracketDepth += 1;
    else if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === ":" && braceDepth === 0 && bracketDepth === 0) return index;
  }
  return -1;
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

function splitTopLevel(value, delimiter = ",") {
  const parts = [];
  let start = 0;
  let quote = null;
  let braceDepth = 0;
  let bracketDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === "\"") {
      if (character === "\\") index += 1;
      else if (character === "\"") quote = null;
      continue;
    }
    if (quote === "'") {
      if (character === "'" && value[index + 1] === "'") index += 1;
      else if (character === "'") quote = null;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") braceDepth += 1;
    else if (character === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (character === "[") bracketDepth += 1;
    else if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === delimiter && braceDepth === 0 && bracketDepth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function parseInlineMap(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const body = trimmed.slice(1, -1).trim();
  if (body === "") return {};
  const result = {};
  for (const pair of splitTopLevel(body)) {
    const separator = findTopLevelColon(pair);
    if (separator <= 0) return null;
    const key = unquoteYamlScalar(pair.slice(0, separator));
    const rawValue = pair.slice(separator + 1).trim();
    if (!key || rawValue === "" || Object.prototype.hasOwnProperty.call(result, key)) return null;
    const parsedValue = parseYamlValue(rawValue);
    if (parsedValue === null) return null;
    result[key] = parsedValue;
  }
  return result;
}

function parseYamlValue(value) {
  const withoutComment = stripYamlComment(value).trim();
  if (withoutComment === "") return "";
  if (withoutComment.startsWith("{") && withoutComment.endsWith("}")) {
    return parseInlineMap(withoutComment);
  }
  if (withoutComment.startsWith("[") && withoutComment.endsWith("]")) return null;
  return unquoteYamlScalar(withoutComment);
}

function parseYamlLine(line) {
  if (/^\t/u.test(line)) return { invalid: true };
  const indent = line.match(/^ */u)?.[0].length ?? 0;
  const content = stripYamlComment(line.slice(indent)).trim();
  if (content === "" || content === "---" || content === "..." || content.startsWith("#")) {
    return null;
  }
  if (content.startsWith("- ") || content === "-") return null;
  const separator = findTopLevelColon(content);
  if (separator <= 0) return null;
  const key = unquoteYamlScalar(content.slice(0, separator));
  if (!key) return null;
  const rawValue = content.slice(separator + 1).trim();
  const value = rawValue === "" ? "" : parseYamlValue(rawValue);
  if (value === null) return { invalid: true };
  return { indent, key, value };
}

function dependencySdkValue(entry) {
  if (!entry) return null;
  if (entry.value && typeof entry.value === "object" && !Array.isArray(entry.value)) {
    return entry.value.sdk === "flutter" ? "flutter" : null;
  }
  return entry.value === "" ? null : null;
}

function parseYamlLines(lines) {
  const parsedLines = [];
  let valid = true;
  for (const line of lines) {
    const parsed = parseYamlLine(line);
    if (parsed?.invalid) valid = false;
    parsedLines.push(parsed);
  }
  return { parsedLines, valid };
}

function findSectionIndexes(parsedLines, sectionName) {
  const sectionIndexes = [];
  for (let index = 0; index < parsedLines.length; index += 1) {
    const parsed = parsedLines[index];
    if (parsed?.indent === 0 && parsed.key === sectionName) sectionIndexes.push(index);
  }
  return sectionIndexes;
}

function dependencyEntriesFromInline(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [key, { value: entryValue }]));
}

function findSectionIndent(parsedLines, sectionIndex) {
  for (let index = sectionIndex + 1; index < parsedLines.length; index += 1) {
    const parsed = parsedLines[index];
    if (!parsed) continue;
    if (parsed.indent === 0) break;
    return parsed.indent;
  }
  return null;
}

function readNestedDependencyMap(parsedLines, entryIndex, parentIndent) {
  let nestedIndent = null;
  const nested = {};
  for (let index = entryIndex + 1; index < parsedLines.length; index += 1) {
    const parsed = parsedLines[index];
    if (!parsed) continue;
    if (parsed.indent <= parentIndent) break;
    nestedIndent ??= parsed.indent;
    if (parsed.indent !== nestedIndent) continue;
    if (Object.prototype.hasOwnProperty.call(nested, parsed.key)) return null;
    nested[parsed.key] = parsed.value;
  }
  return nested;
}

function readBlockDependencyEntries(parsedLines, sectionIndex, sectionIndent) {
  const entries = {};
  for (let index = sectionIndex + 1; index < parsedLines.length; index += 1) {
    const parsed = parsedLines[index];
    if (!parsed) continue;
    if (parsed.indent === 0) break;
    if (parsed.indent !== sectionIndent) continue;
    if (Object.prototype.hasOwnProperty.call(entries, parsed.key)) return null;
    const entry = { value: parsed.value };
    if (parsed.value === "") {
      const nested = readNestedDependencyMap(parsedLines, index, parsed.indent);
      if (nested === null) return null;
      entry.value = nested;
    }
    entries[parsed.key] = entry;
  }
  return entries;
}

function readDependencySection(lines, sectionName) {
  const { parsedLines, valid } = parseYamlLines(lines);
  const sectionIndexes = findSectionIndexes(parsedLines, sectionName);
  if (sectionIndexes.length > 1) return { present: true, valid: false, entries: {} };
  if (sectionIndexes.length === 0) return { present: false, valid, entries: {} };

  const sectionIndex = sectionIndexes[0];
  const section = parsedLines[sectionIndex];
  const entries = {};
  if (section.value !== "") {
    const inlineEntries = dependencyEntriesFromInline(section.value);
    if (inlineEntries === null) {
      return { present: true, valid: false, entries: {} };
    }
    return { present: true, valid, entries: inlineEntries };
  }

  const sectionIndent = findSectionIndent(parsedLines, sectionIndex);
  if (sectionIndent === null) return { present: true, valid, entries };
  const blockEntries = readBlockDependencyEntries(parsedLines, sectionIndex, sectionIndent);
  if (blockEntries === null) return { present: true, valid: false, entries: {} };
  return { present: true, valid, entries: blockEntries };
}

export function parsePubspec(text) {
  if (typeof text !== "string" || text.length > MAX_MANIFEST_BYTES || /\r(?!\n)/u.test(text)) {
    return { valid: false, primary: false, flutterTest: false, override: false };
  }
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const dependencies = readDependencySection(lines, "dependencies");
  const devDependencies = readDependencySection(lines, "dev_dependencies");
  const dependencyOverrides = readDependencySection(lines, "dependency_overrides");
  const valid = dependencies.valid && devDependencies.valid && dependencyOverrides.valid;
  const primary = valid && dependencySdkValue(dependencies.entries.flutter) === "flutter";
  const flutterTest = valid && dependencySdkValue(devDependencies.entries.flutter_test) === "flutter";
  const override = valid && dependencySdkValue(dependencyOverrides.entries.flutter) === "flutter";
  return {
    valid,
    primary,
    flutterTest,
    override,
  };
}

async function findPubspecFiles(root) {
  const result = [];
  async function visit(directory) {
    if (result.length >= MAX_MANIFESTS) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (result.length >= MAX_MANIFESTS) return;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(absolutePath);
      } else if (entry.isFile() && entry.name === "pubspec.yaml") {
        result.push(absolutePath);
      }
    }
  }
  await visit(root);
  return result.sort((left, right) => portableRelative(root, left).localeCompare(portableRelative(root, right)));
}

async function readBounded(filePath, maxBytes) {
  try {
    const bytes = await readFile(filePath);
    if (bytes.length > maxBytes) return null;
    return bytes.toString("utf8");
  } catch {
    return null;
  }
}

async function directDirectoryNames(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  } catch {
    return new Set();
  }
}

async function findDartFiles(root) {
  const result = [];
  async function visit(directory) {
    if (result.length >= MAX_SOURCE_FILES) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (result.length >= MAX_SOURCE_FILES || entry.isSymbolicLink()) return;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith(".dart")) {
        result.push(absolutePath);
      }
    }
  }
  await visit(root);
  return result;
}

async function hasFlutterImport(projectRoot) {
  for (const directory of SOURCE_DIRECTORIES) {
    const files = await findDartFiles(path.join(projectRoot, directory));
    for (const filePath of files) {
      const text = await readBounded(filePath, MAX_SOURCE_BYTES);
      if (text && /^\s*(?:import|export)\s+["']package:flutter\//mu.test(text)) return true;
    }
  }
  return false;
}

function normalizeClaim(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const replaced = value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
  if (replaced === "." || replaced === "") return ".";
  if (replaced.startsWith("../") || replaced.startsWith("/")) return null;
  return path.posix.normalize(replaced).replace(/^\.\//u, "").toLowerCase();
}

function claimMatchesProject(claim, projectRoot) {
  if (claim === ".") return true;
  const root = projectRoot.toLowerCase();
  if (root !== ".") {
    if (claim === root || root.startsWith(`${claim}/`)) return true;
    if (!claim.startsWith(`${root}/`)) return false;
    const relative = claim.slice(root.length + 1);
    return [...FLUTTER_PROJECT_PATHS].some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
  }
  return [...FLUTTER_PROJECT_PATHS].some((prefix) => claim === prefix || claim.startsWith(`${prefix}/`));
}

async function inspectProject(root, manifestPath, targetRoot) {
  const projectRootPath = path.dirname(manifestPath);
  const projectRoot = portableRelative(targetRoot, projectRootPath);
  const manifestRelative = portableRelative(targetRoot, manifestPath);
  const manifestText = await readBounded(manifestPath, MAX_MANIFEST_BYTES);
  const parsed = parsePubspec(manifestText ?? "");
  const primarySignals = parsed.primary ? [`${manifestRelative}:dependencies.flutter.sdk`] : [];
  const supportingSignals = [];
  if (parsed.flutterTest) supportingSignals.push(`${manifestRelative}:dev_dependencies.flutter_test.sdk`);
  if (parsed.override) supportingSignals.push(`${manifestRelative}:dependency_overrides.flutter.sdk`);

  const metadataText = await readBounded(path.join(projectRootPath, ".metadata"), MAX_SOURCE_BYTES);
  if (metadataText && /^project_type:\s*[^\s#]+/mu.test(metadataText)) {
    supportingSignals.push(`${projectRoot === "." ? ".metadata" : `${projectRoot}/.metadata`}:project_type`);
  }

  const directories = await directDirectoryNames(projectRootPath);
  for (const platform of PLATFORM_DIRECTORIES) {
    if (directories.has(platform)) supportingSignals.push(`${projectRoot === "." ? platform : `${projectRoot}/${platform}`}:directory`);
  }
  if (await hasFlutterImport(projectRootPath)) {
    supportingSignals.push(`${projectRoot === "." ? "source" : `${projectRoot}/source`}:package:flutter`);
  }

  return {
    root: projectRoot,
    manifest: manifestRelative,
    validManifest: parsed.valid,
    primary: parsed.primary,
    primarySignals,
    supportingSignals,
  };
}

export async function detectProjectEvidence(target, { claims = [] } = {}) {
  const targetRoot = path.resolve(target);
  const manifestPaths = await findPubspecFiles(targetRoot);
  if (manifestPaths.length === 0) return null;
  const projects = [];
  for (const manifestPath of manifestPaths) {
    projects.push(await inspectProject(targetRoot, manifestPath, targetRoot));
  }

  const normalizedClaims = uniqueSorted((Array.isArray(claims) ? claims : []).map(normalizeClaim).filter(Boolean));
  const hasClaims = Array.isArray(claims) && claims.length > 0;
  const selectedProjects = hasClaims
    ? projects.filter((project) => normalizedClaims.some((claim) => claimMatchesProject(claim, project.root)))
    : projects;
  const scope = hasClaims
    ? (selectedProjects.length > 0 ? "MATCH" : "NO_MATCH")
    : "UNSCOPED";
  return {
    schemaVersion: PROJECT_EVIDENCE_SCHEMA_VERSION,
    scope,
    frameworks: selectedProjects.some((project) => project.primary) ? ["flutter"] : [],
    projectRoots: uniqueSorted(selectedProjects.map((project) => project.root)),
    primarySignals: uniqueSorted(selectedProjects.flatMap((project) => project.primarySignals)),
    supportingSignals: uniqueSorted(selectedProjects.flatMap((project) => project.supportingSignals)),
  };
}
