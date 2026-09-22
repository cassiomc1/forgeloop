import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("the pinned TypeSafe SDK has a clean child-process failure boundary on supported Node", async () => {
  assert.ok(Number(process.versions.node.split(".")[0]) >= 20);
  const script = `import { createTypesafeClient } from ${JSON.stringify(new URL("../src/adapters/typesafe/client.js", import.meta.url).href)};
    try { createTypesafeClient({ model: "jev-1.13.0", requestTimeoutMs: 500, maxRetries: 0 }, { env: {} }); }
    catch (error) { if (error.code !== "E_DECISION_ENGINE_AUTH_REQUIRED") process.exit(2); process.exit(0); }`;
  const result = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, TYPESAFE_API_KEY: "" },
    timeout: 10_000,
  });
  assert.equal(result.stderr, "");
});
