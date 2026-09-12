import { createLanguageProject, C_SOURCE_EXTENSIONS, CPP_SOURCE_EXTENSIONS, pathBelongsToRoot, portablePath } from "./multi-language-project.js";

function invalidNative() {
  return {
    valid: false,
    c: false,
    cpp: false,
    make: false,
  };
}

function stripNativeComments(text) {
  return text.replace(/#[^\n\r]*/gu, " ");
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
  for (const match of text.matchAll(/\bproject\s*\(([^)]*)\)/giu)) {
    const body = match[1];
    const explicit = body.match(/\blanguages?\b([\s\S]*)/iu)?.[1]
      ?? body.match(/^\s*[^\s]+\s+((?:C|CXX|CPP)\b[\s\S]*)/iu)?.[1]
      ?? "";
    const languages = nativeLanguageTokens(explicit);
    result.c ||= languages.c;
    result.cpp ||= languages.cpp;
  }
  for (const match of text.matchAll(/\benable_language\s*\(([^)]*)\)/giu)) {
    const languages = nativeLanguageTokens(match[1]);
    result.c ||= languages.c;
    result.cpp ||= languages.cpp;
  }
  return result;
}

export function parseCMake(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return invalidNative();
  const source = stripNativeComments(text);
  const languages = nativeLanguagesFromCMake(source);
  const hasProject = /\bproject\s*\(/iu.test(source);
  const hasLanguage = /\benable_language\s*\(/iu.test(source);
  return { valid: hasProject || hasLanguage, ...languages, make: false };
}

export function parseMeson(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return invalidNative();
  const source = stripNativeComments(text);
  const matches = [...source.matchAll(/\b(?:project|add_languages)\s*\(([^\n)]*)\)/giu)];
  if (matches.length === 0) return invalidNative();
  const languages = matches.map((match) => match[1]).join(" ").toLowerCase();
  return {
    valid: true,
    c: /['"]c['"]/u.test(languages),
    cpp: /['"](?:cpp|cxx)['"]/u.test(languages),
    make: false,
  };
}

export function parseBazelNative(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return invalidNative();
  const hasNativeRule = /\b(?:cc_|c_)(?:library|binary|test|shared_library|static_library)\s*\(/u.test(stripNativeComments(text));
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
