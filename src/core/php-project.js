import { createLanguageProject, PHP_SOURCE_EXTENSIONS } from "./multi-language-project.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidComposer() {
  return {
    valid: false,
    name: null,
    type: null,
    autoload: false,
    requirements: [],
  };
}

function hasValidComposerSections(value) {
  const requirementFields = ["require", "require-dev", "replace", "provide", "conflict"];
  if (requirementFields.some((field) => value[field] !== undefined && !isPlainObject(value[field]))) return false;
  const autoload = value.autoload === undefined || isPlainObject(value.autoload);
  const autoloadDev = value["autoload-dev"] === undefined || isPlainObject(value["autoload-dev"]);
  return autoload && autoloadDev;
}

function composerStringField(value, field) {
  if (value[field] === undefined) return null;
  return typeof value[field] === "string" && value[field].trim() !== "" ? value[field] : undefined;
}

function hasComposerIdentity(value) {
  return value.name !== undefined
    || value.require !== undefined
    || value.autoload !== undefined
    || value["autoload-dev"] !== undefined;
}

function parseComposerValue(value) {
  if (!isPlainObject(value) || !hasValidComposerSections(value)) return invalidComposer();
  const name = composerStringField(value, "name");
  const type = composerStringField(value, "type");
  if (name === undefined || type === undefined || !hasComposerIdentity(value)) return invalidComposer();
  const hasPhpIdentity = name !== null || value.require !== undefined || value.autoload !== undefined || value["autoload-dev"] !== undefined;
  if (!hasPhpIdentity) return invalidComposer();
  return {
    valid: true,
    name,
    type,
    autoload: value.autoload !== undefined || value["autoload-dev"] !== undefined,
    requirements: Object.keys(value.require ?? {}).sort((left, right) => left.localeCompare(right)),
  };
}

export function parseComposerJson(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return invalidComposer();
  try {
    return parseComposerValue(JSON.parse(text));
  } catch {
    return invalidComposer();
  }
}

export function phpSourceLooksExecutable(text) {
  return typeof text === "string" && /<\?php(?:\s|$)/iu.test(text);
}

export function inspectPhpProject({ projectRoot, manifestRelative, manifestText }) {
  const parsed = parseComposerJson(manifestText);
  const primary = parsed.valid;
  const primarySignals = primary ? [`${manifestRelative}:composer`] : [];
  const supportingSignals = [];
  if (parsed.name) supportingSignals.push(`${manifestRelative}:name=${parsed.name}`);
  if (parsed.type) supportingSignals.push(`${manifestRelative}:type=${parsed.type}`);
  if (parsed.autoload) supportingSignals.push(`${manifestRelative}:autoload`);
  for (const requirement of parsed.requirements) supportingSignals.push(`${manifestRelative}:require=${requirement}`);
  return createLanguageProject({
    kind: "php",
    root: projectRoot,
    manifest: manifestRelative,
    frameworks: primary ? ["php"] : [],
    primary,
    primarySignals,
    supportingSignals,
    internal: { ...parsed, phpSourceExtensions: [...PHP_SOURCE_EXTENSIONS] },
  });
}
