import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access } from "node:fs/promises";
import test from "node:test";

import { createAgentBrowserVerificationProvider } from "../src/integration.js";
import { createForgeLoopContext, runBrowserVerification } from "../src/integration.js";

const enabled = process.env.FORGELOOP_AGENT_BROWSER_E2E === "1";
const executablePath = process.env.FORGELOOP_AGENT_BROWSER_EXECUTABLE;

test("optional Agent Browser localhost smoke", { skip: !enabled || !executablePath }, async () => {
  await access(executablePath);
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>ForgeLoop</title><button id=ready>Ready</button>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const provider = createAgentBrowserVerificationProvider({ executablePath });
    const result = await runBrowserVerification({
      target: "localhost-fixture",
      taskId: "agent-browser-e2e",
      providerName: "agent-browser",
      verificationId: "localhost",
      requirement: "local fixture is observable",
      startUrl: `${origin}/`,
      allowedOrigins: [origin],
      steps: [{ id: "open", kind: "NAVIGATE", url: `${origin}/` }],
      assertions: [{ id: "ready", kind: "TEXT_CONTAINS", locator: { kind: "CSS", value: "body" }, expected: "Ready" }],
      runtimeContext: createForgeLoopContext({ browserVerificationProviders: { "agent-browser": provider } }),
    });
    assert.equal(result.status, "PASS");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
