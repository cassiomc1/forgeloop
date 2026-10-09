import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { createForgeLoopMcpServer } from "../src/server.js";
import { buildDiagnosisProject, TEST_TASK_ID } from "../../../tests/helpers/storage-fixtures.js";
import { getPackageRoot } from "../../../src/core/templates.js";
import { openStorageDatabase, putArtifact } from "../../../src/storage/index.js";
import { createGitRepository } from "../../../tests/helpers/git-fixture.js";
import { setupVerifyingTask } from "../../../tests/helpers/durable-lifecycle.js";
import { runHandoffCreate } from "../../../src/commands/handoff-create.js";
import { runHandoffAccept } from "../../../src/commands/handoff-accept.js";
import { taskArtifactPath } from "../../../src/core/task-paths.js";
import { removeTempTree } from "../../../tests/helpers/rm-safe.js";

async function connectReadonly(projectPath) {
  const { server } = await createForgeLoopMcpServer({ projectPath, mode: "readonly" });
  const client = new Client({ name: "storage-resource-read-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("MCP native evaluations resource reads the SQLite artifact without a legacy file", async () => {
  const target = await buildDiagnosisProject();
  const packageRoot = getPackageRoot();
  const databasePath = path.join(target, ".forgeloop", "state.sqlite");
  const legacyDirectory = path.join(target, taskArtifactPath(TEST_TASK_ID, "evaluations"));
  const fixturePath = path.join(packageRoot, "tests", "fixtures", "schemas", "trajectory-evaluation", "valid.json");
  const evaluation = JSON.parse(await readFile(fixturePath, "utf8"));
  evaluation.taskId = TEST_TASK_ID;
  let db;
  let client;
  let server;
  try {
    db = openStorageDatabase(databasePath);
    putArtifact(db, {
      taskId: TEST_TASK_ID,
      kind: "evaluation",
      artifactId: evaluation.evaluationId,
      payload: evaluation,
    });
    db.close();
    db = null;

    await assert.rejects(access(legacyDirectory), { code: "ENOENT" });
    ({ client, server } = await connectReadonly(target));
    const response = await client.readResource({ uri: `forgeloop://task/${TEST_TASK_ID}/evaluations` });

    assert.equal(response.contents.length, 1);
    assert.equal(response.contents[0].mimeType, "application/json");
    const data = JSON.parse(response.contents[0].text);
    assert.deepEqual(data, { evaluations: [evaluation] });
    await assert.rejects(access(legacyDirectory), { code: "ENOENT" });
  } finally {
    db?.close();
    await client?.close();
    await server?.close();
    await removeTempTree(target);
  }
});

test("MCP native handoffs resource projects the SQLite handoff and acceptance without a legacy file", async () => {
  const target = await createGitRepository("forgeloop-mcp-handoff-resource-");
  const packageRoot = getPackageRoot();
  const taskId = "mcp-handoff-resource";
  const legacyDirectory = path.join(target, taskArtifactPath(taskId, "handoffs"));
  let client;
  let server;
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });
    const created = await runHandoffCreate({ target, packageRoot, taskId, handoffId: "mcp-resource-envelope" });
    const accepted = await runHandoffAccept({
      target,
      packageRoot,
      taskId,
      handoffId: created.handoff.handoffId,
      consumerId: "mcp-resource-consumer",
      harness: "mcp-resource-test",
    });
    await assert.rejects(access(legacyDirectory), { code: "ENOENT" });

    ({ client, server } = await connectReadonly(target));
    const response = await client.readResource({ uri: `forgeloop://task/${taskId}/handoffs` });

    assert.equal(response.contents.length, 1);
    const data = JSON.parse(response.contents[0].text);
    assert.equal(data.taskId, taskId);
    assert.equal(data.count, 1);
    assert.equal(data.handoffs.length, 1);
    assert.equal(data.handoffs[0].handoffId, created.handoff.handoffId);
    assert.equal(data.handoffs[0].artifactDigest, created.handoff.artifactDigest);
    assert.deepEqual(data.handoffs[0].acceptance, {
      status: "ACCEPTED",
      consumerId: accepted.consumerId,
      harness: accepted.harness,
      acceptedAt: accepted.acceptedAt,
    });
    await assert.rejects(access(legacyDirectory), { code: "ENOENT" });
  } finally {
    await client?.close();
    await server?.close();
    await removeTempTree(target);
  }
});
