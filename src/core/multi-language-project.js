import path from "node:path";

export const LANGUAGE_PROJECT_FILE_KINDS = Object.freeze({
  "go.mod": ["go"],
  "go.work": ["go-work"],
  "tsconfig.json": ["typescript"],
  "jsconfig.json": ["javascript-config"],
  "composer.json": ["php"],
  "pom.xml": ["java-maven"],
  "build.gradle": ["java-gradle"],
  "build.gradle.kts": ["java-gradle"],
  "settings.gradle": ["java-gradle-settings"],
  "settings.gradle.kts": ["java-gradle-settings"],
  "gradle.properties": ["java-gradle-properties"],
  "build": ["java-bazel", "native-bazel"],
  "build.bazel": ["java-bazel", "native-bazel"],
  "cmakelists.txt": ["c-cpp-cmake", "swift-cmake"],
  "meson.build": ["c-cpp-meson", "swift-meson"],
  "meson_options.txt": ["c-cpp-meson-options"],
  "makefile": ["c-cpp-make"],
  "gnumakefile": ["c-cpp-make"],
  "package.swift": ["swift-package"],
  "project.pbxproj": ["swift-xcode"],
});

export const LANGUAGE_SOURCE_EXTENSIONS = Object.freeze(new Set([
  ".c", ".cc", ".cpp", ".cxx", ".c++",
  ".go", ".java", ".php", ".sql", ".psql", ".pgsql", ".swift",
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
]));

export const SQL_SOURCE_EXTENSIONS = Object.freeze(new Set([".sql", ".psql", ".pgsql"]));
export const C_SOURCE_EXTENSIONS = Object.freeze(new Set([".c"]));
export const CPP_SOURCE_EXTENSIONS = Object.freeze(new Set([".cc", ".cpp", ".cxx", ".c++", ".C"]));
export const JAVA_SOURCE_EXTENSIONS = Object.freeze(new Set([".java"]));
export const PHP_SOURCE_EXTENSIONS = Object.freeze(new Set([".php", ".phtml", ".php3", ".php4", ".php5", ".php7", ".phps"]));
export const SWIFT_SOURCE_EXTENSIONS = Object.freeze(new Set([".swift"]));

export function languageProjectKinds(fileName) {
  if (typeof fileName !== "string") return [];
  const lowerName = fileName.toLowerCase();
  if (/^tsconfig\.[^/]+\.json$/u.test(lowerName)) return ["typescript"];
  if (/\.sqlproj$/u.test(lowerName)) return ["sql-project"];
  return LANGUAGE_PROJECT_FILE_KINDS[lowerName] ?? [];
}

export function languageSourceExtension(fileName) {
  if (typeof fileName !== "string") return null;
  const extension = path.extname(fileName);
  const normalized = extension === ".C" ? ".C" : extension.toLowerCase();
  return LANGUAGE_SOURCE_EXTENSIONS.has(normalized.toLowerCase()) ? normalized : null;
}

export function portablePath(root, absolutePath) {
  const relative = path.relative(root, absolutePath).split(path.sep).join("/");
  return relative === "" ? "." : relative;
}

export function relativeProjectRoots(targetRoot, projectFiles = []) {
  return [...new Set(projectFiles
    .map((entry) => portablePath(targetRoot, path.dirname(entry.path)))
    .filter((root) => root !== ".." && !root.startsWith("../")))].sort((left, right) => left.localeCompare(right));
}

export function pathBelongsToRoot(relativePath, root, projectRoots = []) {
  const normalizedPath = relativePath.replaceAll("\\", "/").toLowerCase();
  const normalizedRoot = root.replaceAll("\\", "/").toLowerCase();
  if (normalizedRoot !== "."
    && normalizedPath !== normalizedRoot
    && !normalizedPath.startsWith(`${normalizedRoot}/`)) return false;
  return !projectRoots.some((candidate) => {
    const normalizedCandidate = candidate.replaceAll("\\", "/").toLowerCase();
    const nested = normalizedRoot === "."
      ? normalizedCandidate !== "."
      : normalizedCandidate.startsWith(`${normalizedRoot}/`);
    return nested
      && (normalizedPath === normalizedCandidate || normalizedPath.startsWith(`${normalizedCandidate}/`));
  });
}

export function sourceFilesUnderRoot(sourceFiles, targetRoot, root, extensions, projectRoots = []) {
  return sourceFiles.filter((file) => {
    if (!extensions.has(languageSourceExtension(file.name))) return false;
    return pathBelongsToRoot(portablePath(targetRoot, file.path), root, projectRoots);
  });
}

export function createLanguageProject({
  kind,
  root,
  manifest,
  frameworks = [],
  primary = false,
  primarySignals = [],
  supportingSignals = [],
  internal = null,
}) {
  return {
    kind,
    root,
    manifest,
    validManifest: Boolean(internal?.valid ?? primary),
    primary,
    frameworks: [...new Set(frameworks)].sort((left, right) => left.localeCompare(right)),
    primarySignals: [...primarySignals],
    supportingSignals: [...supportingSignals],
    internal,
  };
}

export function isDirectSourceClaim(claim, extensions) {
  return extensions.has(path.extname(claim).toLowerCase());
}

export function isConfigOnlyProject(project) {
  return !project?.frameworks?.length && !project?.primary;
}
