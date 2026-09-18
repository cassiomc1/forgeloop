import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertContractPresetRefs,
  assertContractSourceProvenance,
  createSourceRegistry,
  externalContractSourceRefs,
  isBuiltinContractPresetRef,
} from "../src/core/sources.js";
import { parseArgs } from "../src/cli.js";
import { getPackageRoot } from "../src/core/templates.js";
import { runGateRecord } from "../src/commands/gate-record.js";
import { runNext } from "../src/commands/next.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { runDiscover } from "../src/commands/discover.js";
import { runContractCreate } from "../src/commands/contract-create.js";
import { runRoute } from "../src/commands/route.js";
import { runPreflight } from "../src/commands/preflight.js";
import { CONTRACT_PRESET_IDS } from "../src/core/contract-presets.js";
import { ARTIFACT_PATHS, readJsonArtifact, writeJsonArtifact } from "../src/core/artifacts.js";
import { contractFingerprint, readWorkState, writeWorkState } from "../src/core/work-state.js";
import { taskArtifactPath, taskGatePath } from "../src/core/task-paths.js";
import { COMMAND_EXECUTORS } from "../src/core/command-executors.js";
import { NEXT_ACTIONS } from "../src/core/next-action.js";

const packageRoot = getPackageRoot();
const THREAT_MODEL = "THREAT_MODEL.md";
const ROUTE_OPTIONS = Object.freeze({
  workType: "backend",
  surfaces: ["api"],
  risks: ["untrusted-input"],
  platforms: ["server"],
  behaviorChange: true,
  executableChange: true,
});

