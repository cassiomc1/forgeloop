import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { executeForgeLoopCommand } from "../src/integration.js";

export const ADAPTER_TEST_KIT_VERSION = 1;
export const ADAPTER_SCENARIOS = Object.freeze([
  "cross-harness-resume",
  "policy-drift",
  "evidence-recovery",
  "concurrent-claims",
  "interrupted-transaction",
]);

function pass(scenario, details = {}) {
  return { scenario, status: "PASS", ...details };
}

function unavailable(scenario, reason) {
  return { scenario, status: "UNAVAILABLE", reason };
}

function fail(scenario, error) {
  return { scenario, status: "FAIL", error: { code: error?.code ?? "E_ADAPTER_SCENARIO", message: error?.message ?? String(error) } };
}

async function invoke(executor, projectPath, command, input = {}) {
  return executor({ command, projectPath, input });
}

async function runCrossHarnessResume(executor) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-adapter-resume-"));
  try {
    const created = await invoke(executor, target, "task-create", {
      taskId: "adapter-resume",
      claims: ["src"],
      preset: "feature",
    });
    const resumed = await invoke(executor, target, "next", { taskId: "adapter-resume", explain: true });
    const listed = await invoke(executor, target, "task-list", {});
    if (!created.ok || !resumed.ok || !listed.ok || listed.result.total !== 1) {
      return fail("cross-harness-resume", new Error("second-harness task projection was not deterministic"));
    }
    return pass("cross-harness-resume", { observed: { taskId: "adapter-resume", nextAction: resumed.result.nextAction, total: listed.result.total } });
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

async function runConcurrentClaims(executor) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-adapter-claims-"));
  try {
    const results = await Promise.all([
      invoke(executor, target, "task-create", { taskId: "adapter-claim-a", claims: ["shared"], preset: "bug" }),
      invoke(executor, target, "task-create", { taskId: "adapter-claim-b", claims: ["shared"], preset: "bug" }),
    ]);
    const successes = results.filter((item) => item.ok).length;
    const conflict = results.find((item) => !item.ok)?.error?.code;
    if (successes !== 1 || !["E_TASK_SCOPE_CONFLICT", "E_TASK_LOCKED"].includes(conflict)) {
      return fail("concurrent-claims", new Error(`expected one success and a canonical claim/lock rejection, got ${successes} and ${conflict ?? "none"}`));
    }
    return pass("concurrent-claims", { observed: { successfulCreators: successes, rejectedCode: conflict } });
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

async function runEvidenceRecovery(executor) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-adapter-evidence-"));
  try {
    const next = await invoke(executor, target, "next", { explain: true });
    if (!next.ok || next.result.nextAction !== "DISCOVER" || !next.result.explanation?.bounded) {
      return fail("evidence-recovery", new Error("missing-state recovery did not expose bounded next guidance"));
    }
    return pass("evidence-recovery", { observed: { nextAction: next.result.nextAction, explanation: true } });
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

async function runUnavailable(scenario, reason) {
  return unavailable(scenario, reason);
}

export async function runAdapterTestKit({ executor = executeForgeLoopCommand } = {}) {
  const results = [];
  for (const scenario of ADAPTER_SCENARIOS) {
    try {
      if (scenario === "cross-harness-resume") results.push(await runCrossHarnessResume(executor));
      else if (scenario === "concurrent-claims") results.push(await runConcurrentClaims(executor));
      else if (scenario === "evidence-recovery") results.push(await runEvidenceRecovery(executor));
      else if (scenario === "policy-drift") results.push(await runUnavailable(scenario, "Public command adapters cannot safely fabricate a policy-drift artifact; run the canonical policy fixture separately."));
      else if (scenario === "interrupted-transaction") results.push(await runUnavailable(scenario, "Public command adapters cannot safely fabricate an interrupted transaction journal."));
    } catch (error) {
      results.push(fail(scenario, error));
    }
  }
  return {
    schemaVersion: 1,
    kitVersion: ADAPTER_TEST_KIT_VERSION,
    runtime: { node: process.version, protocol: 1 },
    results,
    summary: {
      passed: results.filter((item) => item.status === "PASS").length,
      failed: results.filter((item) => item.status === "FAIL").length,
      unavailable: results.filter((item) => item.status === "UNAVAILABLE").length,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runAdapterTestKit();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.summary.failed > 0 ? 1 : 0;
}
