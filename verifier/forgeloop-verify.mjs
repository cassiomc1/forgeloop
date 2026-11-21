#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// forgeloop-verify: an independent, dependency-free verifier for ForgeLoop
// evidence bundles (docs/PROTOCOL_SPEC.md, Sections 5-7). It shares no code
// with the ForgeLoop runtime: it reads a Git revision range, checks every
// evidence bundle the range adds or changes, and reports whether every changed
// path is covered by intact evidence that matches the head content.
//
// Signatures: this verifier checks integrity only. A bundle that carries a
// Sigstore signature is reported as SIGNATURE_NOT_VERIFIED; verify it with
// cosign, or use the reference CLI, when a signature is required.
//
// Usage: forgeloop-verify --base <rev> --head <rev> [--path <dir>] [--dir <evidence dir>]
//          [--exclude <path or dir/**>]... [--allow-partial-coverage] [--require-signature]
//          [--min-assurance REPORTED|EXECUTED|HOST_ATTESTED] [--brief <task-brief.json>] [--json]

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
const PREDICATE_TYPE = "https://forgeloop.dev/attestation/v1";
const PREDICATE_SCHEMA_VERSIONS = new Set([1, 2]);
const HEX64 = /^[a-f0-9]{64}$/u;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;

class VerifyError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new VerifyError(code, message); };
const require = (condition, code, message) => { if (!condition) fail(code, message); };

// Canonical JSON: object keys sorted recursively, JSON.stringify spacing.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const fingerprint = (value) => sha256(JSON.stringify(canonicalize(value)));

