import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  FORGELOOP_INTEGRATION_API_VERSION,
  defaultCommandInputValues,
  executeForgeLoopCommand,
  createForgeLoopContext,
  getForgeLoopCapabilities,
  validateForgeLoopCommandInput,
} from "../src/integration.js";
import { CLI_COMMAND_DEFINITIONS } from "../src/core/cli-command-definitions.js";
import { protocolInfo } from "../src/core/protocol-info.js";

test("integration API version is 1 and exported from the stable subpath", () => {
  assert.equal(FORGELOOP_INTEGRATION_API_VERSION, 1);
});

test("capabilities report versions, features, commands, and resources", () => {
  const capabilities = getForgeLoopCapabilities({ packageVersion: "1.5.0" });
  assert.equal(capabilities.packageVersion, "1.5.0");
  assert.equal(capabilities.integrationApiVersion, 1);
  assert.equal(capabilities.features.taskClaimRecovery.validatedClaimProjection, true);
  assert.deepEqual(capabilities.features.verificationExecutionIsolation, {
    version: 1,
    supported: true,
    adapter: true,
    modes: ["NATIVE_PROJECT", "PROJECT_ISOLATED", "SYSTEM_ISOLATED"],
    protocolProjectRootSeparateFromExecutionCwd: true,
  });
  assert.deepEqual(capabilities.features.repositoryIndex, {
    version: 1,
    required: true,
    providerNeutral: true,
    implementation: "microsoft/tgrep",
    engineVersion: "1.0.3",
    engineManagedByForgeLoop: true,
    commands: ["search", "index-setup", "index-start", "index-stop", "index-status", "index-rebuild"],
    resource: "repository/index-status",
    managedBinary: true,
    noPathFallback: true,
    supports: {
      regex: true,
      fixedStrings: true,
      glob: true,
      fileType: true,
      context: true,
      structuredOutput: true,
      liveIndex: true,
    },
  });
  assert.equal(capabilities.executorParity, true);

  const names = capabilities.commands.map((command) => command.name);
  assert.deepEqual(names, [...names].sort());
  assert.equal(names.length, Object.keys(CLI_COMMAND_DEFINITIONS).length);

  const resourceNames = capabilities.resources.map((resource) => resource.name);
  assert.ok(resourceNames.includes("task/ownership"));
  assert.ok(resourceNames.includes("task/context"));
  assert.ok(resourceNames.includes("repository/index-status"));
});

test("protocol-info and Integration API expose matching advisory and handoff contracts", () => {
  const protocol = protocolInfo();
  const capabilities = getForgeLoopCapabilities();

  assert.deepEqual(
    protocol.features.canonicalHandoffs,
    capabilities.features.canonicalHandoffs,
  );
  assert.equal(protocol.features.canonicalHandoffs.version, 2);
  assert.equal(capabilities.features.canonicalHandoffs.version, 2);
  assert.equal(protocol.features.canonicalHandoffs.exactlyOnceAcceptance, true);
  assert.equal(capabilities.features.canonicalHandoffs.exactlyOnceAcceptance, true);
  assert.equal(protocol.features.canonicalHandoffs.lifecycleAuthority, false);
  assert.equal(capabilities.features.canonicalHandoffs.lifecycleAuthority, false);
  assert.equal(protocol.features.canonicalHandoffs.evidenceAuthority, false);
  assert.equal(capabilities.features.canonicalHandoffs.evidenceAuthority, false);

  assert.deepEqual(
    protocol.features.advisoryContextProviders,
    capabilities.features.advisoryContextProviders,
  );
  assert.equal(protocol.features.advisoryContextProviders.integrationApiOnly, true);
  assert.equal(capabilities.features.advisoryContextProviders.integrationApiOnly, true);
  assert.equal(protocol.features.advisoryContextProviders.lifecycleAuthority, false);
  assert.equal(capabilities.features.advisoryContextProviders.lifecycleAuthority, false);
  assert.equal(protocol.features.advisoryContextProviders.evidenceAuthority, false);
  assert.equal(capabilities.features.advisoryContextProviders.evidenceAuthority, false);
  assert.equal(protocol.features.advisoryContextProviders.executable, false);
  assert.equal(capabilities.features.advisoryContextProviders.executable, false);
});

