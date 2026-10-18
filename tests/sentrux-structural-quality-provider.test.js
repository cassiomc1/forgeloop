import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createSentruxStructuralQualityProvider, sentruxCompatibilityForVersion } from "../src/core/structural-quality/sentrux-mcp.js";
import { STRUCTURAL_QUALITY_MEASUREMENT_MODEL, STRUCTURAL_QUALITY_SENTRUX_COMPATIBILITY_KEY } from "../src/core/structural-quality/constants.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "fake-sentrux-mcp.mjs");
// Allow instrumented child startup; the timeout test overrides this to 25 ms.
const fixtureTimeoutMs = 3000;

function provider(projectPath, mode = "valid", extra = {}) {
  return createSentruxStructuralQualityProvider({
    projectPath,
    executable: process.execPath,
    args: [fixture],
    timeoutMs: fixtureTimeoutMs,
    maxOutputBytes: 2 * 1024 * 1024,
    env: {
      SENTRUX_FAKE_MODE: mode,
      ...extra,
    },
  });
}

function input(projectPath, overrides = {}) {
  return {
    projectPath,
    taskId: "sentrux-provider-task",
    timeoutMs: fixtureTimeoutMs,
    maxOutputBytes: 2 * 1024 * 1024,
    ...overrides,
  };
}

test("Sentrux MCP handshake, scan, and health produce one normalized snapshot", async () => {
  const projectPath = path.dirname(fixture);
  const result = await provider(projectPath).scan(input(projectPath));
  assert.equal(result.provider.id, "sentrux");
  assert.equal(result.provider.version, "0.5.7");
  assert.equal(result.provider.transport, "mcp-stdio");
  assert.equal(result.provider.measurementModel, STRUCTURAL_QUALITY_MEASUREMENT_MODEL);
  assert.equal(result.provider.compatibilityKey, STRUCTURAL_QUALITY_SENTRUX_COMPATIBILITY_KEY);
  assert.equal(result.detection.available, true);
  assert.equal(result.detection.measurementModel, STRUCTURAL_QUALITY_MEASUREMENT_MODEL);
  assert.equal(result.detection.compatibilityKey, STRUCTURAL_QUALITY_SENTRUX_COMPATIBILITY_KEY);
  assert.equal(result.snapshot.qualitySignal, 9000);
  assert.equal(result.snapshot.bottleneck, "modularity");
  assert.equal(result.snapshot.statistics.crossModuleEdges, 2);
});

test("Sentrux MCP provider supports single-session observe()", async () => {
  const projectPath = path.dirname(fixture);
  const result = await provider(projectPath).observe(input(projectPath));
  assert.equal(result.provider.id, "sentrux");
  assert.equal(result.provider.version, "0.5.7");
  assert.equal(result.detection.available, true);
  assert.equal(result.snapshot.qualitySignal, 9000);
});

test("Sentrux MCP tool contract schema is strictly validated during handshake", async () => {
  const projectPath = path.dirname(fixture);
  for (const mode of [
    "invalid-scan-schema",
    "missing-scan-path-required",
    "invalid-scan-path-type",
  ]) {
    const detected = await provider(projectPath, mode).detect(input(projectPath));
    assert.equal(detected.available, false, mode);
    assert.equal(detected.reasonCode, "E_STRUCTURAL_QUALITY_PROVIDER_TOOL_CONTRACT_INVALID", mode);
    await assert.rejects(
      () => provider(projectPath, mode).scan(input(projectPath)),
      { code: "E_STRUCTURAL_QUALITY_PROVIDER_TOOL_CONTRACT_INVALID" },
      mode,
    );
  }
});

