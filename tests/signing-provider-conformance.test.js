import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createNoneSigningProvider } from "../src/core/signing/none.js";
import { createSigstoreSigningProvider, verifySigstoreBundle } from "../src/core/signing/sigstore.js";
import { assertSigningProvider, resolveSigningProvider } from "../src/core/signing/provider.js";

async function withTarget(fn) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-signing-conformance-"));
  try {
    await fn(target);
  } finally {
    await removeTempTree(target);
  }
}

test("signing providers satisfy the contract and none remains explicitly unsigned", async () => {
  const none = createNoneSigningProvider();
  assertSigningProvider(none);
  assert.equal((await none.detect()).valueOf(), true);
  assert.equal((await none.verify()).status, "UNSIGNED");
  assert.throws(
    () => assertSigningProvider({ detect() {} }),
    (error) => error.code === "E_ATTESTATION_SIGNER_UNAVAILABLE",
  );
  const resolved = await resolveSigningProvider({ providerName: "none", registry: { none: async () => none } });
  assert.equal(resolved.name, "none");
  await assert.rejects(
    () => resolveSigningProvider({ providerName: "missing", registry: {} }),
    (error) => error.code === "E_ATTESTATION_SIGNER_UNAVAILABLE",
  );
});

test("Sigstore provider uses explicit bounded process arguments and exact identity alternatives", async () => {
  await withTarget(async (target) => {
    const calls = [];
    const provider = createSigstoreSigningProvider({
      timeoutMs: 1234,
      execFileImpl: async (command, args, options) => {
        calls.push({ command, args, options });
        return { stdout: "", stderr: "" };
      },
    });
    assert.equal((await provider.detect()), true);
    assert.equal((await provider.sign({ target, statementPath: "statement.json", bundlePath: "bundle.json" })).status, "VALID");
    const result = await provider.verify({
      target,
      statementPath: "statement.json",
      bundlePath: "bundle.json",
      policy: {
        identities: ["https://example.invalid/a", "https://example.invalid/b?x=1"],
        issuer: "https://issuer.invalid",
      },
    });
    assert.equal(result.status, "VALID");
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.timeout, 1234);
    assert.equal(calls[1].options.maxBuffer, 8 * 1024 * 1024);
    assert.ok(calls[2].args.includes("--certificate-identity-regexp"));
    const identityIndex = calls[2].args.indexOf("--certificate-identity-regexp");
    assert.match(calls[2].args[identityIndex + 1], /^\^\(\?:/u);
    assert.ok(calls[2].args.includes("--certificate-oidc-issuer"));
  });
});

test("Sigstore failures map unavailable, trust, and signature outcomes without leaking diagnostics", async () => {
  await withTarget(async (target) => {
    const failure = (error) => createSigstoreSigningProvider({ execFileImpl: async () => { throw error; } });
    assert.equal((await failure(Object.assign(new Error("missing"), { code: "ENOENT" })).verify({ target, statementPath: "statement.json", bundlePath: "bundle.json" })).code, "E_ATTESTATION_SIGNER_UNAVAILABLE");
    assert.equal((await failure(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })).verify({ target, statementPath: "statement.json", bundlePath: "bundle.json" })).code, "E_ATTESTATION_SIGNER_UNAVAILABLE");
    assert.equal((await failure(Object.assign(new Error("too much"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" })).verify({ target, statementPath: "statement.json", bundlePath: "bundle.json" })).code, "E_ATTESTATION_SIGNER_UNAVAILABLE");
    assert.equal((await failure(Object.assign(new Error("identity mismatch"), { stderr: "certificate identity mismatch" })).verify({ target, statementPath: "statement.json", bundlePath: "bundle.json", policy: { identity: "expected" } })).code, "E_ATTESTATION_IDENTITY_UNTRUSTED");
    assert.equal((await failure(Object.assign(new Error("issuer mismatch"), { stderr: "OIDC issuer mismatch" })).verify({ target, statementPath: "statement.json", bundlePath: "bundle.json", policy: { issuer: "expected" } })).code, "E_ATTESTATION_ISSUER_UNTRUSTED");
    assert.equal((await failure(Object.assign(new Error("bad signature"), { stderr: "invalid signature" })).verify({ target, statementPath: "statement.json", bundlePath: "bundle.json" })).code, "E_ATTESTATION_SIGNATURE_INVALID");

    const wrapper = await verifySigstoreBundle({
      target,
      statementPath: "statement.json",
      bundlePath: "bundle.json",
      identity: "expected",
      execFileImpl: async () => ({ stdout: "", stderr: "" }),
    });
    assert.equal(wrapper.status, "VALID");
  });
});
