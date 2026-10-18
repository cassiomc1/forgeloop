import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

// Repository release admission, not a signature or a replacement for behavioral CI.
export function verifyStableStorageReview(root = process.cwd()) {
  const report = JSON.parse(gunzipSync(readFileSync(path.join(root, "benchmarks/storage-sqlite/stable-2.0.0-writer-review.json.gz"))));
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
  return { valid: true, modules: files.length, boundary: "supported-operational-writers", publicationVerified: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(verifyStableStorageReview())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
