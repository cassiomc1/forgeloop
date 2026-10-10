import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { measureStorageResources } from "./storage-benchmark-resources.mjs";
import { installBenchmarkFailureJournal } from "./benchmark-failure-journal.mjs";
import { createBenchmarkProgressJournal } from "./benchmark-progress-journal.mjs";

const [coreRoot, adapterRoot, target, output, repetitions, instrumentation, requestedLimit, retainProgress, requestedOperations, validationFlag] = process.argv.slice(2);
const repeats = Number(repetitions);
const validationOnly = validationFlag === "true";
assert.ok(validationFlag === undefined || ["true", "false"].includes(validationFlag));
assert.ok(Number.isInteger(repeats) && (validationOnly ? repeats >= 1 : repeats >= 2));
const resources = instrumentation === "true";
const taskListLimit = requestedLimit ? Number(requestedLimit) : null;
assert.ok(taskListLimit === null || (Number.isInteger(taskListLimit) && taskListLimit > 0 && taskListLimit <= 5000));
const knownOperations = ["taskListTool", "projectTasksResource"];
const operationNames = requestedOperations ? requestedOperations.split(",").filter(Boolean) : knownOperations;
assert.ok(operationNames.length > 0 && new Set(operationNames).size === operationNames.length && operationNames.every(value => knownOperations.includes(value)), "Unsupported MCP benchmark operation");
const workerStartedAt = new Date().toISOString();
const progress = { operations: operationNames, validationOnly, operation: null, stage: "BOOTSTRAP", sampleIndex: null, completedSamples: 0 };
const results = {};
const progressJournal = retainProgress === "true" ? createBenchmarkProgressJournal(`${output}.progress.ndjson`) : null;
const checkpoint = () => progressJournal?.record({ coreRoot, target, repeats, resources, validationOnly, operations: operationNames, progress: { ...progress } });
checkpoint();
const failureJournal = installBenchmarkFailureJournal(`${output}.failure.json`, () => ({
  coreRoot, adapterRoot, target, repeats, resources, validationOnly, operations: operationNames, workerStartedAt, progress: { ...progress },
  completedOperations: Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result.sampleCount ?? result.samplesMs.length])),
}));
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@cassiomc1/forgeloop/integration") {
    return { url: pathToFileURL(path.join(coreRoot, "src/integration.js")).href, shortCircuit: true };
  }
  return next(specifier, context);
} });
const require = createRequire(path.join(adapterRoot, "package.json"));
const { Client } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/client")).href);
const { InMemoryTransport } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/server")).href);
const { createForgeLoopMcpServer } = await import(pathToFileURL(path.join(adapterRoot, "src/server.js")).href);
const { server } = await createForgeLoopMcpServer({ projectPath: target, mode: "readonly" });
const client = new Client({ name: "storage-benchmark", version: "1.0.0" });
try {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const availableOperations = {
    taskListTool: async () => {
      const response = await client.callTool({ name: "forgeloop_task_list", arguments: taskListLimit === null ? {} : { limit: taskListLimit } });
      const value = JSON.parse(response.content[0].text);
      const error = value.error ?? value;
      assert.notEqual(response.isError, true, `Task-list failed: ${error.code ?? "unknown"} ${error.message ?? ""}`);
      return value;
    },
    projectTasksResource: async () => {
      const response = await client.readResource({ uri: "forgeloop://project/tasks" });
      assert.equal(response.contents.length, 1);
      return JSON.parse(response.contents[0].text);
    },
  };
  const operations = Object.fromEntries(operationNames.map(name => [name, availableOperations[name]]));
  for (const [name, operation] of Object.entries(operations)) {
    Object.assign(progress, { operation: name, stage: "EXPECTED", sampleIndex: null, completedSamples: 0 });
    checkpoint();
    const expected = await operation();
    const samples = [];
    const resourceSamples = [];
    if (validationOnly) {
      progress.stage = "VALIDATE_ONLY";
      checkpoint();
      const validated = await operation();
      assert.deepEqual(validated, expected);
      results[name] = {
        expected,
        samplesMs: [],
        resourceSamples: [],
        sampleCount: 0,
        resourceSampleCount: 0,
        validationOnly: true,
        validationCalls: 2,
        resourceTiming: "SKIPPED_VALIDATE_ONLY",
      };
      continue;
    }
    progress.stage = "WARMUP";
    checkpoint();
    await operation();
    for (let index = 0; index < repeats; index++) {
      Object.assign(progress, { stage: "MEASURED", sampleIndex: index });
      if (index === 0) checkpoint();
      const start = performance.now();
      const measured = resources ? await measureStorageResources(target, operation) : { value: await operation() };
      const elapsed = performance.now() - start;
      assert.deepEqual(measured.value, expected);
      samples.push(resources ? measured.elapsedMs : elapsed);
      if (resources) resourceSamples.push(measured.resources);
      progress.completedSamples = index + 1;
      if ((index + 1) % 10 === 0 || index + 1 === repeats) checkpoint();
    }
    results[name] = {
      expected,
      samplesMs: samples,
      resourceSamples,
      sampleCount: samples.length,
      resourceSampleCount: resourceSamples.length,
      validationOnly: false,
      resourceTiming: resources ? "ENABLED" : "DISABLED",
    };
  }
  progress.stage = "WRITE_OUTPUT";
  checkpoint();
  const workerEndedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify({ coreRoot, adapterRoot, target, repeats, resources, validationOnly, operations: operationNames, runtime: { node: process.version, platform: process.platform, architecture: process.arch, pid: process.pid }, workerStartedAt, workerEndedAt, resourceTiming: validationOnly ? "SKIPPED_VALIDATE_ONLY" : resources ? "ENABLED" : "DISABLED", transport: "actual MCP in-memory client/server", results }, null, 2));
} catch (error) {
  failureJournal.record(error);
  throw error;
} finally {
  progress.stage = "CLOSE_CLIENT";
  checkpoint();
  await client.close();
  progress.stage = "CLOSE_SERVER";
  checkpoint();
  await server.close();
  failureJournal.dispose();
  progress.stage = "CLOSED";
  checkpoint();
  progressJournal?.close();
}