function parseArgs(argv) {
  const options = { path: ".", dir: ".forgeloop-evidence", exclude: [], allowPartial: false, requireSignature: false, minAssurance: null, brief: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => { index += 1; if (index >= argv.length) throw new Error(`${arg} needs a value`); return argv[index]; };
    if (arg === "--path") options.path = next();
    else if (arg === "--base") options.base = next();
    else if (arg === "--head") options.head = next();
    else if (arg === "--dir") options.dir = next();
    else if (arg === "--exclude") options.exclude.push(next());
    else if (arg === "--allow-partial-coverage") options.allowPartial = true;
    else if (arg === "--require-signature") options.requireSignature = true;
    else if (arg === "--min-assurance") options.minAssurance = next();
    else if (arg === "--brief") options.brief = next();
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function gitClient(cwd) {
  const run = (args, encoding = "utf8") => execFileSync("git", args, { cwd, encoding, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  return {
    resolve: (revision) => run(["rev-parse", "--verify", `${revision}^{commit}`]).trim(),
    changed(base, head) {
      const fields = run(["diff", "--name-status", "-z", "--no-renames", base, head]).split("\0").filter(Boolean);
      const entries = [];
      for (let index = 0; index < fields.length; index += 2) entries.push({ status: fields[index], path: fields[index + 1] });
      return entries;
    },
    read(revision, path) {
      try { return run(["cat-file", "blob", `${revision}:${path}`], "buffer"); } catch { return null; }
    },
    objectId(revision, path) {
      try { return run(["rev-parse", `${revision}:${path}`]).trim(); } catch { return null; }
    },
  };
}

const normalize = (value) => String(value).replaceAll("\\", "/").replace(/^\.\//u, "");
function excluded(path, directory, patterns) {
  if (path === ".forgeloop" || path.startsWith(".forgeloop/")) return true;
  if (path === directory || path.startsWith(`${directory}/`)) return true;
  return patterns.some((pattern) => {
    const value = normalize(pattern);
    return value.endsWith("/**") ? path === value.slice(0, -3) || path.startsWith(value.slice(0, -2)) : path === value;
  });
}

function bundleDigest(bundle) {
  const { digest: _digest, ...body } = bundle;
  return sha256(JSON.stringify(body));
}

function manifestContentDigest(entries) {
  return fingerprint(entries.map((entry) => ({
    path: entry.path,
    sourcePath: entry.sourcePath ?? null,
    operation: entry.operation,
    kind: entry.kind,
    sha256: entry.sha256 ?? null,
    providerContentId: entry.providerContentId ?? null,
    providerMetadata: entry.providerMetadata ?? {},
  })));
}

const entryPaths = (entry) => [entry.path, entry.sourcePath].filter(Boolean).map(normalize);

// Section 6: the bundle, its statement (Section 5) and its manifest must be
// mutually consistent before any content is compared.
function checkBundle(text, expectedTaskId) {
  let bundle;
  try { bundle = JSON.parse(text); } catch { fail("E_EVIDENCE_BUNDLE_INVALID", "Evidence bundle is not valid JSON"); }
  require(bundle && typeof bundle === "object" && !Array.isArray(bundle), "E_EVIDENCE_BUNDLE_INVALID", "Evidence bundle must be an object");
  require(bundle.schemaVersion === 1, "E_EVIDENCE_BUNDLE_INVALID", `Unsupported evidence bundle schemaVersion: ${bundle.schemaVersion}`);
  require(bundle.kind === "forgeloop-evidence-bundle", "E_EVIDENCE_BUNDLE_INVALID", "Evidence bundle kind is not forgeloop-evidence-bundle");
  require(typeof bundle.taskId === "string" && TASK_ID.test(bundle.taskId), "E_EVIDENCE_BUNDLE_INVALID", `Invalid evidence task ID: ${bundle.taskId}`);
  require(bundle.taskId === expectedTaskId, "E_EVIDENCE_BUNDLE_INVALID", `Evidence bundle taskId ${bundle.taskId} does not match its file name`);
  require(typeof bundle.statement?.text === "string", "E_EVIDENCE_BUNDLE_INVALID", "Evidence bundle is missing the statement text");
  require(bundle.manifest && typeof bundle.manifest === "object", "E_EVIDENCE_BUNDLE_INVALID", "Evidence bundle is missing the code manifest");
  require(bundle.manifestFingerprint === fingerprint(bundle.manifest), "E_EVIDENCE_BUNDLE_INVALID", "Evidence bundle manifest fingerprint does not match its manifest");
  require(bundle.signature === null || (typeof bundle.signature?.bundleText === "string" && typeof bundle.signature?.provider === "string"), "E_EVIDENCE_BUNDLE_INVALID", "Evidence bundle signature is malformed");
  require(typeof bundle.digest === "string" && bundle.digest === bundleDigest(bundle), "E_EVIDENCE_BUNDLE_INVALID", "Evidence bundle digest does not match its content");

  let statement;
  try { statement = JSON.parse(bundle.statement.text); } catch { fail("E_EVIDENCE_BUNDLE_INVALID", "Evidence bundle statement text is not valid JSON"); }
  require(statement?._type === STATEMENT_TYPE && statement.predicateType === PREDICATE_TYPE, "E_ATTESTATION_STATEMENT_INVALID", "Statement type or predicate type is not the ForgeLoop v1 contract");
  const predicate = statement.predicate;
  require(predicate && PREDICATE_SCHEMA_VERSIONS.has(predicate.schemaVersion), "E_ATTESTATION_STATEMENT_INVALID", `Unsupported predicate schemaVersion: ${predicate?.schemaVersion}`);
  require(predicate.protocol?.name === "ForgeLoop" && predicate.protocol?.protocolVersion === 1, "E_ATTESTATION_STATEMENT_INVALID", "Predicate protocol is not ForgeLoop 1");
  require(typeof predicate.task?.taskId === "string" && Number.isInteger(predicate.task?.verificationCycle), "E_ATTESTATION_STATEMENT_INVALID", "Predicate task is malformed");
  require(HEX64.test(predicate.content?.manifestFingerprint ?? "") && HEX64.test(predicate.content?.contentDigest ?? "") && Array.isArray(predicate.content?.coveredPaths), "E_ATTESTATION_STATEMENT_INVALID", "Predicate content is malformed");
  require(predicate.verification?.completion === "VALID" && predicate.verification?.audit === "VALID", "E_ATTESTATION_STATEMENT_INVALID", "Predicate does not record a VALID completion and audit");
  const checks = predicate.verification.checks;
  require(predicate.schemaVersion === 1 ? checks === undefined : Array.isArray(checks), "E_ATTESTATION_STATEMENT_INVALID", predicate.schemaVersion === 1 ? "Predicate schema version 1 must not carry verification.checks" : "Predicate schema version 2 requires verification.checks");
  for (const check of checks ?? []) {
    require(typeof check?.id === "string" && typeof check.requirement === "string"
      && ["passed", "failed", "blocked", "not-run"].includes(check.status)
      && ["FORGELOOP_EXECUTED", "ACTOR_REPORTED", "MANUAL_OBSERVATION", "UNKNOWN"].includes(check.provenance)
      && (check.exitCode === null || Number.isInteger(check.exitCode))
      && (check.argvDigest === null || HEX64.test(check.argvDigest)), "E_ATTESTATION_STATEMENT_INVALID", "Predicate check entry is malformed");
  }
  require(Array.isArray(statement.subject) && statement.subject.length === 1, "E_ATTESTATION_STATEMENT_INVALID", "Statement must have exactly one subject");
  require(statement.subject[0].name === `forgeloop-task:${predicate.task.taskId}`, "E_ATTESTATION_SUBJECT_MISMATCH", "Statement subject does not match the attested task");
  require(statement.subject[0].digest?.sha256 === predicate.content.contentDigest, "E_ATTESTATION_SUBJECT_MISMATCH", "Statement subject digest does not match the predicate content digest");

  const manifest = bundle.manifest;
  require(Array.isArray(manifest.entries), "E_ATTESTATION_MANIFEST_INVALID", "Manifest entries must be an array");
  const paths = manifest.entries.map((entry) => entry.path);
  require(new Set(paths).size === paths.length, "E_ATTESTATION_MANIFEST_INVALID", "Manifest entries must not contain duplicate paths");
  require(JSON.stringify([...paths].sort((left, right) => left.localeCompare(right))) === JSON.stringify(paths), "E_ATTESTATION_MANIFEST_INVALID", "Manifest entries must be sorted by normalized path");
  require(manifest.contentDigest === manifestContentDigest(manifest.entries), "E_ATTESTATION_MANIFEST_INVALID", "Manifest contentDigest does not match its entries");

  require(predicate.task.taskId === bundle.taskId && predicate.task.verificationCycle === manifest.verificationCycle, "E_ATTESTATION_SCOPE_MISMATCH", "Attestation statement task or verification cycle does not match the manifest");
  require(predicate.content.manifestFingerprint === bundle.manifestFingerprint, "E_ATTESTATION_SUBJECT_MISMATCH", "Statement does not bind the current code manifest");
  require(predicate.content.contentDigest === manifest.contentDigest, "E_ATTESTATION_SUBJECT_MISMATCH", "Statement subject does not bind the manifest content digest");
  const expectedPaths = [...new Set(manifest.entries.flatMap((entry) => [entry.path, entry.sourcePath].filter(Boolean)))].sort();
  const actualPaths = [...new Set(predicate.content.coveredPaths)].sort();
  require(JSON.stringify(expectedPaths) === JSON.stringify(actualPaths), "E_ATTESTATION_SCOPE_MISMATCH", "Statement covered paths do not match the manifest");
  for (const [key, code] of [
    ["contractFingerprint", "E_ATTESTATION_CONTRACT_MISMATCH"], ["routeFingerprint", "E_ATTESTATION_ROUTE_MISMATCH"],
    ["stateFingerprint", "E_ATTESTATION_STATE_MISMATCH"], ["receiptFingerprint", "E_ATTESTATION_RECEIPT_MISMATCH"],
    ["ledgerSeq", "E_ATTESTATION_LEDGER_MISMATCH"], ["ledgerHash", "E_ATTESTATION_LEDGER_MISMATCH"],
  ]) {
    require(predicate.evidence?.[key] === manifest.bindings?.[key], code, `Statement evidence does not match the manifest binding: ${key}`);
  }
  return { bundle, predicate, manifest };
}

// Does one manifest entry match the content at the head revision?
function entryMatches(git, head, entry) {
  if (entry.kind === "DELETED" || entry.operation === "DELETED") return git.objectId(head, entry.path) === null;
  if (entry.kind === "GITLINK") return git.objectId(head, entry.path) === entry.providerContentId;
  const bytes = git.read(head, entry.path);
  if (bytes === null) return false;
  if (entry.sha256) return sha256(bytes) === entry.sha256;
  return git.objectId(head, entry.path) === entry.providerContentId;
}

// Section 7.2, derived from a version-2 predicate; version 1 carries no checks.
function executionAssurance(predicate) {
  if (predicate.schemaVersion < 2 || !Array.isArray(predicate.verification?.checks) || predicate.verification.checks.length === 0) return "UNKNOWN";
  return predicate.verification.checks.every((check) => check.provenance === "FORGELOOP_EXECUTED") ? "EXECUTED" : "REPORTED";
}

const ASSURANCE = ["UNKNOWN", "REPORTED", "EXECUTED", "HOST_ATTESTED"];

// Section 8: a task brief names the delegated task, the paths it may change
// and the verification it owes.
function readBrief(root, briefPath) {
  let brief;
  try { brief = JSON.parse(readFileSync(join(root, briefPath), "utf8")); } catch (error) { fail("E_DELEGATION_BRIEF_INVALID", `Task brief ${briefPath} cannot be read: ${error.message}`); }
  const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
  require(typeof brief?.taskId === "string" && strings(brief.allowedPaths) && strings(brief.readOnlyPaths) && strings(brief.verification) && brief.verification.length > 0,
    "E_DELEGATION_BRIEF_INVALID", `Task brief ${briefPath} is missing taskId, allowedPaths, readOnlyPaths or verification`);
  const paths = (list) => list.map((item) => normalize(item).replace(/\/+$/u, ""));
  return { taskId: brief.taskId, allowedPaths: paths(brief.allowedPaths), readOnlyPaths: paths(brief.readOnlyPaths), verification: brief.verification };
}

const within = (value, root) => value === root || value.startsWith(`${root}/`);

function delegationErrors(brief, bundles) {
  const bundle = bundles.find((item) => item.taskId === brief.taskId && item.integrity === "VALID");
  if (!bundle) return [{ code: "E_DELEGATION_EVIDENCE_MISSING", taskId: brief.taskId, message: `No intact evidence bundle for delegated task ${brief.taskId} in the range` }];
  const errors = [];
  const offending = [...new Set(bundle.coveredPaths.filter((value) => !brief.allowedPaths.some((root) => within(value, root)) || brief.readOnlyPaths.some((root) => within(value, root))))].sort();
  if (offending.length > 0) errors.push({ code: "E_DELEGATION_SCOPE_VIOLATION", taskId: brief.taskId, paths: offending, message: `Delegated task ${brief.taskId} changed paths outside its brief: ${offending.join(", ")}` });
  const passed = (bundle.checks ?? []).filter((check) => check.status === "passed");
  const unmet = brief.verification.filter((item) => !passed.some((check) => check.requirement === item || check.id === item));
  if (unmet.length > 0) errors.push({ code: "E_DELEGATION_VERIFICATION_UNMET", taskId: brief.taskId, requirements: unmet, message: `Delegated task ${brief.taskId} has no passing bound check for: ${unmet.join("; ")}` });
  return errors;
}

export function verifyRange({ path = ".", base, head, dir = ".forgeloop-evidence", exclude = [], allowPartial = false, requireSignature = false, minAssurance = null, brief = null } = {}) {
  const delegationBrief = brief ? readBrief(path, brief) : null;
  if (minAssurance !== null && !ASSURANCE.includes(minAssurance)) throw new Error(`Unknown execution assurance: ${minAssurance}`);
  const git = gitClient(path);
  const baseRevision = git.resolve(base);
  const headRevision = git.resolve(head);
  const directory = normalize(dir).replace(/\/+$/u, "");
  const changed = git.changed(baseRevision, headRevision).map((entry) => ({ ...entry, path: normalize(entry.path) }));
  const changedPaths = [...new Set(changed.map((entry) => entry.path))].filter((value) => !excluded(value, directory, exclude)).sort();
  const bundlePaths = changed
    .filter((entry) => entry.status !== "D" && entry.path.startsWith(`${directory}/`) && entry.path.endsWith(".json"))
    .map((entry) => entry.path).sort();

  const bundles = bundlePaths.map((bundlePath) => {
    const taskId = bundlePath.slice(directory.length + 1, -".json".length);
    const record = { path: bundlePath, taskId, integrity: "INVALID", signature: { status: "NOT_CHECKED" }, assurance: "UNKNOWN", entries: [] };
    try {
      const { bundle, predicate, manifest } = checkBundle(git.read(headRevision, bundlePath).toString("utf8"), taskId);
      record.entries = manifest.entries.map((entry) => ({ paths: entryPaths(entry), matches: entryMatches(git, headRevision, entry) }));
      record.integrity = "VALID";
      record.signature = { status: bundle.signature ? "SIGNATURE_NOT_VERIFIED" : "UNSIGNED" };
      record.assurance = executionAssurance(predicate);
      record.coveredPaths = predicate.content.coveredPaths.map(normalize);
      record.checks = Array.isArray(predicate.verification.checks) ? predicate.verification.checks : null;
    } catch (error) {
      if (!(error instanceof VerifyError)) throw error;
      record.error = { code: error.code, message: error.message };
    }
    return record;
  });

  const valid = bundles.filter((bundle) => bundle.integrity === "VALID");
  const covering = new Map();
  for (const bundle of valid) {
    for (const entry of bundle.entries.filter((item) => item.matches)) {
      for (const value of entry.paths) covering.set(value, [...(covering.get(value) ?? []), bundle.taskId]);
    }
  }
  const errors = bundles.filter((bundle) => bundle.error).map((bundle) => ({ ...bundle.error, taskId: bundle.taskId, path: bundle.path }));
  for (const bundle of valid) {
    for (const entry of bundle.entries.filter((item) => !item.matches)) {
      for (const value of entry.paths) {
        if (!covering.has(value)) errors.push({ code: "E_ATTESTATION_CONTENT_MISMATCH", taskId: bundle.taskId, path: value, message: `Evidence for ${value} does not match the head revision and no other bundle covers it` });
      }
    }
  }
  const uncoveredPaths = changedPaths.filter((value) => !covering.has(value));
  if (!allowPartial && uncoveredPaths.length > 0) {
    errors.push({ code: "E_ATTESTATION_COVERAGE_GAP", message: `Changed paths are not covered by evidence: ${uncoveredPaths.join(", ")}`, paths: uncoveredPaths });
  }
  if (requireSignature) {
    for (const bundle of valid) {
      if (bundle.signature.status === "UNSIGNED") errors.push({ code: "E_ATTESTATION_UNSIGNED", taskId: bundle.taskId, message: `Evidence for task ${bundle.taskId} has no valid signature` });
      else errors.push({ code: "E_ATTESTATION_SIGNATURE_NOT_VERIFIED", taskId: bundle.taskId, message: "This verifier does not check signatures; verify them with cosign or the reference CLI" });
    }
  }
  // HOST_ATTESTED needs a verified CI signature, which this verifier does not
  // check, so the highest assurance it reports is EXECUTED.
  const assurance = valid.length === 0 ? "UNKNOWN" : valid.map((bundle) => bundle.assurance).reduce((low, value) => (ASSURANCE.indexOf(value) < ASSURANCE.indexOf(low) ? value : low));
  if (minAssurance !== null && ASSURANCE.indexOf(assurance) < ASSURANCE.indexOf(minAssurance)) {
    errors.push({ code: "E_EVIDENCE_ASSURANCE_INSUFFICIENT", message: `Execution assurance ${assurance} is below the required ${minAssurance}`, assurance, required: minAssurance });
  }
  const delegation = delegationBrief ? delegationErrors(delegationBrief, bundles) : null;
  if (delegation) errors.push(...delegation);
  const status = errors.length === 0 ? "VALID" : "INVALID";
  return {
    schemaVersion: 1,
    kind: "forgeloop-evidence-verification",
    verifier: "forgeloop-verify (independent)",
    status,
    level: status === "VALID" ? "INTEGRITY_ONLY" : "NONE",
    assurance,
    ...(delegationBrief ? { delegation: { taskId: delegationBrief.taskId, status: delegation.length === 0 ? "ACCEPTED" : "REJECTED" } } : {}),
    baseRevision,
    headRevision,
    evidenceDirectory: directory,
    changedPaths: changedPaths.length,
    coveredPaths: changedPaths.length - uncoveredPaths.length,
    uncoveredPaths,
    bundles: bundles.map(({ entries, coveredPaths: _coveredPaths, checks: _checks, ...bundle }) => ({ ...bundle, entries: entries.length, matchingEntries: entries.filter((entry) => entry.matches).length })),
    errors,
  };
}

// npx and installed bins run through a node_modules/.bin symlink, so compare
// real paths; a literal argv[1] comparison never matches and exits 0 silently.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

const isMain = invokedDirectly();
if (isMain) {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(2); }
  if (options.help || !options.base || !options.head) {
    console.log("Usage: forgeloop-verify --base <rev> --head <rev> [--path <dir>] [--dir <evidence dir>] [--exclude <path>]... [--allow-partial-coverage] [--require-signature] [--min-assurance <level>] [--brief <task-brief.json>] [--json]");
    process.exit(options.help ? 0 : 2);
  }
  const result = verifyRange(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${result.status} (${result.level}, assurance ${result.assurance}): ${result.coveredPaths}/${result.changedPaths} changed paths covered`);
    for (const error of result.errors) console.log(`- ${error.code}: ${error.message}`);
  }
  process.exitCode = result.status === "VALID" ? 0 : 1;
}
