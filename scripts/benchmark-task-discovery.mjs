import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { discoverTasks } from "../src/core/task-discovery.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { createWorkState, writeWorkState } from "../src/core/work-state.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

function sizesFromArg(argv) {
  const value = argv.find((arg) => arg.startsWith("--sizes="))?.slice("--sizes=".length);
  if (!value) return [10, 100, 250];
  const sizes = value.split(",").map((item) => Number(item.trim()));
  if (sizes.some((size) => !Number.isInteger(size) || size < 1 || size > 5000)) {
    throw new Error("--sizes must contain integers between 1 and 5000");
  }
  return [...new Set(sizes)];
}

async function createFixture(target, size) {
  const timestamp = "2026-09-11T00:00:00.000Z";
  for (let index = 0; index < size; index += 1) {
    const taskId = `discovery-benchmark-${String(index).padStart(5, "0")}`;
    await writeTaskDescriptor(target, createTaskDescriptor({
      taskId,
      writeClaims: [`src/task-${index}`],
      createdAt: timestamp,
      updatedAt: timestamp,
    }), packageRoot);
    await writeWorkState(target, createWorkState({
      taskId,
      contractFingerprint: "0".repeat(64),
      repositoryFingerprint: { branch: null, head: null },
      phase: index % 2 === 0 ? "RECEIVED" : "VERIFYING",
      selectedGuides: [],
      completedSteps: [],
      pendingSteps: ["benchmark"],
      checks: [],
      failures: [],
      blockers: [],
      verificationEvidence: [],
      lastUpdated: timestamp,
    }), { packageRoot, taskId });
  }
}

export async function runTaskDiscoveryBenchmark(sizes = [10, 100, 250]) {
  const results = [];
  for (const size of sizes) {
    const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-discovery-benchmark-"));
    try {
      await createFixture(target, size);
      const coldStart = performance.now();
      const cold = await discoverTasks(target, packageRoot);
      const coldMs = performance.now() - coldStart;
      const warmStart = performance.now();
      const warm = await discoverTasks(target, packageRoot);
      const warmMs = performance.now() - warmStart;
      results.push({ size, coldMs: Number(coldMs.toFixed(3)), warmMs: Number(warmMs.toFixed(3)), observed: cold.length, warmObserved: warm.length });
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  }
  return { schemaVersion: 1, node: process.version, results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runTaskDiscoveryBenchmark(sizesFromArg(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
