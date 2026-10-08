import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { measureStorageResources } from "./storage-benchmark-resources.mjs";
import { installBenchmarkFailureJournal } from "./benchmark-failure-journal.mjs";

const [coreRoot, adapterRoot, target, output, repetitions, instrumentation, requestedLimit] = process.argv.slice(2);
const repeats = Number(repetitions);
assert.ok(Number.isInteger(repeats) && repeats >= 2);
const resources = instrumentation === "true";
const taskListLimit = requestedLimit ? Number(requestedLimit) : null;
assert.ok(taskListLimit === null || (Number.isInteger(taskListLimit) && taskListLimit > 0 && taskListLimit <= 5000));
const progress = { operation: null, stage: "BOOTSTRAP", sampleIndex: null, completedSamples: 0 };
const results = {};
const failureJournal = installBenchmarkFailureJournal(`${output}.failure.json`, () => ({
  coreRoot, adapterRoot, target, repeats, resources, progress: { ...progress },
  completedOperations: Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result.samplesMs.length])),
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
  const operations = {
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
  for (const [name, operation] of Object.entries(operations)) {
    Object.assign(progress, { operation: name, stage: "EXPECTED", sampleIndex: null, completedSamples: 0 });
    const expected = await operation();
    progress.stage = "WARMUP";
    await operation();
    const samples = [];
    const resourceSamples = [];
    for (let index = 0; index < repeats; index++) {
      Object.assign(progress, { stage: "MEASURED", sampleIndex: index });
      const start = performance.now();
      const measured = resources ? await measureStorageResources(target, operation) : { value: await operation() };
      const elapsed = performance.now() - start;
      assert.deepEqual(measured.value, expected);
      samples.push(resources ? measured.elapsedMs : elapsed);
      if (resources) resourceSamples.push(measured.resources);
      progress.completedSamples = index + 1;
    }
    results[name] = { expected, samplesMs: samples, resourceSamples };
  }
  progress.stage = "WRITE_OUTPUT";
  await writeFile(output, JSON.stringify({ coreRoot, adapterRoot, target, repeats, resources, transport: "actual MCP in-memory client/server", results }, null, 2));
} catch (error) {
  failureJournal.record(error);
  throw error;
} finally {
  progress.stage = "CLOSE_CLIENT";
  await client.close();
  progress.stage = "CLOSE_SERVER";
  await server.close();
  failureJournal.dispose();
}