test("verification adapter and isolation policy are runtime-only context", () => {
  const adapter = { execute: async () => ({}) };
  const context = createForgeLoopContext({
    verificationExecutionAdapter: adapter,
    verificationExecutionPolicy: { requiredIsolation: "PROJECT_ISOLATED" },
  });
  assert.equal(context.authorityContext.trustMode, "NONE");
  assert.equal(context.verificationExecutionAdapter, adapter);
  assert.deepEqual(context.verificationExecutionPolicy, { requiredIsolation: "PROJECT_ISOLATED" });
  assert.throws(
    () => createForgeLoopContext({ verificationExecutionAdapter: { execute: "not-a-function" } }),
    (error) => error.code === "E_VERIFICATION_ISOLATION_UNAVAILABLE",
  );
});

test("usage providers are optional trusted runtime context and actor reports stay separate", async () => {
  const provider = { getTaskUsage: async () => null };
  const context = createForgeLoopContext({ usageProvider: provider });
  assert.equal(context.usageProvider, provider);
  assert.throws(
    () => createForgeLoopContext({ usageProvider: { getTaskUsage: "not-a-function" } }),
    (error) => error.code === "E_USAGE_INVALID",
  );
  const { providerUsage } = await import("../src/core/usage.js");
  assert.throws(
    () => providerUsage({ source: "ACTOR_REPORTED", totalTokens: 10 }),
    (error) => error.code === "E_USAGE_SOURCE_INVALID",
  );
});

test("advertised adaptive and efficiency capabilities match their boundaries", () => {
  const capabilities = getForgeLoopCapabilities();
  assert.deepEqual(capabilities.features.adaptiveExecutionProfiles, {
    version: 1,
    supported: true,
    deterministic: true,
    lifecycleFastPath: false,
  });
  assert.deepEqual(capabilities.features.compactLifecycleOutput, {
    version: 1,
    supported: true,
    commands: ["next", "task-show"],
    preservesDefaultOutput: true,
  });
  assert.equal(capabilities.features.usageTelemetry.estimation, false);
  assert.equal(capabilities.features.efficiencyMetrics.comparativeOnly, true);
  assert.deepEqual(capabilities.features.executionProfileContext, {
    version: 1,
    supported: true,
    resource: "task/context",
    resolvedProfileAuthoritative: true,
    compatibilityFallback: "balanced",
    lifecycleFastPath: false,
  });
  assert.equal(capabilities.features.contextUsageObservability.estimation, false);
});

test("every canonical command has a base risk class", () => {
  for (const name of Object.keys(CLI_COMMAND_DEFINITIONS)) {
    assert.match(getForgeLoopCapabilities().commands.find((c) => c.name === name).baseRiskClass, /^[A-Z_]+$/, name);
  }
});

