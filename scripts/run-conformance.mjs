#!/usr/bin/env node
// Runs the verifier conformance suite in conformance/cases.json (see
// docs/PROTOCOL_SPEC.md, Section 10). Each case builds a two-commit Git
// repository from a fixture, applies its mutations to the head commit, runs the
// verifier over base..head and compares status, level and error codes.
//
// The verifier is the reference CLI by default. Any other implementation is
// tested by setting FORGELOOP_CONFORMANCE_VERIFIER to a JSON array argv prefix,
// for example '["my-verifier","verify"]'; the runner appends
// --path, --base, --head, --json and the case's own arguments. --independent
// selects the Apache-2.0 verifier in verifier/forgeloop-verify.mjs.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suite = JSON.parse(await readFile(path.join(root, "conformance/cases.json"), "utf8"));
const args = process.argv.slice(2);
const independent = args.includes("--independent");
const verifier = independent
  ? [process.execPath, path.join(root, "verifier/forgeloop-verify.mjs")]
  : process.env.FORGELOOP_CONFORMANCE_VERIFIER
    ? JSON.parse(process.env.FORGELOOP_CONFORMANCE_VERIFIER)
    : [process.execPath, path.join(root, "src/cli.js"), "evidence-verify"];
const only = args.filter((arg) => arg !== "--independent");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function setPointer(object, pointer, value) {
  const keys = pointer.split("/").slice(1).map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
  let node = object;
  for (const key of keys.slice(0, -1)) node = node[key];
  node[keys.at(-1)] = value;
}

// "reseal": recompute the manifest fingerprint and bundle digest after the
// mutations, so a verifier must catch the inconsistency in the statement,
// manifest or bindings instead of in the outer digest.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
function reseal(bundle) {
  bundle.manifestFingerprint = sha256(JSON.stringify(canonicalize(bundle.manifest)));
  const { digest: _digest, ...body } = bundle;
  bundle.digest = sha256(JSON.stringify(body));
}

async function applyMutation(directory, bundleState, mutation) {
  switch (mutation.type) {
    case "append-file": {
      const file = path.join(directory, mutation.path);
      await writeFile(file, `${await readFile(file, "utf8")}${mutation.content}`);
      return;
    }
    case "write-file": {
      const file = path.join(directory, mutation.path);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, mutation.content);
      return;
    }
    case "edit-statement": {
      const text = bundleState.bundle.statement.text;
      if (!text.includes(mutation.find)) throw new Error(`edit-statement: "${mutation.find}" not found`);
      bundleState.bundle.statement.text = text.replace(mutation.find, mutation.replace);
      return;
    }
    case "edit-bundle":
      setPointer(bundleState.bundle, mutation.pointer, mutation.value);
      return;
    case "rename-bundle":
      bundleState.fileTaskId = mutation.taskId;
      return;
    default:
      throw new Error(`Unknown mutation type: ${mutation.type}`);
  }
}

async function runCase(testCase) {
  const fixture = path.join(root, "conformance/fixtures", testCase.fixture);
  const directory = await mkdtemp(path.join(os.tmpdir(), `forgeloop-conformance-${testCase.id}-`));
  try {
    git(directory, "init", "-q", "-b", "main");
    git(directory, "config", "user.email", "conformance@forgeloop.invalid");
    git(directory, "config", "user.name", "ForgeLoop conformance");
    git(directory, "config", "commit.gpgsign", "false");
    await writeFile(path.join(directory, "README.md"), "conformance base\n");
    git(directory, "add", "-A");
    git(directory, "commit", "-q", "-m", "base");
    const base = git(directory, "rev-parse", "HEAD");

    await cp(path.join(fixture, "tree"), directory, { recursive: true });
    const bundle = JSON.parse(await readFile(path.join(fixture, "bundle.json"), "utf8"));
    const bundleState = { bundle, fileTaskId: bundle.taskId };
    for (const mutation of testCase.mutations) await applyMutation(directory, bundleState, mutation);
    if (testCase.reseal) reseal(bundleState.bundle);
    await mkdir(path.join(directory, ".forgeloop-evidence"), { recursive: true });
    await writeFile(path.join(directory, ".forgeloop-evidence", `${bundleState.fileTaskId}.json`), `${JSON.stringify(bundleState.bundle, null, 2)}\n`);
    git(directory, "add", "-A");
    git(directory, "commit", "-q", "-m", "head");
    const head = git(directory, "rev-parse", "HEAD");

    // A delegation brief is written after the head commit, so it is never a
    // changed path; the verifier reads it from the working tree.
    const briefArgs = [];
    if (testCase.brief) {
      await writeFile(path.join(directory, ".delegation-brief.json"), await readFile(path.join(fixture, testCase.brief), "utf8"));
      briefArgs.push("--brief", ".delegation-brief.json");
    }
    const [command, ...prefix] = verifier;
    const run = spawnSync(command, [...prefix, "--path", directory, "--base", base, "--head", head, "--json", ...testCase.args, ...briefArgs], { encoding: "utf8" });
    let result;
    try { result = JSON.parse(run.stdout); } catch { return { ok: false, detail: `verifier did not print JSON (exit ${run.status}): ${run.stderr.trim().slice(0, 300)}` }; }
    const actual = {
      status: result.status,
      level: result.level,
      ...("assurance" in testCase.expect ? { assurance: result.assurance } : {}),
      errorCodes: [...new Set((result.errors ?? []).map((error) => error.code))].sort(),
    };
    const expected = { ...testCase.expect, errorCodes: [...testCase.expect.errorCodes].sort() };
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    return { ok, detail: ok ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const cases = suite.cases.filter((testCase) => only.length === 0 || only.includes(testCase.id));
let failures = 0;
for (const testCase of cases) {
  const { ok, detail } = await runCase(testCase);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${testCase.id} (spec ${testCase.clause})${detail ? `\n     ${detail}` : ""}`);
}
console.log(`\n${cases.length - failures}/${cases.length} conformance cases passed`);
process.exitCode = failures === 0 ? 0 : 1;
