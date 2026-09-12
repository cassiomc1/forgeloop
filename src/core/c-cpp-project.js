import { createLanguageProject, C_SOURCE_EXTENSIONS, CPP_SOURCE_EXTENSIONS, pathBelongsToRoot, portablePath } from "./multi-language-project.js";
import { extractBuildCalls, maskBuildScript, quotedBuildArguments } from "./build-script.js";

function invalidNative() {
  return {
    valid: false,
    c: false,
    cpp: false,
    make: false,
  };
}

function nativeLanguageTokens(text) {
  const tokens = text.toUpperCase().match(/\b(?:CXX|CPP|C)\b/gu) ?? [];
  return {
    c: tokens.includes("C"),
    cpp: tokens.some((language) => language === "CXX" || language === "CPP"),
  };
}

function nativeLanguagesFromCMake(text) {
  const result = { c: false, cpp: false };
  const calls = extractBuildCalls(text, ["project", "enable_language"], { caseInsensitive: true });
  if (!calls) return result;
  for (const call of calls) {
    const body = maskBuildScript(call.body);
    if (body === null) continue;
    if (call.name.toLowerCase() === "enable_language") {
      const languages = nativeLanguageTokens(body);
      result.c ||= languages.c;
      result.cpp ||= languages.cpp;
      continue;
    }
    const explicit = body.match(/\blanguages?\b([\s\S]*)/iu)?.[1]
      ?? body.match(/^\s*[^\s]+\s+((?:C|CXX|CPP)\b[\s\S]*)/iu)?.[1]
      ?? "";
    const languages = nativeLanguageTokens(explicit);
    result.c ||= languages.c;
    result.cpp ||= languages.cpp;
  }
  return result;
}

export function parseCMake(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return invalidNative();
  const source = maskBuildScript(text);
  if (source === null) return invalidNative();
  const languages = nativeLanguagesFromCMake(text);
  const hasProject = /\bproject\s*\(/iu.test(source);
  const hasLanguage = /\benable_language\s*\(/iu.test(source);
  return { valid: hasProject || hasLanguage, ...languages, make: false };
}

export function parseMeson(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return invalidNative();
  const calls = extractBuildCalls(text, ["project", "add_languages"]);
  if (!calls || calls.length === 0) return invalidNative();
  const languageValues = calls.flatMap((call) => {
    const values = quotedBuildArguments(call.body) ?? [];
    return call.name === "project" ? values.slice(1) : values;
  });
  return {
    valid: true,
    c: languageValues.some((value) => value.toLowerCase() === "c"),
    cpp: languageValues.some((value) => ["cpp", "cxx"].includes(value.toLowerCase())),
    make: false,
  };
}

export function parseBazelNative(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return invalidNative();
  const source = maskBuildScript(text);
  const hasNativeRule = source !== null && /\b(?:cc_|c_)(?:library|binary|test|shared_library|static_library)\s*\(/u.test(source);
  return { valid: hasNativeRule, c: false, cpp: false, make: false };
}

export function parseMakefile(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return invalidNative();
  return { valid: true, c: false, cpp: false, make: true };
}

function sourceEvidence(sourceFiles, targetRoot, projectRoot, projectRoots) {
  const c = sourceFiles.some((file) => C_SOURCE_EXTENSIONS.has(file.extension)
    && pathBelongsToRoot(portablePath(targetRoot, file.path), projectRoot, projectRoots));
  const cpp = sourceFiles.some((file) => CPP_SOURCE_EXTENSIONS.has(file.extension)
    && pathBelongsToRoot(portablePath(targetRoot, file.path), projectRoot, projectRoots));
  return { c, cpp };
}

function parseNativeManifest(manifestName, manifestText) {
  const normalizedName = manifestName.toLowerCase();
  if (normalizedName.includes("cmake")) return parseCMake(manifestText);
  if (normalizedName.includes("meson")) return parseMeson(manifestText);
  if (["makefile", "gnumakefile"].includes(normalizedName)) return parseMakefile(manifestText);
  return parseBazelNative(manifestText);
}

function nativeFrameworks(parsed, source) {
  return {
    c: parsed.c || (parsed.valid && source.c),
    cpp: parsed.cpp || (parsed.valid && source.cpp),
  };
}

function nativePrimarySignals({ manifestRelative, projectRoot, parsed, source, c, cpp }) {
  if (!c && !cpp) return [];
  return [
    ...(c && parsed.c ? [`${manifestRelative}:c`] : []),
    ...(cpp && parsed.cpp ? [`${manifestRelative}:cpp`] : []),
    ...(c && source.c && !parsed.c ? [`${projectRoot}/source:c`] : []),
    ...(cpp && source.cpp && !parsed.cpp ? [`${projectRoot}/source:cpp`] : []),
  ];
}

export function inspectNativeProject({ projectRoot, manifestRelative, manifestText, manifestName, targetRoot, sourceFiles, projectRoots }) {
  const parsed = parseNativeManifest(manifestName, manifestText);
  const source = sourceEvidence(sourceFiles, targetRoot, projectRoot, projectRoots);
  const { c, cpp } = nativeFrameworks(parsed, source);
  const primary = c || cpp;
  const frameworks = [];
  if (c) frameworks.push("c");
  if (cpp) frameworks.push("cpp");
  const primarySignals = nativePrimarySignals({ manifestRelative, projectRoot, parsed, source, c, cpp });
  const supportingSignals = parsed.make ? [`${manifestRelative}:make`] : [];
  return createLanguageProject({
    kind: "native",
    root: projectRoot,
    manifest: manifestRelative,
    frameworks,
    primary,
    primarySignals,
    supportingSignals,
    internal: { ...parsed, valid: parsed.valid },
  });
}

export function nativeFrameworkForSource(fileName) {
  const rawExtension = fileName.match(/\.[^.]+$/u)?.[0] ?? "";
  const extension = rawExtension === ".C" ? ".C" : rawExtension.toLowerCase();
  if (C_SOURCE_EXTENSIONS.has(extension)) return "c";
  if (CPP_SOURCE_EXTENSIONS.has(extension)) return "cpp";
  return null;
}
