import { open, readdir } from "node:fs/promises";
import path from "node:path";

import {
  cargoWorkspaceContains,
  isRustSharedFile,
  parseCargoManifest,
  rustSharedFileKind,
  rustSharedScopeDirectory,
} from "./rust-project.js";
import {
  languageProjectKinds,
  languageSourceExtension,
  portablePath as languagePortablePath,
  C_SOURCE_EXTENSIONS,
  CPP_SOURCE_EXTENSIONS,
  JAVA_SOURCE_EXTENSIONS,
  PHP_SOURCE_EXTENSIONS,
  SQL_SOURCE_EXTENSIONS,
  SWIFT_SOURCE_EXTENSIONS,
} from "./multi-language-project.js";
import { inspectGoProject } from "./go-project.js";
import {
  inspectTypeScriptProject,
  isDeclarationFile,
  isTypeScriptConfigName,
  resolveTypeScriptConfigGraph,
  resolveTypeScriptConfigOwnershipRoots,
} from "./typescript-project.js";
import { inspectPhpProject, phpSourceLooksExecutable } from "./php-project.js";
import { inspectJavaProject } from "./java-project.js";
import { inspectNativeProject, nativeFrameworkForSource } from "./c-cpp-project.js";
import { inspectSwiftProject, swiftSourceLooksExecutable } from "./swift-project.js";
import { looksLikeSql, parseSqlProject } from "./sql-project.js";

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
  "DerivedData",
  "deriveddata",
  "dist",
  "external",
  "generated",
  "gen",
  ".gradle",
  "node_modules",
  "obj",
  "out",
  "target",
  "TestResults",
  "vendor",
  "third_party",
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
const NODE_BACKEND_DEPENDENCIES = new Set([
  "express",
  "fastify",
  "@nestjs/core",
  "koa",
  "@hapi/hapi",
]);
const NODE_SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);
const NON_TYPESCRIPT_JSON_FILES = new Set([
  "composer.lock",
  "global.json",
  "launchsettings.json",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "packages.lock.json",
]);
const NODE_NON_RUNTIME_DIRECTORIES = new Set([
  "test",
  "tests",
  "__tests__",
  "fixtures",
  "mocks",
  "examples",
  "docs",
  "coverage",
  "dist",
  "build",
  "node_modules",
  ".next",
  ".turbo",
  ".storybook",
  "storybook",
  "scripts",
  "tools",
  "tooling",
  "config",
  "configs",
  "codegen",
  "generator",
  "generators",
]);
const NODE_RUNTIME_SOURCE_DIRECTORIES = new Set([
  "api",
  "app",
  "apps",
  "backend",
  "lib",
  "runtime",
  "server",
  "servers",
  "service",
  "services",
  "src",
  "worker",
  "workers",
]);
const NODE_RUNTIME_ENTRY_NAMES = new Set([
  "api",
  "app",
  "bootstrap",
  "daemon",
  "entry",
  "http",
  "https",
  "index",
  "main",
  "network",
  "runtime",
  "server",
  "service",
  "worker",
]);
const SQL_RUNTIME_DIRECTORIES = new Set([
  "database",
  "db",
  "migration",
  "migrations",
  "schema",
  "schemas",
  "sql",
]);
const SQL_NON_RUNTIME_DIRECTORIES = new Set([
  "build",
  "coverage",
  "dist",
  "docs",
  "example",
  "examples",
  "fixtures",
  "generated",
  "gen",
  "node_modules",
  "target",
  "test",
  "tests",
  "vendor",
]);
const NODE_SERVER_BUILTINS = Object.freeze([
  "node:http",
  "node:https",
  "node:http2",
  "node:net",
  "node:tls",
  "node:dgram",
  "http",
  "https",
  "http2",
  "net",
  "tls",
  "dgram",
]);
const SHARED_NODE_FILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".npmrc",
  ".yarnrc.yml",
  "pnpm-workspace.yaml",
  ".nvmrc",
  ".node-version",
]);
const SHARED_GRADLE_FILES = new Set(["gradle.properties"]);
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

function invalidNodePackage() {
  return {
    valid: false,
    backendDependencies: [],
    backendDependencySignals: [],
    runtimeScripts: [],
    serverBuiltins: [],
    supportingDependencies: [],
    enginesNode: false,
    moduleType: false,
    packageManager: false,
    workspaceRoot: false,
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validStringMap(value) {
  return isPlainObject(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function packageWorkspaceRoot(value) {
  if (Array.isArray(value)) return value.length > 0 && value.every((entry) => typeof entry === "string");
  return isPlainObject(value)
    && Array.isArray(value.packages)
    && value.packages.length > 0
    && value.packages.every((entry) => typeof entry === "string");
}

function commandStartsWithNode(command) {
  if (typeof command !== "string") return false;
  let remaining = command.trim();
  if (remaining === "") return false;

  // Allow the ordinary shell environment-prefix form while keeping the
  // executable decision conservative. Wrappers such as npx, npm, and
  // cross-env are intentionally not followed.
  while (true) {
    const assignment = remaining.match(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s;&|<>]+)\s+/u);
    if (!assignment) break;
    remaining = remaining.slice(assignment[0].length).trimStart();
  }
  if (remaining.startsWith("env ")) {
    remaining = remaining.slice(4).trimStart();
    while (true) {
      const assignment = remaining.match(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s;&|<>]+)\s+/u);
      if (!assignment) break;
      remaining = remaining.slice(assignment[0].length).trimStart();
    }
  }

  const executableMatch = remaining.match(/^(?:"([^"]+)"|'([^']+)'|([^\s;&|<>]+))/u);
  const executable = executableMatch?.[1] ?? executableMatch?.[2] ?? executableMatch?.[3] ?? "";
  return executable === "node" || executable === "node.exe";
}

