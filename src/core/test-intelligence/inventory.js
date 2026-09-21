import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const TEST_DIRECTORIES = Object.freeze(["test", "tests", "spec", "specs"]);
const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:c|cpp|go|java|js|jsx|mjs|py|rb|rs|ts|tsx)$/i;

async function filesUnder(root, relative = "") {
  const current = path.join(root, relative);
  let entries = [];
  try { entries = await readdir(current, { withFileTypes: true }); } catch { return []; }
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(root, child));
    else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) result.push(child);
  }
  return result;
}

function stableId(framework, file, suite, name) {
  return `test-${createHash("sha256").update(JSON.stringify({ framework, file, suite, name })).digest("hex").slice(0, 24)}`;
}

function frameworkFor(source) {
  if (/node:test/.test(source)) return "node:test";
  if (/vitest/.test(source)) return "vitest";
  if (/jest/.test(source)) return "jest";
  if (/pytest|unittest/.test(source)) return "python";
  return "unknown";
}

function collectUnits(source) {
  const units = [];
  const matcher = /\b(test|it)\s*\(\s*(["'`])([^"'`]+)\2/g;
  let match;
  while ((match = matcher.exec(source))) units.push({ name: match[3].trim(), line: source.slice(0, match.index).split("\n").length });
  return units;
}

function signals(file, name) {
  const text = `${file} ${name}`.toLowerCase();
  return {
    requiredBehavior: /contract|acceptance|required|lifecycle|protocol/.test(text),
    security: /security|auth|secret|permission|credential|csp|injection/.test(text),
    publicApi: /api|compat|public|cli|protocol/.test(text),
    criticalPath: /critical|transaction|lock|concurr|race|recovery/.test(text),
    integration: /integration|e2e|browser|provider|package|release/.test(text),
  };
}

export async function inventoryTests(projectRoot = process.cwd()) {
  const files = [];
  for (const directory of TEST_DIRECTORIES) files.push(...await filesUnder(projectRoot, directory));
  const tests = [];
  for (const relativeFile of [...new Set(files)].sort()) {
    const source = await readFile(path.join(projectRoot, relativeFile), "utf8");
    const framework = frameworkFor(source);
    for (const unit of collectUnits(source)) {
      const file = relativeFile.replaceAll(path.sep, "/");
      tests.push({
        testId: stableId(framework, file, "", unit.name), file, framework, suite: "", name: unit.name,
        line: unit.line, signals: signals(file, unit.name),
      });
    }
  }
  tests.sort((a, b) => a.testId.localeCompare(b.testId));
  return { schemaVersion: 1, source: "DETERMINISTIC", tests };
}

