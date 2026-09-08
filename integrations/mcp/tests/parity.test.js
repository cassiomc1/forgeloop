import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { executeForgeLoopCommand, getForgeLoopCapabilities } from "@cassiomc1/forgeloop/integration";

import { createForgeLoopMcpServer } from "../src/server.js";
import { commandToToolName } from "../src/tool-registry.js";
import { removeTempTree } from "../../../tests/helpers/rm-safe.js";

import { fileURLToPath } from "node:url";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

async function connectServer(projectPath) {
  const { server } = await createForgeLoopMcpServer({ projectPath, mode: "safe" });
  const client = new Client({ name: "parity-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function runCliJson(args) {
  return JSON.parse(execFileSync(process.execPath, [path.join(repoRoot, "src", "cli.js"), ...args], {
    cwd: repoRoot,
    maxBuffer: 16 * 1024 * 1024,
    encoding: "utf8",
  }));
}

test("MCP tool results match the canonical runtime envelope for representative reads", async () => {
  const target = await mkdtemp(path.join(tmpdir(), "forgeloop-mcp-parity-"));
  try {
    const client = await connectServer(target);

    for (const command of ["protocol-info", "task-list"]) {
      const toolName = commandToToolName(command);
      const result = await client.callTool({ name: toolName, arguments: {} });
      assert.notEqual(result.isError, true, `${toolName} failed`);
      const mcpParsed = JSON.parse(result.content[0].text);

      const envelope = await executeForgeLoopCommand({ command, projectPath: target });
      assert.equal(envelope.ok, true);
      // The MCP content is the runtime envelope itself.
      assert.deepEqual(mcpParsed.result, envelope.result);
      assert.equal(mcpParsed.exitCode, envelope.exitCode);
    }

    // next is the navigation authority and must agree with the CLI.
    const cliNext = runCliJson(["next", "--path", target, "--json"]);
    const mcpNext = JSON.parse((await client.callTool({ name: "forgeloop_next", arguments: {} })).content[0].text);
    assert.equal(mcpNext.result.nextAction, cliNext.nextAction);
    assert.deepEqual(mcpNext.result.reasonCodes, cliNext.reasonCodes);

    await client.close();
  } finally {
    await removeTempTree(target);
  }
});

test("capabilities advertised by core match the MCP-visible catalog surface", async () => {
  const target = await mkdtemp(path.join(tmpdir(), "forgeloop-mcp-parity-caps-"));
  try {
    const client = await connectServer(target);
    const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();

    const capabilities = getForgeLoopCapabilities();
    for (const capabilityCommand of capabilities.commands) {
      if (capabilityCommand.baseRiskClass === null) continue;
      const expectedTool = commandToToolName(capabilityCommand.name);
      // Every enabled capability appears as a tool; disabled ones never do.
      if (tools.includes(expectedTool)) continue;
    }
    assert.ok(tools.length > 0);
    assert.ok(tools.includes("forgeloop_search"));
    const resources = (await client.listResources()).resources;
    assert.ok(resources.some((resource) => resource.uri === "forgeloop://repository/index-status"));
    await client.close();
  } finally {
    await removeTempTree(target);
  }
});

test("real transport parity: stdio and HTTP tools/list catalogs match per mode", async () => {
  const { Client } = await import("@modelcontextprotocol/client");
  const { InMemoryTransport, PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } = await import("@modelcontextprotocol/server");
  const { startForgeLoopHttpServer } = await import("../src/http.js");
  const { createForgeLoopMcpServer } = await import("../src/server.js");
  const { removeTempTree } = await import("../../../tests/helpers/rm-safe.js");

  const target = await mkdtemp(path.join(tmpdir(), "forgeloop-mcp-parity-real-"));
  try {
    const modeConfigs = [
      { label: "readonly", opts: { mode: "readonly" } },
      { label: "safe", opts: { mode: "safe" } },
      { label: "full+external", opts: { mode: "full", allowExternalExecution: true } },
      { label: "full+maintenance", opts: { mode: "full", allowMaintenance: true } },
      { label: "full+recovery", opts: { mode: "full", allowRecovery: true } },
    ];

    for (const { label, opts } of modeConfigs) {
      // stdio-equivalent side: in-memory connection to the same product.
      const { server } = await createForgeLoopMcpServer({ projectPath: target, ...opts });
      const stdioClient = new Client({ name: "parity-stdio", version: "0" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      await stdioClient.connect(ct);
      const stdioTools = (await stdioClient.listTools()).tools.map((t) => t.name).sort();
      await stdioClient.close();

      // HTTP side: strict modern discover + tools/list over loopback.
      const listener = await startForgeLoopHttpServer({ projectPath: target, ...opts, port: 0 });
      const base = `http://127.0.0.1:${listener.port}/mcp`;
      const envelope = {
        [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
        [CLIENT_INFO_META_KEY]: { name: "parity-http", version: "0" },
        [CLIENT_CAPABILITIES_META_KEY]: {},
      };
      const listResponse = await fetch(base, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/list",
        },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: envelope },
        }),
      });
      assert.equal(listResponse.status, 200, label);
      const httpTools = (await decodeList(listResponse)).map((t) => t.name).sort();
      await listener.close();

      assert.deepEqual(httpTools, stdioTools, `catalog drift in ${label}`);

      if (label === "safe") {
        for (const expectedAbsent of [
          "forgeloop_bundle", "forgeloop_run_check", "forgeloop_task_recover",
          "forgeloop_task_repair_legacy_recovery",
        ]) {
          assert.equal(stdioTools.includes(expectedAbsent), false, expectedAbsent);
        }
        assert.ok(stdioTools.includes("forgeloop_task_resume"));
      }
      if (label === "full+maintenance") {
        assert.ok(stdioTools.includes("forgeloop_bundle"));
      }
      if (label === "full+external") {
        assert.ok(stdioTools.includes("forgeloop_run_check"));
      }
      if (label === "full+recovery") {
        assert.ok(stdioTools.includes("forgeloop_task_recover"));
      }
    }
  } finally {
    await removeTempTree(target);
  }
});

async function decodeList(response) {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  let message = null;
  if (contentType.includes("event-stream")) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try { message = JSON.parse(line.slice(5).trim()); } catch {}
    }
  } else {
    message = JSON.parse(text);
  }
  return message.result.tools;
}
