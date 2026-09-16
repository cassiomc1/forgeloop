import { PROVIDER_KINDS, PROVIDER_CAPABILITIES, capabilityFor } from "../src/providers/capabilities.js";
import {
  E_PROVIDER_INVALID,
  E_PROVIDER_UNAVAILABLE,
  E_PROVIDER_TIMEOUT,
  E_PROVIDER_OUTPUT_INVALID,
  E_PROVIDER_OUTPUT_LIMIT,
  E_PROVIDER_AUTHORITY_ESCALATION,
  providerError,
  createProviderRegistry,
} from "../src/providers/index.js";
import { deepStrictEqual, rejects, strictEqual, throws } from "node:assert";
import test from "node:test";

function okProvider(id, kind, operation, extra = {}) {
  return { id, kind, operation, ...extra };
}

test("provider kinds and capabilities are frozen and bounded", () => {
  deepStrictEqual([...PROVIDER_KINDS], [
    "ADVISORY_CONTEXT",
    "VERIFICATION_EXECUTION",
    "BROWSER_VERIFICATION",
    "SECURITY_REVIEW",
    "PRESENTATION",
  ]);
  strictEqual(Object.isFrozen(PROVIDER_KINDS), true);
  strictEqual(Object.isFrozen(PROVIDER_CAPABILITIES), true);
  for (const kind of PROVIDER_KINDS) {
    const capability = PROVIDER_CAPABILITIES[kind];
    strictEqual(Object.isFrozen(capability), true);
    strictEqual(capability.lifecycleAuthority, false);
    strictEqual(capability.completionAuthority, false);
    strictEqual(capability.evidenceAuthority, false);
  }
});

test("capability lookup fails closed for unknown kinds", () => {
  strictEqual(capabilityFor("UNKNOWN_KIND"), null);
  strictEqual(capabilityFor(undefined), null);
});

test("registry rejects invalid providers", () => {
  throws(() => createProviderRegistry({
    providers: { tool: okProvider("tool", "ADVISORY_CONTEXT", async () => ({}), { id: "other" }) },
  }), (error) => error.code === E_PROVIDER_INVALID);

  throws(() => createProviderRegistry({
    providers: { "Bad-ID": okProvider("Bad-ID", "ADVISORY_CONTEXT", async () => ({})) },
  }), (error) => error.code === E_PROVIDER_INVALID);

  throws(() => createProviderRegistry({
    providers: { tool: okProvider("tool", "UNKNOWN_KIND", async () => ({})) },
  }), (error) => error.code === E_PROVIDER_INVALID);

  throws(() => createProviderRegistry({
    providers: { tool: okProvider("tool", "ADVISORY_CONTEXT", async () => ({}), { capability: { lifecycleAuthority: true } }) },
  }), (error) => error.code === E_PROVIDER_INVALID);

  throws(() => createProviderRegistry({
    providers: { tool: { id: "tool", kind: "ADVISORY_CONTEXT" } },
  }), (error) => error.code === E_PROVIDER_INVALID);
});

test("registry rejects duplicate provider keys", () => {
  throws(() => createProviderRegistry({
    providers: [
      okProvider("tool", "ADVISORY_CONTEXT", async () => ({})),
      okProvider("tool", "ADVISORY_CONTEXT", async () => ({})),
    ],
  }), (error) => error.code === E_PROVIDER_INVALID);
});

test("registry resolves providers lazily and validates results", async () => {
  const registry = createProviderRegistry({
    providers: {
      lookup: () => okProvider("lookup", "ADVISORY_CONTEXT", async () => ({ items: [] })),
    },
  });
  const result = await registry.invoke("lookup", { query: "x" });
  deepStrictEqual(result, { items: [] });
  strictEqual(registry.has("missing"), false);
  deepStrictEqual(registry.list(), ["lookup"]);
});

