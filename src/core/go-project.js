import path from "node:path";

import { createLanguageProject, portablePath } from "./multi-language-project.js";

const GO_DIRECTIVE = /^(module|go|toolchain|godebug|require|replace|exclude|retract|tool|ignore)\b/u;
const GO_WORK_DIRECTIVES = new Set(["go", "toolchain", "godebug", "use", "replace", "tool"]);

function invalidGoResult() {
  return {
    valid: false,
    module: null,
    goVersion: null,
    toolchain: null,
    uses: [],
    localReplacements: [],
    ignorePaths: [],
  };
}

function stripGoComment(line) {
  const index = line.indexOf("//");
  return (index < 0 ? line : line.slice(0, index)).trim();
}

function parseGoDirective(line) {
  const block = line.match(/^(module|go|toolchain|godebug|require|replace|exclude|retract|use|tool|ignore)\b\s*\(\s*$/u);
  const match = line.match(/^(module|go|toolchain|godebug|require|replace|exclude|retract|use|tool|ignore)\b\s*(?:\(([^)]*)\)|(.+))$/u);
  if (block) return { name: block[1], value: "" };
  if (!match) return null;
  return {
    name: match[1],
    value: (match[2] ?? match[3] ?? "").trim(),
  };
}

function collectGoBlock(lines, start) {
  const values = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = stripGoComment(lines[index]);
    if (line === ")") return { values, end: index, valid: true };
    if (line !== "") values.push(line);
  }
  return { values, end: lines.length, valid: false };
}

function validGoDirectiveValue(name, value) {
  if (!value || /\s{2,}/u.test(value)) return false;
  if (name === "ignore") {
    const portable = value.replaceAll("\\", "/");
    const segments = portable.split("/");
    return !value.includes("\\")
      && !portable.startsWith("/")
      && !/^[A-Za-z]:\//u.test(portable)
      && !segments.includes("..")
      && !value.includes("=>");
  }
  if (["require", "exclude"].includes(name)) return /^\S+\s+v\S+$/u.test(value);
  if (name === "replace") return /^\S+(?:\s+v\S+)?\s+=>\s+\S+(?:\s+v\S+)?$/u.test(value);
  if (name === "retract") return /^\S+(?:\s*,\s*\S+)?$/u.test(value);
  if (name === "godebug") return /^\S+=\S+$/u.test(value);
  if (name === "tool") return /^\S+(?:\s+v\S+)?$/u.test(value);
  return true;
}

function parseGoModMetadataDirective(state, directive) {
  if (directive.name === "module") {
    if (state.module !== null || directive.value === "" || /\s/u.test(directive.value)) return false;
    state.module = directive.value;
    return true;
  }
  if (directive.name === "go") {
    if (state.goVersion !== null || !/^\d+(?:\.\d+){1,2}$/u.test(directive.value)) return false;
    state.goVersion = directive.value;
    return true;
  }
  if (directive.name === "toolchain") {
    if (state.toolchain !== null || !/^\S+$/u.test(directive.value)) return false;
    state.toolchain = directive.value;
    return true;
  }
  return null;
}

function parseGoModBlockDirective(lines, index, directive) {
  const block = collectGoBlock(lines, index);
  const valid = block.valid && block.values.every((value) => validGoDirectiveValue(directive.name, value));
  return {
    valid,
    end: block.end,
    ignorePaths: valid && directive.name === "ignore" ? block.values : [],
  };
}

function parseGoModLine(lines, index, state) {
  const line = stripGoComment(lines[index]);
  if (line === "" || line.startsWith("//")) return { valid: true, end: index, ignorePaths: [] };
  const directive = parseGoDirective(line);
  if (!directive || !GO_DIRECTIVE.test(line)) return { valid: false, end: index, ignorePaths: [] };
  const metadataValid = parseGoModMetadataDirective(state, directive);
  if (metadataValid !== null) return { valid: metadataValid, end: index, ignorePaths: [] };
  if (line.endsWith("(")) return parseGoModBlockDirective(lines, index, directive);
  const valid = validGoDirectiveValue(directive.name, directive.value);
  return {
    valid,
    end: index,
    ignorePaths: valid && directive.name === "ignore" ? [directive.value] : [],
  };
}

