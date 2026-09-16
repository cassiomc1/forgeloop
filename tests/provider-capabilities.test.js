import { PROVIDER_KINDS, PROVIDER_CAPABILITIES, capabilityFor } from "../src/providers/capabilities.js";
import { deepStrictEqual, doesNotReject, rejects, strictEqual, throws } from "node:assert";
import test from "node:test";
import { createProviderRegistry } from "../src/providers/index.js";

test("every declared provider kind has a frozen capability entry", () => {
  for (const kind of PROVIDER_KINDS) {
    deepStrictEqual(capabilityFor(kind), PROVIDER_CAPABILITIES[kind]);
    strictEqual(Object.isFrozen(PROVIDER_CAPABILITIES[kind]), true);
  }
});

test("no capability ever grants lifecycle, completion, or evidence authority", () => {
  for (const kind of PROVIDER_KINDS) {
    const capability = PROVIDER_CAPABILITIES[kind];
    strictEqual(capability.lifecycleAuthority, false);
    strictEqual(capability.completionAuthority, false);
    strictEqual(capability.evidenceAuthority, false);
  }
});

test("capability metadata cannot be escalated through provider declarations", () => {
  const escalationAttempts = [
    { capability: { ...PROVIDER_CAPABILITIES.ADVISORY_CONTEXT, lifecycleAuthority: true } },
    { capability: { ...PROVIDER_CAPABILITIES.PRESENTATION, mayMutateProtocolState: true } },
    { capability: null },
    { capability: "ADVISORY_CONTEXT" },
  ];
  for (const extra of escalationAttempts) {
    throws(() => createProviderRegistry({
      providers: { escalation: { id: "escalation", kind: "ADVISORY_CONTEXT", operation: async () => ({}), ...extra } },
    }), (error) => error.code === "E_PROVIDER_INVALID");
  }
});

test("provider results cannot carry completion or evidence authority", async () => {
  const registry = createProviderRegistry({
    providers: {
      reporter: {
        id: "reporter",
        kind: "SECURITY_REVIEW",
        version: "1",
        operation: async (input) => input,
      },
    },
  });

  await rejects(() => registry.invoke("reporter", { lifecycleAuthority: true }), (error) => error.code === "E_PROVIDER_AUTHORITY_ESCALATION");
  await rejects(() => registry.invoke("reporter", { completionAuthority: true }), (error) => error.code === "E_PROVIDER_AUTHORITY_ESCALATION");
  await rejects(() => registry.invoke("reporter", { status: "COMPLETE" }), (error) => error.code === "E_PROVIDER_AUTHORITY_ESCALATION");
  await doesNotReject(() => registry.invoke("reporter", { status: "FINDINGS", findings: [] }));
});

test("presentation providers cannot declare protocol-state mutation", () => {
  const registry = createProviderRegistry({
    providers: {
      ui: { id: "ui", kind: "PRESENTATION", operation: async () => ({}) },
    },
  });
  strictEqual(registry.has("ui"), true);
  const capability = capabilityFor("PRESENTATION");
  strictEqual(capability.mayMutateProtocolState, false);
});

test("capability contract forbids automatic installation semantics", () => {
  for (const kind of PROVIDER_KINDS) {
    strictEqual("autoInstall" in PROVIDER_CAPABILITIES[kind], false);
  }
  const registry = createProviderRegistry({ providers: {} });
  strictEqual(registry.install, undefined);
  strictEqual(registry.ensureInstalled, undefined);
});