async function withTarget(prefix, fn) {
  const target = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await fn(target);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

async function setupRoutedTask(target, taskId, { config = null, sourceRefs = null, sourceRegistry = null, threatModel = "bootstrap threat model\n" } = {}) {
  await writeFile(path.join(target, THREAT_MODEL), threatModel, "utf8");
  await runTaskCreate({ target, packageRoot, taskId, preset: "feature", claims: [THREAT_MODEL] });
  await runDiscover({ target, packageRoot, taskId });
  await runContractCreate({ target, packageRoot, taskId, preset: "feature" });
  if (sourceRefs) {
    const state = await readWorkState(target, { packageRoot, taskId });
    const contract = await readTaskContract(target, taskId);
    const value = { ...contract.value, sourceRefs };
    await writeJsonArtifact(target, taskArtifactPath(taskId, "contract"), value, "current-contract", packageRoot);
    await writeWorkState(target, { ...state, contractFingerprint: contractFingerprint(value) }, { packageRoot, taskId });
  }
  if (sourceRegistry) await writeJsonArtifact(target, ARTIFACT_PATHS.sources, sourceRegistry, "source-registry", packageRoot);
  if (config) await writeJsonArtifact(target, ARTIFACT_PATHS.config, config, "config", packageRoot);
  await runRoute({ target, packageRoot, taskId, ...ROUTE_OPTIONS });
}

function configWithGates(requiredGates) {
  return { schemaVersion: 1, protocolVersion: 1, complianceMode: "standard", requiredGates };
}

async function readGateArtifact(target, taskId, gate) {
  const artifact = await readJsonArtifact(target, taskGatePath(taskId, gate), "gate", packageRoot);
  return artifact.value;
}

async function readTaskContract(target, taskId) {
  return readJsonArtifact(target, taskArtifactPath(taskId, "contract"), "current-contract", packageRoot);
}

test("built-in contract preset provenance is accepted without a source registry", () => {
  assert.doesNotThrow(() => assertContractPresetRefs(["contract-preset:feature"]));
  assert.doesNotThrow(() => assertContractSourceProvenance(undefined, ["contract-preset:release"]));
  assert.throws(() => assertContractPresetRefs(["contract-preset:unknown"]), (error) => error.code === "E_PROFILE_SOURCE_UNKNOWN");
});

test("mixed contract sources preserve external registry requirements", () => {
  const registry = createSourceRegistry({ "DECISION-001": { kind: "agent-decision", summary: "Local implementation choice" } });
  assert.doesNotThrow(() => assertContractSourceProvenance(registry, ["contract-preset:feature", "DECISION-001"]));
  assert.throws(() => assertContractSourceProvenance(undefined, ["contract-preset:feature", "DECISION-001"]), (error) => error.code === "E_PROFILE_SOURCE_MISSING");
});

test("gate-record parser exposes the bounded canonical interface", () => {
  const parsed = parseArgs([
    "gate-record",
    "--task", "bootstrap-task",
    "--gate", "threat-boundary",
    "--status", "satisfied",
    "--artifact", "THREAT_MODEL.md",
    "--decision", "Boundary reviewed",
    "--json",
  ]);
  assert.deepEqual(parsed.options.gateArtifacts, ["THREAT_MODEL.md"]);
  assert.deepEqual(parsed.options.gateDecisions, ["Boundary reviewed"]);
});

test("gate-record accepts a structured local evidence file without elevating authority", () => {
  const parsed = parseArgs([
    "gate-record", "--task", "bootstrap-task", "--gate", "threat-boundary",
    "--status", "satisfied", "--evidence-file", "evidence.json",
  ]);
  assert.equal(parsed.options.gateEvidenceFile, "evidence.json");
});

test("gate-record rejects path traversal before writing", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-gate-record-"));
  try {
    await assert.rejects(
      () => runGateRecord({
        target,
        packageRoot,
        taskId: "missing-task",
        gate: "threat-boundary",
        status: "satisfied",
        artifacts: ["../outside.txt"],
        decisions: ["reviewed"],
      }),
      (error) => error.code === "E_TASK_NOT_FOUND" || error.code === "E_GATE_INVALID",
    );
    await assert.rejects(access(path.join(target, ".forgeloop")));
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("contract preset references stay built-in while external refs remain registry-bound", () => {
  assert.throws(() => assertContractPresetRefs(["contract-preset:forged"]), (error) => error.code === "E_PROFILE_SOURCE_UNKNOWN");
});

test("feature preset bootstrap reaches READY through gate-record and detects stale artifacts", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-bootstrap-e2e-"));
  try {
    await writeFile(path.join(target, "THREAT_MODEL.md"), "bootstrap threat model\n", "utf8");
    await runTaskCreate({ target, packageRoot, taskId: "bootstrap-e2e", preset: "feature", claims: ["THREAT_MODEL.md"] });
    await runDiscover({ target, packageRoot, taskId: "bootstrap-e2e" });
    await runContractCreate({ target, packageRoot, taskId: "bootstrap-e2e", preset: "feature" });
    await runRoute({ target, packageRoot, taskId: "bootstrap-e2e", workType: "backend", surfaces: ["api"], risks: ["untrusted-input"], platforms: ["server"], behaviorChange: true, executableChange: true });
    const blocked = await runPreflight({ target, packageRoot, taskId: "bootstrap-e2e" });
    assert.equal(blocked.status, "BLOCKED");
    assert.ok(blocked.errors.some((error) => error.code === "E_GATE_UNVERIFIED"));
    await runGateRecord({ target, packageRoot, taskId: "bootstrap-e2e", gate: "threat-boundary", status: "satisfied", artifacts: ["THREAT_MODEL.md"], decisions: ["Threat boundary reviewed for this task"] });
    const ready = await runPreflight({ target, packageRoot, taskId: "bootstrap-e2e" });
    assert.equal(ready.status, "READY");
    await writeFile(path.join(target, "THREAT_MODEL.md"), "changed\n", "utf8");
    const stale = await runPreflight({ target, packageRoot, taskId: "bootstrap-e2e" });
    assert.ok(stale.errors.some((error) => error.code === "E_GATE_STALE"));
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("canonical CONTRACT_PRESET_IDS drives built-in preset recognition", () => {
  assert.ok(CONTRACT_PRESET_IDS.length >= 4);
  for (const presetId of CONTRACT_PRESET_IDS) {
    assert.equal(isBuiltinContractPresetRef(`contract-preset:${presetId}`), true, presetId);
  }
  assert.equal(isBuiltinContractPresetRef("contract-preset:unknown"), false);
  assert.equal(isBuiltinContractPresetRef("DECISION-001"), false);
  assert.deepEqual(externalContractSourceRefs(["contract-preset:feature", "DECISION-001"]), ["DECISION-001"]);
});

test("preflight sources contain no duplicate hardcoded preset vocabulary", async () => {
  for (const relativePath of ["../src/core/sources.js", "../src/core/preflight-loaders.js"]) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.ok(!source.includes("documentation|bug|feature|release"), relativePath);
    assert.ok(!source.includes("contract-preset:("), relativePath);
  }
});

test("built-in only contract sources load without a sources.json", async () => {
  await withTarget("forgeloop-builtin-only-", async (target) => {
    const taskId = "builtin-only";
    await setupRoutedTask(target, taskId);
    const result = await runPreflight({ target, packageRoot, taskId });
    assert.ok(!result.errors.some((error) => error.code === "E_PROFILE_SOURCE_MISSING"));
    await assert.rejects(access(path.join(target, ARTIFACT_PATHS.sources)));
  });
});

test("built-in plus valid external source refs are accepted by preflight", async () => {
  await withTarget("forgeloop-mixed-sources-", async (target) => {
    const taskId = "mixed-sources";
    await setupRoutedTask(target, taskId, {
      sourceRefs: ["contract-preset:feature", "DECISION-001"],
      sourceRegistry: createSourceRegistry({ "DECISION-001": { kind: "agent-decision", summary: "Local implementation choice" } }),
    });
    const result = await runPreflight({ target, packageRoot, taskId });
    assert.ok(!result.errors.some((error) => error.code === "E_PROFILE_SOURCE_MISSING" || error.code === "E_PROFILE_SOURCE_UNKNOWN"));
  });
});

test("built-in plus missing external source refs are rejected by preflight", async () => {
  await withTarget("forgeloop-missing-sources-", async (target) => {
    const taskId = "missing-sources";
    await setupRoutedTask(target, taskId, { sourceRefs: ["contract-preset:feature", "DECISION-001"] });
    const result = await runPreflight({ target, packageRoot, taskId });
    assert.ok(result.errors.some((error) => error.code === "E_PROFILE_SOURCE_MISSING"));
  });
});

test("next emits an executable concrete gate-record commandSpec", async () => {
  await withTarget("forgeloop-next-command-spec-", async (target) => {
    const taskId = "next-command-spec";
    await setupRoutedTask(target, taskId);
    const blocked = await runPreflight({ target, packageRoot, taskId });
    assert.equal(blocked.status, "BLOCKED");

    const next = await runNext({ target, packageRoot, taskId });
    assert.equal(next.nextAction, NEXT_ACTIONS.SATISFY_GATES);
    const spec = next.commandSpecs[0];
    assert.equal(spec.commandId, "gate-record");
    assert.ok(spec.argv.includes("--gate=threat-boundary"));
    assert.ok(!spec.argv.includes("--gate=<threat-boundary>"));
    assert.ok(!spec.argv.some((argument) => /^--gate=<.*>$/.test(argument)));

    const gatePath = taskGatePath(taskId, "threat-boundary");
    assert.ok(next.reasons.flatMap((reason) => reason.artifacts ?? []).includes(gatePath));
    assert.ok(next.requiredArtifacts.includes(gatePath));
    assert.ok(next.missingArtifacts.includes(gatePath));

    const propagatedInputs = spec.requiredInputs.map((input) => {
      if (input.name === "artifact") return `--artifact=${THREAT_MODEL}`;
      if (input.name === "decision") return "--decision=Executed from the next action commandSpec";
      return input.option;
    });
    const parsed = parseArgs([...spec.argv, ...propagatedInputs]);
    const execution = await COMMAND_EXECUTORS[spec.commandId]({ target, packageRoot, options: parsed.options });
    assert.equal(execution.result.status, "satisfied");
    await access(path.join(target, gatePath));

    const ready = await runPreflight({ target, packageRoot, taskId });
    assert.equal(ready.status, "READY");
  });
});

test("gate-record rejects a stale route and writes no gate artifact", async () => {
  await withTarget("forgeloop-stale-route-", async (target) => {
    const taskId = "stale-route";
    await setupRoutedTask(target, taskId);
    const contractPath = taskArtifactPath(taskId, "contract");
    const contract = await readTaskContract(target, taskId);
    await writeJsonArtifact(target, contractPath, { ...contract.value, objective: `${contract.value.objective} (rebound)` }, "current-contract", packageRoot);
    await assert.rejects(
      () => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied", decisions: ["Threat boundary reviewed"] }),
      (error) => error.code === "E_ROUTE_STALE",
    );
    await assert.rejects(access(path.join(target, taskGatePath(taskId, "threat-boundary"))));
  });
});

test("requiredBy names only the guides that require the gate", async () => {
  await withTarget("forgeloop-required-by-guide-", async (target) => {
    const taskId = "required-by-guide";
    await setupRoutedTask(target, taskId);
    await runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied", decisions: ["Threat boundary reviewed"] });
    const gate = await readGateArtifact(target, taskId, "threat-boundary");
    assert.deepEqual(gate.requiredBy, ["security"]);
  });
});

test("requiredBy marks config-required gates truthfully", async () => {
  await withTarget("forgeloop-required-by-config-", async (target) => {
    const taskId = "required-by-config";
    await setupRoutedTask(target, taskId, { config: configWithGates(["design"]) });
    await runGateRecord({ target, packageRoot, taskId, gate: "design", status: "satisfied", decisions: ["Design approved"] });
    const gate = await readGateArtifact(target, taskId, "design");
    assert.deepEqual(gate.requiredBy, ["config.requiredGates"]);
  });
});

test("requiredBy combines guide and config provenance without duplication", async () => {
  await withTarget("forgeloop-required-by-mixed-", async (target) => {
    const taskId = "required-by-mixed";
    await setupRoutedTask(target, taskId, { config: configWithGates(["threat-boundary"]) });
    await runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied", decisions: ["Threat boundary reviewed"] });
    const gate = await readGateArtifact(target, taskId, "threat-boundary");
    assert.deepEqual(gate.requiredBy, ["security", "config.requiredGates"]);
  });
});

test("runGateRecord rejects invalid status at the programmatic boundary", async () => {
  await withTarget("forgeloop-invalid-status-", async (target) => {
    await assert.rejects(
      () => runGateRecord({ target, packageRoot, taskId: "missing-task", gate: "threat-boundary", status: "passed" }),
      (error) => error.code === "E_GATE_INVALID",
    );
  });
});

test("runGateRecord rejects explicitly malformed repeatable inputs", async () => {
  await withTarget("forgeloop-malformed-inputs-", async (target) => {
    const taskId = "malformed-inputs";
    await setupRoutedTask(target, taskId);
    await assert.rejects(
      () => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied", artifacts: THREAT_MODEL, decisions: ["reviewed"] }),
      (error) => error.code === "E_GATE_INVALID",
    );
    await assert.rejects(
      () => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied", decisions: {} }),
      (error) => error.code === "E_GATE_INVALID",
    );
    await assert.rejects(
      () => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "blocked", unknowns: "unknown" }),
      (error) => error.code === "E_GATE_INVALID",
    );
    await assert.rejects(
      () => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "blocked", assumptions: { note: "x" } }),
      (error) => error.code === "E_GATE_INVALID",
    );
  });
});

