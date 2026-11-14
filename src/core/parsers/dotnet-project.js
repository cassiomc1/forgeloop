// Bounded parsers for untrusted repository manifest text. They never throw on
// malformed input: every entry point returns an `invalid` shape instead.
import { PROJECT_DETECTION_LIMITS } from "./limits.js";
import { uniqueSorted } from "./shared.js";

const MAX_MANIFEST_BYTES = PROJECT_DETECTION_LIMITS.maxManifestBytes;
const MAX_XML_TEXT_LENGTH = 4096;
export const DOTNET_SDKS = new Set([
  "Microsoft.NET.Sdk",
  "Microsoft.NET.Sdk.Web",
  "Microsoft.NET.Sdk.Worker",
  "Microsoft.NET.Sdk.Razor",
  "Microsoft.NET.Sdk.BlazorWebAssembly",
  "Aspire.AppHost.Sdk",
  "MSTest.Sdk",
]);
const ASPNETCORE_SDKS = new Set([
  "Microsoft.NET.Sdk.Web",
  "Microsoft.NET.Sdk.Razor",
  "Microsoft.NET.Sdk.BlazorWebAssembly",
]);

function invalidDotNetProject() {
  return {
    valid: false,
    sdkStyle: false,
    projectSdks: [],
    targetFrameworks: [],
    frameworkReferences: [],
    packageReferences: [],
    projectReferences: [],
    dotnet: false,
    aspnetcore: false,
    abp: false,
  };
}

function findXmlTagEnd(text, start) {
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function parseXmlAttributes(text) {
  const attributes = {};
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/u.test(text[index])) index += 1;
    if (index >= text.length) break;
    const name = text.slice(index).match(/^[A-Za-z_][A-Za-z0-9_.:-]*/u)?.[0];
    if (!name) return null;
    index += name.length;
    while (index < text.length && /\s/u.test(text[index])) index += 1;
    if (text[index] !== "=") return null;
    index += 1;
    while (index < text.length && /\s/u.test(text[index])) index += 1;
    const quote = text[index];
    if (quote !== "\"" && quote !== "'") return null;
    index += 1;
    const end = text.indexOf(quote, index);
    if (end < 0 || Object.prototype.hasOwnProperty.call(attributes, name)) return null;
    attributes[name] = text.slice(index, end);
    index = end + 1;
  }
  return attributes;
}

function appendXmlText(stack, value) {
  if (value === "") return true;
  const current = stack[stack.length - 1];
  if (!current) return value.trim() === "";
  current.textParts.push(value);
  return true;
}

function consumeXmlSpecialToken(text, tagStart, stack) {
  if (text.startsWith("<!--", tagStart)) {
    const end = text.indexOf("-->", tagStart + 4);
    return end < 0 ? { valid: false } : { valid: true, nextIndex: end + 3 };
  }
  if (text.startsWith("<![CDATA[", tagStart)) {
    const end = text.indexOf("]]>", tagStart + 9);
    if (end < 0 || stack.length === 0) return { valid: false };
    stack[stack.length - 1].textParts.push(text.slice(tagStart + 9, end));
    return { valid: true, nextIndex: end + 3 };
  }
  if (text.startsWith("<?", tagStart)) {
    const end = text.indexOf("?>", tagStart + 2);
    return end < 0 ? { valid: false } : { valid: true, nextIndex: end + 2 };
  }
  if (text.startsWith("<!", tagStart)) return { valid: false };
  return null;
}

function closeXmlNode(raw, state) {
  const closing = raw.slice(1).trim().match(/^([A-Za-z_][A-Za-z0-9_.:-]*)\s*$/u)?.[1];
  const open = state.stack.pop();
  if (!closing || !open || open.name !== closing) return false;
  open.text = open.textParts.join("");
  if (state.stack.length === 0) {
    if (state.rootClosed || open !== state.root) return false;
    state.rootClosed = true;
  }
  return true;
}

