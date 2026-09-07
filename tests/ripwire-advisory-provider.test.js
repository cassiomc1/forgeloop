import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createRipwireAdvisoryContextProvider } from "../src/adapters/ripwire/provider.js";
import { createForgeLoopContext } from "../src/core/runtime-context.js";
import { recallAdvisoryContext } from "../src/core/advisory-context/service.js";
import { baselineForCase, scoreBenchmarkRuns } from "../scripts/benchmark-ripwire-context.mjs";
import {
  E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
  E_ADVISORY_CONTEXT_PROVIDER_INVALID,
  E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE,
  E_ADVISORY_CONTEXT_RESULT_INVALID,
  E_ADVISORY_CONTEXT_TIMEOUT,
  E_PORTABLE_CONTEXT_INVALID,
} from "../src/core/error-codes.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(repositoryRoot, "tests/fixtures/ripwire/fake-ripwire.mjs");

async function withProject(callback) {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "forgeloop-ripwire-provider-"));
  await mkdir(path.join(projectPath, "src"));
  await writeFile(path.join(projectPath, "src/handoff.js"), "export function rejectStaleHandoff() {}\n");
  try {
    return await callback(projectPath);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
}

function fixtureSpawnFactory(calls = []) {
  return (executable, args, options) => {
    calls.push({ executable, args: [...args], options: { ...options } });
    return spawn(process.execPath, [fixturePath, ...args], options);
  };
}

function scriptedSpawn(versionOutput, queryOutput) {
  return (_executable, args, options) => spawn(
    process.execPath,
    ["-e", `process.stdout.write(${JSON.stringify(args.includes("--version") ? versionOutput : queryOutput)})`],
    options,
  );
}

function makeProvider(overrides = {}) {
  return createRipwireAdvisoryContextProvider({
    executablePath: "/opt/ripwire/bin/ripwire",
    expectedVersion: "0.3.8",
    spawnImpl: fixtureSpawnFactory(overrides.calls),
    ...overrides,
  });
}

async function recall(projectPath, query, options = {}) {
  const provider = makeProvider(options);
  const runtimeContext = createForgeLoopContext({
    advisoryContextProviders: { ripwire: provider },
  });
  return recallAdvisoryContext({
    target: projectPath,
    taskId: "ripwire-test-task",
    providerName: "ripwire",
    query,
    runtimeContext,
    ...options,
  });
}

test("factory validates explicit executable and version without spawning", () => {
  assert.throws(
    () => createRipwireAdvisoryContextProvider({ executablePath: "ripwire", expectedVersion: "0.3.8" }),
    (error) => error.code === E_ADVISORY_CONTEXT_PROVIDER_INVALID,
  );
  assert.throws(
    () => createRipwireAdvisoryContextProvider({ executablePath: "/opt/ripwire", expectedVersion: "" }),
    (error) => error.code === E_ADVISORY_CONTEXT_PROVIDER_INVALID,
  );
  assert.doesNotThrow(() => createRipwireAdvisoryContextProvider({
    executablePath: "/opt/ripwire",
    expectedVersion: "0.3.8",
  }));
});

test("registering the provider keeps ordinary runtime context construction lazy", () => {
  let calls = 0;
  const provider = {
    id: "ripwire",
    version: "0.3.8",
    recall() {
      calls += 1;
      return { items: [] };
    },
  };
  const runtimeContext = createForgeLoopContext({ advisoryContextProviders: { ripwire: provider } });
  assert.ok(runtimeContext.advisoryContextProviders.ripwire);
  assert.equal(calls, 0);
});

test("recall validates the qualified version and maps flat sigs into advisory context", async () => {
  await withProject(async (projectPath) => {
    const result = await recall(projectPath, "stale handoff");
    assert.equal(result.provider.id, "ripwire");
    assert.equal(result.provider.version, "0.3.8");
    assert.equal(result.authority, "ADVISORY");
    assert.equal(result.evidenceAuthority, "NONE");
    assert.equal(result.actionability, "NON_EXECUTABLE");
    assert.equal(result.persisted, false);
    assert.equal(result.items[0].title, "Ripwire advisory status");
    assert.match(result.items[0].summary, /approximate/u);
    assert.equal(result.items[1].title, "rejectStaleHandoff");
    assert.equal(result.items[1].sourceRef, "src/handoff.js:10");
    assert.equal("observedAt" in result.items[1], false);
    assert.equal("confidence" in result.items[1], false);
  });
});

