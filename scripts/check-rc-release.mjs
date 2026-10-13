import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const RC_BASELINE = "14008f58f8ad255692997ce3fff359591fb695d1";
export const RC_SCRIPTS = Object.freeze({
  "release:quick": "node scripts/run-rc-release.mjs",
  "release:rc:check": "node scripts/check-rc-release.mjs",
  "storage:writer-inventory": "node scripts/storage-writer-inventory.mjs",
});
const mcpMetadata = new Set(["integrations/mcp/package.json", "integrations/mcp/package-lock.json"]);
const runtimePath = value => /^(?:src|schemas|integrations|bin)\//u.test(value) && !value.split("/").includes("node_modules") && !mcpMetadata.has(value);
const canonical = value => JSON.stringify(value, (_key, item) => item && !Array.isArray(item) && typeof item === "object"
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export function validateRcSnapshot({ baselinePackage, currentPackage, baselineLock, currentLock, baselineFiles, currentFiles }) {
  if (!/^2\.0\.0-rc\.[1-9]\d*$/u.test(currentPackage.version)) throw new Error("Bounded release validation admits only 2.0.0-rc.N; stable publication requires full acceptance");
  const oldPackage = structuredClone(baselinePackage);
  const newPackage = structuredClone(currentPackage);
  delete oldPackage.version; delete newPackage.version;
  for (const [name, command] of Object.entries(RC_SCRIPTS)) {
    if (newPackage.scripts[name] !== command) throw new Error(`Missing or changed RC command: ${name}`);
    delete newPackage.scripts[name];
  }
  if (canonical(oldPackage) !== canonical(newPackage)) throw new Error("RC package metadata or dependencies changed beyond version and approved scripts");
  const normalizeLock = value => {
    const copy = structuredClone(value);
    delete copy.version; delete copy.packages[""].version;
    return canonical(copy);
  };
  if (currentLock.version !== currentPackage.version || currentLock.packages[""].version !== currentPackage.version) throw new Error("RC lock version mismatch");
  if (normalizeLock(baselineLock) !== normalizeLock(currentLock)) throw new Error("RC dependency lock changed");
  if (canonical(baselineFiles) !== canonical(currentFiles)) throw new Error("RC runtime source changed; baseline evidence cannot be reused");
  return { status: "RC_ONLY_SOURCE_EQUIVALENT", baseline: RC_BASELINE, version: currentPackage.version,
    runtimeFiles: Object.keys(currentFiles).length, stableAcceptance: false, coverageClaim: "NO_NEW_FULL_COVERAGE_CLAIM" };
}

export function validateMcpMetadata({ baselinePackage, currentPackage, baselineLock, currentLock, version }) {
  const core = "@cassiomc1/forgeloop";
  const expectedPeer = ">=2.0.0-rc.1 <3";
  if (currentPackage.peerDependencies[core] !== expectedPeer || currentLock.packages[""].peerDependencies[core] !== expectedPeer
    || currentLock.packages[`node_modules/${core}`].version !== version) throw new Error("MCP RC peer/version metadata mismatch");
  const newPackage = structuredClone(currentPackage);
  const newLock = structuredClone(currentLock);
  newPackage.peerDependencies[core] = baselinePackage.peerDependencies[core];
  newLock.packages[""].peerDependencies[core] = baselineLock.packages[""].peerDependencies[core];
  newLock.packages[`node_modules/${core}`].version = baselineLock.packages[`node_modules/${core}`].version;
  if (canonical(newPackage) !== canonical(baselinePackage) || canonical(newLock) !== canonical(baselineLock)) throw new Error("MCP resolved dependency graph changed beyond approved peer/version metadata");
}

export function collectRuntimeFiles(root) {
  const files = [];
  const walk = directory => {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const filename = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(filename);
      else if (runtimePath(filename)) files.push(filename);
    }
  };
  for (const directory of ["src", "schemas", "integrations", "bin"]) if (existsSync(path.join(root, directory))) walk(directory);
  return files.sort();
}

export function checkRcRelease(root = process.cwd()) {
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  git(["merge-base", "--is-ancestor", RC_BASELINE, "HEAD"]);
  const baselineFiles = {};
  for (const row of git(["ls-tree", "-r", "-z", RC_BASELINE]).split("\0").filter(Boolean)) {
    const [metadata, filename] = row.split("\t");
    if (runtimePath(filename)) baselineFiles[filename] = metadata.split(" ")[2];
  }
  const filenames = collectRuntimeFiles(root);
  for (const filename of filenames) {
    if (/[\r\n]/u.test(filename) || !lstatSync(path.join(root, filename)).isFile()) throw new Error(`Non-regular runtime source: ${filename}`);
  }
  const hashes = execFileSync("git", ["hash-object", "--stdin-paths"], { cwd: root, encoding: "utf8", input: `${filenames.join("\n")}\n` }).trim().split("\n");
  const currentFiles = Object.fromEntries(filenames.map((filename, index) => [filename, hashes[index]]));
  const fromGit = filename => JSON.parse(git(["show", `${RC_BASELINE}:${filename}`]));
  const current = filename => JSON.parse(readFileSync(path.join(root, filename), "utf8"));
  validateMcpMetadata({ baselinePackage: fromGit("integrations/mcp/package.json"), currentPackage: current("integrations/mcp/package.json"),
    baselineLock: fromGit("integrations/mcp/package-lock.json"), currentLock: current("integrations/mcp/package-lock.json"), version: current("package.json").version });
  return validateRcSnapshot({ baselinePackage: fromGit("package.json"), currentPackage: current("package.json"),
    baselineLock: fromGit("package-lock.json"), currentLock: current("package-lock.json"), baselineFiles, currentFiles });
}

export function validateBaselineRun(run) {
  if (run.head_sha !== RC_BASELINE || run.conclusion !== "success" || run.status !== "completed"
    || run.path !== ".github/workflows/windows-full-suite.yml" || run.repository?.full_name !== "cassiomc1/forgeloop") throw new Error("Trusted baseline Windows evidence is missing, stale, or failed");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--require-ci")) throw new Error("Unknown RC verification argument");
    const result = checkRcRelease();
    if (args.includes("--require-ci")) {
      if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN required for trusted baseline evidence");
      const response = await fetch("https://api.github.com/repos/cassiomc1/forgeloop/actions/runs/38483385848", {
        headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" }, signal: globalThis.AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Baseline evidence API returned HTTP ${response.status}`);
      validateBaselineRun(await response.json());
      result.baselineWindows = "GITHUB_VERIFIED";
    }
    console.log(JSON.stringify(result));
  } catch (error) { console.error(`RC_RELEASE_REFUSED: ${error.message}`); process.exitCode = 1; }
}