test("runGateRecord bounds repeatable inputs to 32 entries", async () => {
  await withTarget("forgeloop-bounded-inputs-", async (target) => {
    const taskId = "bounded-inputs";
    await setupRoutedTask(target, taskId);
    const entries = Array.from({ length: 33 }, (_, index) => `entry-${index}`);
    await assert.rejects(() => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied", artifacts: entries, decisions: ["reviewed"] }), (error) => error.code === "E_GATE_INVALID");
    await assert.rejects(() => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied", decisions: entries }), (error) => error.code === "E_GATE_INVALID");
    await assert.rejects(() => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "blocked", unknowns: entries }), (error) => error.code === "E_GATE_INVALID");
    await assert.rejects(() => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "blocked", assumptions: entries }), (error) => error.code === "E_GATE_INVALID");
  });
});

test("gate-record rejects oversized artifacts before hashing", async () => {
  await withTarget("forgeloop-oversized-artifact-", async (target) => {
    const taskId = "oversized-artifact";
    await setupRoutedTask(target, taskId);
    await writeFile(path.join(target, "oversized.bin"), Buffer.alloc(4 * 1024 * 1024 + 1));
    await assert.rejects(
      () => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied", artifacts: ["oversized.bin"], decisions: ["reviewed"] }),
      (error) => error.code === "E_GATE_INVALID" && /maximum size/.test(error.message),
    );
    await assert.rejects(access(path.join(target, taskGatePath(taskId, "threat-boundary"))));
  });
});

