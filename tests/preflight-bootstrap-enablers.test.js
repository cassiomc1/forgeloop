import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertContractPresetRefs, assertContractSourceProvenance, createSourceRegistry } from "../src/core/sources.js";
import { parseArgs } from "../src/cli.js";
import { getPackageRoot } from "../src/core/templates.js";
import { runGateRecord } from "../src/commands/gate-record.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { runDiscover } from "../src/commands/discover.js";
import { runContractCreate } from "../src/commands/contract-create.js";
import { runRoute } from "../src/commands/route.js";
import { runPreflight } from "../src/commands/preflight.js";

const packageRoot = getPackageRoot();

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
