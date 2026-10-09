import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { executeForgeLoopCommand } from "@cassiomc1/forgeloop/integration";

import { createForgeLoopMcpServer } from "../src/server.js";
import { buildDiagnosisProject, cleanupDir } from "../../../tests/helpers/storage-fixtures.js";

const LEGACY_LIVE_STATE = [
  ".forgeloop/task-state",
  ".forgeloop/work-state.json",
  ".forgeloop/events.ndjson",
  ".forgeloop/session.json",
  ".forgeloop/sessions",
];

async function sha256File(filename) {
  return createHash("sha256").update(await readFile(filename)).digest("hex");
}

async function assertAbsent(target, relativePath) {
  await assert.rejects(
    access(path.join(target, relativePath)),
    (error) => error?.code === "ENOENT",
    `${relativePath} must remain absent from the live project`,
  );
}

async function connectFullMaintenanceServer(projectPath) {
  const { server } = await createForgeLoopMcpServer({
    projectPath,
    mode: "full",
    allowMaintenance: true,
  });
  const client = new Client({ name: "bundle-execution-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("full+maintenance MCP bundle execution matches the direct API and preserves native authority", async () => {
  const taskId = "mcp-bundle-execution";
  const target = await buildDiagnosisProject({ taskId });
  const databasePath = path.join(target, ".forgeloop", "state.sqlite");

  try {
    const beforeDigest = await sha256File(databasePath);
    for (const relativePath of LEGACY_LIVE_STATE) await assertAbsent(target, relativePath);

    const direct = await executeForgeLoopCommand({
      command: "bundle",
      projectPath: target,
      input: { taskId },
    });
    assert.equal(direct.ok, true, JSON.stringify(direct));
    assert.equal(direct.result.schemaVersion, 2);

    const { client, server } = await connectFullMaintenanceServer(target);
    try {
      const tools = (await client.listTools()).tools.map((tool) => tool.name);
      assert.ok(tools.includes("forgeloop_bundle"));

      const mcp = await client.callTool({
        name: "forgeloop_bundle",
        arguments: { taskId },
      });
      assert.notEqual(mcp.isError, true, JSON.stringify(mcp));
      const mcpEnvelope = JSON.parse(mcp.content[0].text);

      // The canonical bundle envelope contains no documented nondeterministic
      // fields, so parity is asserted without masking any response property.
      assert.deepEqual(mcpEnvelope, direct);
      assert.deepEqual(mcp.structuredContent, direct);
    } finally {
      await client.close();
      await server.close();
    }

    const manifestPath = path.join(target, direct.result.path);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const { path: resultPath, ...directManifest } = direct.result;
    assert.equal(resultPath, ".forgeloop/tasks/mcp-bundle-execution/bundle.json");
    assert.deepEqual(manifest, directManifest);
    assert.equal(manifest.taskId, taskId);
    assert.ok(manifest.artifacts.includes("events.ndjson"));
    assert.ok(manifest.files.length === manifest.artifacts.length);
    assert.deepEqual(
      manifest.files.map((file) => file.path).sort(),
      [...manifest.artifacts].sort(),
    );
    // The public bundle command has one canonical portable destination under
    // `.forgeloop/tasks/<taskId>`; this test intentionally does not invent an
    // unsupported destination argument. Verify every exported byte against
    // the manifest's raw schema, including its declared size and digest.
    for (const file of manifest.files) {
      const exportedPath = path.join(target, ".forgeloop", "tasks", taskId, file.path);
      const bytes = await readFile(exportedPath);
      assert.equal(bytes.byteLength, file.size, `${file.path} size must match its manifest`);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        file.sha256,
        `${file.path} digest must match its manifest`,
      );
    }

    assert.equal(await sha256File(databasePath), beforeDigest);
    for (const relativePath of LEGACY_LIVE_STATE) await assertAbsent(target, relativePath);
  } finally {
    await cleanupDir(target);
  }
});
