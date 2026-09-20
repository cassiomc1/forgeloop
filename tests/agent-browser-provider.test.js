import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createAgentBrowserVerificationProvider } from "../src/adapters/agent-browser/provider.js";
import { createForgeLoopContext } from "../src/core/runtime-context.js";
import { runBrowserVerification } from "../src/core/browser-verification/service.js";
import {
  E_BROWSER_VERIFICATION_ORIGIN_DENIED,
} from "../src/core/error-codes.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(repositoryRoot, "tests/agent-browser-verification/agent-browser-fixture.mjs");

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-agent-browser-provider-"));
  const executable = path.join(root, "agent-browser");
  await writeFile(executable, "fixture\n");
  return { root, executable };
}

function scriptedSpawn(calls) {
  return (executable, args, options) => {
    calls.push({ executable, args: [...args], options: { ...options } });
    return spawn(process.execPath, [fixture, ...args], options);
  };
}

function request() {
  return {
    target: "/not-used-as-cwd",
    taskId: "browser-task",
    providerName: "agent-browser",
    verificationId: "checkout",
    requirement: "Checkout is usable",
    startUrl: "https://example.test:8443/start",
    allowedOrigins: ["https://example.test:8443"],
    steps: [
      { id: "open", kind: "NAVIGATE", url: "https://example.test:8443/start" },
      { id: "fill", kind: "FILL", locator: { kind: "CSS", value: "#email" }, text: "user@example.test" },
      { id: "submit", kind: "CLICK", locator: { kind: "CSS", value: "#submit" } },
      { id: "press", kind: "PRESS", locator: { kind: "CSS", value: "#email" }, key: "Enter" },
    ],
    assertions: [
      { id: "visible", kind: "VISIBLE", locator: { kind: "CSS", value: "#email" } },
      { id: "text", kind: "TEXT_CONTAINS", locator: { kind: "CSS", value: "body" }, expected: "Checkout" },
      { id: "url", kind: "URL_PREFIX", expected: "https://example.test:8443" },
      { id: "title", kind: "TITLE_EQUALS", expected: "Checkout" },
    ],
    timeoutMs: 3000,
    capture: { screenshot: "NEVER" },
  };
}

test("Agent Browser provider factory is inert and verifies through the public API", async () => {
  const { root, executable } = await setup();
  try {
    const calls = [];
    const provider = createAgentBrowserVerificationProvider({ executablePath: executable, expectedVersion: "0.38.1", spawnImpl: scriptedSpawn(calls) });
    assert.equal(calls.length, 0);
    const runtimeContext = createForgeLoopContext({ browserVerificationProviders: { "agent-browser": provider } });
    assert.equal(calls.length, 0);
    const result = await runBrowserVerification({ ...request(), runtimeContext });
    assert.equal(result.provider.id, "agent-browser");
    assert.equal(result.status, "PASS");
    assert.equal(result.assertions.length, 4);
    assert.equal(result.authority, "OBSERVATION");
    assert.equal(result.persisted, false);
    assert.equal("evidence" in result, false);
    assert.equal(calls.some(({ args }) => args.includes("--session")), true);
    assert.equal(calls.at(-1).args.includes("close"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Agent Browser provider rejects version mismatch and exact-origin escape", async () => {
  const { root, executable } = await setup();
  try {
    const mismatch = createAgentBrowserVerificationProvider({ executablePath: executable, expectedVersion: "9.9.9", spawnImpl: scriptedSpawn([]) });
    const context = createForgeLoopContext({ browserVerificationProviders: { "agent-browser": mismatch } });
    await assert.rejects(() => runBrowserVerification({ ...request(), runtimeContext: context }), (error) => error.code === "E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE");

    const calls = [];
    const provider = createAgentBrowserVerificationProvider({
      executablePath: executable,
      spawnImpl: (file, args, options) => {
        calls.push({ executable: file, args: [...args], options: { ...options } });
        if (args.includes("get") && args.includes("url")) {
          return spawn(process.execPath, ["-e", "process.stdout.write(JSON.stringify({success:true,data:'https://other.example/'}))"], options);
        }
        return spawn(process.execPath, [fixture, ...args], options);
      },
    });
    const escapeContext = createForgeLoopContext({ browserVerificationProviders: { "agent-browser": provider } });
    await assert.rejects(() => runBrowserVerification({
      ...request(),
      runtimeContext: escapeContext,
    }), (error) => error.code === E_BROWSER_VERIFICATION_ORIGIN_DENIED || error.code === "E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Agent Browser provider supports snapshot locators, wait, assertion order, and screenshot metadata", async () => {
  const { root, executable } = await setup();
  try {
    const provider = createAgentBrowserVerificationProvider({ executablePath: executable, spawnImpl: scriptedSpawn([]) });
    const result = await runBrowserVerification({
      ...request(),
      steps: [
        { id: "open", kind: "NAVIGATE", url: "https://example.test:8443/start" },
        { id: "wait", kind: "WAIT_FOR", condition: "VISIBLE", locator: { kind: "ROLE", value: "textbox" } },
      ],
      assertions: [
        { id: "role", kind: "VISIBLE", locator: { kind: "ROLE", value: "textbox" } },
        { id: "label", kind: "TEXT_EQUALS", locator: { kind: "LABEL", value: "Email" }, expected: "Checkout" },
        { id: "value", kind: "VALUE_EQUALS", locator: { kind: "CSS", value: "#email" }, expected: "user@example.test" },
        { id: "attribute", kind: "ATTRIBUTE_EQUALS", locator: { kind: "CSS", value: "#email" }, attribute: "value", expected: "value" },
        { id: "url", kind: "URL_IS", expected: "https://example.test:8443/start" },
        { id: "title", kind: "TITLE_EQUALS", expected: "Checkout" },
      ],
      capture: { screenshot: "ALWAYS" },
      runtimeContext: createForgeLoopContext({ browserVerificationProviders: { "agent-browser": provider } }),
    });
    assert.equal(result.status, "PASS");
    assert.deepEqual(result.assertions.map((item) => item.id), ["role", "label", "value", "attribute", "url", "title"]);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].kind, "SCREENSHOT");
    assert.match(result.artifacts[0].ref, /^agent-browser\/checkout\/[a-f0-9]{64}\.png$/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
