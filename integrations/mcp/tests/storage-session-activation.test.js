import assert from "node:assert/strict";
import { access, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { openStorageDatabase } from "../../../src/storage/index.js";
import { createForgeLoopMcpServer } from "../src/server.js";
import { commandToToolName } from "../src/tool-registry.js";
import { removeTempTree } from "../../../tests/helpers/rm-safe.js";

async function connectServer({ projectPath, mode, allowMaintenance = false }) {
  const { server, policy } = await createForgeLoopMcpServer({ projectPath, mode, allowMaintenance });
  const client = new Client({ name: "storage-session-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, policy, server };
}

test("MCP activation binds the public response to canonical SQLite without file shadows", async () => {
  const target = await mkdtemp(path.join(tmpdir(), "forgeloop-mcp-session-activation-"));
  let safeClient;
  let safeServer;
  let client;
  let server;
  try {
    ({ client: safeClient, server: safeServer } = await connectServer({ projectPath: target, mode: "safe" }));
    const safeTools = (await safeClient.listTools()).tools.map((tool) => tool.name);
    assert.equal(safeTools.includes(commandToToolName("activate")), false);
    await safeClient.close();
    safeClient = null;
    await safeServer.close();
    safeServer = null;

    ({ client, server } = await connectServer({ projectPath: target, mode: "full", allowMaintenance: true }));
    const toolName = commandToToolName("activate");
    const fullTools = (await client.listTools()).tools.map((tool) => tool.name);
    assert.equal(fullTools.includes(toolName), true);

    const response = await client.callTool({ name: toolName, arguments: {} });
    assert.equal(response.isError, false);
    const envelope = JSON.parse(response.content[0].text);
    assert.equal(envelope.ok, true, JSON.stringify(envelope));
    assert.equal(envelope.command, "activate");
    assert.equal(typeof envelope.result.sessionId, "string");
    assert.equal(typeof envelope.result.activationMarker, "string");

    await client.close();
    client = null;
    await server.close();
    server = null;

    const databasePath = path.join(target, ".forgeloop", "state.sqlite");
    const db = openStorageDatabase(databasePath, { readOnly: true });
    try {
      const meta = db.prepare("SELECT active_session_id FROM storage_meta WHERE id = 1").get();
      assert.equal(meta.active_session_id, envelope.result.sessionId);
      const session = db.prepare("SELECT session_id, activation_json FROM sessions WHERE session_id = ?")
        .get(envelope.result.sessionId);
      assert.ok(session);
      const activation = JSON.parse(session.activation_json);
      assert.equal(activation.sessionId, envelope.result.sessionId);
      assert.equal(activation.activationMarker, envelope.result.activationMarker);
    } finally {
      db.close();
    }

    const storageEntries = await readdir(path.join(target, ".forgeloop"));
    assert.equal(storageEntries.includes("session.json"), false);
    assert.equal(storageEntries.includes("sessions"), false);
    await assert.rejects(access(path.join(target, ".forgeloop", "sessions")), { code: "ENOENT" });
  } finally {
    await client?.close();
    await server?.close();
    await safeClient?.close();
    await safeServer?.close();
    await removeTempTree(target);
  }
});
