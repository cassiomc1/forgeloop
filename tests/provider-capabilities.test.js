import { PROVIDER_KINDS, PROVIDER_CAPABILITIES, capabilityFor } from "../src/providers/capabilities.js";
import { deepStrictEqual, doesNotReject, rejects, strictEqual, throws } from "node:assert";
import test from "node:test";
import { createProviderRegistry, E_PROVIDER_AUTHORITY_ESCALATION, E_PROVIDER_INVALID } from "../src/providers/index.js";

const authorityKeys = [
  "lifecycleAuthority",
  "completionAuthority",
  "evidenceAuthority",
  "executableAuthority",
  "installAuthority",
];

function reporterRegistry(output) {
  return createProviderRegistry({
    providers: {
      reporter: {
        id: "reporter",
        kind: "SECURITY_REVIEW",
        operation: async () => output,
      },
    },
  });
}

test("provider kinds and capability catalog are frozen and bounded", () => {
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
    strictEqual(capabilityFor(kind), PROVIDER_CAPABILITIES[kind]);
    strictEqual(Object.isFrozen(PROVIDER_CAPABILITIES[kind]), true);
  }
});

test("capability lookup fails closed for unknown and inherited names", () => {
  for (const kind of ["UNKNOWN_KIND", undefined, null, "__proto__", "constructor", "toString"]) {
    strictEqual(capabilityFor(kind), null);
  }
});

test("no capability grants lifecycle, completion, or evidence authority", () => {
  for (const kind of PROVIDER_KINDS) {
    const capability = PROVIDER_CAPABILITIES[kind];
    strictEqual(capability.lifecycleAuthority, false);
    strictEqual(capability.completionAuthority, false);
    strictEqual(capability.evidenceAuthority, false);
  }
});

test("every provider kind has provider-neutral non-authoritative metadata", () => {
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
    }), { code: E_PROVIDER_INVALID });
  }
});

for (const key of authorityKeys) {
  const placements = [
    ["root", value => ({ [key]: value })],
    ["nested object", value => ({ details: { [key]: value } })],
    ["nested array", value => ({ findings: [{ details: [{ [key]: value }] }] })],
  ];
  for (const [location, outputFor] of placements) {
    test(`provider output rejects ${key} true at ${location}`, async () => {
      await rejects(() => reporterRegistry(outputFor(true)).invoke("reporter", {}), {
        code: E_PROVIDER_AUTHORITY_ESCALATION,
      });
    });
    test(`provider output preserves ${key} false at ${location}`, async () => {
      const output = outputFor(false);
      deepStrictEqual(await reporterRegistry(output).invoke("reporter", {}), output);
    });
  }
}

test("provider results cannot assign lifecycle completion", async () => {
  await rejects(() => reporterRegistry({ status: "COMPLETE" }).invoke("reporter", {}), {
    code: E_PROVIDER_AUTHORITY_ESCALATION,
  });
});

test("ordinary findings and repeated JSON references are accepted", async () => {
  const finding = { status: "FINDINGS", message: "Review required", evidenceAuthority: false };
  const output = { findings: [finding, finding] };
  await doesNotReject(() => reporterRegistry(output).invoke("reporter", {}));
});

test("presentation capability forbids protocol-state mutation", () => {
  strictEqual(capabilityFor("PRESENTATION").mayMutateProtocolState, false);
});

test("capability contract forbids automatic installation semantics", () => {
  for (const kind of PROVIDER_KINDS) {
    strictEqual("autoInstall" in PROVIDER_CAPABILITIES[kind], false);
  }
  const registry = createProviderRegistry();
  strictEqual(registry.install, undefined);
  strictEqual(registry.ensureInstalled, undefined);
});
