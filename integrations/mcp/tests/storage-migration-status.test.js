import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { executeForgeLoopCommand } from "@cassiomc1/forgeloop/integration";
import { createForgeLoopMcpServer } from "../src/server.js";
import { withStorageMaintenance } from "../../../src/storage/maintenance.js";

test("read-only MCP migration status inspects exclusion while ordinary reads remain blocked", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-mcp-storage-status-"));
  let client;
  let server;
  try {
    await mkdir(path.join(target, ".forgeloop"));
    ({ server } = await createForgeLoopMcpServer({ projectPath: target, mode: "readonly" }));
    client = new Client({ name: "storage-status-client", version: "0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await withStorageMaintenance(target, async () => {
      const result = await client.callTool({ name: "forgeloop_storage_migration_status", arguments: {} });
      assert.notEqual(result.isError, true);
      const envelope = JSON.parse(result.content[0].text);
      const api = await executeForgeLoopCommand({ command: "storage-migration-status", projectPath: target, input: {} });
      assert.deepEqual(envelope.result, api.result);
      assert.equal(envelope.result.maintenance.status, "RETAINED");
      assert.equal(envelope.result.maintenance.ownerLiveness, "NOT_VERIFIED");
      const blocked = await client.callTool({ name: "forgeloop_task_list", arguments: {} });
      assert.equal(blocked.isError, true);
      assert.match(blocked.content[0].text, /E_STORAGE_MAINTENANCE_IN_PROGRESS/u);
    });
  } finally {
    await client?.close();
    await server?.close();
    await rm(target, { recursive: true, force: true });
  }
});
