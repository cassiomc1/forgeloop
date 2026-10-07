/** Reproducible conservative persistence inventory; discovery is not scope approval. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const baselineRevision = "ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5";
assert.ok(argument("baseline-root"), "A clean pinned baseline is required");
const baselineRoot = path.resolve(argument("baseline-root"));
const currentRoot = path.resolve(import.meta.dirname, "..");
assert.equal(execFileSync("git", ["-C", baselineRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baselineRevision);
assert.equal(execFileSync("git", ["-C", baselineRoot, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim(), "");
const productionRoots = ["src", "integrations/mcp/src"];
const persistenceSignal = /\b(?:readJsonArtifact|writeJsonArtifact|readWorkState|writeWorkState|mutateWorkState|readEvents|iterateEvents|appendProtocolEvent|taskArtifactPath|taskDirectory|withTaskTransaction|withTaskMutation|discoverTasks|findTaskById|readFile|writeFile|readdir|rename|unlink|readBytes|writeFileAtomic|withProjectStorage|withExistingProjectScope|operationalArtifactExists|getOperationalStore)\b/u;
async function inventory(root) {
  const files = new Map();
  async function walk(relative) {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const filename = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (entry.isFile() && /\.(?:js|mjs|ts)$/u.test(filename)) {
        const bytes = await readFile(path.join(root, filename));
        const source = bytes.toString("utf8");
        files.set(filename, { nonblankPhysicalLines: source.split(/\r?\n/u).filter(line => line.trim()).length,
          bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), persistenceSignal: persistenceSignal.test(source) });
      }
    }
  }
  for (const relative of productionRoots) await walk(relative);
  return files;
}
const baseline = await inventory(baselineRoot); const current = await inventory(currentRoot);
const changed = new Set(execFileSync("git", ["-C", currentRoot, "diff", "--name-only", baselineRevision, "--", ...productionRoots], { encoding: "utf8" }).trim().split("\n"));
const files = [...new Set([...baseline.keys(), ...current.keys()])].sort().map(filename => {
  const before = baseline.get(filename); const after = current.get(filename);
  const reasons = [];
  if (before?.persistenceSignal) reasons.push("baseline-direct-persistence-or-file-IO-signal");
  if (after?.persistenceSignal) reasons.push("current-direct-persistence-or-file-IO-signal");
  if (filename.startsWith("src/storage/")) reasons.push("complete-storage-import-export-maintenance-owner");
  if (changed.has(filename)) reasons.push("changed-production-module-included-conservatively");
  if (!before && after) reasons.push("new-production-module-included-conservatively");
  return { path: filename, included: reasons.length > 0, scopeReview: "PENDING", reasons, baseline: before ?? null, current: after ?? null };
});
const selected = files.filter(value => value.included);
const total = side => selected.reduce((sum, value) => sum + (value[side]?.nonblankPhysicalLines ?? 0), 0);
const before = total("baseline"); const after = total("current");
assert.ok(before > 0);
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, baselineRevision, productionRoots,
  countingMethod: "Nonblank physical production lines including comments; same whole-module union on both sides; tests/scripts/package manifests excluded",
  scopeMethod: "Conservative candidate union: direct persistence/file-I/O signals in either version, every storage module, every changed/new production module. All omitted modules are listed too. Requires semantic scope review before release acceptance.",
  scopeReviewComplete: false, releaseThresholdsVerified: false, includedFiles: selected.length,
  baselineNonblankPhysicalLines: before, currentNonblankPhysicalLines: after, netReduction: 1 - after / before,
  candidateTargetMet: after <= before * 0.75, files }, null, 2)}\n`);