test("version mismatch fails before the query invocation", async () => {
  await withProject(async (projectPath) => {
    const calls = [];
    const provider = makeProvider({ calls, expectedVersion: "9.9.9" });
    const runtimeContext = createForgeLoopContext({ advisoryContextProviders: { ripwire: provider } });
    await assert.rejects(
      () => recallAdvisoryContext({
        target: projectPath,
        taskId: "ripwire-version-task",
        providerName: "ripwire",
        query: "version check",
        runtimeContext,
      }),
      (error) => error.code === E_ADVISORY_CONTEXT_PROVIDER_INVALID,
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ["--version"]);
  });
});

test("provider errors never retain untrusted version or JSON output", async () => {
  await withProject(async (projectPath) => {
    const versionMarker = "SECRET_VERSION_MARKER";
    const versionProvider = createRipwireAdvisoryContextProvider({
      executablePath: "/opt/ripwire/bin/ripwire",
      expectedVersion: "0.3.8",
      spawnImpl: scriptedSpawn(`ripwire ${versionMarker}`, "{}"),
    });
    const versionContext = createForgeLoopContext({ advisoryContextProviders: { ripwire: versionProvider } });
    await assert.rejects(
      () => recallAdvisoryContext({
        target: projectPath,
        taskId: "ripwire-version-secret-task",
        providerName: "ripwire",
        query: "version marker",
        runtimeContext: versionContext,
      }),
      (error) => error.code === E_ADVISORY_CONTEXT_PROVIDER_INVALID
        && !inspect(error).includes(versionMarker)
        && !error.cause,
    );

    const jsonMarker = "SECRET_INVALID_JSON_MARKER";
    const jsonProvider = createRipwireAdvisoryContextProvider({
      executablePath: "/opt/ripwire/bin/ripwire",
      expectedVersion: "0.3.8",
      spawnImpl: scriptedSpawn("ripwire 0.3.8", `${jsonMarker}{`),
    });
    const jsonContext = createForgeLoopContext({ advisoryContextProviders: { ripwire: jsonProvider } });
    await assert.rejects(
      () => recallAdvisoryContext({
        target: projectPath,
        taskId: "ripwire-json-secret-task",
        providerName: "ripwire",
        query: "invalid JSON marker",
        runtimeContext: jsonContext,
      }),
      (error) => error.code === E_ADVISORY_CONTEXT_RESULT_INVALID
        && !inspect(error).includes(jsonMarker)
        && !error.cause,
    );
  });
});

test("query is passed as one argv value with shell disabled and the lifecycle directory exclusion", async () => {
  await withProject(async (projectPath) => {
    const calls = [];
    const result = await recall(projectPath, "__argv__ symbol; $(touch SHOULD_NOT_EXIST) --for=spoof", { calls });
    const queryCall = calls.find((call) => call.args.some((arg) => arg.startsWith("--for=")));
    assert.ok(queryCall);
    assert.equal(queryCall.options.shell, false);
    assert.deepEqual(queryCall.options.stdio, ["ignore", "pipe", "pipe"]);
    assert.equal(queryCall.args.filter((arg) => arg.startsWith("--for=")).length, 1);
    assert.equal(queryCall.args.find((arg) => arg.startsWith("--for=")), "--for=__argv__ symbol; $(touch SHOULD_NOT_EXIST) --for=spoof");
    assert.ok(queryCall.args.includes("--exclude=.forgeloop"));
    assert.match(result.items[1].summary, /symbol; \$\(touch SHOULD_NOT_EXIST\)/u);
    const files = await readdir(projectPath);
    assert.equal(files.includes("SHOULD_NOT_EXIST"), false);
  });
});

