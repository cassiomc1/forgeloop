import path from "node:path";

import { parse as parseToml } from "smol-toml";

export const CARGO_MANIFEST_MAX_BYTES = 1024 * 1024;

export const RUST_SHARED_FILES = Object.freeze([
  "Cargo.lock",
  "rust-toolchain.toml",
  "rust-toolchain",
  "rustfmt.toml",
  ".rustfmt.toml",
  "clippy.toml",
  ".clippy.toml",
]);

const RUST_BACKEND_CONTEXTS = new Set([
  "actix-web",
  "axum",
  "hyper",
  "poem",
  "rocket",
  "tokio",
  "tonic",
  "tower",
  "warp",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}

function invalidCargoManifest() {
  return {
    valid: false,
    rust: false,
    package: { present: false, name: null, edition: null, rustVersion: null },
    workspace: { present: false, members: [], exclude: [], defaultMembers: [], resolver: null },
    dependencies: [],
    workspaceDependencies: [],
    devDependencies: [],
    buildDependencies: [],
    targetDependencies: [],
    features: [],
    backendContexts: [],
  };
}

function optionalString(object, key) {
  if (object[key] === undefined) return null;
  return typeof object[key] === "string" && object[key].trim() !== "" ? object[key] : undefined;
}

function optionalStringArray(object, key) {
  if (object[key] === undefined) return [];
  if (!Array.isArray(object[key]) || object[key].some((value) => typeof value !== "string" || value.trim() === "")) {
    return null;
  }
  return [...object[key]];
}

function dependencyNamesFromTable(value) {
  if (value === undefined) return [];
  if (!isPlainObject(value)) return null;
  return Object.keys(value);
}

function dependencyNamesFromTargets(value) {
  if (value === undefined) return [];
  if (!isPlainObject(value)) return null;
  const names = [];
  for (const target of Object.values(value)) {
    if (!isPlainObject(target)) return null;
    for (const section of ["dependencies", "dev-dependencies", "build-dependencies"]) {
      const dependencies = dependencyNamesFromTable(target[section]);
      if (dependencies === null) return null;
      names.push(...dependencies);
    }
  }
  return uniqueSorted(names);
}

function parseCargoSections(document) {
  const dependencies = dependencyNamesFromTable(document.dependencies);
  const workspaceDependencies = dependencyNamesFromTable(document.workspace?.dependencies);
  const devDependencies = dependencyNamesFromTable(document["dev-dependencies"]);
  const buildDependencies = dependencyNamesFromTable(document["build-dependencies"]);
  const targetDependencies = dependencyNamesFromTargets(document.target);
  const features = document.features === undefined
    ? []
    : isPlainObject(document.features) ? Object.keys(document.features) : null;
  if ([dependencies, workspaceDependencies, devDependencies, buildDependencies, targetDependencies, features]
    .some((value) => value === null)) return null;
  return {
    dependencies: uniqueSorted(dependencies),
    workspaceDependencies: uniqueSorted(workspaceDependencies),
    devDependencies: uniqueSorted(devDependencies),
    buildDependencies: uniqueSorted(buildDependencies),
    targetDependencies,
    features: uniqueSorted(features),
  };
}

function parseCargoPackage(document) {
  if (document.package === undefined) {
    return { present: false, name: null, edition: null, rustVersion: null };
  }
  if (!isPlainObject(document.package)) return null;
  const name = optionalString(document.package, "name");
  const edition = optionalString(document.package, "edition");
  const rustVersion = optionalString(document.package, "rust-version");
  if (name === undefined || name === null || edition === undefined || rustVersion === undefined) return null;
  return { present: true, name, edition, rustVersion };
}

function parseCargoWorkspace(document) {
  if (document.workspace === undefined) {
    return { present: false, members: [], exclude: [], defaultMembers: [], resolver: null };
  }
  if (!isPlainObject(document.workspace)) return null;
  const members = optionalStringArray(document.workspace, "members");
  const exclude = optionalStringArray(document.workspace, "exclude");
  const defaultMembers = optionalStringArray(document.workspace, "default-members");
  const resolver = optionalString(document.workspace, "resolver");
  if (members === null || exclude === null || defaultMembers === null || resolver === undefined) return null;
  if (document.workspace.dependencies !== undefined && !isPlainObject(document.workspace.dependencies)) return null;
  return { present: true, members, exclude, defaultMembers, resolver };
}

export function parseCargoManifest(text) {
  const invalid = invalidCargoManifest();
  if (typeof text !== "string" || text.length > CARGO_MANIFEST_MAX_BYTES || /\r(?!\n)/u.test(text)) return invalid;

  let document;
  try {
    document = parseToml(text);
  } catch {
    return invalid;
  }
  if (!isPlainObject(document)) return invalid;

  const packageMetadata = parseCargoPackage(document);
  const workspaceMetadata = parseCargoWorkspace(document);
  const sections = parseCargoSections(document);
  if (!packageMetadata || !workspaceMetadata || !sections
    || (!packageMetadata.present && !workspaceMetadata.present)) return invalid;

  const allDependencies = [
    ...sections.dependencies,
    ...sections.workspaceDependencies,
    ...sections.devDependencies,
    ...sections.buildDependencies,
    ...sections.targetDependencies,
  ];
  return {
    valid: true,
    rust: true,
    package: packageMetadata,
    workspace: workspaceMetadata,
    ...sections,
    backendContexts: uniqueSorted(allDependencies.filter((name) => RUST_BACKEND_CONTEXTS.has(name))),
  };
}

function normalizedRelativePath(root, candidate) {
  if (typeof root !== "string" || typeof candidate !== "string") return null;
  if (root === candidate) return ".";
  if (root === ".") return candidate.startsWith("./") ? candidate.slice(2) : candidate;
  if (!candidate.startsWith(`${root}/`)) return null;
  return candidate.slice(root.length + 1);
}

function normalizedCargoPattern(pattern) {
  if (typeof pattern !== "string" || pattern.trim() === "") return null;
  const portable = pattern.trim().replaceAll("\\", "/");
  if (portable.startsWith("/") || /^[A-Za-z]:\//u.test(portable)) return null;
  const normalized = path.posix.normalize(portable).replace(/^\.\//u, "");
  if (normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}

function cargoPatternRegex(pattern) {
  const normalized = normalizedCargoPattern(pattern);
  if (!normalized) return null;
  let expression = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*" && normalized[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, "u");
}

function cargoPatternMatches(patterns, relativePath) {
  return patterns.some((pattern) => cargoPatternRegex(pattern)?.test(relativePath));
}

function isDescendant(root, candidate) {
  return root !== candidate && candidate.startsWith(`${root}/`);
}

function hasNestedWorkspaceBetween(workspaceProject, candidateProject, projects) {
  return projects.some((project) => project !== workspaceProject
    && project !== candidateProject
    && project.kind === "rust"
    && project.workspaceRoot
    && isDescendant(workspaceProject.root, project.root)
    && (project.root === candidateProject.root || isDescendant(project.root, candidateProject.root)));
}

export function cargoWorkspaceContains(workspaceProject, candidateProject, projects = []) {
  if (!workspaceProject?.rust || !workspaceProject.workspaceRoot
    || !candidateProject?.rust || !candidateProject.packageRoot) return false;
  if (workspaceProject.root === candidateProject.root) return true;
  const relative = normalizedRelativePath(workspaceProject.root, candidateProject.root);
  if (!relative || hasNestedWorkspaceBetween(workspaceProject, candidateProject, projects)) return false;
  const workspace = workspaceProject.internal.workspace;
  if (workspace.exclude.some((pattern) => cargoPatternMatches([pattern], relative))) return false;
  return cargoPatternMatches(workspace.members, relative);
}

export function isRustSharedFile(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const fileName = path.posix.basename(normalized).toLowerCase();
  if (RUST_SHARED_FILES.some((name) => name.toLowerCase() === fileName)) return true;
  const parent = path.posix.basename(path.posix.dirname(normalized)).toLowerCase();
  return parent === ".cargo" && ["config", "config.toml"].includes(fileName);
}

export function rustSharedScopeDirectory(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const parent = path.posix.dirname(normalized);
  if (path.posix.basename(parent).toLowerCase() === ".cargo") return path.posix.dirname(parent) || ".";
  return parent || ".";
}

export function rustSharedFileKind(relativePath) {
  if (!isRustSharedFile(relativePath)) return null;
  return path.posix.basename(relativePath).toLowerCase() === "cargo.lock" ? "lockfile" : "configuration";
}
