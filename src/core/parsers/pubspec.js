// Bounded parsers for untrusted repository manifest text. They never throw on
// malformed input: every entry point returns an `invalid` shape instead.
import { PROJECT_DETECTION_LIMITS } from "./limits.js";

const MAX_MANIFEST_BYTES = PROJECT_DETECTION_LIMITS.maxManifestBytes;
const UNSUPPORTED_YAML_VALUE = Symbol("unsupported-yaml-value");
// Inline flow maps deeper than this are rejected as invalid instead of recursing:
// unbounded nesting in untrusted manifests otherwise overflows the call stack.
export const MAX_INLINE_MAP_DEPTH = 32;

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

export function splitTopLevel(value, delimiter = ",") {
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

function parseInlineMap(value, depth) {
  if (depth > MAX_INLINE_MAP_DEPTH) return null;
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
    const parsedValue = parseYamlValue(rawValue, depth + 1);
    if (parsedValue === null) return null;
    result[key] = parsedValue;
  }
  return result;
}

function parseYamlValue(value, depth = 0) {
  const withoutComment = stripYamlComment(value).trim();
  if (withoutComment === "") return "";
  if (withoutComment.startsWith("{")) {
    return withoutComment.endsWith("}") ? parseInlineMap(withoutComment, depth) : null;
  }
  if (withoutComment.startsWith("[")) return UNSUPPORTED_YAML_VALUE;
  return unquoteYamlScalar(withoutComment);
}

function containsUnsupportedYamlValue(value) {
  if (value === UNSUPPORTED_YAML_VALUE) return true;
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(containsUnsupportedYamlValue);
}

function parseYamlLine(line) {
  if (/^\t/u.test(line)) return { invalid: true };
  const indent = line.match(/^ */u)?.[0].length ?? 0;
  const content = stripYamlComment(line.slice(indent)).trim();
  if (content === "" || content === "---" || content === "..." || content.startsWith("#")) {
    return null;
  }
  if (content.startsWith("- ") || content === "-") return { indent, sequence: true };
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
    if (parsed.invalid) return null;
    if (parsed.sequence) {
      if (parsed.indent > parentIndent) return null;
      break;
    }
    if (parsed.indent <= parentIndent) break;
    if (containsUnsupportedYamlValue(parsed.value)) return null;
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
    if (parsed.invalid) return null;
    if (parsed.indent === 0) break;
    if (parsed.sequence || containsUnsupportedYamlValue(parsed.value)) return null;
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
    if (containsUnsupportedYamlValue(section.value)) {
      return { present: true, valid: false, entries: {} };
    }
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