test("unknown provider invocation is unavailable", async () => {
  const registry = createProviderRegistry({ providers: {} });
  await rejects(() => registry.invoke("missing", {}), (error) => error.code === E_PROVIDER_UNAVAILABLE);
});

test("provider factory failure is a structured invalid provider", async () => {
  const registry = createProviderRegistry({
    providers: {
      broken: () => {
        throw new Error("factory boom");
      },
    },
  });
  await rejects(() => registry.invoke("broken", {}), (error) => error.code === E_PROVIDER_INVALID);
});

test("provider timeout is bounded and structured", async () => {
  const registry = createProviderRegistry({
    providers: {
      slow: okProvider("slow", "ADVISORY_CONTEXT", () => new Promise(() => {})),
    },
  });
  await rejects(() => registry.invoke("slow", {}, { timeoutMs: 10 }), (error) => error.code === E_PROVIDER_TIMEOUT);
});

test("malformed provider results fail closed", async () => {
  const registry = createProviderRegistry({
    providers: {
      text: okProvider("text", "ADVISORY_CONTEXT", async () => "not-an-object"),
      array: okProvider("array", "ADVISORY_CONTEXT", async () => []),
      bigint: okProvider("bigint", "ADVISORY_CONTEXT", async () => ({ value: 1n })),
    },
  });
  await rejects(() => registry.invoke("text", {}), (error) => error.code === E_PROVIDER_OUTPUT_INVALID);
  await rejects(() => registry.invoke("array", {}), (error) => error.code === E_PROVIDER_OUTPUT_INVALID);
  await rejects(() => registry.invoke("bigint", {}), (error) => error.code === E_PROVIDER_OUTPUT_INVALID);
});

test("oversized provider output is bounded", async () => {
  const registry = createProviderRegistry({
    providers: {
      huge: okProvider("huge", "ADVISORY_CONTEXT", async () => ({ blob: "x".repeat(4096) })),
    },
  });
  await rejects(() => registry.invoke("huge", {}, { maxResultBytes: 1024 }), (error) => error.code === E_PROVIDER_OUTPUT_LIMIT);
});

test("oversized provider input is bounded", async () => {
  const registry = createProviderRegistry({
    providers: {
      echo: okProvider("echo", "ADVISORY_CONTEXT", async (input) => input),
    },
  });
  await rejects(
    () => registry.invoke("echo", { blob: "x".repeat(4096) }, { maxInputBytes: 1024 }),
    (error) => error.code === E_PROVIDER_OUTPUT_LIMIT,
  );
});

test("non-serializable provider input is invalid", async () => {
  const registry = createProviderRegistry({
    providers: {
      echo: okProvider("echo", "ADVISORY_CONTEXT", async (input) => input),
    },
  });
  const circular = {};
  circular.self = circular;
  await rejects(() => registry.invoke("echo", circular), (error) => error.code === E_PROVIDER_INVALID);
});

test("authority escalation in provider results is rejected", async () => {
  const registry = createProviderRegistry({
    providers: {
      escalator: okProvider("escalator", "SECURITY_REVIEW", async () => ({
        status: "COMPLETE",
        completionAuthority: true,
      })),
    },
  });
  await rejects(() => registry.invoke("escalator", {}), (error) => error.code === E_PROVIDER_AUTHORITY_ESCALATION);
});

test("registry exposes no installation or lifecycle authority", () => {
  const registry = createProviderRegistry({
    providers: { ok: okProvider("ok", "ADVISORY_CONTEXT", async () => ({})) },
  });
  strictEqual(registry.install, undefined);
  strictEqual(registry.ensureInstalled, undefined);
  strictEqual(registry.complete, undefined);
  strictEqual(registry.advance, undefined);
});

test("provider errors carry stable codes", () => {
  const error = providerError(E_PROVIDER_INVALID, "bad provider");
  strictEqual(error.code, E_PROVIDER_INVALID);
  strictEqual(error.name, "ProviderError");
});
