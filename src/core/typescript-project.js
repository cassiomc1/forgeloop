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
    extends: [],
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

function referenceMatchesConfig(projectRoot, reference, configRelative, allowBareReference = false) {
  if (typeof reference !== "string" || reference.trim() === "") return false;
  const normalizedReference = reference.replaceAll("\\", "/");
  if ((!allowBareReference && !normalizedReference.startsWith("."))
    || normalizedReference.startsWith("/")
    || /^[A-Za-z]:\//u.test(normalizedReference)) return false;
  const candidate = normalizedReferencePath(projectRoot, normalizedReference);
  if (candidate === ".." || candidate.startsWith("../")) return false;
  const normalizedConfig = configRelative.toLowerCase();
  const normalizedCandidate = candidate.toLowerCase();
  return normalizedConfig === normalizedCandidate
    || normalizedConfig === normalizedCandidate + ".json"
    || normalizedConfig === normalizedCandidate + "/tsconfig.json";
}

function isConfigCandidate(file) {
  return file?.kind === "typescript" || file?.kind === "typescript-config";
}

function localConfigReferences(configRelative, projectFiles) {
  return projectFiles.filter((file) => {
    if (!isConfigCandidate(file)) return false;
    const parsed = parseTypeScriptConfig(file.text, file.name);
    return parsed.valid && (parsed.references
      .some((reference) => referenceMatchesConfig(path.posix.dirname(file.relative), reference, configRelative, true))
      || parsed.extends.some((reference) => referenceMatchesConfig(
        path.posix.dirname(file.relative),
        reference,
        configRelative,
      )));
  });
}

function configRelationships(projectFiles) {
  const entries = projectFiles
    .filter(isConfigCandidate)
    .map((file) => ({ file, parsed: parseTypeScriptConfig(file.text, file.name) }))
    .filter(({ parsed }) => parsed.valid);
  const forward = new Map();
  const reverse = new Map();
  for (const { file, parsed } of entries) {
    const relations = [
      ...parsed.references.map((value) => ({ value, kind: "reference", allowBare: true })),
      ...parsed.extends.map((value) => ({ value, kind: "extends", allowBare: false })),
    ];
    for (const relation of relations) {
      const target = entries.find(({ file: candidate }) => referenceMatchesConfig(
        path.posix.dirname(file.relative), relation.value, candidate.relative, relation.allowBare,
      ));
      if (!target) continue;
      const sourceRelative = file.relative.toLowerCase();
      const targetRelative = target.file.relative.toLowerCase();
      if (!forward.has(sourceRelative)) forward.set(sourceRelative, []);
      if (!reverse.has(targetRelative)) reverse.set(targetRelative, []);
      forward.get(sourceRelative).push({ relative: targetRelative, kind: relation.kind });
      reverse.get(targetRelative).push({ relative: sourceRelative, kind: relation.kind });
    }
  }
  return { entries, forward, reverse };
}

export function resolveTypeScriptConfigGraph(projectFiles = [], directClaims = []) {
  const { entries, forward, reverse } = configRelationships(projectFiles);
  const byRelative = new Map(entries.map((entry) => [entry.file.relative.toLowerCase(), entry]));
  const active = new Set(entries
    .filter(({ file }) => file.name.toLowerCase() === "tsconfig.json")
    .map(({ file }) => file.relative.toLowerCase()));
  for (const claim of directClaims) {
    if (byRelative.has(claim.toLowerCase())) active.add(claim.toLowerCase());
  }

  const queue = [...active];
  for (let index = 0; index < queue.length; index += 1) {
    const current = byRelative.get(queue[index]);
    const parsed = current?.parsed;
    if (!parsed) continue;
    for (const relation of forward.get(queue[index]) ?? []) {
      if (!active.has(relation.relative)) {
        active.add(relation.relative);
        queue.push(relation.relative);
      }
    }
    if (directClaims.length > 0) {
      for (const relation of reverse.get(queue[index]) ?? []) {
        if (!active.has(relation.relative)) {
          active.add(relation.relative);
          queue.push(relation.relative);
        }
      }
    }
  }
  return active;
}

export function resolveTypeScriptConfigOwnershipRoots(projectFiles = [], activeConfigRelatives = new Set(), directClaims = []) {
  const { entries, reverse } = configRelationships(projectFiles);
  const candidates = entries.filter(({ file }) => activeConfigRelatives.has(file.relative.toLowerCase()));
  const roots = new Set(candidates
    .filter(({ file }) => file.name.toLowerCase() === "tsconfig.json")
    .map(({ file }) => file.relative.toLowerCase()));
  for (const claim of directClaims) {
    const relative = claim.toLowerCase();
    const consumers = (reverse.get(relative) ?? [])
      .filter((relation) => relation.kind === "extends")
      .map((relation) => relation.relative);
    if (consumers.length === 0 && candidates.some(({ file }) => file.relative.toLowerCase() === relative)) {
      roots.add(relative);
    }
    const queue = [...consumers];
    const seen = new Set(queue);
    for (let index = 0; index < queue.length; index += 1) {
      roots.add(queue[index]);
      for (const relation of reverse.get(queue[index]) ?? []) {
        if (relation.kind === "extends" && !seen.has(relation.relative)) {
          seen.add(relation.relative);
          queue.push(relation.relative);
        }
      }
    }
  }
  for (const { file, parsed } of candidates) {
    for (const reference of parsed.references) {
      const target = candidates.find(({ file: candidate }) => referenceMatchesConfig(
        path.posix.dirname(file.relative),
        reference,
        candidate.relative,
        true,
      ));
      if (target) roots.add(target.file.relative.toLowerCase());
    }
  }
  return roots;
}

export function shouldActivateTypeScriptConfig({
  manifestName,
  manifestRelative,
  projectFiles = [],
  directClaim = false,
  configKind = "typescript",
  activeConfigRelatives = null,
  ownershipConfigRelatives = null,
}) {
  if (!isConfigCandidate({ kind: configKind }) || manifestName.toLowerCase() === "jsconfig.json") return false;
  if (activeConfigRelatives) {
    return activeConfigRelatives.has(manifestRelative.toLowerCase())
      && (!ownershipConfigRelatives || ownershipConfigRelatives.has(manifestRelative.toLowerCase()));
  }
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
    ? []
    : typeof value.extends === "string" && value.extends.trim() !== ""
      ? [value.extends]
      : Array.isArray(value.extends) && value.extends.every((reference) => typeof reference === "string" && reference.trim() !== "")
        ? [...value.extends]
        : undefined;
  const compilerOptions = value.compilerOptions === undefined
    ? {}
    : isPlainObject(value.compilerOptions) ? value.compilerOptions : null;
  if (references === null || extendsValue === undefined || compilerOptions === null) return invalidConfig();
  for (const key of ["files", "include", "exclude"]) {
    if (value[key] !== undefined && (!Array.isArray(value[key])
      || value[key].some((entry) => typeof entry !== "string" || entry.trim() === ""))) return invalidConfig();
  }
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
  configKind = "typescript",
  activeConfigRelatives = null,
  ownershipConfigRelatives = null,
}) {
  const parsed = parseTypeScriptConfig(manifestText, manifestName);
  const isConfig = shouldActivateTypeScriptConfig({
    manifestName,
    manifestRelative,
    projectFiles,
    directClaim,
    configKind,
    activeConfigRelatives,
    ownershipConfigRelatives,
  });
  const primary = parsed.valid && isConfig;
  const primarySignals = primary ? [`${manifestRelative}:tsconfig`] : [];
  const supportingSignals = [];
  for (const reference of parsed.references) supportingSignals.push(`${manifestRelative}:reference=${reference}`);
  for (const reference of parsed.extends) supportingSignals.push(`${manifestRelative}:extends=${reference}`);
  const localReferences = parsed.references.filter((reference) => {
    return projectFiles.some((file) => referenceMatchesConfig(
      projectRoot,
      reference,
      path.posix.normalize(file.relative ?? ""),
      true,
    ));
  });
  const localExtends = parsed.extends.flatMap((reference) => projectFiles
    .filter((file) => referenceMatchesConfig(path.posix.dirname(manifestRelative), reference, file.relative))
    .map((file) => file.relative.toLowerCase()));
  for (const reference of localReferences) supportingSignals.push(`${manifestRelative}:local-reference=${reference}`);
  for (const reference of parsed.extends) {
    if (projectFiles.some((file) => referenceMatchesConfig(
      path.posix.dirname(manifestRelative),
      reference,
      file.relative,
    ))) supportingSignals.push(`${manifestRelative}:local-extends=${reference}`);
  }
  return createLanguageProject({
    kind: "typescript",
    root: projectRoot,
    manifest: manifestRelative,
    frameworks: primary ? ["typescript"] : [],
    primary,
    primarySignals,
    supportingSignals,
    internal: { ...parsed, valid: parsed.valid, localReferences, localExtends },
  });
}

export function isDeclarationFile(fileName) {
  return typeof fileName === "string" && /\.d\.(?:ts|mts|cts)$/iu.test(fileName);
}
