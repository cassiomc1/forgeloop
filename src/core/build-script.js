function quotedValue(text, start) {
  const quote = text[start];
  let value = "";
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      value += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === quote) {
      return { value, next: index + 1 };
    } else {
      value += character;
    }
  }
  return null;
}

function bracketEnd(text, start) {
  const marker = text.slice(start).match(/^\[(=*)\[/u);
  if (!marker) return null;
  const closing = `]${marker[1]}]`;
  const end = text.indexOf(closing, start + marker[0].length);
  return end < 0 ? null : { next: end + closing.length };
}

function maskRange(text, start, end) {
  return text.slice(start, end).replace(/[^\n\r]/gu, " ");
}

function skipHashComment(text, start) {
  const bracket = bracketEnd(text, start + 1);
  if (text[start + 1] === "[" && bracket) return bracket.next;
  const lineEnd = text.slice(start).search(/[\n\r]/u);
  return lineEnd < 0 ? text.length : start + lineEnd;
}

function skipBuildToken(text, start) {
  if (text[start] === "#") return { next: skipHashComment(text, start) };
  if (text[start] === "\"" || text[start] === "'") {
    const quoted = quotedValue(text, start);
    return quoted ? { next: quoted.next } : null;
  }
  const bracket = bracketEnd(text, start);
  return bracket ? { next: bracket.next } : { next: start + 1 };
}

export function maskBuildScript(text) {
  if (typeof text !== "string") return null;
  let result = "";
  for (let index = 0; index < text.length;) {
    const step = skipBuildToken(text, index);
    if (!step) return null;
    result += step.next === index + 1
      ? text[index]
      : maskRange(text, index, step.next);
    index = step.next;
  }
  return result;
}

function callEnd(text, open) {
  let depth = 1;
  for (let index = open + 1; index < text.length; index += 1) {
    const character = text[index];
    const step = skipBuildToken(text, index);
    if (!step) return null;
    if (step.next !== index + 1) {
      index = step.next - 1;
      continue;
    }
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

export function extractBuildCalls(text, names, { caseInsensitive = false } = {}) {
  if (typeof text !== "string" || !Array.isArray(names)) return null;
  const wanted = new Set(names.map((name) => caseInsensitive ? name.toLowerCase() : name));
  const calls = [];
  for (let index = 0; index < text.length;) {
    const step = skipBuildToken(text, index);
    if (!step) return null;
    if (step.next !== index + 1) {
      index = step.next;
      continue;
    }
    const name = text.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/u)?.[0];
    if (!name || !wanted.has(caseInsensitive ? name.toLowerCase() : name)) {
      index += name?.length ?? 1;
      continue;
    }
    let open = index + name.length;
    while (/\s/u.test(text[open] ?? "")) open += 1;
    if (text[open] !== "(") {
      index += name.length;
      continue;
    }
    const close = callEnd(text, open);
    if (close === null) return null;
    calls.push({ name, body: text.slice(open + 1, close) });
    index = close + 1;
  }
  return calls;
}

function splitBuildArguments(text) {
  const parts = [];
  let start = 0;
  const depths = { "(": 0, "[": 0, "{": 0 };
  for (let index = 0; index < text.length;) {
    const step = skipBuildToken(text, index);
    if (!step) return null;
    if (step.next !== index + 1) {
      index = step.next;
      continue;
    }
    const character = text[index];
    if (character === "(" || character === "[" || character === "{") depths[character] += 1;
    if (character === ")" || character === "]" || character === "}") {
      const opening = character === ")" ? "(" : character === "]" ? "[" : "{";
      depths[opening] -= 1;
      if (depths[opening] < 0) return null;
    }
    if (character === "," && Object.values(depths).every((depth) => depth === 0)) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
    index += 1;
  }
  if (Object.values(depths).some((depth) => depth !== 0)) return null;
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

export function quotedBuildArguments(text) {
  const parts = splitBuildArguments(text);
  if (!parts) return null;
  return parts.flatMap((part) => {
    const value = part.length >= 2 && (part[0] === "\"" || part[0] === "'")
      ? quotedValue(part, 0)
      : null;
    return value && value.next === part.length ? [value.value] : [];
  });
}
