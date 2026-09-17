import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ALL_KNOWN_ERROR_CODES } from "../src/core/error-codes.js";
import { protocolInfo } from "../src/core/protocol-info.js";
import { PROVIDER_KINDS } from "../src/providers/capabilities.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("protocol-info exposes a complete public compatibility handshake", () => {
  const info = protocolInfo({ packageVersion: "1.2.4-test" });
  assert.equal(info.protocolVersion, 1);
  assert.equal(info.packageVersion, "1.2.4-test");
  assert.deepEqual(info.readsProtocol, [1]);
  assert.deepEqual(info.writesProtocol, [1]);
  assert.deepEqual(info.readsSchemaVersions.event, [1]);
  assert.deepEqual(info.writesSchemaVersions["work-state"], [1]);
  assert.deepEqual(info.readsSchemaVersions["task-recovery"], [1]);
  assert.deepEqual(info.features.taskClaimRecovery, {
    version: 1,
    durableRecoveryState: true,
    explicitResume: true,
    validatedClaimProjection: true,
  });
  assert.deepEqual(info.features.verificationExecutionIsolation, {
    version: 1,
    supported: true,
    adapter: true,
    modes: ["NATIVE_PROJECT", "PROJECT_ISOLATED", "SYSTEM_ISOLATED"],
    protocolProjectRootSeparateFromExecutionCwd: true,
  });
  assert.equal(info.compatibility.schemaVersion, 1);
  assert.deepEqual(info.features.adaptiveExecutionProfiles, {
    version: 1,
    supported: true,
    requests: ["auto", "light", "balanced", "full"],
    resolvedProfiles: ["light", "balanced", "full"],
    deterministic: true,
    lifecycleFastPath: false,
  });
  assert.equal(info.features.compactLifecycleOutput.preservesDefaultOutput, true);
  assert.equal(info.features.usageTelemetry.estimation, false);
  assert.equal(info.features.efficiencyMetrics.comparativeOnly, true);
  assert.equal(info.features.executionProfileContext.resource, "task/context");
  assert.equal(info.features.executionProfileContext.resolvedProfileAuthoritative, true);
  assert.deepEqual(info.features.contextUsageObservability.sources, ["HOST_REPORTED", "UNKNOWN"]);
  assert.equal(info.features.contextUsageObservability.estimation, false);
  assert.deepEqual(info.features.canonicalHandoffs, {
    version: 2,
    supported: true,
    immutable: true,
    lifecycleAuthority: false,
    evidenceAuthority: false,
    exactlyOnceAcceptance: true,
    acceptanceLedgerBacked: true,
    acceptanceCommand: "handoff-accept",
    acceptanceStatuses: ["OPEN", "ACCEPTED", "UNBOUND", "INCONSISTENT"],
  });
  assert.deepEqual(info.features.advisoryContextProviders, {
    version: 1,
    supported: true,
    providerNeutral: true,
    integrationApiOnly: true,
    lazy: true,
    optIn: true,
    persistedByForgeLoop: false,
    lifecycleAuthority: false,
    evidenceAuthority: false,
    executable: false,
  });
  assert.deepEqual(info.features.providerExtensions, {
    version: 1,
    supported: true,
    providerNeutral: true,
    maturity: "experimental",
    publicRegistryApi: false,
    packageSubpathExported: false,
    autoInstall: false,
    lifecycleAuthority: false,
    completionAuthority: false,
    evidenceAuthority: false,
    providerKinds: [...PROVIDER_KINDS],
    resultBoundary: "STRICT_JSON_SNAPSHOT",
    cancellation: "COOPERATIVE_ABORT_SIGNAL",
  });
  assert.ok(info.commands.some((command) => command.name === "protocol-info"));
  assert.ok(info.commands.some((command) => command.name === "task-resume"));
  assert.equal(info.errors.length, ALL_KNOWN_ERROR_CODES.size);
  assert.ok(info.errors.every((error) => error.category && error.safeResolution));
});

test("protocol-info CLI supports human and JSON output", () => {
  const json = spawnSync(process.execPath, [path.join(root, "src/cli.js"), "protocol-info", "--json"], { cwd: root, encoding: "utf8" });
  assert.equal(json.status, 0, json.stderr);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.protocolVersion, 1);
  assert.match(parsed.packageVersion, /^\d+\.\d+\.\d+/);
  const human = spawnSync(process.execPath, [path.join(root, "src/cli.js"), "protocol-info"], { cwd: root, encoding: "utf8" });
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /Protocol version: 1/);
});

test("diagnostics capability advertising matches delivered runtime semantics", () => {
  const info = protocolInfo();
  assert.equal(info.features.diagnostics.informationGainV2, true);
  assert.equal(info.features.diagnostics.strategyOscillationDetection, true);
  assert.equal(info.features.observabilityStability?.informationGainV2, "stable");
  assert.equal(info.features.observabilityStability?.strategyOscillationDetection, "stable");
  assert.equal(info.protocolVersion, 1);
});

test("provider extension kinds remain synchronized with the capability catalog", () => {
  assert.deepEqual(protocolInfo().features.providerExtensions.providerKinds, [...PROVIDER_KINDS]);
});

test("CLI advertises the provider extension boundary without a public registry", () => {
  const json = spawnSync(process.execPath, [path.join(root, "src/cli.js"), "protocol-info", "--json"], { cwd: root, encoding: "utf8" });
  assert.equal(json.status, 0, json.stderr);
  const feature = JSON.parse(json.stdout).features.providerExtensions;
  assert.equal(feature.version, 1);
  assert.equal(feature.supported, true);
  assert.deepEqual(feature.providerKinds, [...PROVIDER_KINDS]);
  assert.equal(feature.publicRegistryApi, false);
  assert.equal(feature.packageSubpathExported, false);
});