test("status item preserves caps, omitted lenses, ambiguity, and unknown completeness", async () => {
  await withProject(async (projectPath) => {
    const result = await recall(projectPath, "__truncated__ __ambiguous__ __unindexed__", { limit: 2 });
    assert.equal(result.items.length, 2);
    assert.match(result.items[0].summary, /output_capped_or_truncated=true/u);
    assert.match(result.items[0].summary, /unreported_lenses_remain_unknown=true/u);
    assert.match(result.items[0].summary, /ambiguous_or_unresolved_edges_may_be_missing=true/u);
    assert.match(result.items[0].summary, /index_completeness=unknown/u);
  });
});

test("empty and unsafe candidate sets are explicit and fail closed", async () => {
  await withProject(async (projectPath) => {
    const empty = await recall(projectPath, "__empty__");
    assert.equal(empty.items.length, 1);
    assert.match(empty.items[0].summary, /absence_is_not_proof_of_no_impact/u);

    const unsafe = await recall(projectPath, "__unsafe__");
    assert.equal(unsafe.items.length, 1);
    assert.match(unsafe.items[0].summary, /No symbol items fit/u);
    assert.equal(unsafe.items.some((item) => item.sourceRef), false);
  });
});

test("malformed candidate fields remain a coded advisory result", async () => {
  await withProject(async (projectPath) => {
    const provider = createRipwireAdvisoryContextProvider({
      executablePath: "/opt/ripwire/bin/ripwire",
      expectedVersion: "0.3.8",
      spawnImpl: scriptedSpawn(
        "ripwire 0.3.8",
        JSON.stringify({ sigs: [{ n: "broken", sig: { toString: null } }] }),
      ),
    });
    const runtimeContext = createForgeLoopContext({ advisoryContextProviders: { ripwire: provider } });
    const result = await recallAdvisoryContext({
      target: projectPath,
      taskId: "ripwire-malformed-candidate-task",
      providerName: "ripwire",
      query: "malformed candidate",
      runtimeContext,
    });
    assert.equal(result.items.length, 1);
    assert.match(result.items[0].summary, /rejected_candidates=1/u);
  });
});

test("duplicate candidates are stable and bounded by the requested limit", async () => {
  await withProject(async (projectPath) => {
    const result = await recall(projectPath, "__duplicate__", { limit: 3 });
    assert.equal(result.items.length, 3);
    assert.equal(result.items[1].sourceRef, "src/handoff.js:10");
    assert.equal(result.items[2].sourceRef, "src/handoff.js:22");
  });
});

test("repeated recalls keep ordered items and fingerprints deterministic", async () => {
  await withProject(async (projectPath) => {
    const first = await recall(projectPath, "deterministic recall");
    const second = await recall(projectPath, "deterministic recall");
    assert.deepEqual(second.items, first.items);
    assert.deepEqual(
      second.items.map((item) => item.itemFingerprint),
      first.items.map((item) => item.itemFingerprint),
    );
  });
});

test("secret-like candidate text is rejected by the core portable safety boundary", async () => {
  await withProject(async (projectPath) => {
    await assert.rejects(
      () => recall(projectPath, "__secret__"),
      (error) => error.code === E_PORTABLE_CONTEXT_INVALID,
    );
  });
});

test("process timeout terminates a hanging Ripwire child", async () => {
  await withProject(async (projectPath) => {
    const started = Date.now();
    await assert.rejects(
      () => recall(projectPath, "__hang__", { timeoutMs: 120 }),
      (error) => error.code === E_ADVISORY_CONTEXT_TIMEOUT,
    );
    assert.ok(Date.now() - started < 2000);
  });
});

test("stdout and stderr ceilings are enforced before parsing", async () => {
  await withProject(async (projectPath) => {
    await assert.rejects(
      () => recall(projectPath, "__flood_stdout__"),
      (error) => error.code === E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
    );
    await assert.rejects(
      () => recall(projectPath, "__flood_stderr__"),
      (error) => error.code === E_ADVISORY_CONTEXT_OUTPUT_LIMIT,
    );
  });
});