function maskJavaScriptCommentsAndTemplates(text) {
  let result = "";
  let state = "code";
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (state === "line-comment") {
      if (character === "\n") {
        result += character;
        state = "code";
      } else {
        result += " ";
      }
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else {
        result += character === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (state === "template") {
      if (escaped) {
        result += character === "\n" ? "\n" : " ";
        escaped = false;
      } else if (character === "\\") {
        result += " ";
        escaped = true;
      } else if (character === "`") {
        result += " ";
        state = "code";
      } else {
        result += character === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (character === "/" && next === "/") {
      result += "  ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      result += "  ";
      index += 1;
      state = "block-comment";
    } else if (character === "`") {
      result += " ";
      state = "template";
    } else {
      result += character;
    }
  }
  return result;
}

function isNodeToolingConfigFile(filePath) {
  const fileName = path.posix.basename(filePath).toLowerCase();
  return /\.config\.(?:js|mjs|cjs|ts|mts|cts)$/u.test(fileName);
}

function isNodeRuntimeSourceFile(filePath) {
  const normalizedPath = filePath.replaceAll("\\", "/").toLowerCase();
  if (isNodeToolingConfigFile(normalizedPath)) return false;
  const segments = normalizedPath.split("/");
  const fileName = path.posix.basename(normalizedPath);
  const stem = fileName.slice(0, fileName.lastIndexOf("."));
  return segments.slice(0, -1).some((segment) => NODE_RUNTIME_SOURCE_DIRECTORIES.has(segment))
    || NODE_RUNTIME_ENTRY_NAMES.has(stem)
    || /(?:^|-)(?:server|worker|daemon|service|bootstrap|entry|runtime)(?:-|$)/u.test(stem);
}

function classifyImportSpecifier(specifier) {
  if (/^type\s+[A-Za-z_$][\w$]*(?:\s+as\s+[A-Za-z_$][\w$]*)?$/u.test(specifier)) return "type-only";
  if (/^[A-Za-z_$][\w$]*(?:\s+as\s+[A-Za-z_$][\w$]*)?$/u.test(specifier)) return "runtime";
  return "unknown";
}

function classifyImportExportClause(clause) {
  const trimmed = clause.trim();
  if (trimmed === "" || /^type(?:\s|\{|\*)/u.test(trimmed)) return "type-only";
  const openBrace = trimmed.indexOf("{");
  if (openBrace < 0) return "runtime";
  const closeBrace = trimmed.lastIndexOf("}");
  if (closeBrace < openBrace || trimmed.slice(closeBrace + 1).trim() !== "") return "unknown";
  const prefix = trimmed.slice(0, openBrace).trim();
  if (prefix && !/^[A-Za-z_$][\w$]*,?$/u.test(prefix)) return "unknown";
  const specifiers = splitTopLevel(trimmed.slice(openBrace + 1, closeBrace));
  if (specifiers.length === 0) return "unknown";
  const classifications = specifiers.map((specifier) => classifyImportSpecifier(specifier.trim()));
  if (classifications.includes("unknown")) return "unknown";
  if (prefix || classifications.includes("runtime")) return "runtime";
  return "type-only";
}

function nodeServerBuiltinPattern() {
  return [...NODE_SERVER_BUILTINS]
    .sort((left, right) => right.length - left.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("|");
}

function packageImportExportServerBuiltin(source, moduleAlternation) {
  const declarationPattern = new RegExp(
    `^\\s*(?:import|export)\\b([\\s\\S]*?)\\bfrom\\s*["'](${moduleAlternation})["']`,
    "gmu",
  );
  for (const match of source.matchAll(declarationPattern)) {
    const clause = match[1];
    if (clause.includes(";") || /^\s*(?:import|export)\b/m.test(clause)) continue;
    if (classifyImportExportClause(clause) === "runtime") return match[2];
  }
  return null;
}

function packageServerBuiltin(text) {
  if (typeof text !== "string") return null;
  const source = maskJavaScriptCommentsAndTemplates(text);
  const moduleAlternation = nodeServerBuiltinPattern();
  const importedModule = packageImportExportServerBuiltin(source, moduleAlternation);
  if (importedModule) return importedModule;
  const patterns = [
    new RegExp(`^\\s*import\\s*["'](${moduleAlternation})["']`, "mu"),
    new RegExp(`^\\s*(?:const|let|var)\\b[^\\n=]*=\\s*require\\(\\s*["'](${moduleAlternation})["']\\s*\\)`, "mu"),
    new RegExp(`^\\s*require\\(\\s*["'](${moduleAlternation})["']\\s*\\)`, "mu"),
    new RegExp(`^\\s*(?:await\\s+)?import\\(\\s*["'](${moduleAlternation})["']\\s*\\)`, "mu"),
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function parsePackageJson(text) {
  const invalid = invalidNodePackage();
  if (typeof text !== "string" || text.length > MAX_MANIFEST_BYTES || /\r(?!\n)/u.test(text)) return invalid;

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return invalid;
  }
  if (!isPlainObject(value)) return invalid;

  const dependencyFields = ["dependencies", "optionalDependencies", "devDependencies", "peerDependencies"];
  if (dependencyFields.some((field) => value[field] !== undefined && !validStringMap(value[field]))) return invalid;
  if (value.scripts !== undefined && !validStringMap(value.scripts)) return invalid;
  if (value.engines !== undefined && !validStringMap(value.engines)) return invalid;
  if (value.workspaces !== undefined && !packageWorkspaceRoot(value.workspaces)) return invalid;
  if (value.type !== undefined && typeof value.type !== "string") return invalid;
  if (value.packageManager !== undefined && typeof value.packageManager !== "string") return invalid;

  const backendDependencySignals = ["dependencies", "optionalDependencies"]
    .flatMap((field) => Object.keys(value[field] ?? {})
      .filter((name) => NODE_BACKEND_DEPENDENCIES.has(name))
      .map((name) => `${field}.${name}`));
  const runtimeScripts = Object.entries(value.scripts ?? {})
    .filter(([, command]) => commandStartsWithNode(command))
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
  const supportingDependencies = ["devDependencies", "peerDependencies"]
    .flatMap((field) => Object.keys(value[field] ?? {}))
    .filter((name) => ["@types/node", "typescript", "tsx"].includes(name));

  return {
    valid: true,
    backendDependencies: uniqueSorted(backendDependencySignals.map((signal) => signal.split(".").slice(1).join("."))),
    backendDependencySignals: uniqueSorted(backendDependencySignals),
    runtimeScripts,
    serverBuiltins: [],
    supportingDependencies: uniqueSorted(supportingDependencies),
    enginesNode: typeof value.engines?.node === "string",
    moduleType: value.type === "module" || value.type === "commonjs",
    packageManager: typeof value.packageManager === "string",
    workspaceRoot: packageWorkspaceRoot(value.workspaces),
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
  const languageFiles = [];
  const sourceFiles = [];
  const solutions = [];
  const sharedFiles = [];

  function projectFileCapacityAvailable() {
    return manifests.length + languageFiles.length < MAX_MANIFESTS;
  }

  function addManifest(entry, absolutePath) {
    if (!projectFileCapacityAvailable()) return;
    const extension = path.extname(entry.name).toLowerCase();
    const kind = entry.name === "pubspec.yaml"
      ? "flutter"
      : entry.name === "package.json"
        ? "nodejs"
        : entry.name === "Cargo.toml"
          ? "rust"
          : DOTNET_PROJECT_EXTENSIONS.has(extension) ? "dotnet" : null;
    if (kind) manifests.push({ path: absolutePath, kind });
  }

  function addSolution(entry, absolutePath) {
    if (solutions.length >= MAX_SOLUTION_FILES) return;
    const extension = path.extname(entry.name).toLowerCase();
    if (extension === ".sln" || extension === ".slnx") solutions.push(absolutePath);
  }

  function addLanguageFiles(entry, absolutePath) {
    if (!projectFileCapacityAvailable()) return;
    const kinds = languageProjectKinds(entry.name);
    if (kinds.length === 0
      && entry.name.toLowerCase().endsWith(".json")
      && entry.name.toLowerCase() !== "package.json"
      && !NON_TYPESCRIPT_JSON_FILES.has(entry.name.toLowerCase())) {
      kinds.push("typescript-config");
    }
    for (const kind of kinds) {
      if (!projectFileCapacityAvailable()) break;
      languageFiles.push({
        path: absolutePath,
        kind,
        name: entry.name,
        relative: portableRelative(root, absolutePath).toLowerCase(),
      });
    }
  }

  function addSourceFile(entry, absolutePath) {
    if (sourceFiles.length >= MAX_SOURCE_FILES) return;
    if (languageProjectKinds(entry.name).length > 0) return;
    const extension = languageSourceExtension(entry.name);
    if (!extension || isDeclarationFile(entry.name)) return;
    sourceFiles.push({ path: absolutePath, name: entry.name, extension });
  }

  function classifyFile(entry, absolutePath) {
    addManifest(entry, absolutePath);
    addLanguageFiles(entry, absolutePath);
    addSourceFile(entry, absolutePath);
    addSolution(entry, absolutePath);
    const relative = portableRelative(root, absolutePath);
    if (isRustSharedFile(relative)) sharedFiles.push({ path: absolutePath, kind: "rust" });
    if (SHARED_NODE_FILES.has(entry.name.toLowerCase())) sharedFiles.push({ path: absolutePath, kind: "nodejs" });
    if (SHARED_GRADLE_FILES.has(entry.name.toLowerCase())) sharedFiles.push({ path: absolutePath, kind: "gradle" });
  }

  async function visit(directory) {
    if (!projectFileCapacityAvailable() && solutions.length >= MAX_SOLUTION_FILES) return;
    if (!consumeDirectory(budget)) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!projectFileCapacityAvailable() && solutions.length >= MAX_SOLUTION_FILES) return;
      if (!consumeEntry(budget)) return;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      classifyFile(entry, absolutePath);
    }
  }
  await visit(root);
  const sortPaths = (left, right) => portableRelative(root, left.path ?? left).localeCompare(portableRelative(root, right.path ?? right));
  return {
    manifests: manifests.sort(sortPaths),
    languageFiles: languageFiles.sort(sortPaths),
    sourceFiles: sourceFiles.sort(sortPaths),
    solutions: solutions.sort(sortPaths),
    sharedFiles: sharedFiles.sort(sortPaths),
  };
}

export async function readBounded(filePath, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) return null;
  let handle;
  try {
    handle = await open(filePath, "r");
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    if (bytesRead > maxBytes) return null;
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
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

async function findNodeSourceFiles(root, budget, nestedRoots = []) {
  const result = [];
  const boundaries = nestedRoots.map((nestedRoot) => path.resolve(nestedRoot));
  async function visit(directory) {
    if (result.length >= MAX_SOURCE_FILES) return;
    if (boundaries.some((boundary) => directory !== root && (directory === boundary || directory.startsWith(`${boundary}${path.sep}`)))) return;
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
        const directoryName = entry.name.toLowerCase();
        if (!IGNORED_DIRECTORIES.has(entry.name) && !NODE_NON_RUNTIME_DIRECTORIES.has(directoryName)) {
          await visit(absolutePath);
        }
      } else if (entry.isFile()
        && !/\.d\.(?:ts|mts|cts)$/iu.test(entry.name)
        && NODE_SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
        && !isNodeToolingConfigFile(entry.name)) {
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

async function findNodeServerImports(projectRoot, targetRoot, budget, nestedRoots = []) {
  const imports = [];
  const files = await findNodeSourceFiles(projectRoot, budget, nestedRoots);
  for (const filePath of files) {
    const relative = portableRelative(targetRoot, filePath);
    if (!isNodeRuntimeSourceFile(relative)) continue;
    const text = await readBounded(filePath, MAX_SOURCE_BYTES);
    const moduleName = packageServerBuiltin(text);
    if (!moduleName) continue;
    imports.push({
      file: relative,
      module: moduleName,
    });
  }
  return imports;
}

function normalizeClaim(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const replaced = value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
  if (replaced === "." || replaced === "") return ".";
  if (replaced.startsWith("../") || replaced.startsWith("/")) return null;
  return path.posix.normalize(replaced).replace(/^\.\//u, "").toLowerCase();
}

function nestedProjectRoots(projectRoot, projectRoots) {
  const root = projectRoot.toLowerCase();
  return projectRoots
    .map((candidate) => candidate.toLowerCase())
    .filter((candidate) => candidate !== root
      && (root === "." ? candidate !== "." : candidate.startsWith(`${root}/`)));
}

function projectPathHasNestedBoundary(candidate, projectRoot, projectRoots) {
  const normalizedCandidate = candidate.toLowerCase();
  return nestedProjectRoots(projectRoot, projectRoots)
    .some((nestedRoot) => normalizedCandidate === nestedRoot
      || normalizedCandidate.startsWith(`${nestedRoot}/`));
}

function projectOwnsPath(candidate, projectRoot, projectRoots) {
  const normalizedCandidate = candidate.toLowerCase();
  const root = projectRoot.toLowerCase();
  if (projectPathHasNestedBoundary(normalizedCandidate, root, projectRoots)) return false;
  if (root === ".") return true;
  return normalizedCandidate === root
    || normalizedCandidate.startsWith(`${root}/`)
    || root.startsWith(`${normalizedCandidate}/`);
}

function sharedFileWithinProjectScope(directory, projectRoot, projectRoots) {
  if (directory === ".") return true;
  return projectOwnsPath(directory, projectRoot, projectRoots);
}

function claimMatchesProject(claim, project, projectRoots) {
  if (claim === ".") return true;
  const root = project.root.toLowerCase();
  const manifest = project.manifest.toLowerCase();
  if (claim === manifest || claim === root) return true;
  return projectOwnsPath(claim, root, projectRoots);
}

function typeScriptProjectConsumesClaim(claim, project, projects, visited = new Set()) {
  if (project.manifest.toLowerCase() === claim) return true;
  const identity = project.manifest.toLowerCase();
  if (visited.has(identity)) return false;
  visited.add(identity);
  return (project.internal?.localExtends ?? []).some((reference) => {
    if (reference === claim) return true;
    const consumer = projects.find((candidate) => candidate.kind === "typescript"
      && candidate.manifest.toLowerCase() === reference);
    return consumer ? typeScriptProjectConsumesClaim(claim, consumer, projects, visited) : false;
  });
}

function isSharedDotNetClaim(claim) {
  return SHARED_DOTNET_FILES.has(path.posix.basename(claim).toLowerCase());
}

function claimMatchesSharedDotNetFile(claim, project, projectRoots) {
  if (!project.dotnet || !isSharedDotNetClaim(claim)) return false;
  const directory = path.posix.dirname(claim).toLowerCase();
  return sharedFileWithinProjectScope(directory, project.root, projectRoots);
}

function isSharedNodeClaim(claim) {
  return SHARED_NODE_FILES.has(path.posix.basename(claim).toLowerCase());
}

function claimMatchesSharedNodeFile(claim, project, projectRoots) {
  if (!project.nodejs || !isSharedNodeClaim(claim)) return false;
  const directory = path.posix.dirname(claim).toLowerCase();
  return sharedFileWithinProjectScope(directory, project.root, projectRoots);
}

function isSharedGradleClaim(claim) {
  return SHARED_GRADLE_FILES.has(path.posix.basename(claim).toLowerCase());
}

function isGradleBuildProject(project) {
  return project?.kind === "java" && project.internal?.gradleBuild;
}

function gradlePropertiesWithinScope(claim, project, projects) {
  if (!isGradleBuildProject(project) || !isSharedGradleClaim(claim)) return false;
  const directory = path.posix.dirname(claim).toLowerCase();
  const projectRoot = project.root.toLowerCase();
  const withinDirectory = directory === "."
    || projectRoot === directory
    || projectRoot.startsWith(`${directory}/`);
  if (!withinDirectory) return false;
  return !projects.some((candidate) => {
    if (!candidate.internal?.gradleSettings || !candidate.validManifest) return false;
    const settingsRoot = candidate.root.toLowerCase();
    if (settingsRoot === directory || !isStrictRootAncestor(directory, settingsRoot)) return false;
    return projectRoot === settingsRoot || projectRoot.startsWith(`${settingsRoot}/`);
  });
}

function claimMatchesSharedGradleFile(claim, project, projects) {
  return gradlePropertiesWithinScope(claim, project, projects);
}

function claimMatchesGradleSettings(claim, project, projects) {
  if (!isGradleBuildProject(project)) return false;
  return projects.some((settingsProject) => {
    if (settingsProject.kind !== "java"
      || !settingsProject.validManifest
      || !settingsProject.internal?.gradleSettings
      || settingsProject.manifest.toLowerCase() !== claim) return false;
    if (settingsProject.root.toLowerCase() === project.root.toLowerCase()) return true;
    return (settingsProject.internal.includes ?? [])
      .map((include) => normalizedGradleProjectRoot(settingsProject.root, include)?.toLowerCase())
      .includes(project.root.toLowerCase());
  });
}

function isRustToolchainFile(relativePath) {
  return ["rust-toolchain", "rust-toolchain.toml"].includes(path.posix.basename(relativePath).toLowerCase());
}

function sharedRustSignalApplies(relativePath, projectRoot, projectRoots) {
  if (!isRustSharedFile(relativePath)) return false;
  const directory = rustSharedScopeDirectory(relativePath).toLowerCase();
  return sharedFileWithinProjectScope(directory, projectRoot, projectRoots);
}

function hasCloserRustToolchain(claim, projectRoot, sharedFiles, targetRoot) {
  if (!isRustToolchainFile(claim)) return false;
  const claimDirectory = rustSharedScopeDirectory(claim).toLowerCase();
  return sharedFiles.some((sharedFile) => {
    const relative = portableRelative(targetRoot, sharedFile.path).toLowerCase();
    if (!isRustToolchainFile(relative) || relative === claim) return false;
    const otherDirectory = rustSharedScopeDirectory(relative).toLowerCase();
    return otherDirectory !== claimDirectory
      && (claimDirectory === "." || otherDirectory.startsWith(`${claimDirectory}/`))
      && (projectRoot === otherDirectory || projectRoot.startsWith(`${otherDirectory}/`));
  });
}

function claimMatchesRustWorkspaceManifest(claim, project, projects) {
  if (path.posix.basename(claim) !== "cargo.toml") return false;
  const workspace = projects.find((candidate) => candidate.kind === "rust"
    && candidate.rust
    && candidate.workspaceRoot
    && candidate.manifest.toLowerCase() === claim);
  if (!workspace) return false;
  return project === workspace || cargoWorkspaceContains(workspace, project, projects);
}

function claimMatchesRustLockfile(claim, project, projects) {
  const directory = rustSharedScopeDirectory(claim).toLowerCase();
  const workspace = projects.find((candidate) => candidate.kind === "rust"
    && candidate.rust
    && candidate.workspaceRoot
    && candidate.root.toLowerCase() === directory);
  if (workspace) return cargoWorkspaceContains(workspace, project, projects);
  return project.packageRoot && project.root.toLowerCase() === directory;
}

function claimMatchesSharedRustFile(claim, project, projects, projectRoots, sharedFiles, targetRoot) {
  if (!project.rust || !project.packageRoot || !isRustSharedFile(claim)) return false;
  if (rustSharedFileKind(claim) === "lockfile") return claimMatchesRustLockfile(claim, project, projects);
  if (hasCloserRustToolchain(claim, project.root.toLowerCase(), sharedFiles, targetRoot)) return false;
  const scopeDirectory = rustSharedScopeDirectory(claim).toLowerCase();
  const workspace = projects.find((candidate) => candidate.kind === "rust"
    && candidate.rust
    && candidate.workspaceRoot
    && candidate.root.toLowerCase() === scopeDirectory);
  if (workspace) return cargoWorkspaceContains(workspace, project, projects);
  return sharedRustSignalApplies(claim, project.root, projectRoots);
}

function claimMatchesNodeWorkspaceManifest(claim, project, projects) {
  if (path.posix.basename(claim) !== "package.json" || project.kind !== "nodejs" || !project.nodejs) return false;
  const workspace = projects.find((candidate) => candidate.kind === "nodejs"
    && candidate.manifest.toLowerCase() === claim
    && candidate.workspaceRoot);
  if (!workspace) return false;
  const workspacePrefix = workspace.root === "." ? "" : `${workspace.root}/`;
  return project.root === workspace.root || project.root.startsWith(workspacePrefix);
}

function normalizedJavaModuleRoot(aggregatorRoot, module) {
  if (typeof module !== "string" || module.trim() === "") return null;
  const portable = module.trim().replaceAll("\\", "/");
  if (portable.startsWith("/") || /^[A-Za-z]:\//u.test(portable)) return null;
  const normalized = path.posix.normalize(path.posix.join(aggregatorRoot === "." ? "" : aggregatorRoot, portable));
  if (normalized === ".." || normalized.startsWith("../")) return null;
  return normalized.replace(/^\.\//u, "") || ".";
}

function claimMatchesJavaAggregator(claim, project, projects) {
  if (!project?.frameworks?.includes("java")) return false;
  return projects.some((aggregator) => {
    if (aggregator === project || aggregator.kind !== "java" || aggregator.manifest.toLowerCase() !== claim) return false;
    return (aggregator.internal?.modules ?? []).some((module) => {
      return normalizedJavaModuleRoot(aggregator.root, module)?.toLowerCase() === project.root.toLowerCase();
    });
  });
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

function sharedNodeSignalApplies(sharedFile, projectRoot, projectRoots) {
  const sharedDirectory = path.posix.dirname(sharedFile).toLowerCase();
  return sharedFileWithinProjectScope(sharedDirectory, projectRoot, projectRoots);
}

function inspectDotNetProject({ projectRoot, manifestRelative, manifestText }) {
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

function inspectRustProject({ projectRoot, manifestRelative, manifestText, targetRoot, projectRoots, sharedFiles }) {
  const parsed = parseCargoManifest(manifestText ?? "");
  const primarySignals = [];
  if (parsed.package.present) primarySignals.push(`${manifestRelative}:package`);
  if (parsed.workspace.present) primarySignals.push(`${manifestRelative}:workspace`);

  const supportingSignals = [];
  if (parsed.package.edition) supportingSignals.push(`${manifestRelative}:edition=${parsed.package.edition}`);
  if (parsed.package.editionInherited) supportingSignals.push(`${manifestRelative}:edition=workspace`);
  if (parsed.package.rustVersion) supportingSignals.push(`${manifestRelative}:rust-version=${parsed.package.rustVersion}`);
  if (parsed.package.rustVersionInherited) supportingSignals.push(`${manifestRelative}:rust-version=workspace`);
  if (parsed.workspace.resolver) supportingSignals.push(`${manifestRelative}:resolver=${parsed.workspace.resolver}`);
  if (parsed.workspace.package?.edition) {
    supportingSignals.push(`${manifestRelative}:workspace.package.edition=${parsed.workspace.package.edition}`);
  }
  if (parsed.workspace.package?.rustVersion) {
    supportingSignals.push(`${manifestRelative}:workspace.package.rust-version=${parsed.workspace.package.rustVersion}`);
  }
  for (const dependency of uniqueSorted([...parsed.dependencies, ...parsed.workspaceDependencies])) {
    supportingSignals.push(`${manifestRelative}:dependency=${dependency}`);
  }
  for (const dependency of parsed.devDependencies) supportingSignals.push(`${manifestRelative}:devDependency=${dependency}`);
  for (const dependency of parsed.buildDependencies) supportingSignals.push(`${manifestRelative}:buildDependency=${dependency}`);
  for (const dependency of parsed.targetDependencies) supportingSignals.push(`${manifestRelative}:targetDependency=${dependency}`);
  for (const feature of parsed.features) supportingSignals.push(`${manifestRelative}:feature=${feature}`);

  for (const sharedFile of sharedFiles) {
    const relative = portableRelative(targetRoot, sharedFile.path);
    if (!parsed.rust || !parsed.package.present || !sharedRustSignalApplies(relative, projectRoot, projectRoots)) continue;
    const kind = rustSharedFileKind(relative);
    supportingSignals.push(`${relative}:${kind === "lockfile" ? "workspace-shared" : "rust-scope"}`);
  }

  return {
    kind: "rust",
    root: projectRoot,
    manifest: manifestRelative,
    validManifest: parsed.valid,
    primary: parsed.rust,
    rust: parsed.rust,
    packageRoot: parsed.package.present,
    workspaceRoot: parsed.workspace.present,
    virtualWorkspace: parsed.workspace.present && !parsed.package.present,
    frameworks: parsed.rust ? ["rust"] : [],
    primarySignals,
    supportingSignals,
    internal: parsed,
  };
}

function invalidateRustVirtualWorkspace(project) {
  project.rust = false;
  project.primary = false;
  project.frameworks = [];
  project.primarySignals = [];
  project.supportingSignals = [];
}

function resolveRustWorkspaceEvidence(projects) {
  const workspaces = projects
    .filter((project) => project.kind === "rust" && project.virtualWorkspace)
    .sort((left, right) => right.root.split("/").length - left.root.split("/").length);
  for (const workspace of workspaces) {
    if (!workspace.rust) continue;
    const hasConfirmedMember = projects.some((candidate) => candidate !== workspace
      && cargoWorkspaceContains(workspace, candidate, projects));
    if (!hasConfirmedMember) invalidateRustVirtualWorkspace(workspace);
  }
}

async function inspectNodeProject({
  projectRootPath,
  projectRoot,
  manifestRelative,
  manifestText,
  targetRoot,
  budget,
  projectRoots,
  sharedFiles,
  includeSourceEvidence = true,
}) {
  const parsed = parsePackageJson(manifestText ?? "");
  const nestedRoots = nestedProjectRoots(projectRoot, projectRoots)
    .map((candidate) => path.resolve(targetRoot, candidate));
  const primarySignals = [];
  for (const dependency of parsed.backendDependencySignals) primarySignals.push(`${manifestRelative}:${dependency}`);
  for (const script of parsed.runtimeScripts) primarySignals.push(`${manifestRelative}:scripts.${script}=node`);

  const serverImports = parsed.valid && includeSourceEvidence && primarySignals.length === 0
    ? await findNodeServerImports(projectRootPath, targetRoot, budget, nestedRoots)
    : [];
  for (const serverImport of serverImports) {
    primarySignals.push(`${serverImport.file}:import=${serverImport.module}`);
  }

  const supportingSignals = [];
  if (parsed.enginesNode) supportingSignals.push(`${manifestRelative}:engines.node`);
  if (parsed.moduleType) supportingSignals.push(`${manifestRelative}:type`);
  if (parsed.packageManager) supportingSignals.push(`${manifestRelative}:packageManager`);
  if (parsed.workspaceRoot) supportingSignals.push(`${manifestRelative}:workspaces`);
  for (const dependency of parsed.supportingDependencies) supportingSignals.push(`${manifestRelative}:supportingDependency=${dependency}`);
  for (const sharedFile of sharedFiles) {
    const relative = portableRelative(targetRoot, sharedFile.path);
    if (sharedNodeSignalApplies(relative, projectRoot, projectRoots)) {
      supportingSignals.push(`${relative}:node-scope`);
    }
  }

  const primary = parsed.valid && primarySignals.length > 0;
  return {
    kind: "nodejs",
    root: projectRoot,
    manifest: manifestRelative,
    validManifest: parsed.valid,
    primary,
    nodejs: primary,
    workspaceRoot: parsed.workspaceRoot,
    frameworks: primary ? ["nodejs"] : [],
    primarySignals,
    supportingSignals,
  };
}

function inspectGoLanguageProject(context) {
  return inspectGoProject(context);
}

function inspectTypeScriptLanguageProject(context) {
  return inspectTypeScriptProject(context);
}

function inspectSqlLanguageProject(context) {
  const parsed = parseSqlProject(context.manifestText);
  return {
    kind: "sql",
    root: context.projectRoot,
    manifest: context.manifestRelative,
    validManifest: parsed.valid,
    primary: parsed.database,
    frameworks: parsed.database ? ["sql"] : [],
    primarySignals: parsed.database ? [`${context.manifestRelative}:database-project`] : [],
    supportingSignals: [],
    internal: parsed,
  };
}

const LANGUAGE_PROJECT_INSPECTORS = new Map([
  ["go", inspectGoLanguageProject],
  ["go-work", inspectGoLanguageProject],
  ["typescript", inspectTypeScriptLanguageProject],
  ["javascript-config", inspectTypeScriptLanguageProject],
  ["typescript-config", inspectTypeScriptLanguageProject],
  ["php", inspectPhpProject],
  ["java-maven", inspectJavaProject],
  ["java-gradle", inspectJavaProject],
  ["java-gradle-settings", inspectJavaProject],
  ["java-gradle-properties", inspectJavaProject],
  ["java-bazel", inspectJavaProject],
  ["c-cpp-cmake", inspectNativeProject],
  ["c-cpp-meson", inspectNativeProject],
  ["c-cpp-meson-options", inspectNativeProject],
  ["c-cpp-make", inspectNativeProject],
  ["native-bazel", inspectNativeProject],
  ["swift-package", inspectSwiftProject],
  ["swift-xcode", inspectSwiftProject],
  ["swift-cmake", inspectSwiftProject],
  ["swift-meson", inspectSwiftProject],
  ["sql-project", inspectSqlLanguageProject],
]);

function inspectLanguageProject(
  languageFile,
  targetRoot,
  projectRoots,
  sourceFiles,
  languageFiles,
  claims = [],
  activeConfigRelatives = null,
  ownershipConfigRelatives = null,
) {
  const projectRootPath = languageFile.kind === "swift-xcode"
    ? path.dirname(path.dirname(languageFile.path))
    : path.dirname(languageFile.path);
  const manifestRelative = languagePortablePath(targetRoot, languageFile.path);
  const context = {
    projectRoot: languagePortablePath(targetRoot, projectRootPath),
    manifestRelative,
    manifestText: languageFile.text,
    manifestName: languageFile.name.toLowerCase(),
    targetRoot,
    projectRoots,
    sourceFiles,
    projectFiles: languageFiles,
    directClaim: claims.includes(manifestRelative.toLowerCase()),
    configKind: languageFile.kind,
    activeConfigRelatives,
    ownershipConfigRelatives,
  };
  return LANGUAGE_PROJECT_INSPECTORS.get(languageFile.kind)?.(context) ?? null;
}

function directSourceFrameworks(sourceFile, text) {
  if (!sourceFile || typeof text !== "string") return [];
  if (SQL_SOURCE_EXTENSIONS.has(sourceFile.extension)) return looksLikeSql(text) ? ["sql"] : [];
  if (PHP_SOURCE_EXTENSIONS.has(sourceFile.extension)) return phpSourceLooksExecutable(text) ? ["php"] : [];
  if (JAVA_SOURCE_EXTENSIONS.has(sourceFile.extension)) return ["java"];
  if (SWIFT_SOURCE_EXTENSIONS.has(sourceFile.extension)) return swiftSourceLooksExecutable(text) ? ["swift"] : [];
  const nativeFramework = nativeFrameworkForSource(sourceFile.name);
  if (nativeFramework && (C_SOURCE_EXTENSIONS.has(sourceFile.extension) || CPP_SOURCE_EXTENSIONS.has(sourceFile.extension))) {
    return [nativeFramework];
  }
  return [];
}

function sourceProjectRoot(claim, projectRoots) {
  const candidates = projectRoots
    .filter((root) => root === "." || claim === root || claim.startsWith(`${root}/`))
    .sort((left, right) => right.length - left.length);
  return candidates.find((root) => !projectPathHasNestedBoundary(claim, root, projectRoots)) ?? null;
}

function isDiscoveredSqlArtifact(relativePath) {
  const segments = relativePath.split("/");
  if (segments.some((segment) => SQL_NON_RUNTIME_DIRECTORIES.has(segment))) return false;
  return segments.slice(0, -1).some((segment) => SQL_RUNTIME_DIRECTORIES.has(segment));
}

function attachSourceFramework(project, relative, framework) {
  if (!project.frameworks.includes(framework)) project.frameworks.push(framework);
  project.primary = true;
  project.primarySignals.push(relative + ":source=" + framework);
}

function createDirectSourceProject(relative, frameworks, root = null) {
  return {
    kind: "direct-source",
    root,
    manifest: relative,
    validManifest: true,
    primary: true,
    frameworks,
    primarySignals: [relative + ":source=" + frameworks.join(",")],
    supportingSignals: [],
    internal: { direct: true },
  };
}

function directSourceProjectForClaim({ relative, frameworks, projects, projectRoots }) {
  const hostRoot = sourceProjectRoot(relative, projectRoots);
  const host = hostRoot ? projects.find((project) => project.root.toLowerCase() === hostRoot.toLowerCase()) : null;
  if (host) {
    for (const framework of frameworks) attachSourceFramework(host, relative, framework);
    return null;
  }
  return createDirectSourceProject(relative, frameworks);
}

function sqlProjectRoot(relative, projectRoots) {
  return sourceProjectRoot(relative, projectRoots) ?? path.posix.dirname(relative);
}

async function addDiscoveredSqlProjects({ targetRoot, sourceFiles, projects, projectRoots }) {
  const directProjects = [];
  for (const sourceFile of sourceFiles) {
    if (!SQL_SOURCE_EXTENSIONS.has(sourceFile.extension)) continue;
    const relative = languagePortablePath(targetRoot, sourceFile.path).toLowerCase();
    if (!isDiscoveredSqlArtifact(relative)) continue;
    const text = await readBounded(sourceFile.path, MAX_SOURCE_BYTES);
    if (!looksLikeSql(text)) continue;
    const root = sqlProjectRoot(relative, projectRoots);
    const host = projects.find((project) => project.root.toLowerCase() === root.toLowerCase());
    if (host) {
      attachSourceFramework(host, relative, "sql");
    } else {
      directProjects.push(createDirectSourceProject(relative, ["sql"], root));
    }
  }
  return directProjects;
}

async function addDirectSourceProjects({ targetRoot, claims, sourceFiles, projects, projectRoots }) {
  const directProjects = [];
  const handled = new Set();
  for (const claim of claims) {
    const claimedFiles = sourceFiles.filter((file) => {
      const relative = languagePortablePath(targetRoot, file.path).toLowerCase();
      return relative === claim || (SQL_SOURCE_EXTENSIONS.has(file.extension) && relative.startsWith(`${claim}/`));
    });
    for (const sourceFile of claimedFiles) {
      const relativeLower = languagePortablePath(targetRoot, sourceFile.path).toLowerCase();
      if (handled.has(relativeLower)) continue;
      handled.add(relativeLower);
      if (relativeLower !== claim && (!SQL_SOURCE_EXTENSIONS.has(sourceFile.extension)
        || !isDiscoveredSqlArtifact(relativeLower))) continue;
      const text = await readBounded(sourceFile.path, MAX_SOURCE_BYTES);
      const frameworks = directSourceFrameworks(sourceFile, text);
      if (frameworks.length === 0) continue;
      const relative = languagePortablePath(targetRoot, sourceFile.path);
      const directProject = directSourceProjectForClaim({ relative, frameworks, projects, projectRoots });
      if (directProject) directProjects.push(directProject);
    }
  }
  return directProjects;
}

async function inspectFlutterProject({ projectRootPath, projectRoot, manifestRelative, manifestText, budget, includeSupportingEvidence = true }) {
  const parsed = parsePubspec(manifestText ?? "");
  const primarySignals = parsed.primary ? [`${manifestRelative}:dependencies.flutter.sdk`] : [];
  const supportingSignals = [];
  if (!includeSupportingEvidence) {
    return {
      kind: "flutter",
      root: projectRoot,
      manifest: manifestRelative,
      validManifest: parsed.valid,
      primary: parsed.primary,
      nodejs: false,
      dotnet: false,
      frameworks: parsed.primary ? ["flutter"] : [],
      primarySignals,
      supportingSignals,
    };
  }
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
    nodejs: false,
    dotnet: false,
    frameworks: parsed.primary ? ["flutter"] : [],
    primarySignals,
    supportingSignals,
  };
}

async function inspectProject(
  manifestInfo,
  targetRoot,
  budget,
  projectRoots,
  sharedFiles,
  includeSupportingEvidence = true,
) {
  const manifestPath = manifestInfo.path;
  const projectRootPath = path.dirname(manifestPath);
  const context = {
    projectRootPath,
    projectRoot: portableRelative(targetRoot, projectRootPath),
    manifestRelative: portableRelative(targetRoot, manifestPath),
    manifestText: manifestInfo.text ?? await readBounded(manifestPath, MAX_MANIFEST_BYTES),
  };

  if (manifestInfo.kind === "dotnet") return inspectDotNetProject(context);
  if (manifestInfo.kind === "rust") {
    return inspectRustProject({
      ...context,
      targetRoot,
      projectRoots,
      sharedFiles,
    });
  }
  if (manifestInfo.kind === "nodejs") {
    return inspectNodeProject({
      ...context,
      targetRoot,
      budget,
      projectRoots,
      sharedFiles,
      includeSourceEvidence: includeSupportingEvidence,
    });
  }
  return inspectFlutterProject({ ...context, budget, includeSupportingEvidence });
}

function isSelectableProject(project) {
  if (isAuxiliaryNativeProject(project)
    || project.internal?.gradleSettings
    || project.internal?.gradleProperties) return project.primary;
  if (project.kind === "typescript") return project.primary;
  if (project.kind === "rust" && !project.rust) return false;
  return project.primary || project.validManifest;
}

async function readLanguageFiles(entries, budget) {
  const languageFiles = entries.map((entry) => ({ ...entry, text: null }));
  for (const languageFile of languageFiles) {
    languageFile.text = await readBounded(languageFile.path, MAX_MANIFEST_BYTES);
    if (budget.exhausted) return null;
  }
  return languageFiles;
}

async function readManifestFiles(entries, budget) {
  const manifests = entries.map((entry) => ({ ...entry, text: null }));
  for (const manifest of manifests) {
    manifest.text = await readBounded(manifest.path, MAX_MANIFEST_BYTES);
    if (budget.exhausted) return null;
  }
  return manifests;
}

async function inspectDiscoveredProjects({
  targetRoot,
  manifests,
  languageFiles,
  sourceFiles,
  projectRoots,
  claims,
  activeConfigRelatives,
  ownershipConfigRelatives,
  sharedFiles,
  budget,
  includeSupportingEvidence = true,
}) {
  const projects = [];
  for (const manifestInfo of manifests) {
    projects.push(await inspectProject(
      manifestInfo,
      targetRoot,
      budget,
      projectRoots,
      sharedFiles,
      includeSupportingEvidence,
    ));
    if (budget.exhausted) return null;
  }
  for (const languageFile of languageFiles) {
    const project = inspectLanguageProject(
      languageFile,
      targetRoot,
      projectRoots,
      sourceFiles,
      languageFiles,
      claims,
      activeConfigRelatives,
      ownershipConfigRelatives,
    );
    if (project) projects.push(project);
    if (budget.exhausted) return null;
  }
  return projects;
}

function isStrictRootAncestor(parent, candidate) {
  return parent !== candidate && (parent === "." ? candidate !== "." : candidate.startsWith(`${parent}/`));
}

function normalizedGradleProjectRoot(aggregatorRoot, include) {
  if (typeof include !== "string" || include.trim() === "") return null;
  const portable = include.trim().replaceAll("\\", "/").replace(/^:/u, "").replaceAll(":", "/");
  if (portable.startsWith("/") || /^[A-Za-z]:\//u.test(portable)) return null;
  const normalized = path.posix.normalize(path.posix.join(aggregatorRoot === "." ? "" : aggregatorRoot, portable));
  if (normalized === ".." || normalized.startsWith("../")) return null;
  return normalized.replace(/^\.\//u, "") || ".";
}

function hasKnownGradleChild(settingsProject, projects) {
  const includes = settingsProject.internal?.includes ?? [];
  const includedRoots = includes
    .map((include) => normalizedGradleProjectRoot(settingsProject.root, include))
    .filter(Boolean)
    .map((root) => root.toLowerCase());
  return projects.some((candidate) => candidate !== settingsProject
    && candidate.internal?.gradleBuild
    && candidate.primary
    && candidate.validManifest
    && (candidate.root.toLowerCase() === settingsProject.root.toLowerCase()
      || includedRoots.includes(candidate.root.toLowerCase())));
}

function isAuxiliaryNativeProject(project) {
  const name = path.posix.basename(project.manifest ?? "").toLowerCase();
  return project.kind === "native" && ["makefile", "gnumakefile", "meson_options.txt"].includes(name);
}

function isConfirmedProjectCandidate(project, projects) {
  if (!project?.root || project.root === "..") return false;
  if (project.internal?.gradleProperties) return false;
  if (project.internal?.gradleSettings) return project.validManifest && hasKnownGradleChild(project, projects);
  if (project.kind === "typescript") return project.primary && project.validManifest;
  if (project.kind === "rust") return Boolean(project.rust);
  if (isAuxiliaryNativeProject(project)) return false;
  if (project.internal?.gradleBuild) return project.primary && project.validManifest;
  if (project.kind === "native") return Boolean(project.internal?.valid);
  if (project.kind === "sql") return Boolean(project.internal?.database);
  return project.validManifest;
}

function nativeSourceExistsUnderRoot(project, sourceFiles, targetRoot, boundaryRoots) {
  return sourceFiles.some((file) => {
    if (!C_SOURCE_EXTENSIONS.has(file.extension) && !CPP_SOURCE_EXTENSIONS.has(file.extension)) return false;
    const relative = portableRelative(targetRoot, file.path).toLowerCase();
    const root = project.root.toLowerCase();
    const underRoot = root === "." || relative === root || relative.startsWith(`${root}/`);
    return underRoot && !projectPathHasNestedBoundary(relative, root, boundaryRoots);
  });
}

function hasConfirmedNativeAncestor(projects, root) {
  return projects.some((ancestor) => {
    const ancestorRoot = ancestor.root?.toLowerCase();
    return ancestorRoot && isStrictRootAncestor(ancestorRoot, root)
      && ancestor.kind === "native"
      && !isAuxiliaryNativeProject(ancestor)
      && ancestor.internal?.valid;
  });
}

function confirmedProjectRoots(projects, sourceFiles, targetRoot) {
  const roots = new Set(projects
    .filter((project) => isConfirmedProjectCandidate(project, projects))
    .map((project) => project.root.toLowerCase()));
  for (const project of projects) {
    if (!isAuxiliaryNativeProject(project) || roots.has(project.root.toLowerCase())) continue;
    if (hasConfirmedNativeAncestor(projects, project.root.toLowerCase())) continue;
    if (nativeSourceExistsUnderRoot(project, sourceFiles, targetRoot, [...roots])) roots.add(project.root.toLowerCase());
  }
  return uniqueSorted([...roots]);
}

function demoteNestedAuxiliaryProjects(projects, projectRoots, sourceFiles, targetRoot) {
  for (const project of projects) {
    if (!isAuxiliaryNativeProject(project)) continue;
    const root = project.root.toLowerCase();
    if (!projectRoots.some((candidate) => isStrictRootAncestor(candidate, root))) continue;
    const independentSource = nativeSourceExistsUnderRoot(project, sourceFiles, targetRoot, projectRoots);
    if (independentSource && !hasConfirmedNativeAncestor(projects, root)) continue;
    project.primary = false;
    project.frameworks = [];
    project.primarySignals = [];
  }
}

async function readSolutionMembership(targetRoot, solutions) {
  const membership = new Map();
  for (const solutionPath of solutions) {
    const solutionRelative = portableRelative(targetRoot, solutionPath).toLowerCase();
    const text = await readBounded(solutionPath, MAX_MANIFEST_BYTES);
    membership.set(
      solutionRelative,
      parseSolutionMembership(text, path.extname(solutionPath).toLowerCase(), solutionPath, targetRoot) ?? [],
    );
  }
  return membership;
}

function projectMatchesClaim(claim, project, { solutionClaims, solutionMembership, projectRoots, projects, sharedFiles, targetRoot }) {
  if (!project.root) return false;
  if (project.kind === "typescript") {
    const knownConfigClaim = isTypeScriptConfigName(path.posix.basename(claim))
      || projects.some((candidate) => candidate.kind === "typescript"
        && candidate.manifest.toLowerCase() === claim);
    if (knownConfigClaim) {
      return path.posix.basename(claim) === "tsconfig.json"
        ? project.manifest.toLowerCase() === claim
        : typeScriptProjectConsumesClaim(claim, project, projects);
    }
  }
  if (solutionClaims.includes(claim)) {
    return project.dotnet && solutionMembership.get(claim).includes(project.manifest.toLowerCase());
  }
  if (isSharedDotNetClaim(claim)) return claimMatchesSharedDotNetFile(claim, project, projectRoots);
  if (isSharedNodeClaim(claim)) return claimMatchesSharedNodeFile(claim, project, projectRoots);
  if (isSharedGradleClaim(claim)) return claimMatchesSharedGradleFile(claim, project, projects);
  if (isRustSharedFile(claim)) {
    return claimMatchesSharedRustFile(claim, project, projects, projectRoots, sharedFiles, targetRoot);
  }
  return claimMatchesProject(claim, project, projectRoots)
    || claimMatchesNodeWorkspaceManifest(claim, project, projects)
    || claimMatchesGradleSettings(claim, project, projects)
    || claimMatchesJavaAggregator(claim, project, projects)
    || claimMatchesRustWorkspaceManifest(claim, project, projects);
}

function selectProjects(projects, claims, hasClaims, solutionMembership, projectRoots, sharedFiles, targetRoot) {
  const selectableProjects = projects.filter(isSelectableProject);
  if (!hasClaims) return selectableProjects;
  const solutionClaims = claims.filter((claim) => solutionMembership.has(claim));
  const context = { solutionClaims, solutionMembership, projectRoots, projects, sharedFiles, targetRoot };
  return selectableProjects.filter((project) => claims.some((claim) => projectMatchesClaim(claim, project, context)));
}

export async function detectProjectEvidence(target, { claims = [], limits = {} } = {}) {
  const targetRoot = path.resolve(target);
  const budget = createTraversalBudget(limits);
  const discovered = await findProjectFiles(targetRoot, budget);
  if (budget.exhausted) return null;
  const projectFiles = [
    ...discovered.manifests,
    ...discovered.languageFiles,
  ];
  const normalizedClaims = uniqueSorted((Array.isArray(claims) ? claims : []).map(normalizeClaim).filter(Boolean));
  const hasClaims = Array.isArray(claims) && claims.length > 0;
  if (projectFiles.length === 0 && discovered.sourceFiles.length === 0 && !hasClaims) return null;
  const languageFiles = await readLanguageFiles(discovered.languageFiles, budget);
  if (!languageFiles) return null;
  const activeConfigRelatives = resolveTypeScriptConfigGraph(languageFiles, normalizedClaims);
  const manifestFiles = await readManifestFiles(discovered.manifests, budget);
  if (!manifestFiles) return null;
  const ownershipConfigRelatives = resolveTypeScriptConfigOwnershipRoots(
    languageFiles,
    activeConfigRelatives,
    normalizedClaims,
  );
  const preliminaryProjects = await inspectDiscoveredProjects({
    targetRoot,
    manifests: manifestFiles,
    languageFiles,
    sourceFiles: [],
    projectRoots: [],
    claims: normalizedClaims,
    activeConfigRelatives,
    ownershipConfigRelatives,
    sharedFiles: discovered.sharedFiles,
    budget,
    includeSupportingEvidence: false,
  });
  if (!preliminaryProjects) return null;
  resolveRustWorkspaceEvidence(preliminaryProjects);
  const projectRoots = confirmedProjectRoots(preliminaryProjects, discovered.sourceFiles, targetRoot);
  const projects = await inspectDiscoveredProjects({
    targetRoot,
    manifests: manifestFiles,
    languageFiles,
    sourceFiles: discovered.sourceFiles,
    projectRoots,
    claims: normalizedClaims,
    activeConfigRelatives,
    ownershipConfigRelatives,
    sharedFiles: discovered.sharedFiles,
    budget,
  });
  if (!projects) return null;
  demoteNestedAuxiliaryProjects(projects, projectRoots, discovered.sourceFiles, targetRoot);
  if (!hasClaims) {
    projects.push(...await addDiscoveredSqlProjects({
      targetRoot,
      sourceFiles: discovered.sourceFiles,
      projects,
      projectRoots,
    }));
  }
  resolveRustWorkspaceEvidence(projects);

  const solutionMembership = await readSolutionMembership(targetRoot, discovered.solutions);
  let selectedProjects = selectProjects(
    projects,
    normalizedClaims,
    hasClaims,
    solutionMembership,
    projectRoots,
    discovered.sharedFiles,
    targetRoot,
  );
  if (hasClaims) {
    const directProjects = await addDirectSourceProjects({
      targetRoot,
      claims: normalizedClaims,
      sourceFiles: discovered.sourceFiles,
      projects,
      projectRoots,
    });
    selectedProjects = [...selectedProjects, ...directProjects];
  }
  if (projects.length === 0 && selectedProjects.length === 0) return null;
  const scope = hasClaims
    ? (selectedProjects.length > 0 ? "MATCH" : "NO_MATCH")
    : "UNSCOPED";
  return {
    schemaVersion: PROJECT_EVIDENCE_SCHEMA_VERSION,
    scope,
    frameworks: uniqueSorted(selectedProjects.flatMap((project) => project.frameworks)),
    projectRoots: uniqueSorted(selectedProjects
      .map((project) => project.virtualWorkspace ? null : project.root)
      .filter(Boolean)),
    primarySignals: uniqueSorted(selectedProjects.flatMap((project) => project.primarySignals)),
    supportingSignals: uniqueSorted(selectedProjects.flatMap((project) => project.supportingSignals)),
  };
}