test("gate-record rejects oversized evidence before JSON parsing", async () => {
  await withTarget("forgeloop-oversized-evidence-", async (target) => {
    const taskId = "oversized-evidence";
    await setupRoutedTask(target, taskId);
    await writeFile(path.join(target, "evidence.json"), `not-json-${"x".repeat(64 * 1024)}`, "utf8");
    await assert.rejects(
      () => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied", evidenceFile: "evidence.json" }),
      (error) => error.code === "E_GATE_INVALID" && /exceeds/.test(error.cause?.message ?? ""),
    );
  });
});

test("gate-record rejects symlinked artifacts and evidence", async () => {
  await withTarget("forgeloop-symlink-", async (target) => {
    const taskId = "symlinked-artifact";
    await setupRoutedTask(target, taskId);
    await symlink(path.join(target, THREAT_MODEL), path.join(target, "THREAT_MODEL_LINK.md"));
    await writeFile(path.join(target, "evidence.json"), JSON.stringify({ note: "local" }), "utf8");
    await symlink(path.join(target, "evidence.json"), path.join(target, "evidence-link.json"));
    await assert.rejects(
      () => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied", artifacts: ["THREAT_MODEL_LINK.md"], decisions: ["reviewed"] }),
      (error) => error.code === "E_GATE_INVALID" && /regular file/.test(error.message),
    );
    await assert.rejects(
      () => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied", evidenceFile: "evidence-link.json" }),
      (error) => error.code === "E_GATE_INVALID",
    );
  });
});

