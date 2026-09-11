import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const PROJECT_EVIDENCE_SCHEMA_VERSION = 1;

export const PROJECT_EVIDENCE_SCOPES = Object.freeze([
  "MATCH",
  "UNSCOPED",
  "NO_MATCH",
  "NONE",
]);

export const PROJECT_DETECTION_LIMITS = Object.freeze({
  maxManifests: 256,
  maxSolutionFiles: 64,
  maxManifestBytes: 1024 * 1024,
  maxSourceFiles: 256,
  maxSourceBytes: 512 * 1024,
  maxVisitedDirectories: 4096,
  maxVisitedEntries: 20000,
});
const MAX_MANIFESTS = PROJECT_DETECTION_LIMITS.maxManifests;
const MAX_SOLUTION_FILES = PROJECT_DETECTION_LIMITS.maxSolutionFiles;
const MAX_MANIFEST_BYTES = PROJECT_DETECTION_LIMITS.maxManifestBytes;
const MAX_SOURCE_FILES = PROJECT_DETECTION_LIMITS.maxSourceFiles;
const MAX_SOURCE_BYTES = PROJECT_DETECTION_LIMITS.maxSourceBytes;
const MAX_XML_TEXT_LENGTH = 4096;
const UNSUPPORTED_YAML_VALUE = Symbol("unsupported-yaml-value");
const IGNORED_DIRECTORIES = new Set([
  ".dart_tool",
  ".forgeloop",
  ".git",
  ".idea",
  ".vscode",
  "artifacts",
  "bin",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "obj",
  "out",
  "TestResults",
  "vendor",
]);
const DOTNET_PROJECT_EXTENSIONS = new Set([".csproj", ".fsproj", ".vbproj"]);
const DOTNET_SDKS = new Set([
  "Microsoft.NET.Sdk",
  "Microsoft.NET.Sdk.Web",
  "Microsoft.NET.Sdk.Worker",
  "Microsoft.NET.Sdk.Razor",
  "Microsoft.NET.Sdk.BlazorWebAssembly",
  "Aspire.AppHost.Sdk",
  "MSTest.Sdk",
]);
const ASPNETCORE_SDKS = new Set([
  "Microsoft.NET.Sdk.Web",
  "Microsoft.NET.Sdk.Razor",
  "Microsoft.NET.Sdk.BlazorWebAssembly",
]);
const SHARED_DOTNET_FILES = new Set([
  "directory.build.props",
  "directory.build.targets",
  "directory.packages.props",
  "global.json",
  "nuget.config",
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
  if (withoutComment.startsWith("{")) {
    return withoutComment.endsWith("}") ? parseInlineMap(withoutComment) : null;
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

function invalidDotNetProject() {
  return {
    valid: false,
    sdkStyle: false,
    projectSdks: [],
    targetFrameworks: [],
    frameworkReferences: [],
    packageReferences: [],
    projectReferences: [],
    dotnet: false,
    aspnetcore: false,
    abp: false,
  };
}

function findXmlTagEnd(text, start) {
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function parseXmlAttributes(text) {
  const attributes = {};
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/u.test(text[index])) index += 1;
    if (index >= text.length) break;
    const name = text.slice(index).match(/^[A-Za-z_][A-Za-z0-9_.:-]*/u)?.[0];
    if (!name) return null;
    index += name.length;
    while (index < text.length && /\s/u.test(text[index])) index += 1;
    if (text[index] !== "=") return null;
    index += 1;
    while (index < text.length && /\s/u.test(text[index])) index += 1;
    const quote = text[index];
    if (quote !== "\"" && quote !== "'") return null;
    index += 1;
    const end = text.indexOf(quote, index);
    if (end < 0 || Object.prototype.hasOwnProperty.call(attributes, name)) return null;
    attributes[name] = text.slice(index, end);
    index = end + 1;
  }
  return attributes;
}

function appendXmlText(stack, value) {
  if (value === "") return true;
  const current = stack[stack.length - 1];
  if (!current) return value.trim() === "";
  current.textParts.push(value);
  return true;
}

function consumeXmlSpecialToken(text, tagStart, stack) {
  if (text.startsWith("<!--", tagStart)) {
    const end = text.indexOf("-->", tagStart + 4);
    return end < 0 ? { valid: false } : { valid: true, nextIndex: end + 3 };
  }
  if (text.startsWith("<![CDATA[", tagStart)) {
    const end = text.indexOf("]]>", tagStart + 9);
    if (end < 0 || stack.length === 0) return { valid: false };
    stack[stack.length - 1].textParts.push(text.slice(tagStart + 9, end));
    return { valid: true, nextIndex: end + 3 };
  }
  if (text.startsWith("<?", tagStart)) {
    const end = text.indexOf("?>", tagStart + 2);
    return end < 0 ? { valid: false } : { valid: true, nextIndex: end + 2 };
  }
  if (text.startsWith("<!", tagStart)) return { valid: false };
  return null;
}

function closeXmlNode(raw, state) {
  const closing = raw.slice(1).trim().match(/^([A-Za-z_][A-Za-z0-9_.:-]*)\s*$/u)?.[1];
  const open = state.stack.pop();
  if (!closing || !open || open.name !== closing) return false;
  open.text = open.textParts.join("");
  if (state.stack.length === 0) {
    if (state.rootClosed || open !== state.root) return false;
    state.rootClosed = true;
  }
  return true;
}

function openXmlNode(raw, state) {
  const selfClosing = /\/\s*$/u.test(raw);
  const body = selfClosing ? raw.replace(/\/\s*$/u, "").trimEnd() : raw;
  const name = body.match(/^([A-Za-z_][A-Za-z0-9_.:-]*)/u)?.[1];
  if (!name) return false;
  if (state.stack.length === 0 && (state.root || state.rootClosed)) return false;
  if (!state.root && state.expectedRoot && name !== state.expectedRoot) return false;
  const attributes = parseXmlAttributes(body.slice(name.length).trim());
  if (!attributes) return false;
  const node = { name, attributes, textParts: [], children: [], text: "" };
  state.nodes.push(node);
  if (state.stack.length > 0) state.stack[state.stack.length - 1].children.push(node);
  if (!state.root) state.root = node;
  if (!selfClosing) state.stack.push(node);
  else if (node === state.root) state.rootClosed = true;
  return true;
}

function consumeXmlTag(text, tagStart, state) {
  const tagEnd = findXmlTagEnd(text, tagStart + 1);
  if (tagEnd < 0) return null;
  const raw = text.slice(tagStart + 1, tagEnd).trim();
  if (raw === "") return null;
  const valid = raw.startsWith("/") ? closeXmlNode(raw, state) : openXmlNode(raw, state);
  return { valid, nextIndex: tagEnd + 1 };
}

function parseXmlStructure(text, expectedRoot = null) {
  if (typeof text !== "string" || text.length > MAX_MANIFEST_BYTES || /\r(?!\n)/u.test(text)) return null;
  const state = { nodes: [], stack: [], root: null, rootClosed: false, expectedRoot };
  let index = 0;
  while (index < text.length) {
    const tagStart = text.indexOf("<", index);
    if (tagStart < 0) break;
    if (!appendXmlText(state.stack, text.slice(index, tagStart))) return null;
    const special = consumeXmlSpecialToken(text, tagStart, state.stack);
    if (special) {
      if (!special.valid) return null;
      index = special.nextIndex;
      continue;
    }
    const tag = consumeXmlTag(text, tagStart, state);
    if (!tag?.valid) return null;
    index = tag.nextIndex;
  }
  if (!appendXmlText(state.stack, text.slice(index))) return null;
  if (!state.root || state.stack.length > 0 || !state.rootClosed) return null;
  return { root: state.root, nodes: state.nodes };
}

function normalizeSdkName(value) {
  return typeof value === "string" ? value.trim().split("/")[0] : "";
}

function xmlValues(nodes, name, attribute = "Include") {
  return uniqueSorted(nodes
    .filter((node) => node.name === name && typeof node.attributes?.[attribute] === "string")
    .map((node) => node.attributes[attribute].trim())
    .filter(Boolean));
}

function targetFrameworkValues(nodes) {
  return uniqueSorted(nodes
    .filter((node) => (node.name === "TargetFramework" || node.name === "TargetFrameworks")
      && node.children.length === 0
      && node.text.length <= MAX_XML_TEXT_LENGTH)
    .flatMap((node) => node.text.split(";"))
    .map((value) => value.trim())
    .filter(Boolean));
}

export function parseDotNetProject(text) {
  const invalid = invalidDotNetProject();
  if (typeof text !== "string" || text.length > MAX_MANIFEST_BYTES) return invalid;
  const document = parseXmlStructure(text, "Project");
  if (!document) return invalid;

  const sdkValues = [
    document.root.attributes.Sdk ?? "",
    ...document.nodes.filter((node) => node.name === "Sdk").map((node) => node.attributes.Name ?? ""),
  ];
  const projectSdks = uniqueSorted(sdkValues
    .flatMap((value) => value.split(";"))
    .map(normalizeSdkName)
    .filter(Boolean));
  const recognizedSdks = projectSdks.filter((sdk) => DOTNET_SDKS.has(sdk));
  const frameworkReferences = xmlValues(document.nodes, "FrameworkReference");
  const packageReferences = xmlValues(document.nodes, "PackageReference");
  const projectReferences = xmlValues(document.nodes, "ProjectReference");
  const dotnet = recognizedSdks.length > 0;
  const aspnetcore = dotnet && (recognizedSdks.some((sdk) => ASPNETCORE_SDKS.has(sdk))
    || frameworkReferences.some((reference) => reference.toLowerCase() === "microsoft.aspnetcore.app"));
  const abp = dotnet && packageReferences.some((reference) => reference.toLowerCase().startsWith("volo.abp."));
  return {
    valid: true,
    sdkStyle: dotnet,
    projectSdks,
    targetFrameworks: targetFrameworkValues(document.nodes),
    frameworkReferences,
    packageReferences,
    projectReferences,
    dotnet,
    aspnetcore,
    abp,
  };
}

function createTraversalBudget(limits = {}) {
  const positiveLimit = (value, fallback) => Number.isInteger(value) && value > 0 ? value : fallback;
  return {
    maxVisitedDirectories: positiveLimit(limits.maxVisitedDirectories, PROJECT_DETECTION_LIMITS.maxVisitedDirectories),
    maxVisitedEntries: positiveLimit(limits.maxVisitedEntries, PROJECT_DETECTION_LIMITS.maxVisitedEntries),
    visitedDirectories: 0,
    visitedEntries: 0,
    exhausted: false,
  };
}

function consumeDirectory(budget) {
  if (budget.exhausted || budget.visitedDirectories >= budget.maxVisitedDirectories) {
    budget.exhausted = true;
    return false;
  }
  budget.visitedDirectories += 1;
  return true;
}

function consumeEntry(budget) {
  if (budget.exhausted || budget.visitedEntries >= budget.maxVisitedEntries) {
    budget.exhausted = true;
    return false;
  }
  budget.visitedEntries += 1;
  return true;
}

async function findProjectFiles(root, budget) {
  const manifests = [];
  const solutions = [];
  async function visit(directory) {
    if (manifests.length >= MAX_MANIFESTS && solutions.length >= MAX_SOLUTION_FILES) return;
    if (!consumeDirectory(budget)) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (manifests.length >= MAX_MANIFESTS && solutions.length >= MAX_SOLUTION_FILES) return;
      if (!consumeEntry(budget)) return;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (entry.name === "pubspec.yaml" && manifests.length < MAX_MANIFESTS) {
        manifests.push({ path: absolutePath, kind: "flutter" });
      } else if (DOTNET_PROJECT_EXTENSIONS.has(extension) && manifests.length < MAX_MANIFESTS) {
        manifests.push({ path: absolutePath, kind: "dotnet" });
      } else if ((extension === ".sln" || extension === ".slnx") && solutions.length < MAX_SOLUTION_FILES) {
        solutions.push(absolutePath);
      }
    }
  }
  await visit(root);
  const sortPaths = (left, right) => portableRelative(root, left.path ?? left).localeCompare(portableRelative(root, right.path ?? right));
  return {
    manifests: manifests.sort(sortPaths),
    solutions: solutions.sort(sortPaths),
  };
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

async function directDirectoryNames(directory, budget) {
  if (!consumeDirectory(budget)) return new Set();
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const directories = new Set();
    for (const entry of entries) {
      if (!consumeEntry(budget)) break;
      if (entry.isDirectory()) directories.add(entry.name);
    }
    return directories;
  } catch {
    return new Set();
  }
}

async function findDartFiles(root, budget) {
  const result = [];
  async function visit(directory) {
    if (result.length >= MAX_SOURCE_FILES) return;
    if (!consumeDirectory(budget)) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (result.length >= MAX_SOURCE_FILES) return;
      if (!consumeEntry(budget)) return;
      if (entry.isSymbolicLink()) continue;
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

async function hasFlutterImport(projectRoot, budget) {
  for (const directory of SOURCE_DIRECTORIES) {
    const files = await findDartFiles(path.join(projectRoot, directory), budget);
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

function claimMatchesProject(claim, project, projectRoots) {
  if (claim === ".") return true;
  const root = project.root.toLowerCase();
  const manifest = project.manifest.toLowerCase();
  if (claim === manifest || claim === root) return true;
  if (root === ".") {
    const nestedRoots = projectRoots
      .map((candidate) => candidate.toLowerCase())
      .filter((candidate) => candidate !== ".");
    // A root project owns claims outside confirmed nested project boundaries.
    return !nestedRoots.some((candidate) => claim === candidate || claim.startsWith(`${candidate}/`));
  }
  return claim.startsWith(`${root}/`) || root.startsWith(`${claim}/`);
}

function isSharedDotNetClaim(claim) {
  return SHARED_DOTNET_FILES.has(path.posix.basename(claim).toLowerCase());
}

function claimMatchesSharedDotNetFile(claim, project) {
  if (!project.dotnet || !isSharedDotNetClaim(claim)) return false;
  const directory = path.posix.dirname(claim).toLowerCase();
  const root = project.root.toLowerCase();
  return directory === "." || root === directory || root.startsWith(`${directory}/`);
}

function normalizedSolutionMember(relativePath, solutionPath, targetRoot) {
  if (typeof relativePath !== "string" || relativePath.trim() === "") return null;
  const portable = relativePath.trim().replaceAll("\\", "/");
  if (portable.startsWith("/") || /^[A-Za-z]:\//u.test(portable)) return null;
  const absolute = path.resolve(path.dirname(solutionPath), portable);
  const member = portableRelative(targetRoot, absolute).toLowerCase();
  if (member === ".." || member.startsWith("../")) return null;
  return member;
}

function parseSolutionMembership(text, extension, solutionPath, targetRoot) {
  if (typeof text !== "string") return null;
  const members = [];
  if (extension === ".sln") {
    const pattern = /^Project\("[^\r\n]*"\)\s*=\s*"[^"\r\n]*",\s*"([^"\r\n]+)"\s*,\s*"[^"\r\n]*"\s*$/u;
    for (const line of text.split(/\r?\n/u)) {
      if (!/^Project\(/u.test(line.trim())) continue;
      const match = line.trim().match(pattern);
      if (!match) return null;
      if (!/(?:\.csproj|\.fsproj|\.vbproj)$/iu.test(match[1])) continue;
      const member = normalizedSolutionMember(match[1], solutionPath, targetRoot);
      if (!member) return null;
      members.push(member);
    }
    return uniqueSorted(members);
  }

  const document = parseXmlStructure(text, "Solution");
  if (!document) return null;
  for (const node of document.nodes) {
    const projectPath = node.attributes.Path ?? node.attributes.path;
    if (node.name !== "Project") continue;
    if (typeof projectPath !== "string" || !/(?:\.csproj|\.fsproj|\.vbproj)$/iu.test(projectPath)) return null;
    const member = normalizedSolutionMember(projectPath, solutionPath, targetRoot);
    if (!member) return null;
    members.push(member);
  }
  return uniqueSorted(members);
}

async function inspectProject(manifestInfo, targetRoot, budget) {
  const manifestPath = manifestInfo.path;
  const projectRootPath = path.dirname(manifestPath);
  const projectRoot = portableRelative(targetRoot, projectRootPath);
  const manifestRelative = portableRelative(targetRoot, manifestPath);
  const manifestText = await readBounded(manifestPath, MAX_MANIFEST_BYTES);

  if (manifestInfo.kind === "dotnet") {
    const parsed = parseDotNetProject(manifestText ?? "");
    const primarySignals = parsed.dotnet
      ? parsed.projectSdks
        .filter((sdk) => DOTNET_SDKS.has(sdk))
        .map((sdk) => `${manifestRelative}:project.sdk=${sdk}`)
      : [];
    const supportingSignals = [];
    for (const targetFramework of parsed.targetFrameworks) supportingSignals.push(`${manifestRelative}:targetFramework=${targetFramework}`);
    for (const reference of parsed.frameworkReferences) supportingSignals.push(`${manifestRelative}:frameworkReference=${reference}`);
    for (const reference of parsed.packageReferences) supportingSignals.push(`${manifestRelative}:packageReference=${reference}`);
    for (const reference of parsed.projectReferences) supportingSignals.push(`${manifestRelative}:projectReference=${reference}`);
    const frameworks = [];
    if (parsed.dotnet) frameworks.push("dotnet");
    if (parsed.aspnetcore) frameworks.push("aspnetcore");
    if (parsed.abp) frameworks.push("abp");
    return {
      kind: "dotnet",
      root: projectRoot,
      manifest: manifestRelative,
      validManifest: parsed.valid,
      primary: parsed.dotnet,
      dotnet: parsed.dotnet,
      frameworks,
      primarySignals,
      supportingSignals,
    };
  }

  const parsed = parsePubspec(manifestText ?? "");
  const primarySignals = parsed.primary ? [`${manifestRelative}:dependencies.flutter.sdk`] : [];
  const supportingSignals = [];
  if (parsed.flutterTest) supportingSignals.push(`${manifestRelative}:dev_dependencies.flutter_test.sdk`);
  if (parsed.override) supportingSignals.push(`${manifestRelative}:dependency_overrides.flutter.sdk`);

  const metadataText = await readBounded(path.join(projectRootPath, ".metadata"), MAX_SOURCE_BYTES);
  if (metadataText && /^project_type:\s*[^\s#]+/mu.test(metadataText)) {
    supportingSignals.push(`${projectRoot === "." ? ".metadata" : `${projectRoot}/.metadata`}:project_type`);
  }

  const directories = await directDirectoryNames(projectRootPath, budget);
  for (const platform of PLATFORM_DIRECTORIES) {
    if (directories.has(platform)) supportingSignals.push(`${projectRoot === "." ? platform : `${projectRoot}/${platform}`}:directory`);
  }
  if (await hasFlutterImport(projectRootPath, budget)) {
    supportingSignals.push(`${projectRoot === "." ? "source" : `${projectRoot}/source`}:package:flutter`);
  }

  return {
    kind: "flutter",
    root: projectRoot,
    manifest: manifestRelative,
    validManifest: parsed.valid,
    primary: parsed.primary,
    dotnet: false,
    frameworks: parsed.primary ? ["flutter"] : [],
    primarySignals,
    supportingSignals,
  };
}

export async function detectProjectEvidence(target, { claims = [], limits = {} } = {}) {
  const targetRoot = path.resolve(target);
  const budget = createTraversalBudget(limits);
  const discovered = await findProjectFiles(targetRoot, budget);
  if (budget.exhausted) return null;
  if (discovered.manifests.length === 0) return null;
  const projects = [];
  for (const manifestInfo of discovered.manifests) {
    projects.push(await inspectProject(manifestInfo, targetRoot, budget));
    if (budget.exhausted) return null;
  }

  const solutionMembership = new Map();
  for (const solutionPath of discovered.solutions) {
    const solutionRelative = portableRelative(targetRoot, solutionPath).toLowerCase();
    const text = await readBounded(solutionPath, MAX_MANIFEST_BYTES);
    solutionMembership.set(
      solutionRelative,
      parseSolutionMembership(text, path.extname(solutionPath).toLowerCase(), solutionPath, targetRoot) ?? [],
    );
  }

  const normalizedClaims = uniqueSorted((Array.isArray(claims) ? claims : []).map(normalizeClaim).filter(Boolean));
  const hasClaims = Array.isArray(claims) && claims.length > 0;
  const projectRoots = projects.map((project) => project.root);
  const solutionClaims = normalizedClaims.filter((claim) => solutionMembership.has(claim));
  const selectedProjects = hasClaims
    ? projects.filter((project) => normalizedClaims.some((claim) => {
      if (solutionClaims.includes(claim)) {
        return project.dotnet && solutionMembership.get(claim).includes(project.manifest.toLowerCase());
      }
      if (isSharedDotNetClaim(claim)) return claimMatchesSharedDotNetFile(claim, project);
      return claimMatchesProject(claim, project, projectRoots);
    }))
    : projects;
  const scope = hasClaims
    ? (selectedProjects.length > 0 ? "MATCH" : "NO_MATCH")
    : "UNSCOPED";
  return {
    schemaVersion: PROJECT_EVIDENCE_SCHEMA_VERSION,
    scope,
    frameworks: uniqueSorted(selectedProjects.flatMap((project) => project.frameworks)),
    projectRoots: uniqueSorted(selectedProjects.map((project) => project.root)),
    primarySignals: uniqueSorted(selectedProjects.flatMap((project) => project.primarySignals)),
    supportingSignals: uniqueSorted(selectedProjects.flatMap((project) => project.supportingSignals)),
  };
}
