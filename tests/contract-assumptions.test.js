import { ensureFixtureTask, overwriteFixtureText } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { taskArtifactPath } from "../src/core/task-paths.js";
import { createContract, readContract, validateContract, writeContract } from "../src/core/contract.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const safeAssumption = {
  value: "Use a fictional law-firm identity",
  reason: "No real branding was supplied",
  scope: "local prototype",
  reversible: true,
  source: "agent-default",
};

const validContractInput = {
  taskId: "law-firm-site",
  objective: "Create a premium law-firm website",
  deliverables: [],
  constraints: [],
  risks: [],
  verification: [],
  successCriteria: [],
  stopConditions: [],
  unresolvedDecisions: [],
  sourceRefs: [],
};

function persistedContract(assumptions = []) {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    ...validContractInput,
    assumptions,
  };
}

async function writeManualContract(target, contract) {
  await ensureFixtureTask(target, contract.taskId, packageRoot);
  await overwriteFixtureText(target, taskArtifactPath(contract.taskId, "contract"), `${JSON.stringify(contract, null, 2)}\n`);
}

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-contract-assumptions-"));
  try {
    await run(target);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

test("createContract normalizes assumptions and preserves the canonical shape", () => {
  const contract = createContract({
    ...validContractInput,
    assumptions: [safeAssumption],
  });

  assert.deepEqual(contract.assumptions, [safeAssumption]);
});

test("valid assumptions survive writeContract then readContract", async () => {
  const contract = createContract({
    ...validContractInput,
    assumptions: [safeAssumption],
  });

  await withTarget(async (target) => {
    await ensureFixtureTask(target, contract.taskId, packageRoot);
    await writeContract(target, contract, packageRoot, { taskId: contract.taskId });
    const loaded = await readContract(target, packageRoot, { taskId: contract.taskId });

    assert.deepEqual(loaded.value.assumptions, [safeAssumption]);
    assert.deepEqual(loaded.value, contract);
  });
});

test("createContract serializes an omitted assumptions field as an empty list", () => {
  const contract = createContract({
    taskId: "task-without-assumptions",
    objective: "Validate compatibility",
  });

  assert.deepEqual(contract.assumptions, []);
});

test("validateContract accepts a legacy protocol-v1 contract without assumptions", async () => {
  const legacyContract = {
    schemaVersion: 1,
    protocolVersion: 1,
    taskId: "legacy-task",
    objective: "Keep an existing contract valid",
    deliverables: [],
    constraints: [],
    risks: [],
    verification: [],
    successCriteria: [],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
  };

  await assert.doesNotReject(() => validateContract(legacyContract, packageRoot));
});

const secretLikeAssumptionValue = "sk-" + "R".repeat(20);
const invalidPersistedAssumptionCases = [
  ["secret-like assumption values", { ...safeAssumption, value: secretLikeAssumptionValue }, /secret-like/i],
  ["whitespace-only assumption values", { ...safeAssumption, value: "   " }, /non-empty/i],
  ["whitespace-only assumption reasons", { ...safeAssumption, reason: "\t" }, /non-empty/i],
  ["whitespace-only assumption scopes", { ...safeAssumption, scope: "\n" }, /non-empty/i],
];

for (const [label, assumption, expectedError] of invalidPersistedAssumptionCases) {
  test(`readContract rejects manually persisted ${label}`, async () => {
    await withTarget(async (target) => {
      await writeManualContract(target, persistedContract([assumption]));

      await assert.rejects(
        () => readContract(target, packageRoot, { taskId: validContractInput.taskId }),
        (error) => {
          assert.match(error.message, expectedError);
          assert.equal(error.message.includes(secretLikeAssumptionValue), false);
          return true;
        },
      );
    });
  });
}

const invalidAssumptionCases = [
  ["rejects assumptions with reversible=false", { ...safeAssumption, reversible: false }],
  ["rejects assumptions with a non-agent-default source", { ...safeAssumption, source: "manual" }],
  ["rejects assumptions with an empty value", { ...safeAssumption, value: "" }],
  ["rejects assumptions with an empty reason", { ...safeAssumption, reason: "" }],
  ["rejects assumptions with an empty scope", { ...safeAssumption, scope: "" }],
  ["rejects assumptions with a whitespace-only value", { ...safeAssumption, value: "   " }],
  ["rejects assumptions with a whitespace-only reason", { ...safeAssumption, reason: "\t" }],
  ["rejects assumptions with a whitespace-only scope", { ...safeAssumption, scope: "\n" }],
  ["rejects assumptions with an unknown property", { ...safeAssumption, extra: "unexpected" }],
  ["rejects assumptions with a non-object entry", "not-an-assumption"],
  ["rejects assumptions with secret-like content", {
    ...safeAssumption,
    value: "sk-" + "A".repeat(20),
  }],
];

for (const [title, assumption] of invalidAssumptionCases) {
  test(`${title} when creating`, () => {
    assert.throws(() => createContract({
      ...validContractInput,
      assumptions: [assumption],
    }));
  });

  test(title, async () => {
    const invalidContract = persistedContract([assumption]);

    await assert.rejects(() => validateContract(invalidContract, packageRoot));
  });

  test(`${title} when writing`, async () => {
    const invalidContract = persistedContract([assumption]);

    await withTarget(async (target) => {
      await assert.rejects(() => writeContract(target, invalidContract, packageRoot));
    });
  });
}
