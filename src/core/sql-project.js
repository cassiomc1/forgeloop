const SQL_STATEMENT_PATTERNS = Object.freeze([
  /\bselect\b[\s\S]{0,240}\bfrom\b/iu,
  /\binsert\s+into\b/iu,
  /\bupdate\b[\s\S]{0,160}\bset\b/iu,
  /\bdelete\s+from\b/iu,
  /\b(?:create|alter|drop)\s+(?:table|view|index|schema|database)\b/iu,
  /\b(?:begin|commit|rollback)\s*(?:transaction)?\b/iu,
]);

function maskSqlComment(text, start, block) {
  const lineEnd = text.slice(start).search(/[\n\r]/u);
  const end = block ? text.indexOf("*/", start + 2) : lineEnd < 0 ? -1 : start + lineEnd;
  if (block && end < 0) return null;
  const finish = block ? end + 2 : (end < 0 ? text.length : end);
  const value = text.slice(start, finish);
  return { text: value.replace(/[^\n\r]/gu, " "), next: finish };
}

function maskSqlQuoted(text, start, quote) {
  let result = " ";
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === quote && next === quote) {
      result += "  ";
      index += 1;
    } else if (character === quote) {
      return { text: result + " ", next: index + 1 };
    } else {
      result += character === "\n" || character === "\r" ? character : " ";
    }
  }
  return null;
}

function maskSqlToken(text, index) {
  const character = text[index];
  const next = text[index + 1];
  if ((character === "-" && next === "-") || character === "#") {
    return maskSqlComment(text, index, false);
  }
  if (character === "/" && next === "*") return maskSqlComment(text, index, true);
  if (character === "'" || character === '"') return maskSqlQuoted(text, index, character);
  return { text: character, next: index + 1 };
}

function maskSql(text) {
  let result = "";
  for (let index = 0; index < text.length;) {
    const segment = maskSqlToken(text, index);
    if (!segment) return null;
    result += segment.text;
    index = segment.next;
  }
  return result;
}

export function looksLikeSql(text) {
  if (typeof text !== "string" || text.length > 512 * 1024 || /\r(?!\n)/u.test(text)) return false;
  const masked = maskSql(text);
  return masked !== null && SQL_STATEMENT_PATTERNS.some((pattern) => pattern.test(masked));
}

export function sqlSignal(text) {
  if (!looksLikeSql(text)) return null;
  const masked = maskSql(text);
  return masked === null ? null : SQL_STATEMENT_PATTERNS.find((pattern) => pattern.test(masked))?.source ?? "statement";
}
