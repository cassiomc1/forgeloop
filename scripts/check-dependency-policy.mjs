#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APPROVED_DEV_DEPENDENCIES = Object.freeze([
  "c8",
  "eslint",
  "typescript",
  "yaml",
]);

export const APPROVED_RUNTIME_DEPENDENCIES = Object.freeze([
  "smol-toml",
]);

const RUNTIME_DEPENDENCY_GROUPS = Object.freeze([
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
]);

export function validateDependencyPolicy(packageJson) {
  const violations = [];
  const approvedRuntime = new Set(APPROVED_RUNTIME_DEPENDENCIES);
  for (const group of RUNTIME_DEPENDENCY_GROUPS) {
    for (const name of Object.keys(packageJson[group] ?? {}).sort()) {
      if (group === "dependencies" && approvedRuntime.has(name)) continue;
      violations.push(`${group}:${name}`);
    }
  }
  const approved = new Set(APPROVED_DEV_DEPENDENCIES);
  for (const name of Object.keys(packageJson.devDependencies ?? {}).sort()) {
    if (!approved.has(name)) violations.push(`devDependencies:${name}`);
  }
  return { ok: violations.length === 0, violations };
}

async function main() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  const result = validateDependencyPolicy(packageJson);
  if (!result.ok) {
    console.error(`Dependency policy violation: ${result.violations.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Dependency policy valid: runtime ${APPROVED_RUNTIME_DEPENDENCIES.join(", ")}; development ${APPROVED_DEV_DEPENDENCIES.join(", ")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
