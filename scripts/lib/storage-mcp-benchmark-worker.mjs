import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { measureStorageResources } from "./storage-benchmark-resources.mjs";
import { installBenchmarkFailureJournal } from "./benchmark-failure-journal.mjs";
import { createBenchmarkProgressJournal } from "./benchmark-progress-journal.mjs";
import { assertStorageResourceSample, assertTimingSamples } from "./benchmark-mcp-sample-validation.mjs";

const [coreRoot, adapterRoot, target, output, repetitions, instrumentation, requestedLimit, retainProgress, requestedOperations, validationFlag] = process.argv.slice(2);
const repeats = Number(repetitions);
const validationOnly = validationFlag === "true";
assert.ok(validationFlag === undefined || ["true", "false"].includes(validationFlag));
assert.ok(Number.isInteger(repeats) && (validationOnly ? repeats >= 1 : repeats >= 2));
const resources = instrumentation === "true";
const taskListLimit = requestedLimit ? Number(requestedLimit) : null;
assert.ok(taskListLimit === null || (Number.isInteger(taskListLimit) && taskListLimit > 0 && taskListLimit <= 5000));
const knownOperations = ["taskListTool", "projectTasksResource"];
const WIRE_VALIDATION = "STRICT_CANONICAL_MCP_ENVELOPE";
const operationNames = requestedOperations ? requestedOperations.split(",").filter(Boolean) : knownOperations;
assert.ok(operationNames.length > 0 && new Set(operationNames).size === operationNames.length && operationNames.every(value => knownOperations.includes(value)), "Unsupported MCP benchmark operation");

function parseCanonicalJsonText(text, label) {
  assert.equal(typeof text, "string", `${label} must contain text`);
  const value = JSON.parse(text);
  assert.equal(text, JSON.stringify(value, null, 2), `${label} JSON serialization is not canonical`);
  return value;
}

function readToolEnvelope(response) {
  assert.ok(Array.isArray(response?.content), "MCP tool content is missing");
  assert.equal(response.content.length, 1, "MCP tool must return one content item");
  assert.equal(response.content[0]?.type, "text", "MCP tool content must be text");
  const value = parseCanonicalJsonText(response.content[0].text, "MCP tool content");
  if (response.isError === true) {
    const error = value.error ?? value;
    assert.fail(`MCP tool failed: ${error.code ?? "unknown"} ${error.message ?? ""}`);
  }
  assert.deepEqual(response.structuredContent, value, "MCP tool structuredContent differs from its canonical text");
  return value;
}

function readResourceEnvelope(response, uri) {
  assert.notEqual(response?.isError, true, "MCP resource returned an error");
  assert.ok(Array.isArray(response?.contents), "MCP resource contents are missing");
  assert.equal(response.contents.length, 1, "MCP resource must return one content item");
  assert.equal(response.contents[0]?.uri, uri, "MCP resource URI changed in transit");
  assert.equal(response.contents[0]?.mimeType, "application/json", "MCP resource MIME type changed in transit");
  return parseCanonicalJsonText(response.contents[0].text, "MCP resource content");
}
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
      const value = readToolEnvelope(response);
      const error = value.error ?? value;
      assert.notEqual(response.isError, true, `Task-list failed: ${error.code ?? "unknown"} ${error.message ?? ""}`);
      return value;
    },
    projectTasksResource: async () => {
      const uri = "forgeloop://project/tasks";
      const response = await client.readResource({ uri });
      return readResourceEnvelope(response, uri);
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
        wireValidation: WIRE_VALIDATION,
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
      const sampleMs = resources ? measured.elapsedMs : elapsed;
      assertTimingSamples([sampleMs], `${name} sample ${index}`);
      if (resources) assertStorageResourceSample(measured.resources, `${name} resource sample ${index}`);
      samples.push(sampleMs);
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
      wireValidation: WIRE_VALIDATION,
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