test("invalid JSON, unsupported shape, nonzero exit, and unavailable executable map to stable codes", async () => {
  await withProject(async (projectPath) => {
    await assert.rejects(
      () => recall(projectPath, "__invalid_json__"),
      (error) => error.code === E_ADVISORY_CONTEXT_RESULT_INVALID,
    );
    await assert.rejects(
      () => recall(projectPath, "__wrong_shape__"),
      (error) => error.code === E_ADVISORY_CONTEXT_RESULT_INVALID,
    );
    await assert.rejects(
      () => recall(projectPath, "__exit_failure__"),
      (error) => error.code === E_ADVISORY_CONTEXT_RESULT_INVALID
        && !error.message.includes("fixture failure detail"),
    );

    const unavailable = createRipwireAdvisoryContextProvider({
      executablePath: path.join(projectPath, "missing-ripwire"),
      expectedVersion: "0.3.8",
    });
    const runtimeContext = createForgeLoopContext({ advisoryContextProviders: { ripwire: unavailable } });
    await assert.rejects(
      () => recallAdvisoryContext({
        target: projectPath,
        taskId: "ripwire-unavailable-task",
        providerName: "ripwire",
        query: "unavailable",
        runtimeContext,
      }),
      (error) => error.code === E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE,
    );
  });
});

test("a valid JSON scalar root maps to a coded invalid-result error", async () => {
  await withProject(async (projectPath) => {
    const provider = createRipwireAdvisoryContextProvider({
      executablePath: "/opt/ripwire/bin/ripwire",
      expectedVersion: "0.3.8",
      spawnImpl: scriptedSpawn("ripwire 0.3.8", "null"),
    });
    const runtimeContext = createForgeLoopContext({ advisoryContextProviders: { ripwire: provider } });
    await assert.rejects(
      () => recallAdvisoryContext({
        target: projectPath,
        taskId: "ripwire-null-root-task",
        providerName: "ripwire",
        query: "null root",
        runtimeContext,
      }),
      (error) => error.code === E_ADVISORY_CONTEXT_RESULT_INVALID
        && /JSON root must be an object/u.test(error.message),
    );
  });
});

test("recall does not create or mutate project files", async () => {
  await withProject(async (projectPath) => {
    const before = await readdir(projectPath, { recursive: true });
    await recall(projectPath, "persistence check");
    const after = await readdir(projectPath, { recursive: true });
    assert.deepEqual(after, before);
  });
});

test("benchmark baseline excludes lifecycle internals and reads only bounded file bytes", async () => {
  await withProject(async (projectPath) => {
    await mkdir(path.join(projectPath, ".git", "hooks"), { recursive: true });
    await mkdir(path.join(projectPath, ".forgeloop"), { recursive: true });
    await writeFile(path.join(projectPath, ".git", "hooks", "ignored.sample"), "known\n");
    await writeFile(path.join(projectPath, ".forgeloop", "ignored.json"), "known\n");
    await writeFile(path.join(projectPath, "src", "known.js"), "known\n".repeat(10_000));
    const baseline = await baselineForCase(projectPath, ["known", "rejectStaleHandoff"]);
    assert.deepEqual(baseline.files, ["src/handoff.js", "src/known.js"]);
    assert.equal(baseline.bytes, Buffer.byteLength("known\n".repeat(10_000).slice(0, 32 * 1024), "utf8") + Buffer.byteLength("export function rejectStaleHandoff() {}\n", "utf8"));
  });
});

test("benchmark scoring reports per-run misses instead of unioning repetitions", () => {
  const score = scoreBenchmarkRuns([
    { durationMs: 10, files: ["a.js"], adapterBytes: 1, transportBytes: 2 },
    { durationMs: 20, files: ["b.js"], adapterBytes: 1, transportBytes: 2 },
  ], ["a.js", "b.js"]);
  assert.deepEqual(score.expectedFound, []);
  assert.deepEqual(score.expectedMissing, ["a.js", "b.js"]);
  assert.deepEqual(score.observedAcrossRuns, ["a.js", "b.js"]);
  assert.equal(score.everyExpectedFileFound, false);
  assert.equal(score.perRun[0].everyExpectedFileFound, false);
  assert.equal(score.perRun[1].everyExpectedFileFound, false);
});
