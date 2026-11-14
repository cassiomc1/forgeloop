import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import * as errorCodes from "../src/core/error-codes.js";

const {
  ALL_KNOWN_ERROR_CODES,
  EMITTED_UNCLASSIFIED_ERROR_CODES,
  PUBLIC_ERROR_CODES,
  PUBLIC_ERROR_REGISTRY,
} = errorCodes;

const SOURCE_ROOT = path.resolve(import.meta.dirname, "../src");
const CODE_LITERAL = /["'`](E_[A-Z0-9_]{3,})["'`]/gu;

function emittedLiterals() {
  const literals = new Map();
  for (const relative of readdirSync(SOURCE_ROOT, { recursive: true })) {
    if (!relative.endsWith(".js")) continue;
    const text = readFileSync(path.join(SOURCE_ROOT, relative), "utf8");
    for (const match of text.matchAll(CODE_LITERAL)) {
      if (!literals.has(match[1])) literals.set(match[1], relative.split(path.sep).join("/"));
    }
  }
  return literals;
}

// Literals such as "E_STORAGE_" or "E_REPOSITORY_INDEX" are used with
// startsWith() to match a family of codes; they are not codes themselves.
function isFamilyPrefix(candidate, universe) {
  return candidate.endsWith("_") || universe.some((code) => code !== candidate && code.startsWith(`${candidate}_`));
}

test("every error code literal emitted under src/ is published in the registry", () => {
  const literals = emittedLiterals();
  const universe = [...ALL_KNOWN_ERROR_CODES, ...literals.keys()];
  const unregistered = [...literals]
    .filter(([code]) => !ALL_KNOWN_ERROR_CODES.has(code) && !isFamilyPrefix(code, universe))
    .map(([code, file]) => `${code} (${file})`);
  assert.deepEqual(unregistered, [], "register new codes in PUBLIC_ERROR_CODES (curated) or EMITTED_UNCLASSIFIED_ERROR_CODES");
});

test("every exported error-code constant is published in the registry", () => {
  const missing = Object.entries(errorCodes)
    .filter(([name, value]) => name.startsWith("E_") && typeof value === "string" && !ALL_KNOWN_ERROR_CODES.has(value))
    .map(([name]) => name);
  assert.deepEqual(missing, []);
});

test("unclassified codes stay sorted, unique, still emitted, and leave the list once curated", () => {
  assert.deepEqual([...EMITTED_UNCLASSIFIED_ERROR_CODES], [...new Set(EMITTED_UNCLASSIFIED_ERROR_CODES)].sort());
  const curated = EMITTED_UNCLASSIFIED_ERROR_CODES.filter((code) => Object.hasOwn(PUBLIC_ERROR_CODES, code));
  assert.deepEqual(curated, [], "remove promoted codes from EMITTED_UNCLASSIFIED_ERROR_CODES");
  const literals = emittedLiterals();
  const exported = new Set(Object.values(errorCodes).filter((value) => typeof value === "string"));
  const stale = EMITTED_UNCLASSIFIED_ERROR_CODES.filter((code) => !literals.has(code) && !exported.has(code));
  assert.deepEqual(stale, [], "remove codes that src/ no longer emits");
});

test("unclassified codes are published without a stable compatibility promise", () => {
  for (const code of EMITTED_UNCLASSIFIED_ERROR_CODES) {
    const entry = PUBLIC_ERROR_REGISTRY[code];
    assert.equal(entry?.classification, "PUBLIC_UNCLASSIFIED", code);
    assert.ok(entry.safeResolution.length > 0, code);
  }
  for (const [code, entry] of Object.entries(PUBLIC_ERROR_CODES)) {
    assert.equal(PUBLIC_ERROR_REGISTRY[code], entry, `curated metadata must be published unchanged: ${code}`);
  }
});
