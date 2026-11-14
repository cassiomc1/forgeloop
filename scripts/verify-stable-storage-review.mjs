import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export function stableStorageReviewPath(version) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/u.test(version)) throw new Error(`Stable storage review requires an exact stable version, got ${version}`);
  return `benchmarks/storage-sqlite/stable-${version}-writer-review.json.gz`;
}

function packageVersion(root) {
  return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
}

// Repository release admission, not a signature or a replacement for behavioral CI.
// Each stable version must carry its own review; there is no fallback to an
// earlier version's report, so changed runtime bytes always need a fresh review.
export function verifyStableStorageReview(root = process.cwd(), version = packageVersion(root)) {
  const reportPath = stableStorageReviewPath(version);
  let compressed;
  try { compressed = readFileSync(path.join(root, reportPath)); }
  catch { throw new Error(`Supported operational writer review is missing for ${version}: ${reportPath}`); }
  const report = JSON.parse(gunzipSync(compressed));
  if (report.reviewedVersion !== undefined && report.reviewedVersion !== version) throw new Error(`Writer review ${reportPath} is bound to ${report.reviewedVersion}, not ${version}`);
  if (report.sourceAcceptance?.supportedOperationalWriterClosure !== true) throw new Error("Supported operational writer review is incomplete");
  const files = [];
  function collect(directory) {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Runtime source symlink: ${relative}`);
      if (entry.isDirectory()) collect(relative);
      else if (entry.isFile() && entry.name.endsWith(".js")) files.push(relative);
    }
  }
  for (const directory of ["src", "integrations/mcp/src"]) collect(directory);
  if (JSON.stringify(files.sort()) !== JSON.stringify(Object.keys(report.sourceManifest).sort())) throw new Error("Reviewed runtime module membership changed");
  for (const relative of files) {
    const text = readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
    const digest = createHash("sha256").update(text).digest("hex");
    if (digest !== report.sourceManifest[relative]) throw new Error(`Reviewed runtime source changed: ${relative}`);
  }
  return { valid: true, version, modules: files.length, boundary: "supported-operational-writers", publicationVerified: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(verifyStableStorageReview())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
