import { createLanguageProject, C_SOURCE_EXTENSIONS, CPP_SOURCE_EXTENSIONS, SWIFT_SOURCE_EXTENSIONS, pathBelongsToRoot, portablePath } from "./multi-language-project.js";
import { extractBuildCalls, maskBuildScript, quotedBuildArguments } from "./build-script.js";

function invalidSwift() {
  return { valid: false, swift: false, c: false, cpp: false };
}

function stripSwiftComments(text) {
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

function maskSwiftStrings(text) {
  let result = "";
  let state = "code";
  let escaped = false;
  for (const character of text) {
    if (state === "string") {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') state = "code";
      result += " ";
    } else if (character === '"') {
      state = "string";
      result += " ";
    } else {
      result += character;
    }
  }
  return state === "string" ? null : result;
}

function maskSwiftLexicalNoise(text) {
  const withoutComments = stripSwiftComments(text);
  return withoutComments === null ? null : maskSwiftStrings(withoutComments);
}

export function parseSwiftPackage(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return invalidSwift();
  const toolsVersion = /^\s*\/\/\s*swift-tools-version:\s*\d+(?:\.\d+){1,2}\s*$/mu.test(text);
  const source = maskSwiftLexicalNoise(text);
  const packageDescription = source !== null && /\bimport\s+PackageDescription\b/u.test(source);
  const packageDeclaration = source !== null && /\bPackage\s*\(/u.test(source);
  return {
    valid: toolsVersion && packageDescription && packageDeclaration,
    swift: toolsVersion && packageDescription && packageDeclaration,
    c: false,
    cpp: false,
  };
}

export function parseXcodeProject(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return invalidSwift();
  const source = stripSwiftComments(text);
  const swift = source !== null && /\bSWIFT_VERSION\s*=/u.test(source) && /\.swift\b/u.test(source);
  return { valid: swift, swift, c: false, cpp: false };
}

export function parseSwiftCMake(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return invalidSwift();
  const source = maskBuildScript(text);
  const swift = source !== null && /\b(?:LANGUAGES[^\n)]*\bSwift\b|enable_language\s*\(\s*Swift\b)/iu.test(source);
  return { valid: swift, swift, c: false, cpp: false };
}

export function parseSwiftMeson(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return invalidSwift();
  const calls = extractBuildCalls(text, ["project", "add_languages"]);
  const swift = Boolean(calls?.some((call) => {
    const values = quotedBuildArguments(call.body) ?? [];
    return (call.name === "project" ? values.slice(1) : values)
      .some((value) => value.toLowerCase() === "swift");
  }));
  return { valid: swift, swift, c: false, cpp: false };
}

function sourceEvidence(sourceFiles, targetRoot, projectRoot, projectRoots) {
  const owns = (file) => pathBelongsToRoot(portablePath(targetRoot, file.path), projectRoot, projectRoots);
  return {
    swift: sourceFiles.some((file) => SWIFT_SOURCE_EXTENSIONS.has(file.extension) && owns(file)),
    c: sourceFiles.some((file) => C_SOURCE_EXTENSIONS.has(file.extension) && owns(file)),
    cpp: sourceFiles.some((file) => CPP_SOURCE_EXTENSIONS.has(file.extension) && owns(file)),
  };
}

export function swiftSourceLooksExecutable(text) {
  const source = maskSwiftLexicalNoise(text);
  return source !== null && /\b(?:import|class|struct|enum|protocol|func|let|var)\b/u.test(source);
}

export function inspectSwiftProject({ projectRoot, manifestRelative, manifestText, manifestName, targetRoot, sourceFiles, projectRoots, directClaim = false }) {
  const normalizedManifestName = manifestName.toLowerCase();
  const parsed = normalizedManifestName === "package.swift"
    ? parseSwiftPackage(manifestText)
    : normalizedManifestName === "project.pbxproj"
      ? parseXcodeProject(manifestText)
      : normalizedManifestName === "meson.build"
        ? parseSwiftMeson(manifestText)
      : parseSwiftCMake(manifestText);
  const source = sourceEvidence(sourceFiles, targetRoot, projectRoot, projectRoots);
  const swift = parsed.swift
    && (normalizedManifestName !== "package.swift" || source.swift || directClaim);
  const frameworks = [];
  if (swift) frameworks.push("swift");
  if (normalizedManifestName === "package.swift" && source.c) frameworks.push("c");
  if (normalizedManifestName === "package.swift" && source.cpp) frameworks.push("cpp");
  const primary = frameworks.length > 0;
  const primarySignals = [];
  const manifestSignal = normalizedManifestName === "package.swift"
    ? "package"
    : normalizedManifestName === "project.pbxproj" ? "xcode" : "build";
  if (swift) primarySignals.push(`${manifestRelative}:${manifestSignal}`);
  if (normalizedManifestName === "package.swift" && source.c) primarySignals.push(`${projectRoot}/source:c`);
  if (normalizedManifestName === "package.swift" && source.cpp) primarySignals.push(`${projectRoot}/source:cpp`);
  return createLanguageProject({
    kind: "swift",
    root: projectRoot,
    manifest: manifestRelative,
    frameworks,
    primary,
    primarySignals,
    supportingSignals: [],
    internal: { ...parsed, valid: parsed.valid, source },
  });
}
