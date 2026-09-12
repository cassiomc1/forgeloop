import path from "node:path";

import { createLanguageProject } from "./multi-language-project.js";

const TS_CONFIG_NAME = /^tsconfig(?:\.[^/]+)?\.json$/u;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidConfig() {
  return {
    valid: false,
    references: [],
    extends: null,
    compilerOptions: {},
  };
}

function maskJsonComments(text) {
  let result = "";
  let state = "code";
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (state === "string") {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') state = "code";
    } else if (state === "line-comment") {
      if (character === "\n") {
        result += character;
        state = "code";
      } else result += " ";
    } else if (state === "block-comment") {
      if (character === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else result += character === "\n" ? "\n" : " ";
    } else if (character === '"') {
      result += character;
      state = "string";
    } else if (character === "/" && next === "/") {
      result += "  ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      result += "  ";
      index += 1;
      state = "block-comment";
    } else result += character;
  }
  return state === "block-comment" ? null : result;
}

function removeTrailingCommas(text) {
  let result = "";
  let state = "code";
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (state === "string") {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') state = "code";
      continue;
    }
    if (character === '"') {
      result += character;
      state = "string";
    } else if (character === "," && /^[\s]*[}\]]/u.test(text.slice(index + 1))) {
      continue;
    } else result += character;
  }
  return result;
}

export function isTypeScriptConfigName(fileName) {
  return typeof fileName === "string" && TS_CONFIG_NAME.test(fileName.toLowerCase());
}

function normalizedReferencePath(projectRoot, reference) {
  return path.posix.normalize(path.posix.join(projectRoot, reference.replaceAll("\\", "/")));
}

function referenceMatchesConfig(projectRoot, reference, configRelative) {
  const candidate = normalizedReferencePath(projectRoot, reference);
  return configRelative === candidate
    || configRelative === candidate + ".json"
    || configRelative === candidate + "/tsconfig.json";
}

function localConfigReferences(configRelative, projectFiles) {
  return projectFiles.filter((file) => file.kind === "typescript"
    && parseTypeScriptConfig(file.text, file.name).valid
    && parseTypeScriptConfig(file.text, file.name).references
      .some((reference) => referenceMatchesConfig(path.posix.dirname(file.relative), reference, configRelative)));
}

export function shouldActivateTypeScriptConfig({ manifestName, manifestRelative, projectFiles = [], directClaim = false }) {
  if (!isTypeScriptConfigName(manifestName)) return false;
  if (manifestName.toLowerCase() === "tsconfig.json" || directClaim) return true;
  return localConfigReferences(manifestRelative, projectFiles).length > 0;
}

export function parseJsonc(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return null;
  try {
    return JSON.parse(removeTrailingCommas(maskJsonComments(text)));
  } catch {
    return null;
  }
}

export function parseTypeScriptConfig(text, fileName = "tsconfig.json") {
  const value = parseJsonc(text);
  if (!isPlainObject(value)) return invalidConfig();
  const references = value.references === undefined
    ? []
    : Array.isArray(value.references) && value.references.every((reference) => isPlainObject(reference) && typeof reference.path === "string" && reference.path.trim() !== "")
      ? value.references.map((reference) => reference.path)
      : null;
  const extendsValue = value.extends === undefined
    ? null
    : typeof value.extends === "string" && value.extends.trim() !== "" ? value.extends : undefined;
  const compilerOptions = value.compilerOptions === undefined
    ? {}
    : isPlainObject(value.compilerOptions) ? value.compilerOptions : null;
  if (references === null || extendsValue === undefined || compilerOptions === null) return invalidConfig();
  return {
    valid: true,
    references,
    extends: extendsValue,
    compilerOptions,
    fileName,
  };
}

export function inspectTypeScriptProject({
  projectRoot,
  manifestRelative,
  manifestText,
  manifestName,
  targetRoot,
  projectFiles,
  directClaim = false,
}) {
  const parsed = parseTypeScriptConfig(manifestText, manifestName);
  const isConfig = shouldActivateTypeScriptConfig({ manifestName, manifestRelative, projectFiles, directClaim });
  const primary = parsed.valid && isConfig;
  const primarySignals = primary ? [`${manifestRelative}:tsconfig`] : [];
  const supportingSignals = [];
  for (const reference of parsed.references) supportingSignals.push(`${manifestRelative}:reference=${reference}`);
  if (parsed.extends) supportingSignals.push(`${manifestRelative}:extends=${parsed.extends}`);
  const localReferences = parsed.references.filter((reference) => {
    return projectFiles.some((file) => referenceMatchesConfig(
      projectRoot,
      reference,
      path.posix.normalize(file.relative ?? ""),
    ));
  });
  for (const reference of localReferences) supportingSignals.push(`${manifestRelative}:local-reference=${reference}`);
  return createLanguageProject({
    kind: "typescript",
    root: projectRoot,
    manifest: manifestRelative,
    frameworks: primary ? ["typescript"] : [],
    primary,
    primarySignals,
    supportingSignals,
    internal: { ...parsed, valid: parsed.valid, localReferences },
  });
}

export function isDeclarationFile(fileName) {
  return typeof fileName === "string" && /\.d\.(?:ts|mts|cts)$/iu.test(fileName);
}