function openXmlNode(raw, state) {
  const selfClosing = /\/\s*$/u.test(raw);
  const body = selfClosing ? raw.replace(/\/\s*$/u, "").trimEnd() : raw;
  const name = body.match(/^([A-Za-z_][A-Za-z0-9_.:-]*)/u)?.[1];
  if (!name) return false;
  if (state.stack.length === 0 && (state.root || state.rootClosed)) return false;
  if (!state.root && state.expectedRoot && name !== state.expectedRoot) return false;
  const attributes = parseXmlAttributes(body.slice(name.length).trim());
  if (!attributes) return false;
  const node = { name, attributes, textParts: [], children: [], text: "" };
  state.nodes.push(node);
  if (state.stack.length > 0) state.stack[state.stack.length - 1].children.push(node);
  if (!state.root) state.root = node;
  if (!selfClosing) state.stack.push(node);
  else if (node === state.root) state.rootClosed = true;
  return true;
}

function consumeXmlTag(text, tagStart, state) {
  const tagEnd = findXmlTagEnd(text, tagStart + 1);
  if (tagEnd < 0) return null;
  const raw = text.slice(tagStart + 1, tagEnd).trim();
  if (raw === "") return null;
  const valid = raw.startsWith("/") ? closeXmlNode(raw, state) : openXmlNode(raw, state);
  return { valid, nextIndex: tagEnd + 1 };
}

export function parseXmlStructure(text, expectedRoot = null) {
  if (typeof text !== "string" || text.length > MAX_MANIFEST_BYTES || /\r(?!\n)/u.test(text)) return null;
  const state = { nodes: [], stack: [], root: null, rootClosed: false, expectedRoot };
  let index = 0;
  while (index < text.length) {
    const tagStart = text.indexOf("<", index);
    if (tagStart < 0) break;
    if (!appendXmlText(state.stack, text.slice(index, tagStart))) return null;
    const special = consumeXmlSpecialToken(text, tagStart, state.stack);
    if (special) {
      if (!special.valid) return null;
      index = special.nextIndex;
      continue;
    }
    const tag = consumeXmlTag(text, tagStart, state);
    if (!tag?.valid) return null;
    index = tag.nextIndex;
  }
  if (!appendXmlText(state.stack, text.slice(index))) return null;
  if (!state.root || state.stack.length > 0 || !state.rootClosed) return null;
  return { root: state.root, nodes: state.nodes };
}

function normalizeSdkName(value) {
  return typeof value === "string" ? value.trim().split("/")[0] : "";
}

function xmlValues(nodes, name, attribute = "Include") {
  return uniqueSorted(nodes
    .filter((node) => node.name === name && typeof node.attributes?.[attribute] === "string")
    .map((node) => node.attributes[attribute].trim())
    .filter(Boolean));
}

function targetFrameworkValues(nodes) {
  return uniqueSorted(nodes
    .filter((node) => (node.name === "TargetFramework" || node.name === "TargetFrameworks")
      && node.children.length === 0
      && node.text.length <= MAX_XML_TEXT_LENGTH)
    .flatMap((node) => node.text.split(";"))
    .map((value) => value.trim())
    .filter(Boolean));
}

export function parseDotNetProject(text) {
  const invalid = invalidDotNetProject();
  if (typeof text !== "string" || text.length > MAX_MANIFEST_BYTES) return invalid;
  const document = parseXmlStructure(text, "Project");
  if (!document) return invalid;

  const sdkValues = [
    document.root.attributes.Sdk ?? "",
    ...document.nodes.filter((node) => node.name === "Sdk").map((node) => node.attributes.Name ?? ""),
  ];
  const projectSdks = uniqueSorted(sdkValues
    .flatMap((value) => value.split(";"))
    .map(normalizeSdkName)
    .filter(Boolean));
  const recognizedSdks = projectSdks.filter((sdk) => DOTNET_SDKS.has(sdk));
  const frameworkReferences = xmlValues(document.nodes, "FrameworkReference");
  const packageReferences = xmlValues(document.nodes, "PackageReference");
  const projectReferences = xmlValues(document.nodes, "ProjectReference");
  const dotnet = recognizedSdks.length > 0;
  const aspnetcore = dotnet && (recognizedSdks.some((sdk) => ASPNETCORE_SDKS.has(sdk))
    || frameworkReferences.some((reference) => reference.toLowerCase() === "microsoft.aspnetcore.app"));
  const abp = dotnet && packageReferences.some((reference) => reference.toLowerCase().startsWith("volo.abp."));
  return {
    valid: true,
    sdkStyle: dotnet,
    projectSdks,
    targetFrameworks: targetFrameworkValues(document.nodes),
    frameworkReferences,
    packageReferences,
    projectReferences,
    dotnet,
    aspnetcore,
    abp,
  };
}
