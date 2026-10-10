import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { readForgeLoopIntegrationResource, createForgeLoopContext } from "../src/integration.js";
import { runActivate } from "../src/commands/activate.js";
import { runAdvance } from "../src/commands/advance.js";
import { runAttestationCreate } from "../src/commands/attestation-create.js";
import { runCheck } from "../src/commands/run-check.js";
import { runComplete } from "../src/commands/complete.js";
import { runPrepareCompletion } from "../src/commands/prepare-completion.js";
import { runPreflight } from "../src/commands/preflight.js";
import { runQualityBaseline } from "../src/commands/quality-baseline.js";
import { runRoute } from "../src/commands/route.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { runTestUtility } from "../src/commands/test-utility.js";
import { runVerifyScope } from "../src/commands/verify-scope.js";
import { runWorkspaceBind } from "../src/commands/workspace-bind.js";
import { runActionPropose } from "../src/commands/action-propose.js";
import { runApprovalRequest } from "../src/commands/approval-request.js";
import { recordSemanticDecision } from "../src/core/decision/service.js";
import { installTestSemanticProvider, clearTestSemanticProvider, testSemanticProvider } from "../src/core/decision/test-provider.js";
import { createConfig, writeConfig } from "../src/core/config.js";
import { createContract, writeContract } from "../src/core/contract.js";
import { setResponsibilityContract } from "../src/core/responsibility.js";
import { taskDirectory } from "../src/core/task-paths.js";
import { getPackageRoot } from "../src/core/templates.js";
import { setupVerifyingTask } from "./helpers/durable-lifecycle.js";
import { createGitRepository } from "./helpers/git-fixture.js";

const packageRoot = getPackageRoot();
const mcpRequire = createRequire(new URL("../integrations/mcp/package.json", import.meta.url));
const { Client } = mcpRequire("@modelcontextprotocol/client");
const { InMemoryTransport } = mcpRequire("@modelcontextprotocol/server");

