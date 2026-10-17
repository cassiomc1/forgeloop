#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(new URL("../skills/security-audit/", import.meta.url));
const upstream = "https://github.com/cloudflare/security-audit-skill";
const requiredFiles = ["SKILL.md", "LICENSE", "report-schema.json", "validate-findings.cjs", "validate-coverage-ledger.cjs"];

async function regularFile(file) {
  let metadata;
  try { metadata = await lstat(file); } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Skill integrity: missing ${path.basename(file)}`);
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Skill integrity: expected a regular file, no symlink: ${path.basename(file)}`);
  }
  return readFile(file);
}

function validatePin(pin) {
  if (pin?.schemaVersion !== 1 || pin.repository !== upstream
    || pin.upstreamDirectory !== "skills/security-audit" || pin.license !== "MIT"
    || typeof pin.commit !== "string" || !/^[a-f0-9]{40}$/u.test(pin.commit)
    || !pin.files || typeof pin.files !== "object" || Array.isArray(pin.files)) {
    throw new Error("Skill integrity: invalid upstream pin");
  }
  for (const [name, digest] of Object.entries(pin.files)) {
    if (name === "PIN.json" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)
      || typeof digest !== "string" || !/^[a-f0-9]{64}$/u.test(digest)) {
      throw new Error(`Skill integrity: unsafe filename or invalid digest: ${name}`);
    }
  }
  if (requiredFiles.some(name => !Object.hasOwn(pin.files, name))) {
    throw new Error("Skill integrity: invalid pin missing required resources");
  }
}

export async function verifySecurityAuditSkill({ rootDir = defaultRoot } = {}) {
  const metadata = await lstat(rootDir);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("Skill integrity: expected a directory, no symlink");
  const pin = JSON.parse(await regularFile(path.join(rootDir, "PIN.json")));
  validatePin(pin);
  const expected = [...Object.keys(pin.files), "PIN.json"].sort();
  const actual = (await readdir(rootDir)).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error("Skill integrity: missing or unexpected files");
  }
  for (const [name, digest] of Object.entries(pin.files)) {
    const bytes = await regularFile(path.join(rootDir, name));
    if (createHash("sha256").update(bytes).digest("hex") !== digest) {
      throw new Error(`Skill integrity: SHA-256 mismatch: ${name}`);
    }
  }
  return { valid: true, commit: pin.commit, filesChecked: Object.keys(pin.files).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await verifySecurityAuditSkill()));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