export function parseGoMod(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return invalidGoResult();
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const state = { module: null, goVersion: null, toolchain: null, valid: true };
  const ignorePaths = [];
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseGoModLine(lines, index, state);
    state.valid &&= parsed.valid;
    ignorePaths.push(...parsed.ignorePaths);
    index = parsed.end;
  }
  return {
    valid: state.valid && state.module !== null,
    module: state.module,
    goVersion: state.goVersion,
    toolchain: state.toolchain,
    uses: [],
    localReplacements: [],
    ignorePaths: [...new Set(ignorePaths)],
  };
}

export function parseGoWork(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) {
    return { valid: false, goVersion: null, uses: [] };
  }
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  let goVersion = null;
  const uses = [];
  let valid = true;
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripGoComment(lines[index]);
    if (line === "") continue;
    const directive = parseGoDirective(line);
    if (!directive) {
      valid = false;
      continue;
    }
    if (directive.name === "go") {
      if (goVersion !== null || !/^\d+(?:\.\d+){1,2}$/u.test(directive.value)) valid = false;
      else goVersion = directive.value;
      continue;
    }
    if (directive.name === "toolchain") {
      if (!/^\S+$/u.test(directive.value)) valid = false;
      continue;
    }
    if (!GO_WORK_DIRECTIVES.has(directive.name)) {
      valid = false;
      continue;
    }
    if (directive.name !== "use") {
      if (line.endsWith("(")) {
        const block = collectGoBlock(lines, index);
        if (!block.valid || !block.values.every((value) => validGoDirectiveValue(directive.name, value))) valid = false;
        index = block.end;
      }
      continue;
    }
    const values = line.endsWith("(") ? collectGoBlock(lines, index) : { values: [directive.value], end: index, valid: true };
    if (!values.valid || values.values.some((value) => !validGoDirectiveValue("use", value)
      || value.startsWith("/") || /^[A-Za-z]:/u.test(value))) {
      valid = false;
    } else {
      uses.push(...values.values);
    }
    index = values.end;
  }
  return { valid: valid && goVersion !== null && uses.length > 0, goVersion, uses: [...new Set(uses)] };
}

export function inspectGoProject({ projectRoot, manifestRelative, manifestText, manifestName, targetRoot, projectFiles }) {
  const parsed = manifestName === "go.work" ? parseGoWork(manifestText) : parseGoMod(manifestText);
  const localUses = manifestName === "go.work"
    ? parsed.uses.filter((use) => projectFiles.some((file) => file.kind === "go"
      && parseGoMod(file.text).valid
      && portablePath(targetRoot, path.dirname(file.path)) === path.posix.normalize(path.posix.join(projectRoot, use))))
    : [];
  const primary = parsed.valid && (manifestName === "go.mod" || localUses.length > 0);
  const primarySignals = primary
    ? [manifestName === "go.mod" ? `${manifestRelative}:module` : `${manifestRelative}:workspace`]
    : [];
  const supportingSignals = [];
  if (parsed.goVersion) supportingSignals.push(`${manifestRelative}:go=${parsed.goVersion}`);
  if (parsed.toolchain) supportingSignals.push(`${manifestRelative}:toolchain=${parsed.toolchain}`);
  for (const use of localUses) supportingSignals.push(`${manifestRelative}:use=${use}`);
  return createLanguageProject({
    kind: "go",
    root: projectRoot,
    manifest: manifestRelative,
    frameworks: primary ? ["go"] : [],
    primary,
    primarySignals,
    supportingSignals,
    internal: { ...parsed, valid: parsed.valid, manifestName, localUses },
  });
}
