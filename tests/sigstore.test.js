import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { verifySigstoreBundle } from "../src/core/signing/sigstore.js";

test("the Sigstore convenience verifier keeps policy and process execution bounded", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-sigstore-"));
  const calls = [];
  try {
    const result = await verifySigstoreBundle({
      target,
      statementPath: "attestations/statement.json",
      bundlePath: "attestations/statement.sigstore.json",
      identity: "https://example.invalid/workflow",
      issuer: "https://issuer.example.invalid",
      command: "cosign-test",
      execFileImpl: async (command, args, options) => {
        calls.push({ command, args, options });
        return { stdout: "", stderr: "" };
      },
    });
    assert.equal(result.status, "VALID");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "cosign-test");
    assert.equal(calls[0].options.shell, false);
    assert.ok(calls[0].options.timeout > 0);
    assert.ok(calls[0].args.includes("--certificate-identity"));
    assert.ok(calls[0].args.includes("--certificate-oidc-issuer"));
  } finally {
    await removeTempTree(target);
  }
});
