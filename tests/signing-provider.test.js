import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
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
    const statement = { _type: "https://in-toto.io/Statement/v1", subject: [{ name: "fixture", digest: { sha256: "b".repeat(64) } }], predicateType: "https://forgeloop.dev/attestation/v1", predicate: {} };
    await writeFile(path.join(target, "statement.json"), JSON.stringify(statement));
    await writeFile(path.join(target, "statement.sigstore.json"), JSON.stringify({ dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString("base64") } }));
    assert.equal(await provider.detect(), true);
    assert.equal((await provider.sign({ target, statementPath: "statement.json", bundlePath: "statement.sigstore.json" })).status, "VALID");
    assert.equal((await provider.verify({ target, statementPath: "statement.json", bundlePath: "statement.sigstore.json", policy: { identity: "https://example.invalid/workflow" } })).status, "VALID");
    assert.ok(calls.every((call) => call.options.shell === false));
    assert.deepEqual(calls[1].args.slice(0, 3), ["attest-blob", "--statement", path.join(target, "statement.json")]);
    assert.ok(calls[2].args.includes("--certificate-identity"));
    assert.deepEqual(calls[2].args.slice(0, 1), ["verify-blob-attestation"]);
    assert.equal(calls[2].args.includes("--statement"), false);
    assert.equal(calls[2].args[calls[2].args.indexOf("--type") + 1], "https://forgeloop.dev/attestation/v1");
    assert.equal(calls[2].args[calls[2].args.indexOf("--digest") + 1], "b".repeat(64));
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
