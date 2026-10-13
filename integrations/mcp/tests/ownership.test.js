import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { createForgeLoopMcpServer } from "../src/server.js";
import { removeTempTree } from "../../../tests/helpers/rm-safe.js";
import { packageRoot as fixturePackageRoot, setupAbandonedTask, withRecoveryTarget } from "../../../tests/helpers/task-recovery-fixture.js";
import { runTaskRecover } from "../../../src/commands/task-recover.js";
import { readWorkState, createWorkState, writeWorkState } from "../../../src/core/work-state.js";

async function connectServer(projectPath) {
  const { server } = await createForgeLoopMcpServer({ projectPath, mode: "safe" });
  const client = new Client({ name: "test-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const closeClient = client.close.bind(client);
  client.close = async () => {
    try { await closeClient(); } finally { await server.close(); }
  };
  return client;
}

test("ownership resource projects ACTIVE and forged-COMPLETE states through the canonical resolver", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "mcp-ownership-states" });

    // ACTIVE.
    let client = await connectServer(target);
    try {
      const active = await client.readResource({ uri: `forgeloop://task/${taskId}/ownership` });
      const activeData = JSON.parse(active.contents[0].text);
      assert.equal(activeData.claimState, "ACTIVE");
      assert.deepEqual(activeData.effectiveWriteClaims, ["tests"]);
      assert.equal(activeData.mutationAllowed, true);
    } finally {
      await client.close();
    }

    // Forged COMPLETE -> INCONSISTENT with retained claims.
    const state = await readWorkState(target, { packageRoot: fixturePackageRoot, taskId });
    await writeWorkState(target, createWorkState({
      ...state,
      phase: "COMPLETE",
      previousPhase: "REVIEWING",
      verificationEvidence: [{ kind: "OBSERVED", source: "fixture", result: "passed" }],
      evidenceCoverage: [],
      checks: [],
    }), { packageRoot: fixturePackageRoot, taskId });

    client = await connectServer(target);
    try {
      const forged = await client.readResource({ uri: `forgeloop://task/${taskId}/ownership` });
      const forgedData = JSON.parse(forged.contents[0].text);
      assert.equal(forgedData.claimState, "INCONSISTENT");
      assert.deepEqual(forgedData.effectiveWriteClaims, ["tests"]);
      assert.equal(forgedData.mutationAllowed, false);
      assert.equal(forgedData.ownershipValid, false);
      assert.ok(forgedData.reasonCodes.includes("E_COMPLETION_OWNERSHIP_UNPROVEN"));
    } finally {
      await client.close();
    }
  });
});

test("normal mutation against a RECOVERED task is blocked by core, not by MCP", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "mcp-recovered-mutation" });
    await runTaskRecover({ target, packageRoot: fixturePackageRoot, taskId, acknowledgeRecovery: true });

    const client = await connectServer(target);
    try {
      const result = await client.callTool({
        name: "forgeloop_advance",
        arguments: { taskId, to: "VERIFYING" },
      });
      assert.equal(result.isError, true);
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.ok, false);

      // Ownership resource confirms validated recovered state.
      const ownership = await client.readResource({ uri: `forgeloop://task/${taskId}/ownership` });
      const projection = JSON.parse(ownership.contents[0].text);
      assert.equal(projection.claimState, "RELEASED_BY_RECOVERY");
      assert.deepEqual(projection.effectiveWriteClaims, []);
      assert.equal(projection.mutationAllowed, false);
    } finally {
      await client.close();
    }
  });
});

test("task-resume remains available in safe mode and reacquires canonically", async () => {
  await withRecoveryTarget(async (target) => {
    const { taskId } = await setupAbandonedTask(target, { taskId: "mcp-safe-resume" });
    await runTaskRecover({ target, packageRoot: fixturePackageRoot, taskId, acknowledgeRecovery: true });

    const client = await connectServer(target);
    try {
      const result = await client.callTool({
        name: "forgeloop_task_resume",
        arguments: { taskId },
      });
      assert.notEqual(result.isError, true, result.content?.[0]?.text);
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.result.resumed, true);
      assert.deepEqual(parsed.result.reacquiredClaims, ["tests"]);

      const ownership = await client.readResource({ uri: `forgeloop://task/${taskId}/ownership` });
      const projection = JSON.parse(ownership.contents[0].text);
      assert.equal(projection.claimState, "ACTIVE");
      assert.equal(projection.mutationAllowed, true);
    } finally {
      await client.close();
    }
  });
});

test("task-recover and legacy repair are unavailable in safe mode", async () => {
  const target = await mkdtemp(path.join(tmpdir(), "forgeloop-mcp-norecovery-"));
  const { server } = await createForgeLoopMcpServer({ projectPath: target, mode: "safe" });
  const client = new Client({ name: "t", version: "0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    assert.equal(names.includes("forgeloop_task_recover"), false);
    assert.equal(names.includes("forgeloop_task_repair_legacy_recovery"), false);
  } finally {
    await client.close();
    await removeTempTree(target);
  }
});
