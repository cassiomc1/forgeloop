import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";

import { readForgeLoopIntegrationResource } from "../../../src/integration.js";
import { recordSemanticDecision } from "../../../src/core/decision/service.js";
import { testSemanticProvider } from "../../../src/core/decision/test-provider.js";
import { evaluateTrajectory } from "../../../src/core/trajectory-evaluation.js";
import { runHandoffAccept } from "../../../src/commands/handoff-accept.js";
import { runHandoffCreate } from "../../../src/commands/handoff-create.js";
import { runTaskCreate } from "../../../src/commands/task-create.js";
import { getPackageRoot } from "../../../src/core/templates.js";
import { setupVerifyingTask } from "../../../tests/helpers/durable-lifecycle.js";
import { createGitRepository } from "../../../tests/helpers/git-fixture.js";
import { removeTempTree } from "../../../tests/helpers/rm-safe.js";

const packageRoot = getPackageRoot();
const mcpRequire = createRequire(new URL("../package.json", import.meta.url));
const { Client } = mcpRequire("@modelcontextprotocol/client");
const { InMemoryTransport } = mcpRequire("@modelcontextprotocol/server");

// The preserved MCP dependency tree may resolve the package name to the
// original checkout. Bind the public integration specifier to this checkout
// so the transport assertion exercises the source under test without changing
// the dependency tree.
const currentIntegrationUrl = new URL("../../../src/integration.js", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@cassiomc1/forgeloop/integration") {
      return { url: currentIntegrationUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

async function connectMcp(projectPath) {
  const { createForgeLoopMcpServer } = await import("../src/server.js");
  const { server } = await createForgeLoopMcpServer({
    projectPath,
    mode: "readonly",
    packageRoot,
  });
  const client = new Client({ name: "resource-read-coverage-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

async function readMcpResource(client, uri) {
  const response = await client.readResource({ uri });
  assert.equal(response.contents.length, 1, uri);
  assert.equal(response.contents[0].uri, uri, uri);
  assert.equal(response.contents[0].mimeType, "application/json", uri);
  const text = response.contents[0].text;
  const value = JSON.parse(text);
  // The MCP adapter promises to transmit the exact bounded JSON serialization;
  // assert the wire bytes are canonical before comparing the parsed payload.
  assert.equal(text, JSON.stringify(value, null, 2), uri);
  return value;
}

async function readDirectResource(projectPath, resource, extra = {}) {
  const result = await readForgeLoopIntegrationResource(resource, {
    projectPath,
    packageRoot,
    ...extra,
  });
  return result.data;
}

function stableTransportValue(value, key = null) {
  // Direct and MCP reads happen at different instants, so stateAgeMs is a
  // transient parity field. macOS realpath may also spell /var as
  // /private/var; normalize that equivalent path spelling only after proving
  // the transient value is a finite, non-negative measurement.
  if (key === "stateAgeMs") {
    assert.equal(Number.isFinite(value), true, "stateAgeMs must be finite");
    assert.equal(value >= 0, true, "stateAgeMs must be non-negative");
    return undefined;
  }
  if (typeof value === "string") return value.replaceAll("/private/var/", "/var/");
  if (Array.isArray(value)) return value.map((item) => stableTransportValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([entryKey, entryValue]) => [entryKey, stableTransportValue(entryValue, entryKey)])
        .filter(([, entryValue]) => entryValue !== undefined),
    );
  }
  return value;
}

test("MCP project resources/read preserve protocol and capability-policy authority", async () => {
  const target = await createGitRepository("forgeloop-mcp-project-resources-");
  const taskId = "mcp-project-resource-precondition";
  let client;
  let server;
  const capabilityPolicy = {
    schemaVersion: 1,
    defaultDecision: "DENY",
    rules: [{ capability: "filesystem.write", decision: "REQUIRE_APPROVAL" }],
  };
  try {
    // The task fixture drives the canonical policy lock and project policy
    // setup; the resources below are then read through the real MCP server.
    await setupVerifyingTask(target, packageRoot, { taskId, capabilityPolicy });

    const directProtocol = await readDirectResource(target, "protocol/info");
    assert.equal(directProtocol.protocolVersion, 1);
    assert.deepEqual(directProtocol.readsProtocol, [1]);
    assert.deepEqual(directProtocol.writesProtocol, [1]);
    assert.equal(directProtocol.features.integrationApi.canonicalResources, true);
    assert.equal(directProtocol.features.operationalStorage.defaultBackend, "sqlite");

    const directPolicy = await readDirectResource(target, "project/capability-policy");
    assert.equal(directPolicy.path, ".forgeloop/policy/capabilities.json");
    assert.deepEqual(directPolicy.policy, capabilityPolicy);
    assert.match(directPolicy.fingerprint, /^[a-f0-9]{64}$/u);
    assert.equal(Object.hasOwn(directPolicy.policy, "authority"), false);

    ({ client, server } = await connectMcp(target));
    const mcpProtocol = await readMcpResource(client, "forgeloop://protocol/info");
    const mcpPolicy = await readMcpResource(client, "forgeloop://project/capability-policy");
    assert.deepEqual(mcpProtocol, directProtocol);
    assert.deepEqual(mcpPolicy, directPolicy);
    assert.equal(mcpPolicy.policy.rules[0].capability, "filesystem.write");
    assert.equal(mcpPolicy.policy.rules[0].decision, "REQUIRE_APPROVAL");
  } finally {
    await client?.close();
    await server?.close();
    await removeTempTree(target);
  }
});

test("MCP task resources/read preserve canonical status, continuity, context and audit projections", async () => {
  const target = await createGitRepository("forgeloop-mcp-task-resources-");
  const taskId = "mcp-task-resource-precondition";
  let client;
  let server;
  try {
    await setupVerifyingTask(target, packageRoot, { taskId, requirement: "MCP resources/read" });

    const direct = new Map();
    for (const kind of ["status", "contract", "continuity", "metrics", "context", "audit-view"]) {
      direct.set(kind, await readDirectResource(target, `task/${kind}`, { taskId }));
    }

    const status = direct.get("status");
    assert.equal(status.taskId, taskId);
    assert.equal(status.claimState, "ACTIVE");
    assert.equal(status.mutationAllowed, true);
    assert.equal(status.ownershipValid, true);

    const contract = direct.get("contract");
    assert.equal(contract.taskId, taskId);
    assert.match(contract.objective, /mcp-task-resource-precondition/u);
    assert.ok(contract.verification.some((item) => String(item.text ?? item).includes("MCP resources/read")));

    const continuity = direct.get("continuity");
    // This lifecycle fixture has no continuity artifact yet. The supported
    // response is an explicit absence projection, not an invented fresh state.
    assert.equal(continuity.classification, "ABSENT");
    assert.equal(continuity.present, false);
    assert.equal(continuity.taskMatches, null);
    assert.equal(continuity.authority, "OPERATIONAL_CONTEXT_ONLY");
    assert.equal(continuity.evidenceAuthority, "NONE");

    const metrics = direct.get("metrics");
    assert.equal(metrics.schemaVersion, 1);
    assert.equal(metrics.taskId, taskId);
    assert.ok(["PROVIDER_REPORTED", "HOST_REPORTED", "ACTOR_REPORTED", "UNKNOWN"].includes(metrics.usage.source));
    assert.equal(metrics.completion.phase, "VERIFYING");

    const context = direct.get("context");
    assert.equal(context.schemaVersion, 1);
    assert.equal(context.taskId, taskId);
    assert.ok(["light", "balanced", "full"].includes(context.executionProfile.resolved));
    assert.equal(context.invariants.requiredGatesPreserved, true);
    assert.equal(context.invariants.verificationTruthPreserved, true);
    assert.equal(context.invariants.lifecyclePhaseSkippingAllowed, false);

    const audit = direct.get("audit-view");
    assert.equal(audit.readOnly, true);
    assert.equal(audit.authority.lifecycleAuthority, false);
    assert.equal(audit.authority.evidenceAuthority, false);
    assert.equal(audit.authority.mutationAuthority, false);
    assert.ok(audit.timeline.items.length > 0);
    assert.equal(audit.links.status, "task/status");
    assert.equal(audit.links.auditView, "task/audit-view");

    ({ client, server } = await connectMcp(target));
    for (const [kind, expected] of direct) {
      const actual = await readMcpResource(client, `forgeloop://task/${taskId}/${kind}`);
      assert.deepEqual(
        stableTransportValue(actual),
        stableTransportValue(expected),
        kind,
      );
    }
  } finally {
    await client?.close();
    await server?.close();
    await removeTempTree(target);
  }
});

test("MCP repository/index-status resources/read preserve explicit engine health and redaction", async () => {
  const target = await createGitRepository("forgeloop-mcp-index-resource-");
  let client;
  let server;
  try {
    const direct = await readDirectResource(target, "repository/index-status");
    assert.equal(direct.schemaVersion, 1);
    assert.equal(direct.required, true);
    assert.equal(direct.engine, "tgrep");
    assert.ok([
      "READY",
      "INDEXING",
      "NOT_INITIALIZED",
      "ENGINE_MISSING",
      "ENGINE_INVALID",
      "SERVER_DOWN",
      "SERVER_UNHEALTHY",
      "ERROR",
    ].includes(direct.health));
    assert.equal(Object.hasOwn(direct, "repositoryRoot"), false);
    assert.equal(Object.hasOwn(direct, "indexPath"), false);
    assert.equal(Object.hasOwn(direct, "binaryPath"), false);
    assert.equal(Object.hasOwn(direct, "statePath"), false);
    assert.equal(Object.hasOwn(direct.index, "rootPath"), false);
    assert.doesNotMatch(JSON.stringify(direct), new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
    if (direct.health === "ENGINE_MISSING") {
      assert.equal(direct.managedBinary, false);
      assert.equal(direct.server.running, false);
    }
    if (direct.health === "NOT_INITIALIZED") {
      assert.equal(direct.index.present, false);
      assert.equal(direct.server.running, false);
    }

    ({ client, server } = await connectMcp(target));
    const mcp = await readMcpResource(client, "forgeloop://repository/index-status");
    assert.deepEqual(mcp, direct);
    assert.equal(mcp.engine, "tgrep");
    assert.equal(mcp.required, true);
    assert.equal(mcp.health, direct.health);
  } finally {
    await client?.close();
    await server?.close();
    await removeTempTree(target);
  }
});

test("MCP project/tasks preserves empty and populated canonical discovery parity", async () => {
  const emptyTarget = await createGitRepository("forgeloop-mcp-project-tasks-empty-");
  let client;
  let server;
  try {
    const direct = await readDirectResource(emptyTarget, "project/tasks");
    assert.deepEqual(direct, { count: 0, tasks: [] });

    ({ client, server } = await connectMcp(emptyTarget));
    const mcp = await readMcpResource(client, "forgeloop://project/tasks");
    assert.deepEqual(stableTransportValue(mcp), stableTransportValue(direct));
  } finally {
    await client?.close();
    await server?.close();
    await removeTempTree(emptyTarget);
  }

  const populatedTarget = await createGitRepository("forgeloop-mcp-project-tasks-populated-");
  client = undefined;
  server = undefined;
  try {
    const taskId = "mcp-project-tasks-populated";
    await setupVerifyingTask(populatedTarget, packageRoot, { taskId });

    const direct = await readDirectResource(populatedTarget, "project/tasks");
    assert.equal(direct.count, 1);
    assert.deepEqual(direct.tasks, [{
      taskId,
      healthy: true,
      phase: "VERIFYING",
      mutationAllowed: true,
    }]);

    ({ client, server } = await connectMcp(populatedTarget));
    const mcp = await readMcpResource(client, "forgeloop://project/tasks");
    assert.deepEqual(stableTransportValue(mcp), stableTransportValue(direct));
  } finally {
    await client?.close();
    await server?.close();
    await removeTempTree(populatedTarget);
  }
});

test("MCP task/ownership preserves the canonical projection and fails closed for invalid subjects", async () => {
  const target = await createGitRepository("forgeloop-mcp-task-ownership-");
  const taskId = "mcp-task-ownership";
  const missingTaskId = "mcp-task-ownership-missing";
  let client;
  let server;
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });

    const direct = await readDirectResource(target, "task/ownership", { taskId });
    assert.equal(direct.taskId, taskId);
    assert.equal(direct.claimState, "ACTIVE");
    assert.equal(direct.mutationAllowed, true);
    assert.equal(direct.ownershipValid, true);
    assert.deepEqual(direct.effectiveWriteClaims, ["src"]);

    ({ client, server } = await connectMcp(target));
    const mcp = await readMcpResource(client, "forgeloop://task/" + taskId + "/ownership");
    assert.deepEqual(stableTransportValue(mcp), stableTransportValue(direct));

    for (const kind of ["ownership", "handoffs", "evaluations", "decisions"]) {
      await assert.rejects(
        () => readDirectResource(target, "task/" + kind),
        (error) => {
          assert.equal(error.code, "E_TASK_REQUIRED");
          assert.equal(error.message, "Resource task/" + kind + " requires a taskId");
          return true;
        },
        kind,
      );
    }
    const unknownDirect = await readDirectResource(target, "task/ownership", { taskId: missingTaskId });
    assert.equal(unknownDirect.taskId, missingTaskId);
    assert.equal(unknownDirect.claimState, "INCONSISTENT");
    assert.equal(unknownDirect.mutationAllowed, false);
    assert.equal(unknownDirect.ownershipValid, false);
    assert.ok(unknownDirect.reasonCodes.includes("E_TASK_CLAIM_OWNERSHIP_INCONSISTENT"));
    assert.ok(unknownDirect.reasonCodes.includes("E_TASK_NOT_FOUND"));

    const unknownMcp = await readMcpResource(
      client,
      "forgeloop://task/" + missingTaskId + "/ownership",
    );
    assert.deepEqual(stableTransportValue(unknownMcp), stableTransportValue(unknownDirect));

    const missingUri = "forgeloop://task//ownership";
    await assert.rejects(
      () => client.readResource({ uri: missingUri }),
      (error) => {
        assert.equal(error.code, -32602);
        assert.deepEqual(error.data, { uri: missingUri });
        assert.equal(error.message, "Resource not found: " + missingUri);
        return true;
      },
    );
  } finally {
    await client?.close();
    await server?.close();
    await removeTempTree(target);
  }
});

test("MCP empty handoffs, evaluations and decisions preserve direct-resource parity", async () => {
  const target = await createGitRepository("forgeloop-mcp-empty-secondary-resources-");
  const taskId = "mcp-empty-secondary-resources";
  let client;
  let server;
  try {
    // task-create creates only the canonical descriptor and lifecycle ledger,
    // leaving the three collection resources empty without bypassing public
    // storage or seeding rows directly.
    await runTaskCreate({ target, packageRoot, taskId, claims: [] });

    const direct = new Map([
      ["handoffs", await readDirectResource(target, "task/handoffs", { taskId })],
      ["evaluations", await readDirectResource(target, "task/evaluations", { taskId })],
      ["decisions", await readDirectResource(target, "task/decisions", { taskId })],
    ]);
    assert.deepEqual(direct.get("handoffs"), { taskId, count: 0, handoffs: [] });
    assert.deepEqual(direct.get("evaluations"), { evaluations: [] });
    assert.deepEqual(direct.get("decisions"), { taskId, decisions: [] });

    ({ client, server } = await connectMcp(target));
    for (const [kind, expected] of direct) {
      const actual = await readMcpResource(client, "forgeloop://task/" + taskId + "/" + kind);
      assert.deepEqual(
        stableTransportValue(actual),
        stableTransportValue(expected),
        kind,
      );
    }
  } finally {
    await client?.close();
    await server?.close();
    await removeTempTree(target);
  }
});

test("MCP handoffs, evaluations and decisions preserve populated direct-resource parity", async () => {
  const target = await createGitRepository("forgeloop-mcp-populated-resources-");
  const taskId = "mcp-populated-resources";
  const evaluationId = "eval-mcp-resource-parity";
  const decisionId = "diagnosis-mcp-resource-parity";
  let client;
  let server;
  try {
    await setupVerifyingTask(target, packageRoot, { taskId });

    // The scenario is written through the filesystem helper and evaluated
    // through the public trajectory API; no artifact or database rows are
    // seeded by the fixture.
    const scenarioFixture = await readFile(
      path.join(packageRoot, "tests", "fixtures", "schemas", "trajectory-scenario", "valid.json"),
      "utf8",
    );
    await writeFile(path.join(target, "trajectory-scenario.json"), scenarioFixture, "utf8");

    const created = await runHandoffCreate({ target, packageRoot, taskId });
    const accepted = await runHandoffAccept({
      target,
      packageRoot,
      taskId,
      handoffId: created.handoff.handoffId,
      consumerId: "mcp-resource-parity-consumer",
      harness: "mcp-resource-parity",
    });
    assert.equal(accepted.accepted, true);
    const statusAfterAcceptance = await readDirectResource(target, "task/status", { taskId });
    assert.equal(statusAfterAcceptance.phase, "VERIFYING");

    const evaluation = await evaluateTrajectory({
      target,
      packageRoot,
      taskId,
      scenarioPath: "trajectory-scenario.json",
      evaluationId,
    });
    assert.equal(evaluation.evaluationId, evaluationId);
    assert.equal(evaluation.taskId, taskId);

    const decision = await recordSemanticDecision({
      target,
      packageRoot,
      taskId,
      decisionId,
      provider: testSemanticProvider,
      request: {
        decisionKind: "DIAGNOSIS_PRIORITY",
        questionSetId: "diagnosis-v1",
        state: { objective: "MCP resource parity" },
      },
    });
    assert.equal(decision.artifact.decisionId, decisionId);

    const direct = new Map([
      ["handoffs", await readDirectResource(target, "task/handoffs", { taskId })],
      ["evaluations", await readDirectResource(target, "task/evaluations", { taskId })],
      ["decisions", await readDirectResource(target, "task/decisions", { taskId })],
    ]);
    assert.equal(direct.get("handoffs").count, 1);
    assert.equal(direct.get("handoffs").handoffs[0].acceptance.status, "ACCEPTED");
    assert.equal(direct.get("evaluations").evaluations.length, 1);
    assert.equal(direct.get("evaluations").evaluations[0].evaluationId, evaluationId);
    assert.equal(direct.get("decisions").taskId, taskId);
    assert.ok(direct.get("decisions").decisions.some((item) => item.decisionId === decisionId));

    ({ client, server } = await connectMcp(target));
    for (const [kind, expected] of direct) {
      const actual = await readMcpResource(client, "forgeloop://task/" + taskId + "/" + kind);
      assert.deepEqual(
        stableTransportValue(actual),
        stableTransportValue(expected),
        kind,
      );
    }
  } finally {
    await client?.close();
    await server?.close();
    await removeTempTree(target);
  }
});