test("Sentrux adapter owns .sentrux/rules.toml scopeBinding", async () => {
  const tmpDir = await mkdir(path.join(os.tmpdir(), "forgeloop-sentrux-scope-test-"), { recursive: true });
  try {
    const sentruxProvider = provider(tmpDir);
    const initialScope = await sentruxProvider.scopeBinding({ projectPath: tmpDir });
    assert.equal(initialScope.architectureRulesFingerprint, null);
    assert.equal(initialScope.providerConfigFingerprint, undefined);
    assert.equal(initialScope.measurementCompatibilityKey, STRUCTURAL_QUALITY_SENTRUX_COMPATIBILITY_KEY);

    await mkdir(path.join(tmpDir, ".sentrux"), { recursive: true });
    await writeFile(path.join(tmpDir, ".sentrux", "rules.toml"), 'version = "1.0"\n');
    const updatedScope = await sentruxProvider.scopeBinding({ projectPath: tmpDir });
    assert.ok(typeof updatedScope.architectureRulesFingerprint === "string" && updatedScope.architectureRulesFingerprint.length === 64);
    assert.equal(updatedScope.providerConfigFingerprint, undefined);
  } finally {
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("the adapter invokes a trusted process without a shell", async () => {
  const projectPath = path.dirname(fixture);
  let spawnOptions;
  const wrappedSpawn = (...args) => {
    spawnOptions = args[2];
    return spawn(...args);
  };
  const trusted = createSentruxStructuralQualityProvider({
    projectPath,
    executable: process.execPath,
    args: [fixture],
    spawnImpl: wrappedSpawn,
    timeoutMs: fixtureTimeoutMs,
  });
  await trusted.detect(input(projectPath));
  assert.equal(spawnOptions.shell, false);
  assert.deepEqual(spawnOptions.stdio, ["pipe", "pipe", "pipe"]);
});

test("protocol, identity, version, and provider failures fail closed", async () => {
  const projectPath = path.dirname(fixture);
  for (const [mode, code] of [
    ["malformed-jsonrpc", "E_STRUCTURAL_QUALITY_PROVIDER_PROTOCOL_INVALID"],
    ["wrong-server-name", "E_STRUCTURAL_QUALITY_PROVIDER_PROTOCOL_INVALID"],
    ["missing-health", "E_STRUCTURAL_QUALITY_PROVIDER_PROTOCOL_INVALID"],
  ]) {
    const detected = await provider(projectPath, mode).detect(input(projectPath));
    assert.equal(detected.available, false, mode);
    assert.equal(detected.reasonCode, code, mode);
    await assert.rejects(() => provider(projectPath, mode).scan(input(projectPath)), { code });
  }
  const providerFailure = provider(projectPath, "provider-error");
  assert.equal((await providerFailure.detect(input(projectPath))).available, true);
  await assert.rejects(() => providerFailure.scan(input(projectPath)), { code: "E_STRUCTURAL_QUALITY_SCAN_FAILED" });
  const old = provider(projectPath, "valid", { SENTRUX_FAKE_VERSION: "0.5.4" });
  assert.equal((await old.detect(input(projectPath))).reasonCode, "E_STRUCTURAL_QUALITY_PROVIDER_VERSION_UNSUPPORTED");
  await assert.rejects(() => old.scan(input(projectPath)), { code: "E_STRUCTURAL_QUALITY_PROVIDER_VERSION_UNSUPPORTED" });
});

test("Sentrux measurement compatibility is explicit and future versions fail closed", async () => {
  for (const version of ["0.5.5", "0.5.6", "0.5.7"]) {
    assert.deepEqual(sentruxCompatibilityForVersion(version), {
      supported: true,
      measurementModel: STRUCTURAL_QUALITY_MEASUREMENT_MODEL,
      compatibilityKey: STRUCTURAL_QUALITY_SENTRUX_COMPATIBILITY_KEY,
    });
  }
  for (const version of ["0.5.4", "0.5.8", "0.6.0", "1.0.0", "0.5.7-beta.1", "malformed"]) {
    assert.equal(sentruxCompatibilityForVersion(version).supported, false, version);
  }
  const projectPath = path.dirname(fixture);
  for (const version of ["0.5.8", "0.6.0", "1.0.0"]) {
    const future = provider(projectPath, "valid", { SENTRUX_FAKE_VERSION: version });
    const detected = await future.detect(input(projectPath));
    assert.equal(detected.available, false, version);
    assert.equal(detected.reasonCode, "E_STRUCTURAL_QUALITY_PROVIDER_VERSION_UNSUPPORTED", version);
  }
});

test("timeouts and combined stdout/stderr limits terminate the external process", async () => {
  const projectPath = path.dirname(fixture);
  await assert.rejects(
    () => provider(projectPath, "hang", { SENTRUX_FAKE_MODE: "hang" }).scan(input(projectPath, { timeoutMs: 25 })),
    { code: "E_STRUCTURAL_QUALITY_TIMEOUT" },
  );
  for (const mode of ["oversized-output", "stderr-flood"]) {
    await assert.rejects(
      () => provider(projectPath, mode).scan(input(projectPath, { maxOutputBytes: 1024 })),
      { code: "E_STRUCTURAL_QUALITY_OUTPUT_LIMIT" },
    );
  }
});

test("secret-like diagnostics and absolute paths outside the target never become evidence", async () => {
  const projectPath = path.dirname(fixture);
  await assert.rejects(
    () => provider(projectPath, "secret-field").scan(input(projectPath)),
    { code: "E_STRUCTURAL_QUALITY_PROVIDER_INVALID" },
  );
  await assert.rejects(
    () => provider(projectPath, "secret-health").scan(input(projectPath)),
    { code: "E_STRUCTURAL_QUALITY_PROVIDER_INVALID" },
  );
  await assert.rejects(
    () => provider(projectPath, "outside-path").scan(input(projectPath)),
    { code: "E_STRUCTURAL_QUALITY_PROVIDER_INVALID" },
  );
});
