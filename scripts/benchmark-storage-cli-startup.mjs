/** Fresh CLI processes with warm filesystem caches; no provider or storage allocation. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const baselineRevision = "ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5";
assert.ok(argument("baseline-root"), "A clean pinned baseline is required");
const baselineRoot = path.resolve(argument("baseline-root"));
const currentRoot = path.resolve(import.meta.dirname, "..");
assert.equal(execFileSync("git", ["-C", baselineRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baselineRevision);
assert.equal(execFileSync("git", ["-C", baselineRoot, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim(), "");
const repeats = Number(argument("repeats") ?? 30);
assert.ok(Number.isInteger(repeats) && repeats >= 10 && repeats <= 200);
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const roots = { baseline: baselineRoot, native: currentRoot };
const metadata = {};
for (const [backend, root] of Object.entries(roots)) {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  metadata[backend] = { version: manifest.version, cliSha256: createHash("sha256").update(await readFile(path.join(root, "src/cli.js"))).digest("hex") };
}
const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-cli-startup-"));
const results = [];
try {
  for (const operation of ["version", "empty-task-list"]) {
    const samples = { baseline: [], native: [] };
    const expected = { tasks: [], offset: 0, total: 0, hasMore: false };
    for (let repetition = 0; repetition < repeats; repetition += 1) {
      for (const backend of repetition % 2 ? ["baseline", "native"] : ["native", "baseline"]) {
        const args = operation === "version" ? ["--version"] : ["task-list", "--path", target, "--json"];
        const started = performance.now();
        const observed = spawnSync(process.execPath, [path.join(roots[backend], "src/cli.js"), ...args], {
          cwd: target, encoding: "utf8", timeout: 30000, env: { ...process.env, FORGELOOP_TASK: "" },
        });
        samples[backend].push(performance.now() - started);
        assert.equal(observed.status, 0, observed.stderr);
        assert.equal(observed.signal, null);
        if (operation === "version") assert.equal(observed.stdout.trim(), metadata[backend].version);
        else assert.deepEqual(JSON.parse(observed.stdout), expected);
        assert.deepEqual(await readdir(target), [], "Read-only CLI must not allocate storage in an empty project");
      }
    }
    const baselineP95Ms = percentile(samples.baseline, 0.95);
    const nativeP95Ms = percentile(samples.native, 0.95);
    const toleranceMs = Math.max(5, baselineP95Ms * 0.1);
    results.push({ operation, repeats, outputContractVerified: true, storageAllocationAbsent: true, samplesMs: samples,
      baselineP50Ms: percentile(samples.baseline, 0.5), nativeP50Ms: percentile(samples.native, 0.5), baselineP95Ms, nativeP95Ms,
      regressionMs: nativeP95Ms - baselineP95Ms, toleranceMs, candidateSmallWorkspaceTargetMet: nativeP95Ms - baselineP95Ms <= toleranceMs });
  }
} finally { await rm(target, { recursive: true, force: true }); }
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, baselineRevision, node: process.version, platform: process.platform, architecture: process.arch,
  cpu: os.cpus()[0]?.model, metadata, releaseThresholdsVerified: false,
  runtime: "Fresh CLI process for every sample, alternating backend order, warm filesystem caches; version values intentionally match each package version",
  limitations: ["Empty workspace only; populated CLI and persistent MCP paths remain separate measurements", "No filesystem-cold, RSS, internal SQLite I/O or power-loss claim"], results }, null, 2)}\n`);
