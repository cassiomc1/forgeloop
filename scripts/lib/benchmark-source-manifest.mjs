import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import path from "node:path";

export const BENCHMARK_SOURCE_MANIFEST_SCHEMA_VERSION = 2;

export const BENCHMARK_SOURCE_UNTRACKED_POLICY = Object.freeze({
  mode: "allow-listed",
  command: "git ls-files --others --exclude-standard -z",
  allowedPrefixes: Object.freeze([
    "node_modules",
    "integrations/mcp/node_modules",
  ]),
  ignoredPathLimitation: "git --exclude-standard omits ignored paths; ignored files are not enumerated by this manifest",
});

function decodeNulSeparated(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean);
}

function allowedPrefixFor(filename) {
  return BENCHMARK_SOURCE_UNTRACKED_POLICY.allowedPrefixes.find(prefix =>
    filename === prefix || filename.startsWith(`${prefix}/`)) ?? null;
}

function assertSafeRelativePath(filename, label) {
  assert.ok(
    typeof filename === "string"
      && filename.length > 0
      && !path.isAbsolute(filename)
      && !filename.includes("\0")
      && !filename.split("/").includes(".."),
    `${label} contains an unsafe path`,
  );
}

async function admittedDependencyEvidence(root, untracked) {
  const roots = [...new Set(untracked.map(allowedPrefixFor).filter(Boolean))].sort();
  return Promise.all(roots.map(async filename => {
    const absolutePath = path.join(root, filename);
    const stats = await lstat(absolutePath);
    const type = stats.isSymbolicLink()
      ? "symlink"
      : stats.isDirectory()
        ? "directory"
        : stats.isFile()
          ? "file"
          : "other";
    return {
      path: filename,
      type,
      resolvedPath: await realpath(absolutePath),
      symlinkTarget: type === "symlink" ? await readlink(absolutePath) : null,
    };
  }));
}

export async function captureBenchmarkSourceManifest(root) {
  const revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const status = execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim();
  const untracked = decodeNulSeparated(execFileSync(
    "git",
    ["-C", root, "ls-files", "--others", "--exclude-standard", "-z"],
    { encoding: "buffer" },
  ));
  for (const filename of untracked) assertSafeRelativePath(filename, `${root} untracked path`);
  const unexpectedUntracked = untracked.filter(filename => allowedPrefixFor(filename) === null).sort();
  const files = decodeNulSeparated(execFileSync(
    "git",
    ["-C", root, "ls-files", "-z"],
    { encoding: "buffer" },
  )).sort();
  return {
    revision,
    status,
    trackedFiles: files.length,
    files: await Promise.all(files.map(async filename => ({
      path: filename,
      sha256: createHash("sha256").update(await readFile(path.join(root, filename))).digest("hex"),
    }))),
    untrackedPolicy: BENCHMARK_SOURCE_UNTRACKED_POLICY,
    untrackedEvidence: {
      scannedPathCount: untracked.length,
      admittedEntries: await admittedDependencyEvidence(root, untracked),
      unexpectedPaths: unexpectedUntracked,
    },
  };
}
