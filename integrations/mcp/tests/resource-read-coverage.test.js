import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { test } from "node:test";

import { readForgeLoopIntegrationResource } from "../../../src/integration.js";
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
  return JSON.parse(response.contents[0].text);
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
