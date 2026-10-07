import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createSigstoreSigningProvider } from "../src/core/signing/sigstore.js";
import { createNoneSigningProvider } from "../src/core/signing/none.js";

test("Sigstore provider uses bounded argument-based execution and keeps signing outside artifacts", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-signing-"));
  const calls = [];
  try {
    const provider = createSigstoreSigningProvider({
      execFileImpl: async (command, args, options) => {
        calls.push({ command, args, options });
        return { stdout: "", stderr: "" };
      },
    });
    assert.equal(await provider.detect(), true);
    assert.equal((await provider.sign({ target, statementPath: "statement.json", bundlePath: "statement.sigstore.json" })).status, "VALID");
    assert.equal((await provider.verify({ target, statementPath: "statement.json", bundlePath: "statement.sigstore.json", policy: { identity: "https://example.invalid/workflow" } })).status, "VALID");
    assert.ok(calls.every((call) => call.options.shell === false));
    assert.deepEqual(calls[1].args.slice(0, 3), ["attest-blob", "--statement", path.join(target, "statement.json")]);
    assert.ok(calls[2].args.includes("--certificate-identity"));
  } finally {
    await removeTempTree(target);
  }
});

test("none provider reports unsigned and refuses external bundle verification", async () => {
  const provider = createNoneSigningProvider();
  assert.equal((await provider.verify()).status, "UNSIGNED");
  assert.equal((await provider.verify({ bundlePath: "bundle.json" })).code, "E_ATTESTATION_SIGNER_UNAVAILABLE");
  assert.equal((await provider.sign()).code, "E_ATTESTATION_SIGNER_UNAVAILABLE");
});
