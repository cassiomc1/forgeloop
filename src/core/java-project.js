import { createLanguageProject, JAVA_SOURCE_EXTENSIONS, pathBelongsToRoot, portablePath } from "./multi-language-project.js";
import { maskBuildScript } from "./build-script.js";
import { parseXmlStructure } from "./xml-structure.js";

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

function childNodes(node, name) {
  return node.children.filter((child) => child.name.toLowerCase() === name.toLowerCase());
}

function nodesAtPath(root, names) {
  return names.reduce((nodes, name) => nodes.flatMap((node) => childNodes(node, name)), [root]);
}

function nodeValues(nodes) {
  return nodes
    .filter((node) => node.children.length === 0 && node.text.length <= 256)
    .map((node) => node.text.trim())
    .filter(Boolean);
}

export function parseMavenPom(text) {
  const document = parseXmlStructure(text);
  if (!document || document.root.name.toLowerCase() !== "project") return invalidJava();
  const root = document.root;
  const packaging = nodeValues(childNodes(root, "packaging"))[0] ?? null;
  const modules = nodeValues(nodesAtPath(root, ["modules", "module"]));
  const compilerProperties = ["release", "source", "target"]
    .some((name) => nodeValues(nodesAtPath(root, ["properties", `maven.compiler.${name}`])).length > 0);
  const compilerPlugin = [
    ["build", "plugins", "plugin", "artifactId"],
    ["build", "pluginManagement", "plugins", "plugin", "artifactId"],
  ].some((path) => nodeValues(nodesAtPath(root, path)).some((value) => value === "maven-compiler-plugin"));
  const javaCompiler = compilerProperties || compilerPlugin;
  const valid = nodeValues(childNodes(root, "artifactId")).length > 0
    || packaging === "pom"
    || modules.length > 0
    || javaCompiler;
  return { valid, javaPlugin: false, javaPlatform: false, javaCompiler, packaging, modules };
}

function maskGradleStringsAndComments(text) {
  let result = "";
  let state = "code";
  let quote = null;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (state === "string") {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) {
        state = "code";
        quote = null;
      }
      result += character === "\n" || character === "\r" ? character : " ";
    } else if (state === "line-comment") {
      if (character === "\n" || character === "\r") {
        result += character;
        state = "code";
      } else result += " ";
    } else if (state === "block-comment") {
      if (character === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else result += character === "\n" || character === "\r" ? character : " ";
    } else if (character === "\"" || character === "'") {
      result += " ";
      quote = character;
      state = "string";
    } else if (character === "/" && next === "/") {
      result += "  ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      result += "  ";
      index += 1;
      state = "block-comment";
    } else {
      result += character;
    }
  }
  return state === "code" ? result : null;
}

const JAVA_PLUGIN_IDS = new Set(["java", "java-library", "java-platform", "application", "war"]);

function quotedPluginId(rawBlock, start) {
  const plugin = rawBlock.slice(start).match(/^\s*(?:\(\s*)?["']([^"']+)["']/u)?.[1];
  return JAVA_PLUGIN_IDS.has(plugin);
}

function pluginBlockHasJava(rawBlock) {
  const masked = maskGradleStringsAndComments(rawBlock);
  if (masked === null) return false;
  for (const match of masked.matchAll(/\bid\b/gu)) {
    if (quotedPluginId(rawBlock, match.index + match[0].length)) return true;
  }
  return /(?:^|[;{}\n])\s*(?:java|javaLibrary|javaPlatform|application|war)\s*(?:[;\n}]|$)/mu.test(masked);
}

function hasJavaPlugin(text) {
  const masked = maskGradleStringsAndComments(text);
  if (masked === null) return false;
  for (const match of masked.matchAll(/\bplugins\s*\{([\s\S]*?)\}/gu)) {
    const open = match[0].indexOf("{");
    if (pluginBlockHasJava(text.slice(match.index + open + 1, match.index + match[0].length - 1))) return true;
  }
  for (const match of masked.matchAll(/\bapply\s+plugin\s*:\s*/gu)) {
    const suffix = text.slice(match.index + match[0].length);
    if (/^['"](?:java|java-library|java-platform|application|war)['"]/u.test(suffix)) return true;
  }
  return false;
}

export function parseGradleBuild(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || /\r(?!\n)/u.test(text)) return invalidJava();
  const source = maskGradleStringsAndComments(text);
  if (source === null) return invalidJava();
  const javaPlugin = hasJavaPlugin(text);
  const javaPlatform = javaPlugin && /(?:java-platform|javaPlatform)/u.test(text);
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
  const source = maskBuildScript(text);
  const javaPlugin = source !== null && /\bjava_(?:binary|library|test|import|plugin)\s*\(/u.test(source);
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