test("invocation classification covers input-dependent commands", async () => {
  const { classifyForgeLoopInvocation } = await import("../src/core/integration-invocation-policy.js");
  const { INTEGRATION_RISK_CLASSES } = await import("../src/core/integration-invocation-policy.js");

  // doctor without --fix is maintenance-classified but non-destructive input;
  // with the current command set it stays MAINTENANCE.
  assert.equal(classifyForgeLoopInvocation("doctor").riskClass, INTEGRATION_RISK_CLASSES.MAINTENANCE);

  // policy-discover stays maintenance; write refines nothing yet but remains gated.
  assert.equal(classifyForgeLoopInvocation("policy-discover").riskClass, INTEGRATION_RISK_CLASSES.MAINTENANCE);
  assert.equal(classifyForgeLoopInvocation("policy-discover").requiredCapability, "allowMaintenance");

  // task-unlock escalates to FORCE_DESTRUCTIVE only with force:true.
  assert.equal(classifyForgeLoopInvocation("task-unlock").requiredCapability, "allowMaintenance");
  const forced = classifyForgeLoopInvocation("task-unlock", { force: true });
  assert.equal(forced.riskClass, INTEGRATION_RISK_CLASSES.FORCE_DESTRUCTIVE);
  assert.equal(forced.requiredCapability, "allowForceRecovery");

  // Claim authority boundaries are distinct classes.
  assert.equal(classifyForgeLoopInvocation("task-resume").riskClass, INTEGRATION_RISK_CLASSES.CLAIM_REACQUISITION);
  assert.equal(classifyForgeLoopInvocation("task-resume").requiredCapability, null);
  assert.equal(classifyForgeLoopInvocation("task-recover").riskClass, INTEGRATION_RISK_CLASSES.CLAIM_RELEASE_RECOVERY);
  assert.equal(classifyForgeLoopInvocation("task-recover").requiredCapability, "allowRecovery");
  assert.equal(classifyForgeLoopInvocation("task-repair-legacy-recovery").riskClass, INTEGRATION_RISK_CLASSES.LEGACY_MIGRATION);

  // External execution classes.
  assert.equal(classifyForgeLoopInvocation("run-check").riskClass, INTEGRATION_RISK_CLASSES.EXTERNAL_EXECUTION);
  assert.equal(classifyForgeLoopInvocation("run-check").executesExternalProcess, true);

  // Read-only class never mutates.
  const statusClass = classifyForgeLoopInvocation("status");
  assert.equal(statusClass.riskClass, INTEGRATION_RISK_CLASSES.READ_ONLY);
  assert.equal(statusClass.readOnly, true);
  assert.equal(statusClass.mutatesProtocol, false);

  assert.throws(() => classifyForgeLoopInvocation("not-a-command"));
});

test("shared semantic validation runs identically for any transport", async () => {
  assert.throws(
    () => validateForgeLoopCommandInput({ command: "record-check", input: defaultCommandInputValues() }),
    /record-check requires --id/,
  );
  const envelope = await executeForgeLoopCommand({ command: "record-check", projectPath: ".", input: {} });
  assert.equal(envelope.ok, false);
  assert.match(envelope.error.message, /record-check requires --id/);
});

test("bundle is classified MAINTENANCE because it writes bundle artifacts", async () => {
  const { classifyForgeLoopInvocation } = await import("../src/core/integration-invocation-policy.js");
  const { INTEGRATION_RISK_CLASSES } = await import("../src/core/integration-invocation-policy.js");
  const classification = classifyForgeLoopInvocation("bundle");
  assert.equal(classification.riskClass, INTEGRATION_RISK_CLASSES.MAINTENANCE);
  assert.equal(classification.readOnly, false);
  assert.equal(classification.mutatesProtocol, true);
  assert.equal(classification.requiredCapability, "allowMaintenance");
});

test("integration helper defaults and risk fallbacks behave deterministically", async () => {
  const { defaultIntegrationProjectPath } = await import("../src/core/project-root.js");
  const { classifyForgeLoopInvocation } = await import("../src/core/integration-invocation-policy.js");

  assert.ok(path.isAbsolute(defaultIntegrationProjectPath()));

  // Unknown-to-static-table commands fall back to MAINTENANCE conservatively.
  const { CLI_COMMAND_DEFINITIONS } = await import("../src/core/cli-command-definitions.js");
  for (const name of Object.keys(CLI_COMMAND_DEFINITIONS)) {
    const classification = classifyForgeLoopInvocation(name);
    assert.match(classification.riskClass, /^[A-Z_]+$/, name);
  }

  // FORCE_DESTRUCTIVE refinement requires exactly force:true.
  assert.notEqual(
    classifyForgeLoopInvocation("task-unlock", { force: false }).riskClass,
    "FORCE_DESTRUCTIVE",
  );
});

test("baseRiskClass fails closed and covers artifact/process metadata directions", async () => {
  const { baseRiskClass } = await import("../src/core/integration-invocation-policy.js");
  assert.throws(() => baseRiskClass("__missing__"), /no integration risk classification/);

  const { classifyForgeLoopInvocation } = await import("../src/core/integration-invocation-policy.js");
  // removes-driven classification directions.
  assert.equal(classifyForgeLoopInvocation("clear-state").removesArtifacts, true);
  assert.equal(classifyForgeLoopInvocation("clear-continuity").removesArtifacts, true);
  assert.equal(classifyForgeLoopInvocation("status").removesArtifacts, false);
});
