const DEFAULT_XML_MAX_BYTES = 1024 * 1024;

function findTagEnd(text, start) {
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

function parseAttributes(text) {
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

function appendText(stack, value) {
  if (value === "") return true;
  const current = stack[stack.length - 1];
  if (!current) return value.trim() === "";
  current.textParts.push(value);
  return true;
}

function specialToken(text, start, stack) {
  if (text.startsWith("<!--", start)) {
    const end = text.indexOf("-->", start + 4);
    return end < 0 ? { valid: false } : { valid: true, next: end + 3 };
  }
  if (text.startsWith("<![CDATA[", start)) {
    const end = text.indexOf("]]>", start + 9);
    if (end < 0 || stack.length === 0) return { valid: false };
    stack[stack.length - 1].textParts.push(text.slice(start + 9, end));
    return { valid: true, next: end + 3 };
  }
  if (text.startsWith("<?", start)) {
    const end = text.indexOf("?>", start + 2);
    return end < 0 ? { valid: false } : { valid: true, next: end + 2 };
  }
  if (text.startsWith("<!", start)) return { valid: false };
  return null;
}

function closeNode(raw, state) {
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

function openNode(raw, state) {
  const selfClosing = /\/\s*$/u.test(raw);
  const body = selfClosing ? raw.replace(/\/\s*$/u, "").trimEnd() : raw;
  const name = body.match(/^([A-Za-z_][A-Za-z0-9_.:-]*)/u)?.[1];
  if (!name || (state.stack.length === 0 && (state.root || state.rootClosed))) return false;
  if (!state.root && state.expectedRoot && name !== state.expectedRoot) return false;
  const attributes = parseAttributes(body.slice(name.length).trim());
  if (!attributes) return false;
  const node = { name, attributes, textParts: [], children: [], text: "" };
  state.nodes.push(node);
  if (state.stack.length > 0) state.stack[state.stack.length - 1].children.push(node);
  if (!state.root) state.root = node;
  if (!selfClosing) state.stack.push(node);
  else if (node === state.root) state.rootClosed = true;
  return true;
}

export function parseXmlStructure(text, expectedRoot = null, maxBytes = DEFAULT_XML_MAX_BYTES) {
  if (typeof text !== "string" || text.length > maxBytes || /\r(?!\n)/u.test(text)) return null;
  const state = { nodes: [], stack: [], root: null, rootClosed: false, expectedRoot };
  let index = 0;
  while (index < text.length) {
    const tagStart = text.indexOf("<", index);
    if (tagStart < 0) break;
    if (!appendText(state.stack, text.slice(index, tagStart))) return null;
    const special = specialToken(text, tagStart, state.stack);
    if (special) {
      if (!special.valid) return null;
      index = special.next;
      continue;
    }
    const tagEnd = findTagEnd(text, tagStart + 1);
    if (tagEnd < 0) return null;
    const raw = text.slice(tagStart + 1, tagEnd).trim();
    if (raw === "") return null;
    const valid = raw.startsWith("/") ? closeNode(raw, state) : openNode(raw, state);
    if (!valid) return null;
    index = tagEnd + 1;
  }
  if (!appendText(state.stack, text.slice(index))) return null;
  if (!state.root || state.stack.length > 0 || !state.rootClosed) return null;
  return { root: state.root, nodes: state.nodes };
}
