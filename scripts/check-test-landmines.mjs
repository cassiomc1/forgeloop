#!/usr/bin/env node
// Test landmines: keeps tests honest in the spirit of
// https://github.com/interfere-inc/landmines (MIT), adapted to this
// repository's node:test suite without adding a linter dependency.
//
// - no-fixed-sleep: awaiting a fixed real-time delay. Await the operation or
//   a signal it emits; control the clock with t.mock.timers.
// - no-flake-masking: retries and raised per-test timeouts. A test that only
//   passes with more time or a rerun is a flake to fix.
// - no-test-doubles: replacing real behaviour (module/method/property mocks,
//   patched globals, prototypes or clocks). Inject a real implementation or a
//   local server instead; t.mock.timers stays allowed.
//
// Existing occurrences are listed in scripts/test-landmines-allowlist.json
// with an exact count per file. A file above its allowance fails (a new
// landmine); a file below it fails too, so the allowance is lowered and the
// list only shrinks.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RULES = Object.freeze({
  "no-fixed-sleep": {
    advice: "Await the operation or a signal it emits instead of a fixed delay; control time with t.mock.timers.",
    patterns: [/\bsetTimeout\(\s*(?:resolve|res|r)\s*,/gu, /\bawait\s+(?:delay|sleep|wait)\s*\(/gu],
  },
  "no-flake-masking": {
    advice: "Fix the race instead of raising the timeout or retrying; a test that passes on rerun is a flake.",
    // Retry options on a test call; a field named "retries" in data is not one.
    patterns: [/\b(?:test|it|describe)\s*\([^\n]*\{[^{}\n]*\btimeout\s*:/gu, /\b(?:test|it|describe)\s*\([^\n]*\{[^{}\n]*\bretr(?:y|ies)\s*:\s*\d/gu],
  },
  "no-test-doubles": {
    advice: "Use the real implementation (inject it, or run a local server) instead of mocking it; t.mock.timers is allowed.",
    patterns: [
      /\bmock\.(?:module|method|property|fn)\s*\(/gu,
      /\bglobalThis\.[A-Za-z_$][\w$]*\s*=(?!=)/gu,
      /\.prototype\.[A-Za-z_$][\w$]*\s*=(?!=)/gu,
      /\b(?:Date\.now|Math\.random|performance\.now)\s*=(?!=)/gu,
    ],
  },
});

const TEST_FILE = /\.test\.(?:js|mjs|cjs)$/u;

export function countLandmines(source) {
  const counts = {};
  for (const [rule, { patterns }] of Object.entries(RULES)) {
    const total = patterns.reduce((sum, pattern) => sum + (source.match(pattern)?.length ?? 0), 0);
    if (total > 0) counts[rule] = total;
  }
  return counts;
}

async function testFiles(root, directory = "tests") {
  const files = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "fixtures" && entry.name !== "node_modules") files.push(...await testFiles(root, relative));
    } else if (TEST_FILE.test(entry.name)) {
      files.push(relative);
    }
  }
  return files.sort();
}

export async function scanRepository(root) {
  const found = {};
  for (const file of await testFiles(root)) {
    for (const [rule, count] of Object.entries(countLandmines(await readFile(path.join(root, file), "utf8")))) {
      (found[rule] ??= {})[file] = count;
    }
  }
  return found;
}

export function compareWithAllowlist(found, allowlist) {
  const problems = [];
  for (const rule of Object.keys(RULES)) {
    const allowed = allowlist[rule] ?? {};
    const actual = found[rule] ?? {};
    for (const file of [...new Set([...Object.keys(allowed), ...Object.keys(actual)])].sort()) {
      const have = actual[file] ?? 0;
      const may = allowed[file] ?? 0;
      if (have > may) problems.push({ rule, file, kind: "NEW", message: `${file}: ${have} ${rule} (allowed ${may}). ${RULES[rule].advice}` });
      else if (have < may) problems.push({ rule, file, kind: "STALE", message: `${file}: ${rule} allowance is ${may} but only ${have} remain; lower it to ${have} in scripts/test-landmines-allowlist.json.` });
    }
  }
  return problems;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const allowlistPath = path.join(root, "scripts", "test-landmines-allowlist.json");
  const found = await scanRepository(root);
  if (process.argv.includes("--write")) {
    await writeFile(allowlistPath, `${JSON.stringify(found, null, 2)}\n`);
    console.log("Wrote scripts/test-landmines-allowlist.json");
    return;
  }
  const allowlist = JSON.parse(await readFile(allowlistPath, "utf8"));
  const problems = compareWithAllowlist(found, allowlist);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`${problem.kind} ${problem.message}`);
    console.error(`test landmines: ${problems.length} problem(s)`);
    process.exitCode = 1;
    return;
  }
  const remaining = Object.values(found).reduce((sum, files) => sum + Object.values(files).reduce((a, b) => a + b, 0), 0);
  console.log(`Test landmines valid: no new occurrences; ${remaining} allowed occurrence(s) remain to remove.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