// The checkout intentionally preserves the existing MCP dependency tree. Its
// installed file dependency may point at the original checkout, so bind the
// adapter's stable package specifier to this checkout's public integration
// entrypoint for this source-level regression. No dependency tree is changed.
const currentIntegrationUrl = new URL("../src/integration.js", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@cassiomc1/forgeloop/integration") {
      return { url: currentIntegrationUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

async function connectMcp(projectPath, runtimeContext = null) {
  const mcp = await import("../integrations/mcp/src/server.js");
  const product = runtimeContext
    ? mcp.buildForgeLoopMcpServer({
      projectContext: await (await import("../integrations/mcp/src/project-context.js")).resolveProjectContext(projectPath),
      policy: (await import("../integrations/mcp/src/capability-policy.js")).resolveLaunchPolicy({ mode: "readonly" }),
      packageRoot,
      storageRuntimeContext: runtimeContext,
    })
    : await mcp.createForgeLoopMcpServer({ projectPath, mode: "readonly", packageRoot });
  const selectedServer = runtimeContext ? product : product.server;
  const client = new Client({ name: "storage-task-resource-authority-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await selectedServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server: selectedServer };
}

async function readMcpResource(client, uri) {
  const response = await client.readResource({ uri });
  assert.equal(response.contents.length, 1, uri);
  assert.equal(response.contents[0].mimeType, "application/json", uri);
  return JSON.parse(response.contents[0].text);
}

async function readIntegrationResource(target, taskId, kind, extra = {}) {
  const resource = await readForgeLoopIntegrationResource(`task/${kind}`, {
    projectPath: target,
    packageRoot,
    taskId,
    ...extra,
  });
  return resource.data;
}

async function assertNoLegacyTaskTree(target, taskId) {
  await assert.rejects(
    access(path.join(target, taskDirectory(taskId))),
    { code: "ENOENT" },
  );
}

async function prepareResponsibilityTask(target, taskId) {
  await runTaskCreate({ target, packageRoot, taskId, claims: ["src"] });
  await runWorkspaceBind({ target, packageRoot, taskId });
  const contract = createContract({
    taskId,
    objective: "Exercise the native responsibility resource",
    deliverables: ["src"],
    constraints: [],
    risks: [],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
    verification: [{ id: "resource-check", text: "The native resource remains readable", type: "VERIFICATION" }],
    successCriteria: ["The native responsibility sentinel is preserved"],
  });
  await writeContract(target, contract, packageRoot, { taskId });
  await runRoute({
    target,
    packageRoot,
    taskId,
    workType: "code",
    surfaces: ["config"],
    executableChange: true,
    semanticProvider: testSemanticProvider,
  });
  const preflight = await runPreflight({ target, packageRoot, taskId });
  assert.equal(preflight.status, "READY", JSON.stringify(preflight.errors));
  await runActivate({ target, packageRoot, taskId });
  await runAdvance({ target, packageRoot, taskId, to: "PLANNED" });
  return setResponsibilityContract(target, {
    packageRoot,
    taskId,
    label: "native-resource-responsibility-sentinel",
    allowedPaths: ["src"],
    readOnlyPaths: ["docs"],
    frozenInputs: { contract: true, route: true, claims: true },
  });
}

function qualityRuntimeContext() {
  const provider = {
    id: "fake",
    async detect() {
      return {
        available: true,
        providerId: "fake",
        providerVersion: "1.0.0",
        transport: "test",
        reasonCode: null,
      };
    },
    async scan() {
      return {
        snapshot: {
          quality_signal: 9000,
          root_causes: {
            modularity: { score: 9000, raw: 0.9 },
            acyclicity: { score: 9000, raw: 0.9 },
            depth: { score: 9000, raw: 0.9 },
            equality: { score: 9000, raw: 0.9 },
            redundancy: { score: 9000, raw: 0.9 },
          },
          files: 1,
          lines: 1,
          import_edges: 0,
          cross_module_edges: 0,
        },
        provider: { id: "fake", version: "1.0.0", transport: "test", executionMode: "test" },
      };
    },
  };
  return createForgeLoopContext({ structuralQualityProviders: { fake: provider } });
}

async function prepareQualityTask(target, taskId, runtimeContext) {
  await runTaskCreate({ target, packageRoot, taskId, claims: [] });
  await writeConfig(target, createConfig({
    complianceMode: "standard",
    structuralQuality: { mode: "gate", provider: "fake" },
  }), packageRoot);
  await writeContract(target, createContract({
    taskId,
    objective: "Exercise the native structural-quality resource",
    deliverables: ["src"],
    verification: [],
    successCriteria: [],
  }), packageRoot, { taskId });
  await runRoute({ target, packageRoot, taskId, workType: "documentation", surfaces: ["config"], semanticProvider: testSemanticProvider });
  const preflight = await runPreflight({ target, packageRoot, taskId });
  assert.equal(preflight.status, "READY", JSON.stringify(preflight.errors));
  await runActivate({ target, packageRoot, taskId });
  await runAdvance({ target, packageRoot, taskId, to: "PLANNED" });
  const baseline = await runQualityBaseline({ target, packageRoot, taskId, runtimeContext });
  assert.equal(baseline.status, "CAPTURED");
  return baseline;
}

test("public integration and MCP resources read native task payloads without legacy mirrors", async () => {
  installTestSemanticProvider();
  const target = await createGitRepository("forgeloop-task-resource-authority-");
  const taskId = "native-task-resource-authority";
  let client;
  let server;
  try {
    await setupVerifyingTask(target, packageRoot, {
      taskId,
      capabilityPolicy: {
        schemaVersion: 1,
        defaultDecision: "DENY",
        rules: [{ capability: "filesystem.write", decision: "REQUIRE_APPROVAL" }],
      },
    });
    await runWorkspaceBind({ target, packageRoot, taskId });
    const actionResult = await runActionPropose({
      target,
      packageRoot,
      taskId,
      input: {
        actionId: "action-resource-sentinel",
        effectClass: "REVERSIBLE_WRITE",
        capability: "filesystem.write",
        target: "resource-native-sentinel",
        operation: "persist resource sentinel",
        idempotencyKey: "resource-native-sentinel:v1",
        requiredForCompletion: true,
        requirement: "the resource sentinel is persisted",
      },
    });
    const actionId = actionResult.action.actionId;
    await runApprovalRequest({
      target,
      packageRoot,
      taskId,
      approvalId: "approval-resource-sentinel",
      actionId,
      reason: "native resource approval sentinel",
    });
    await runVerifyScope({ target, packageRoot, taskId, verificationScopeMode: "AUTO" });
    await mkdir(path.join(target, "tests"), { recursive: true });
    await writeFile(
      path.join(target, "tests", "resource-native-sentinel.test.js"),
      "import test from 'node:test'; test('resource-native-sentinel', () => {});\n",
      "utf8",
    );
    await runTestUtility({ target, packageRoot, taskId, provider: testSemanticProvider });
    await recordSemanticDecision({
      target,
      packageRoot,
      taskId,
      decisionId: "model-route-resource-sentinel",
      provider: testSemanticProvider,
      request: {
        decisionKind: "MODEL_ROUTE",
        questionSetId: "model-route-v1",
        state: { objective: "native model route resource sentinel" },
      },
    });

    const direct = new Map();
    for (const kind of [
      "workspace-binding",
      "verification-scope",
      "actions",
      "approvals",
      "context-plan",
      "model-route",
      "test-utility",
    ]) direct.set(kind, await readIntegrationResource(target, taskId, kind));
    direct.set("action", await readIntegrationResource(target, taskId, "action", { actionId }));

    assert.equal(direct.get("workspace-binding").status, "MATCH");
    assert.equal(direct.get("workspace-binding").binding.taskId, taskId);
    assert.equal(direct.get("workspace-binding").current.workspaceIdentity, direct.get("workspace-binding").binding.workspaceIdentity);
    assert.match(direct.get("workspace-binding").bindingFingerprint, /^[a-f0-9]{64}$/u);

    assert.equal(direct.get("verification-scope").taskId, taskId);
    assert.equal(direct.get("verification-scope").scope.taskId, taskId);
    assert.equal(direct.get("verification-scope").scope.resolvedMode, "FULL");
    assert.equal(direct.get("verification-scope").scope.fallback.to, "FULL");

    assert.equal(direct.get("actions").actions.length, 1);
    assert.equal(direct.get("actions").actions[0].target, "resource-native-sentinel");
    assert.equal(direct.get("action").target, "resource-native-sentinel");
    assert.equal(direct.get("action").actionId, actionId);

    assert.equal(direct.get("approvals").approvals.length, 1);
    assert.equal(direct.get("approvals").approvals[0].status, "PENDING");
    assert.equal(direct.get("approvals").approvals[0].reason, "native resource approval sentinel");

    assert.equal(direct.get("context-plan").profile, "balanced");
    assert.equal(direct.get("context-plan").candidateItems, 0);
    assert.equal(direct.get("context-plan").evidenceAuthority, "NONE");
    assert.equal(direct.get("context-plan").lifecycleAuthority, false);

    assert.equal(direct.get("model-route").engine, "typesafe-jev");
    assert.equal(direct.get("model-route").resolved, "STANDARD");
    assert.equal(direct.get("model-route").semanticRecommendation.confidence, 0.95);
    assert.equal(direct.get("model-route").lifecycleAuthority, false);

    const utilityTest = direct.get("test-utility").tests.find((item) => item.name === "resource-native-sentinel");
    assert.ok(utilityTest);
    assert.equal(utilityTest.file, "tests/resource-native-sentinel.test.js");
    assert.equal(direct.get("test-utility").semanticStatus, "PROVIDER_REPORTED");

    await assertNoLegacyTaskTree(target, taskId);
    ({ client, server } = await connectMcp(target));
    for (const [kind, data] of direct) {
      const uri = kind === "action"
        ? `forgeloop://task/${taskId}/action/${actionId}`
        : `forgeloop://task/${taskId}/${kind}`;
      assert.deepEqual(await readMcpResource(client, uri), data, kind);
    }
    await assertNoLegacyTaskTree(target, taskId);
  } finally {
    await client?.close();
    await server?.close();
    clearTestSemanticProvider();
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("responsibility integration and MCP resources preserve the native scoped contract", async () => {
  installTestSemanticProvider();
  const target = await createGitRepository("forgeloop-task-resource-responsibility-");
  const taskId = "native-responsibility-resource";
  let client;
  let server;
  try {
    await prepareResponsibilityTask(target, taskId);
    const direct = await readIntegrationResource(target, taskId, "responsibility");
    assert.equal(direct.status, "VALID", JSON.stringify(direct.errors));
    assert.equal(direct.responsibility.label, "native-resource-responsibility-sentinel");
    assert.deepEqual(direct.responsibility.allowedPaths, ["src"]);
    assert.equal(direct.responsibility.taskId, taskId);
    assert.match(direct.fingerprint, /^[a-f0-9]{64}$/u);
    await assertNoLegacyTaskTree(target, taskId);

    ({ client, server } = await connectMcp(target));
    assert.deepEqual(
      await readMcpResource(client, `forgeloop://task/${taskId}/responsibility`),
      direct,
    );
    await assertNoLegacyTaskTree(target, taskId);
  } finally {
    await client?.close();
    await server?.close();
    clearTestSemanticProvider();
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("structural-quality integration and MCP resources expose the native baseline", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-task-resource-quality-"));
  const taskId = "native-quality-resource";
  const runtimeContext = qualityRuntimeContext();
  let client;
  let server;
  try {
    await prepareQualityTask(target, taskId, runtimeContext);
    const direct = await readIntegrationResource(target, taskId, "structural-quality", { runtimeContext });
    assert.equal(direct.mode, "gate");
    assert.equal(direct.provider, "fake");
    assert.equal(direct.baseline.status, "OBSERVED");
    assert.equal(direct.baseline.qualitySignal, 9000);
    assert.match(direct.baseline.fingerprint, /^[a-f0-9]{64}$/u);
    await assertNoLegacyTaskTree(target, taskId);

    ({ client, server } = await connectMcp(target, runtimeContext));
    assert.deepEqual(
      await readMcpResource(client, `forgeloop://task/${taskId}/structural-quality`),
      direct,
    );
    await assertNoLegacyTaskTree(target, taskId);
  } finally {
    await client?.close();
    await server?.close();
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("attestation integration and MCP resources expose the native statement result", async () => {
  installTestSemanticProvider();
  const target = await createGitRepository("forgeloop-task-resource-attestation-");
  const taskId = "native-attestation-resource";
  let client;
  let server;
  try {
    const sourcePath = path.join(target, "src", "index.js");
    const originalSource = await readFile(sourcePath, "utf8");
    await setupVerifyingTask(target, packageRoot, { taskId, requirement: "tests" });
    await writeConfig(target, createConfig({
      attestation: {
        mode: "required",
        revisionProvider: "git",
        requireCompleteCoverage: true,
        signing: { provider: "none", required: false, policy: {} },
      },
    }), packageRoot);
    await writeFile(sourcePath, `${originalSource}export const nativeResourceSentinel = true;\n`, "utf8");
    await runPrepareCompletion({ target, packageRoot, taskId });
    await runCheck({
      target,
      packageRoot,
      taskId,
      id: "attestation-resource-check",
      requirement: "tests",
      argv: [process.execPath, "-e", "process.exit(0)"],
    });
    await runCheck({
      target,
      packageRoot,
      taskId,
      id: "attestation-resource-completion",
      requirement: "required action satisfies tests",
      argv: [process.execPath, "-e", "process.exit(0)"],
    });
    await runAdvance({ target, packageRoot, taskId, to: "REVIEWING" });
    const completion = await runComplete({ target, packageRoot, taskId });
    assert.equal(completion.status, "VALID");
    const created = await runAttestationCreate({ target, packageRoot, taskId });
    assert.deepEqual(created.statement.predicate.content.coveredPaths, ["src/index.js"]);

    const direct = await readIntegrationResource(target, taskId, "attestation");
    assert.equal(direct.status, "VALID");
    assert.equal(direct.level, "VERIFIED");
    assert.equal(direct.content, "VALID");
    assert.equal(direct.receipt, "VALID");
    assert.equal(direct.files, 1);
    assert.equal(direct.subject, `sha256:${created.statement.predicate.content.contentDigest}`);
    await assertNoLegacyTaskTree(target, taskId);

    ({ client, server } = await connectMcp(target));
    assert.deepEqual(
      await readMcpResource(client, `forgeloop://task/${taskId}/attestation`),
      direct,
    );
    await assertNoLegacyTaskTree(target, taskId);
  } finally {
    await client?.close();
    await server?.close();
    clearTestSemanticProvider();
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
