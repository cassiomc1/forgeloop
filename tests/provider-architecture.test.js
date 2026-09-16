import {
  E_PROVIDER_INVALID,
  E_PROVIDER_UNAVAILABLE,
  E_PROVIDER_TIMEOUT,
  E_PROVIDER_OUTPUT_INVALID,
  E_PROVIDER_OUTPUT_LIMIT,
  E_PROVIDER_EXECUTION_FAILED,
  providerError,
  createProviderRegistry,
} from "../src/providers/index.js";
import { deepStrictEqual, notStrictEqual, rejects, strictEqual, throws } from "node:assert";
import { clearInterval, setInterval } from "node:timers";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";

function okProvider(id, kind, operation, extra = {}) {
  return { id, kind, operation, ...extra };
}

function registryFor(operation) {
  return createProviderRegistry({
    providers: { tool: okProvider("tool", "ADVISORY_CONTEXT", operation) },
  });
}

function assertDeepFrozen(value) {
  if (value === null || typeof value !== "object") return;
  strictEqual(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

const invalidJsonCases = [
  ["function", () => () => {}],
  ["undefined", () => undefined],
  ["symbol", () => Symbol("value")],
  ["bigint", () => 1n],
  ["NaN", () => NaN],
  ["positive infinity", () => Infinity],
  ["negative infinity", () => -Infinity],
  ["date", () => new Date("2026-01-01T00:00:00Z")],
  ["map", () => new Map([["key", "value"]])],
  ["set", () => new Set([1])],
  ["custom class", () => new (class Value { value = 1; })()],
  ["promise", () => Promise.resolve(1)],
  ["cycle", () => { const value = {}; value.self = value; return value; }],
  ["sparse array", () => new Array(2)],
];

test("registry rejects invalid providers", () => {
  const invalidEntries = [
    ["tool", okProvider("other", "ADVISORY_CONTEXT", async () => ({}))],
    ["Bad-ID", okProvider("Bad-ID", "ADVISORY_CONTEXT", async () => ({}))],
    ["tool", okProvider("tool", "UNKNOWN_KIND", async () => ({}))],
    ["tool", { id: "tool", kind: "ADVISORY_CONTEXT" }],
  ];
  for (const [key, entry] of invalidEntries) {
    throws(() => createProviderRegistry({ providers: { [key]: entry } }), { code: E_PROVIDER_INVALID });
  }
});

test("registry requires an object map rather than a provider array", () => {
  throws(() => createProviderRegistry({
    providers: [okProvider("tool", "ADVISORY_CONTEXT", async () => ({}))],
  }), { code: E_PROVIDER_INVALID });
});

test("registry resolves providers lazily and validates results", async () => {
  let factoryCalls = 0;
  const registry = createProviderRegistry({
    providers: {
      lookup: () => {
        factoryCalls += 1;
        return okProvider("lookup", "ADVISORY_CONTEXT", async () => ({ items: [] }));
      },
    },
  });
  strictEqual(factoryCalls, 0);
  strictEqual(registry.has("missing"), false);
  deepStrictEqual(registry.list(), ["lookup"]);
  strictEqual(factoryCalls, 0);
  deepStrictEqual(await registry.invoke("lookup", { query: "x" }), { items: [] });
  strictEqual(factoryCalls, 1);
});

test("unknown provider invocation is unavailable", async () => {
  await rejects(() => createProviderRegistry().invoke("missing", {}), { code: E_PROVIDER_UNAVAILABLE });
});

test("malformed factory results are invalid providers", async () => {
  const registry = createProviderRegistry({ providers: { tool: async () => ({ id: "tool" }) } });
  await rejects(() => registry.invoke("tool", {}), { code: E_PROVIDER_INVALID });
});

test("factory and operation receive shared invocation context", async () => {
  let factoryContext;
  let operationContext;
  const registry = createProviderRegistry({
    providers: {
      tool: (context) => {
        factoryContext = context;
        return okProvider("tool", "ADVISORY_CONTEXT", async (_input, context) => {
          operationContext = context;
          return {};
        });
      },
    },
  });
  await registry.invoke("tool", {}, { timeoutMs: 100 });
  strictEqual(factoryContext?.providerId, "tool");
  strictEqual(factoryContext?.timeoutMs, 100);
  strictEqual(factoryContext?.signal instanceof globalThis.AbortSignal, true);
  strictEqual(operationContext?.providerId, "tool");
  strictEqual(operationContext?.timeoutMs, 100);
  strictEqual(operationContext?.signal, factoryContext.signal);
  strictEqual(factoryContext.signal.aborted, false);
});

test("hanging factory is bounded by invocation timeout", { timeout: 500 }, async (t) => {
  const keepAlive = setInterval(() => {}, 50);
  t.after(() => clearInterval(keepAlive));
  const registry = createProviderRegistry({ providers: { tool: () => new Promise(() => {}) } });
  await rejects(() => registry.invoke("tool", {}, { timeoutMs: 10 }), { code: E_PROVIDER_TIMEOUT });
});

for (const stage of ["factory", "operation"]) {
  test(`${stage} receives abort on timeout even when it rejects on cancellation`, { timeout: 500 }, async (t) => {
    const keepAlive = setInterval(() => {}, 50);
    t.after(() => clearInterval(keepAlive));
    let context;
    let aborts = 0;
    const hang = (value) => {
      context = value;
      return new Promise((_resolve, reject) => {
        value?.signal?.addEventListener("abort", () => {
          aborts += 1;
          reject(new Error("cancelled"));
        }, { once: true });
      });
    };
    const registry = createProviderRegistry({
      providers: {
        tool: stage === "factory" ? hang : okProvider("tool", "ADVISORY_CONTEXT", (_input, context) => hang(context)),
      },
    });
    await rejects(() => registry.invoke("tool", {}, { timeoutMs: 10 }), { code: E_PROVIDER_TIMEOUT });
    strictEqual(context?.signal?.aborted, true);
    strictEqual(aborts, 1);
  });
}

test("late factory resolution after timeout never starts operation", { timeout: 500 }, async (t) => {
  const keepAlive = setInterval(() => {}, 50);
  t.after(() => clearInterval(keepAlive));
  let resolveFactory;
  let operations = 0;
  const entry = okProvider("tool", "ADVISORY_CONTEXT", async () => { operations += 1; return {}; });
  const registry = createProviderRegistry({
    providers: { tool: () => new Promise(resolve => { resolveFactory = resolve; }) },
  });
  t.after(() => resolveFactory?.(entry));
  await rejects(() => registry.invoke("tool", {}, { timeoutMs: 10 }), { code: E_PROVIDER_TIMEOUT });
  resolveFactory(entry);
  await nextTurn();
  strictEqual(operations, 0);
});

test("factory and operation consume one timeout budget", { timeout: 500 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolveFactory;
  let operationStarted = false;
  const registry = createProviderRegistry({
    providers: { tool: () => new Promise(resolve => { resolveFactory = resolve; }) },
  });
  const pending = registry.invoke("tool", {}, { timeoutMs: 100 });
  const rejected = rejects(pending, { code: E_PROVIDER_TIMEOUT });
  await nextTurn();
  t.mock.timers.tick(60);
  resolveFactory(okProvider("tool", "ADVISORY_CONTEXT", () => {
    operationStarted = true;
    return new Promise(() => {});
  }));
  await nextTurn();
  strictEqual(operationStarted, true);
  t.mock.timers.tick(40);
  await rejected;
});

for (const [option, maximum] of [["timeoutMs", 300_000], ["maxInputBytes", 4_194_304], ["maxResultBytes", 4_194_304]]) {
  for (const value of [null, 0, -1, 1.5, "10", true, NaN, Infinity, -Infinity, maximum + 1]) {
    test(`${option} rejects ${String(value)} before executing provider code`, async () => {
      let calls = 0;
      const registry = createProviderRegistry({
        providers: { tool: () => {
          calls += 1;
          return okProvider("tool", "ADVISORY_CONTEXT", async () => { calls += 1; return {}; });
        } },
      });
      await rejects(() => registry.invoke("tool", {}, { [option]: value }), { code: E_PROVIDER_INVALID });
      strictEqual(calls, 0);
    });
  }
  test(`${option} accepts its upper bound`, async () => {
    deepStrictEqual(await registryFor(async () => ({})).invoke("tool", {}, { [option]: maximum }), {});
  });
}

test("undefined options use defaults", async () => {
  let context;
  const registry = registryFor(async (_input, value) => { context = value; return {}; });
  deepStrictEqual(await registry.invoke("tool", {}, {
    timeoutMs: undefined, maxInputBytes: undefined, maxResultBytes: undefined,
  }), {});
  strictEqual(context?.timeoutMs, 10_000);
});

for (const option of ["maxInputBytes", "maxResultBytes"]) {
  test(`${option} undefined retains the default byte limit`, async () => {
    const value = { text: "x".repeat(262_144) };
    const registry = registryFor(async () => option === "maxResultBytes" ? value : {});
    await rejects(() => registry.invoke("tool", option === "maxInputBytes" ? value : {}, {
      [option]: undefined,
    }), { code: E_PROVIDER_OUTPUT_LIMIT });
  });
  test(`${option} measures UTF-8 bytes and accepts the exact boundary`, async () => {
    const value = { text: "é" };
    const size = Buffer.byteLength(JSON.stringify(value), "utf8");
    const registry = registryFor(async () => value);
    deepStrictEqual(await registry.invoke("tool", value, { [option]: size }), value);
    await rejects(() => registry.invoke("tool", value, { [option]: size - 1 }), { code: E_PROVIDER_OUTPUT_LIMIT });
  });
}

test("positive minimum timeout and input byte limit are accepted", async () => {
  deepStrictEqual(await registryFor(async () => ({})).invoke("tool", 0, { timeoutMs: 1, maxInputBytes: 1 }), {});
});

test("one-byte result limit is valid but cannot fit an object", async () => {
  await rejects(() => registryFor(async () => ({})).invoke("tool", {}, { maxResultBytes: 1 }), { code: E_PROVIDER_OUTPUT_LIMIT });
});

for (const [name, createValue] of invalidJsonCases) {
  for (const direction of ["input", "output"]) {
    test(`${direction} rejects nested ${name} instead of coercing JSON`, async () => {
      let calls = 0;
      const value = { nested: [{ value: createValue() }] };
      const registry = registryFor(async () => { calls += 1; return direction === "output" ? value : {}; });
      await rejects(() => registry.invoke("tool", direction === "input" ? value : {}), {
        code: direction === "input" ? E_PROVIDER_INVALID : E_PROVIDER_OUTPUT_INVALID,
      });
      strictEqual(calls, direction === "input" ? 0 : 1);
    });
  }
}

for (const direction of ["input", "output"]) {
  for (const property of ["value", "toJSON"]) {
    test(`${direction} rejects ${property} accessors without evaluating getters`, async () => {
      let reads = 0;
      const nested = Object.defineProperty({}, property, {
        enumerable: true,
        get() { reads += 1; return property === "toJSON" ? () => ({}) : "value"; },
      });
      const value = { nested: [nested] };
      const registry = registryFor(async () => direction === "output" ? value : {});
      try {
        await rejects(() => registry.invoke("tool", direction === "input" ? value : {}), {
          code: direction === "input" ? E_PROVIDER_INVALID : E_PROVIDER_OUTPUT_INVALID,
        });
      } finally {
        strictEqual(reads, 0);
      }
    });
  }
}

for (const value of [null, true, false, 0, 1.5, "text", [], [1, null], { nested: [true, "text"] }]) {
  test(`input accepts JSON root ${JSON.stringify(value)} without coercion`, async () => {
    const registry = registryFor(async input => ({ input }));
    deepStrictEqual(await registry.invoke("tool", value), { input: value });
  });
}

for (const value of [null, undefined, "text", true, 1, []]) {
  test(`output root ${String(value)} is not a plain JSON object`, async () => {
    await rejects(() => registryFor(async () => value).invoke("tool", {}), { code: E_PROVIDER_OUTPUT_INVALID });
  });
}

test("input is a detached deeply frozen snapshot without freezing the caller", async () => {
  const input = { nested: [{ value: 1 }] };
  let received;
  const result = await registryFor(async payload => { received = payload; return { input: payload }; }).invoke("tool", input);
  deepStrictEqual(received, input);
  notStrictEqual(received, input);
  notStrictEqual(received.nested, input.nested);
  notStrictEqual(received.nested[0], input.nested[0]);
  assertDeepFrozen(received);
  throws(() => { received.nested[0].value = 2; }, TypeError);
  strictEqual(Object.isFrozen(input), false);
  strictEqual(Object.isFrozen(input.nested[0]), false);
  input.nested[0].value = 3;
  strictEqual(received.nested[0].value, 1);
  strictEqual(result.input.nested[0].value, 1);
});

test("output is a detached deeply frozen snapshot without freezing provider originals", async () => {
  const output = { nested: [{ value: 1 }] };
  const result = await registryFor(async () => output).invoke("tool", {});
  deepStrictEqual(result, output);
  notStrictEqual(result, output);
  notStrictEqual(result.nested, output.nested);
  notStrictEqual(result.nested[0], output.nested[0]);
  assertDeepFrozen(result);
  throws(() => { result.nested[0].value = 2; }, TypeError);
  throws(() => result.nested.push({ value: 2 }), TypeError);
  strictEqual(Object.isFrozen(output), false);
  strictEqual(Object.isFrozen(output.nested[0]), false);
  output.nested[0].value = 3;
  strictEqual(result.nested[0].value, 1);
});

for (const stage of ["factory", "operation"]) {
  const failures = [
    ["ordinary error", () => new Error("failure")],
    ["plain spoofed code", () => ({ code: E_PROVIDER_TIMEOUT })],
    ["spoofed error", () => Object.assign(new Error("failure"), { code: E_PROVIDER_OUTPUT_INVALID })],
    ["providerError-created error", () => providerError(E_PROVIDER_UNAVAILABLE, "failure")],
  ];
  for (const [name, createError] of failures) {
    test(`${stage} throwing ${name} is always execution failed`, async () => {
      const fail = () => { throw createError(); };
      const registry = createProviderRegistry({
        providers: { tool: stage === "factory" ? fail : okProvider("tool", "ADVISORY_CONTEXT", fail) },
      });
      await rejects(() => registry.invoke("tool", {}), { code: E_PROVIDER_EXECUTION_FAILED });
    });
  }
}

test("operation return then getter is rejected without evaluation", async () => {
  let reads = 0;
  const output = Object.defineProperty({}, "then", {
    enumerable: true,
    get() { reads += 1; return undefined; },
  });
  try {
    await rejects(() => registryFor(() => output).invoke("tool"), { code: E_PROVIDER_OUTPUT_INVALID });
  } finally {
    strictEqual(reads, 0);
  }
});

test("factory return then getter is rejected without evaluation", async () => {
  let reads = 0;
  const entry = Object.defineProperty(okProvider("tool", "ADVISORY_CONTEXT", () => ({})), "then", {
    get() { reads += 1; return undefined; },
  });
  await rejects(() => createProviderRegistry({ providers: { tool: () => entry } }).invoke("tool"), { code: E_PROVIDER_INVALID });
  strictEqual(reads, 0);
});

test("symbol options are rejected without evaluating accessors", async () => {
  let reads = 0;
  const options = Object.defineProperty({}, Symbol("option"), { get() { reads += 1; return 1; } });
  await rejects(() => registryFor(() => ({})).invoke("tool", {}, options), { code: E_PROVIDER_INVALID });
  strictEqual(reads, 0);
});

for (const value of [
  Object.defineProperty({}, "hidden", { value: 1 }),
  { [Symbol("key")]: 1 },
  Object.assign([], { extra: 1 }),
  new WeakMap(), new WeakSet(),
]) {
  test("unsupported hidden JSON shape is rejected", async () => {
    await rejects(() => registryFor(() => ({ value })).invoke("tool"), { code: E_PROVIDER_OUTPUT_INVALID });
  });
}

test("payload proxies are rejected without triggering traps", async () => {
  let traps = 0;
  const value = new Proxy({}, { getPrototypeOf() { traps += 1; return Object.prototype; }, ownKeys() { traps += 1; return []; } });
  await rejects(() => registryFor(() => value).invoke("tool"), { code: E_PROVIDER_OUTPUT_INVALID });
  strictEqual(traps, 0);
});

test("null-prototype JSON and prototype-like keys preserve data safely", async () => {
  const output = Object.assign(Object.create(null), JSON.parse('{"__proto__":{"safe":true},"constructor":null}'));
  const result = await registryFor(() => output).invoke("tool");
  strictEqual(Object.hasOwn(result, "__proto__"), true);
  strictEqual(result.__proto__.safe, true);
  strictEqual(Object.getPrototypeOf(result), Object.prototype);
  assertDeepFrozen(result);
});

test("deep JSON fails with a bounded structural error", async () => {
  let value = {};
  for (let i = 0; i < 70; i += 1) value = { value };
  await rejects(() => registryFor(() => value).invoke("tool"), { code: E_PROVIDER_OUTPUT_LIMIT });
});

test("post-return mutation cannot change result status or findings", async () => {
  const source = { status: "FINDINGS", findings: [] };
  const result = await registryFor(() => source).invoke("tool");
  source.status = "COMPLETE";
  source.findings.push({ id: "late" });
  deepStrictEqual(result, { status: "FINDINGS", findings: [] });
});

test("registry exposes no lifecycle operations", () => {
  const registry = createProviderRegistry();
  strictEqual(registry.complete, undefined);
  strictEqual(registry.advance, undefined);
});

test("provider errors carry stable codes", () => {
  const error = providerError(E_PROVIDER_INVALID, "bad provider");
  strictEqual(error.code, E_PROVIDER_INVALID);
  strictEqual(error.name, "ProviderError");
});

test("providers remain internal rather than a package subpath export", () => {
  throws(() => import.meta.resolve("@cassiomc1/forgeloop/providers"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
});
