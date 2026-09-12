import { parseXmlStructure } from "./xml-structure.js";

const SQL_STATEMENT_PATTERNS = Object.freeze([
  /(?:^|[;\n])\s*select\b[\s\S]{0,240}\bfrom\b/imu,
  /(?:^|[;\n])\s*insert\s+into\b/imu,
  /(?:^|[;\n])\s*update\b[\s\S]{0,160}\bset\b/imu,
  /(?:^|[;\n])\s*delete\s+from\b/imu,
  /(?:^|[;\n])\s*merge\s+into\b/imu,
  /(?:^|[;\n])\s*with\b[\s\S]{0,1024}\bas\s*\([\s\S]*\)\s*(?:select|insert|update|delete|merge)\b/imu,
  /(?:^|[;\n])\s*create\s+(?:table|view|index|schema|database|function|procedure|trigger|type|sequence)\b/imu,
  /(?:^|[;\n])\s*(?:alter|drop)\b/imu,
  /(?:^|[;\n])\s*(?:grant|revoke)\b[\s\S]{0,240}\bon\b/imu,
  /(?:^|[;\n])\s*(?:begin|commit|rollback)(?:\s+transaction)?\s*;?(?:\s|$)/imu,
  /(?:^|[;\n])\s*savepoint\b/imu,
  /(?:^|[;\n])\s*release(?:\s+savepoint)?\b/imu,
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

function maskSqlBracketIdentifier(text, start) {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "]") {
      if (text[index + 1] === "]") {
        index += 1;
      } else {
        return { text: " ".repeat(index - start + 1), next: index + 1 };
      }
    }
  }
  return null;
}

function maskSqlDollarQuote(text, start) {
  const marker = text.slice(start).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u)?.[0];
  if (!marker) return null;
  const end = text.indexOf(marker, start + marker.length);
  if (end < 0) return { invalid: true };
  const finish = end + marker.length;
  return { text: text.slice(start, finish).replace(/[^\n\r]/gu, " "), next: finish };
}

function maskSqlToken(text, index) {
  const character = text[index];
  const next = text[index + 1];
  if (character === "-" && next === "-") {
    return maskSqlComment(text, index, false);
  }
  if (character === "/" && next === "*") return maskSqlComment(text, index, true);
  if (character === "'" || character === '"' || character === "`") return maskSqlQuoted(text, index, character);
  if (character === "[") return maskSqlBracketIdentifier(text, index);
  if (character === "$") {
    const dollarQuote = maskSqlDollarQuote(text, index);
    if (dollarQuote?.invalid) return null;
    return dollarQuote ?? { text: character, next: index + 1 };
  }
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

function childValues(node, name) {
  return node.children
    .filter((child) => child.name.toLowerCase() === name)
    .map((child) => child.text.trim())
    .filter(Boolean);
}

export function parseSqlProject(text) {
  const document = parseXmlStructure(text);
  if (!document || document.root.name.toLowerCase() !== "project") return { valid: false, database: false };
  const sdk = document.root.attributes.Sdk ?? document.root.attributes.sdk ?? "";
  const databaseMarkers = [
    sdk.toLowerCase().startsWith("microsoft.build.sql/"),
    childValues(document.root, "dsp").length > 0,
    document.nodes.some((node) => ["databaseproject", "sqlscript"].includes(node.name.toLowerCase())),
  ];
  const database = databaseMarkers.some(Boolean);
  return { valid: database, database };
}
