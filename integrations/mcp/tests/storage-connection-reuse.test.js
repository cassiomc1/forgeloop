import assert from "node:assert/strict";
import test from "node:test";
import { rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { buildForgeLoopMcpServer, createForgeLoopMcpServer } from "../src/server.js";
import { buildDiagnosisProject, TEST_TASK_ID } from "../../../tests/helpers/storage-fixtures.js";
import { loadStorageDriver } from "../../../src/storage/runtime.js";

test("MCP tools and resources reuse one canonical readonly connection and close owned audit snapshots", async () => {
  const target = await buildDiagnosisProject();
  const driver = loadStorageDriver();
  const Original = driver.DatabaseSync;
  const handles = [];
  let server;
  let client;
  try {
    driver.DatabaseSync = function (...args) {
      const db = new Original(...args);
      // Native resolution expands Windows short directory names consistently
      // with the asynchronous realpath used by the connection owner.
      handles.push({ db, filename: realpathSync.native(args[0]), options: args[1] });
      return db;
    };
    ({ server } = await createForgeLoopMcpServer({ projectPath: target, mode: "readonly" }));
    client = new Client({ name: "storage-reuse-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    for (let i = 0; i < 2; i += 1) {
      const result = await client.callTool({ name: "forgeloop_task_list", arguments: {} });
      assert.notEqual(result.isError, true);
    }
    const resource = await client.readResource({ uri: "forgeloop://project/tasks" });
    assert.equal(resource.contents.length, 1);
    const decisions = await client.readResource({ uri: `forgeloop://task/${TEST_TASK_ID}/decisions` });
    assert.equal(decisions.contents.length, 1);
    const canonicalFilename = realpathSync.native(path.join(target, ".forgeloop/state.sqlite"));
    const canonical = handles.filter(handle => handle.filename === canonicalFilename);
    const snapshots = handles.filter(handle => handle.filename !== canonicalFilename);
    assert.equal(canonical.length, 1, "Each MCP request must reuse the same canonical connection");
    assert.equal(canonical[0].db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 1);
    const expectedDecisions = canonical[0].db.prepare("SELECT payload_json FROM task_artifacts WHERE task_id = ? AND kind = 'decision' ORDER BY artifact_id")
      .all(TEST_TASK_ID).map(row => JSON.parse(row.payload_json));
    assert.deepEqual(JSON.parse(decisions.contents[0].text).decisions, expectedDecisions);
    assert.equal(snapshots.length, 3, "Decision collections capture finite rows without a full project-copy snapshot");
    assert.equal(canonical[0].db.isTransaction, false, "Decision validation must not retain a live native transaction");
    for (const snapshot of snapshots) {
      assert.equal(snapshot.options.readOnly, true);
      assert.throws(() => snapshot.db.prepare("SELECT 1"), "Audit snapshot handles must close before server shutdown");
    }
    await client.close();
    await server.close();
    assert.throws(() => canonical[0].db.prepare("SELECT 1"));
  } finally {
    driver.DatabaseSync = Original;
    await client?.close();
    await server?.close();
    await rm(target, { recursive: true, force: true });
  }
});

test("MCP storage context cannot bypass the dedicated authority provider", () => {
  assert.throws(() => buildForgeLoopMcpServer({ storageRuntimeContext: { authorityContext: { trustMode: "HOST_ATTESTED" } } }), /use authorityContextProvider/);
});
