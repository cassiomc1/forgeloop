import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(import.meta.dirname, "..");
assert.ok(argument("legacy-root") && argument("output"), "Provide pinned legacy root and external output directory");
const legacy = path.resolve(argument("legacy-root"));
const output = path.resolve(argument("output"));
const outputRelative = path.relative(root, output);
assert.ok(outputRelative === ".." || outputRelative.startsWith(`..${path.sep}`) || path.isAbsolute(outputRelative), "Keep evidence outside the checked source tree");
await mkdir(output, { recursive: true });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function manifest() {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean).sort();
  return Promise.all(files.map(async filename => ({ path: filename, sha256: hash(await readFile(path.join(root, filename))) })));
}
const before = await manifest();
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const cases = [false, true].map(control => ({
  name: `initial-${control}`,
  args: ["scripts/drill-storage-prewrite-source-rollback.mjs", `--legacy-root=${legacy}`, "--publication=true", "--operator=true", "--operator-cli=true", `--postwrite-control=${control}`],
}));
for (const phase of ["PREP_READY", "PREP_PREPARING_COMPLETE", "PREP_PREPARING_PARTIAL", "PREP_PREPARING_MISSING", "STAGE_READY", "STAGE_PREPARING_COMPLETE", "STAGE_PREPARING_PARTIAL", "STAGE_PREPARING_MISSING", "STAGE_PREPARING_BINARY", "SWITCHING", "DATABASE_RETAINED", "NATIVE_RETAINED", "PARTIAL_SOURCE", "RESTORED"]) {
  cases.push({ name: phase, args: ["scripts/drill-storage-source-rollback-recovery.mjs", `--legacy-root=${legacy}`, `--phase=${phase}`, "--operator-cli=true", "--release=true", "--binary=true"] });
}
const results = [];
const started = performance.now();
for (const testCase of cases) {
  const run = spawnSync(process.execPath, ["--import", path.join(root, "scripts/test-semantic-provider-loader.mjs"), ...testCase.args], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  await writeFile(path.join(output, `${testCase.name}.json`), run.stdout ?? "", { flag: "wx" });
  await writeFile(path.join(output, `${testCase.name}.stderr`), run.stderr ?? "", { flag: "wx" });
  results.push({ case: testCase.name, exitCode: run.status, signal: run.signal, error: run.error ? { code: run.error.code, message: run.error.message } : null, outputSha256: hash(run.stdout ?? "") });
  console.log(JSON.stringify(results.at(-1)));
  if (run.status !== 0) break;
}
const after = await manifest();
const unchanged = JSON.stringify(before) === JSON.stringify(after);
const passed = unchanged && results.length === cases.length && results.every(result => result.exitCode === 0);
const terminal = { status: passed ? "PASS" : "FAILED", sourceRevision: revision, node: process.version, platform: process.platform, architecture: process.arch, elapsedSeconds: (performance.now() - started) / 1000, manifestFiles: before.length, admittedSourceUnchanged: unchanged, plannedCases: cases.length, results, limits: ["Constructed persisted owner-death checkpoints, not syscall power loss", "Disposable linked worktrees; no live project migration", "No exclusion claim for privileged or uninventoried writers"] };
await writeFile(path.join(output, "source-manifest.json"), JSON.stringify(before, null, 2) + "\n", { flag: "wx" });
await writeFile(path.join(output, "terminal.json"), JSON.stringify(terminal, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(terminal));
assert.ok(passed, "Public rollback drill failed or admitted source changed; inspect retained evidence");