test("gate-record rejects traversal and absolute artifact paths", async () => {
  await withTarget("forgeloop-unsafe-paths-", async (target) => {
    const taskId = "unsafe-paths";
    await setupRoutedTask(target, taskId);
    await assert.rejects(
      () => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied", artifacts: ["../outside.md"], decisions: ["reviewed"] }),
      (error) => error.code === "E_GATE_INVALID",
    );
    await assert.rejects(
      () => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied", artifacts: [path.join(target, THREAT_MODEL)], decisions: ["reviewed"] }),
      (error) => error.code === "E_GATE_INVALID",
    );
    await assert.rejects(
      () => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied", evidenceFile: "../outside.json" }),
      (error) => error.code === "E_GATE_INVALID",
    );
  });
});

test("gate-record hashes the validated file contents", async () => {
  await withTarget("forgeloop-hash-", async (target) => {
    const taskId = "hash-artifact";
    await setupRoutedTask(target, taskId);
    const expected = createHash("sha256").update(Buffer.from("bootstrap threat model\n", "utf8")).digest("hex");
    await runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied", artifacts: [THREAT_MODEL], decisions: ["reviewed"] });
    const gate = await readGateArtifact(target, taskId, "threat-boundary");
    assert.equal(gate.artifacts[0].sha256, expected);
    assert.equal(gate.artifacts[0].path, THREAT_MODEL);
  });
});

test("satisfied gates require no unknowns and explicit caller evidence", async () => {
  await withTarget("forgeloop-satisfied-inputs-", async (target) => {
    const taskId = "satisfied-inputs";
    await setupRoutedTask(target, taskId);
    await assert.rejects(
      () => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied", decisions: ["reviewed"], unknowns: ["open question"] }),
      (error) => error.code === "E_GATE_INVALID",
    );
    await assert.rejects(
      () => runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "satisfied" }),
      (error) => error.code === "E_GATE_INVALID",
    );
  });
});

test("blocked and unverified gates keep preflight BLOCKED", async () => {
  await withTarget("forgeloop-blocked-gates-", async (target) => {
    const taskId = "blocked-gates";
    await setupRoutedTask(target, taskId);
    await runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "blocked", unknowns: ["Awaiting boundary review"] });
    const blocked = await runPreflight({ target, packageRoot, taskId });
    assert.equal(blocked.status, "BLOCKED");
    assert.ok(blocked.errors.some((error) => error.code === "E_GATE_UNVERIFIED"));
    await runGateRecord({ target, packageRoot, taskId, gate: "threat-boundary", status: "unverified", decisions: ["Recorded by the caller"] });
    const unverified = await runPreflight({ target, packageRoot, taskId });
    assert.equal(unverified.status, "BLOCKED");
    assert.ok(unverified.errors.some((error) => error.code === "E_GATE_UNVERIFIED"));
  });
});
