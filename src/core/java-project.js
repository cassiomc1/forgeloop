import { createLanguageProject, JAVA_SOURCE_EXTENSIONS, pathBelongsToRoot, portablePath } from "./multi-language-project.js";

function invalidJava() {
  return {
    valid: false,
    javaPlugin: false,
    javaPlatform: false,
    javaCompiler: false,
    packaging: null,
    modules: [],
  };
}

function xmlTagValues(text, name) {
  const values = [];
  const pattern = new RegExp(`<${name}\\s*>([^<]{1,256})</${name}\\s*>`, "giu");
  for (const match of text.matchAll(pattern)) values.push(match[1].trim());
  return values.filter(Boolean);
}

function stripXmlComments(text) {
  let result = "";
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf("<!--", cursor);
    if (start < 0) return result + text.slice(cursor);
    const end = text.indexOf("-->", start + 4);
    if (end < 0) return null;
    result += text.slice(cursor, start);
    result += text.slice(start, end + 3).replace(/[^\n]/gu, " ");
    cursor = end + 3;
  }
  return result;
}

function xmlIsStructurallySafe(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return false;
  const source = stripXmlComments(text);
  if (source === null || /<!(?:DOCTYPE|ENTITY)\b/iu.test(source)) return false;
  const tags = [];
  for (const match of source.matchAll(/<\/?([A-Za-z_][\w:.-]*)(?:\s[^<>]*?)?\s*(\/?)>/gu)) {
    const raw = match[0];
    const name = match[1];
    if (raw.startsWith("</")) {
      if (tags.pop() !== name) return false;
    } else if (!raw.endsWith("/>") && !raw.startsWith("<?")) {
      tags.push(name);
    }
  }
  return tags.length === 0 && /<project(?:\s|>)/iu.test(source);
}

function stripGradleComments(text) {
  if (/\/\*[\s\S]*$/u.test(text) && !/\/\*[\s\S]*?\*\//u.test(text)) return null;
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|[\s;{}])\/\/[^\r\n]*/gu, "$1");
}

function stripBazelComments(text) {
  return text.replace(/#[^\n\r]*/gu, " ");
}

export function parseMavenPom(text) {
  if (!xmlIsStructurallySafe(text)) return invalidJava();
  const source = stripXmlComments(text);
  const packaging = xmlTagValues(source, "packaging")[0] ?? null;
  const modules = xmlTagValues(source, "module");
  const javaCompiler = /(?:maven\.compiler\.(?:release|source|target)|maven-compiler-plugin)/iu.test(source);
  const valid = xmlTagValues(source, "artifactId").length > 0
    || packaging === "pom"
    || modules.length > 0
    || javaCompiler;
  return { valid, javaPlugin: false, javaPlatform: false, javaCompiler, packaging, modules };
}

function hasJavaPlugin(text) {
  return /(?:id\s*[('"](?:java(?:-library|-platform|-gradle-plugin)?|application|war)[)'" ]|apply\s+plugin\s*:\s*['"](?:java(?:-library|-gradle-plugin)?|application|war)['"])/u.test(text);
}

export function parseGradleBuild(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return invalidJava();
  const source = stripGradleComments(text);
  if (source === null) return invalidJava();
  const javaPlugin = hasJavaPlugin(source);
  const javaPlatform = /id\s*[('"]java-platform[)'" ]/u.test(source);
  return {
    valid: javaPlugin || javaPlatform,
    javaPlugin,
    javaPlatform,
    javaCompiler: false,
    packaging: null,
    modules: [],
  };
}

export function parseBazelJava(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return invalidJava();
  const javaPlugin = /\bjava_(?:binary|library|test|import|plugin)\s*\(/u.test(stripBazelComments(text));
  return { valid: javaPlugin, javaPlugin, javaPlatform: false, javaCompiler: false, packaging: null, modules: [] };
}

function hasOwnedJavaSource(sourceFiles, targetRoot, projectRoot, projectRoots) {
  return sourceFiles.some((file) => JAVA_SOURCE_EXTENSIONS.has(file.extension)
    && pathBelongsToRoot(portablePath(targetRoot, file.path), projectRoot, projectRoots));
}

export function inspectJavaProject({ projectRoot, manifestRelative, manifestText, manifestName, targetRoot, sourceFiles, projectRoots }) {
  const parsed = manifestName === "pom.xml"
    ? parseMavenPom(manifestText)
    : manifestName === "build" || manifestName === "build.bazel"
      ? parseBazelJava(manifestText)
      : parseGradleBuild(manifestText);
  const javaSource = hasOwnedJavaSource(sourceFiles, targetRoot, projectRoot, projectRoots);
  const primary = parsed.valid && (javaSource || parsed.javaPlugin || parsed.javaPlatform || parsed.javaCompiler);
  const primarySignals = primary
    ? [`${manifestRelative}:${parsed.javaPlatform ? "java-platform" : manifestName === "pom.xml" ? "maven" : "build"}`]
    : [];
  const supportingSignals = [];
  if (javaSource) supportingSignals.push(`${projectRoot === "." ? "source" : `${projectRoot}/source`}:java`);
  for (const module of parsed.modules) supportingSignals.push(`${manifestRelative}:module=${module}`);
  return createLanguageProject({
    kind: "java",
    root: projectRoot,
    manifest: manifestRelative,
    frameworks: primary ? ["java"] : [],
    primary,
    primarySignals,
    supportingSignals,
    internal: { ...parsed, valid: parsed.valid },
  });
}
