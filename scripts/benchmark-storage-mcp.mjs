import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBenchmarkProgressJournal } from "./lib/benchmark-progress-journal.mjs";
import { createTaskDescriptor } from "../src/core/task-descriptor.js";
import { createWorkState } from "../src/core/work-state.js";
import { buildProtocolEvent } from "../src/core/events.js";
import { openStorageDatabase, runInTransaction, upsertTask, reserveClaims, appendEvent, exportDatabase } from "../src/storage/index.js";

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const baselineRoot = path.resolve(argument("baseline-root") ?? "");
const currentRoot = path.resolve(import.meta.dirname, "..");
const revision = "ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5";
assert.equal(execFileSync("git", ["-C", baselineRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), revision);
assert.equal(execFileSync("git", ["-C", baselineRoot, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim(), "");
const sizes = (argument("sizes") ?? "10,1000").split(",").map(Number);
const repeats = Number(argument("repeats") ?? 20);
const resources = argument("resources") ?? "false";
const taskListLimit = argument("task-list-limit") === undefined ? null : Number(argument("task-list-limit"));
const validationOnly = process.argv.includes("--validate-only");
assert.ok(sizes.every(size => Number.isInteger(size) && size > 0 && size <= 5000));
assert.ok(Number.isInteger(repeats) && repeats >= (validationOnly ? 2 : 20));
assert.ok(["true", "false"].includes(resources));
assert.ok(taskListLimit === null || (Number.isInteger(taskListLimit) && taskListLimit > 0 && taskListLimit <= 5000));
const workerEvidenceDirectory = argument("worker-evidence-directory") ? path.resolve(argument("worker-evidence-directory")) : null;
if (workerEvidenceDirectory) {
  const relative = path.relative(currentRoot, workerEvidenceDirectory);
  assert.ok(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), "Worker evidence must stay outside the checked source tree");
  // Refuse reuse so a retained first-cause journal cannot mask a new run.
  await mkdir(workerEvidenceDirectory);
}
const progressJournal = workerEvidenceDirectory
  ? createBenchmarkProgressJournal(path.join(workerEvidenceDirectory, "parent.progress.ndjson")) : null;
const checkpoint = context => progressJournal?.record(context);
checkpoint({ stage: "STARTED", sizes, repeats, resources });
const percentile = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
const timestamp = "2026-09-11T00:00:00.000Z";
const versions = {};
for (const [backend, root] of Object.entries({ native: currentRoot, baseline: baselineRoot })) {
  versions[backend] = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
}

function comparable(value, backend) {
  const copy = structuredClone(value);
  if (copy.metadata?.packageVersion !== undefined) {
    assert.equal(copy.metadata.packageVersion, versions[backend]);
    copy.metadata.packageVersion = "DECLARED_BACKEND_VERSION";
  }
  return copy;
}

async function seed(native, portable, size) {
  await mkdir(path.join(native, ".forgeloop"));
  const db = openStorageDatabase(path.join(native, ".forgeloop/state.sqlite"));
  try {
    runInTransaction(db, () => {
      for (let index = 0; index < size; index++) {
        const taskId = `mcp-populated-${String(index).padStart(5, "0")}`;
        const descriptor = createTaskDescriptor({ taskId, writeClaims: [`src/task-${index}`], createdAt: timestamp, updatedAt: timestamp });
        const state = createWorkState({ taskId, phase: "RECEIVED", contractFingerprint: "0".repeat(64), repositoryFingerprint: { branch: null, head: null }, lastUpdated: timestamp });
        upsertTask(db, { taskId, descriptor, state });
        reserveClaims(db, { taskId, claims: descriptor.writeClaims, createdAt: timestamp });
        let checkpoint = { seq: 0, lastHash: null };
        for (let observation = 0; observation < 10; observation++) {
          const event = buildProtocolEvent({ taskId, event: "OBSERVATION", at: timestamp, details: { observation } }, { checkpoint });
          appendEvent(db, { taskId, event });
          checkpoint = { seq: event.seq, lastHash: event.hash };
        }
      }
    });
    await exportDatabase(db, portable);
  } finally { db.close(); }
}

const results = [];
for (const [sizeIndex, size] of sizes.entries()) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeloop-mcp-benchmark-"));
  try {
    const native = path.join(directory, "native"), portable = path.join(directory, "portable");
    await mkdir(native);
    checkpoint({ stage: "SEEDING", tasks: size });
    await seed(native, portable, size);
    checkpoint({ stage: "SEEDED", tasks: size });
    const backends = {};
    const order = sizeIndex % 2 ? ["baseline", "native"] : ["native", "baseline"];
    for (const backend of order) {
      const output = workerEvidenceDirectory
        ? path.join(workerEvidenceDirectory, `${backend}-${size}.json`)
        : path.join(directory, `${backend}.json`);
      checkpoint({ stage: "WORKER_STARTED", backend, tasks: size, output });
      const run = spawnSync(process.execPath, [path.join(currentRoot, "scripts/lib/storage-mcp-benchmark-worker.mjs"),
        backend === "native" ? currentRoot : baselineRoot, path.join(currentRoot, "integrations/mcp"),
        backend === "native" ? native : portable, output, String(repeats), resources, taskListLimit === null ? "" : String(taskListLimit), workerEvidenceDirectory ? "true" : "false"], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
      checkpoint({ stage: "WORKER_EXITED", backend, tasks: size, status: run.status, signal: run.signal });
      if (run.status !== 0 && argument("output")) {
        let workerDiagnostics = null;
        let diagnosticReadError = null;
        try { workerDiagnostics = JSON.parse(await readFile(`${output}.failure.json`, "utf8")); }
        catch (error) { diagnosticReadError = { code: error.code ?? error.name, message: error.message }; }
        await writeFile(`${argument("output")}.failure.json`, JSON.stringify({
          status: "FAILED", backend, tasks: size, baselineRevision: revision,
          workerStatus: run.status, workerSignal: run.signal, workerDiagnostics, diagnosticReadError, stderr: run.stderr,
        }, null, 2) + "\n");
      }
      assert.equal(run.status, 0, run.stderr);
      backends[backend] = JSON.parse(await readFile(output, "utf8"));
    }
    for (const name of Object.keys(backends.native.results)) {
      const n = backends.native.results[name], b = backends.baseline.results[name];
      if (name === "taskListTool") {
        assert.equal(n.expected.result.total, size);
        assert.equal(n.expected.result.tasks.length, taskListLimit === null ? size : Math.min(size, taskListLimit));
      } else {
        assert.equal(n.expected.count, size);
        assert.equal(n.expected.tasks.length, size);
      }
      assert.deepEqual(comparable(n.expected, "native"), comparable(b.expected, "baseline"));
      results.push({ tasks: size, events: size * 10, operation: name, outputParity: true,
        native: n, baseline: b, nativeP95Ms: percentile(n.samplesMs), baselineP95Ms: percentile(b.samplesMs) });
    }
    checkpoint({ stage: "PARITY_VERIFIED", tasks: size });
  } finally {
    checkpoint({ stage: "CLEANUP_STARTED", tasks: size });
    await rm(directory, { recursive: true, force: true });
    checkpoint({ stage: "CLEANUP_COMPLETED", tasks: size });
  }
}
const output = { sourceRevision: execFileSync("git", ["-C", currentRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  workerEvidenceDirectory, progressRetention: workerEvidenceDirectory ? { sampleInterval: 10, durability: "fsync outside measured operations", limitation: "Between-request journal writes can affect subsequent process/cache behavior" } : null, baselineRevision: revision, node: process.version, platform: process.platform, repeats, resources, validationOnly,
  taskListRequest: taskListLimit === null ? {} : { limit: taskListLimit },
  declaredBackendVersions: versions, parityException: "Only metadata.packageVersion;each raw value must equal its backend package manifest",
  adapter: "same current MCP adapter with current or pinned core selected by module resolution hook", transport: "in-memory MCP client/server",
  limits: ["Transport serialization/stdio/HTTP not measured", "Synthetic valid tasks/claims and ten observation events per task", "Resource samples are separately instrumented;RSS endpoints are not operation peak", "Not complete MCP throughput/contention/resource acceptance"],
  releaseThresholdsVerified: false, results };
if (argument("output")) await writeFile(argument("output"), JSON.stringify(output, null, 2) + "\n");
else process.stdout.write(JSON.stringify(output, null, 2) + "\n");

checkpoint({ stage: "COMPLETED" });
progressJournal?.close();
