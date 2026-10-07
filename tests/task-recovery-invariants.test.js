import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { runTaskRecover } from "../src/commands/task-recover.js";
import { runTaskResume } from "../src/commands/task-resume.js";
import { resolveTaskClaimState } from "../src/core/task-claim-state.js";
import { appendProtocolEvent, readEvents } from "../src/core/events.js";
import { ensureWithin } from "../src/core/filesystem.js";
import { classifyRecoveryHistory } from "../src/core/recovery-history.js";
import { taskArtifactPath } from "../src/core/task-paths.js";
import { taskClaimProjection } from "../src/core/task-recovery.js";
import {
  packageRoot,
  setupAbandonedTask,
  withRecoveryTarget,
} from "./helpers/task-recovery-fixture.js";

import { readRawFixtureText, overwriteFixtureText, deleteFixtureArtifact, overwriteFixtureArtifactBytes } from "./helpers/native-storage-fixture.js";

const corpus = JSON.parse(await readFile(
  new URL("./fixtures/task-recovery/corpus.json", import.meta.url),
  "utf8",
));

async function rewriteRecovery(target, taskId, mutate) {
  const recoveryPath = ensureWithin(target, taskArtifactPath(taskId, "recovery"));
  const recovery = JSON.parse(await readRawFixtureText(target, recoveryPath));
  mutate(recovery);
  await overwriteFixtureText(target, recoveryPath, `${JSON.stringify(recovery, null, 2)}\n`, "utf8");
}

async function appendResume(target, taskId, recovery) {
  await appendProtocolEvent(target, {
    taskId,
    event: "TASK_RECOVERY_RESUMED",
    details: {
      recoveryId: recovery.recoveryId,
      reacquiredClaims: recovery.releasedClaims,
      previousClassification: recovery.classificationAtRecovery,
    },
  }, packageRoot, { taskId });
}

async function applyCorpusAction(target, taskId, entry, recovered) {
  const recoveryPath = ensureWithin(target, taskArtifactPath(taskId, "recovery"));
  const eventsPath = ensureWithin(target, taskArtifactPath(taskId, "events"));
  if (entry.action === "none") return;
  if (entry.action === "resume") {
    await runTaskResume({ target, packageRoot, taskId });
    return;
  }
  if (entry.action === "two-recovery-cycles") {
    const firstRecovery = JSON.parse(await readRawFixtureText(target, recoveryPath));
    const firstRecoveryEvent = (await readEvents(target, packageRoot, { taskId }))
      .find((event) => event.seq === firstRecovery.recoveryEventSeq);
    await runTaskResume({ target, packageRoot, taskId });

    const recoveryId = "recovery-second-valid-cycle";
    const recoveredAt = new Date().toISOString();
    const recoveryEvent = await appendProtocolEvent(target, {
      taskId,
      event: firstRecoveryEvent.event,
      at: recoveredAt,
      details: { ...firstRecoveryEvent.details, recoveryId },
    }, packageRoot, { taskId });
    await overwriteFixtureText(target, recoveryPath, `${JSON.stringify({
      ...firstRecovery,
      recoveredAt,
      recoveryId,
      recoveryEventSeq: recoveryEvent.seq,
    }, null, 2)}\n`, "utf8");
    await runTaskResume({ target, packageRoot, taskId });
    return;
  }
  if (entry.action === "delete-tombstone") {
    await deleteFixtureArtifact(target, recoveryPath);
    return;
  }
  if (entry.action === "artifact-field") {
    await rewriteRecovery(target, taskId, (value) => {
      value[entry.field] = entry.value;
    });
    return;
  }
  if (entry.action === "corrupt-recovery") {
    await overwriteFixtureArtifactBytes(target, recoveryPath, "{\"status\":");
    return;
  }
  if (entry.action === "corrupt-ledger") {
    const lines = (await readRawFixtureText(target, eventsPath)).trimEnd().split("\n");
    const first = JSON.parse(lines[0]);
    first.hash = "f".repeat(64);
    lines[0] = JSON.stringify(first);
    await overwriteFixtureText(target, eventsPath, `${lines.join("\n")}\n`, "utf8");
    return;
  }
  if (entry.action === "remove-recovery-event") {
    const lines = (await readRawFixtureText(target, eventsPath)).trimEnd().split("\n")
      .filter((line) => JSON.parse(line).event !== "OPERATOR_RECOVERY_RECORDED");
    await overwriteFixtureText(target, eventsPath, `${lines.join("\n")}\n`, "utf8");
    return;
  }
  if (entry.action === "resume-with-tombstone") {
    await appendResume(target, taskId, recovered);
    return;
  }
  if (entry.action === "second-recovery") {
    const original = (await readEvents(target, packageRoot, { taskId }))
      .find((event) => event.event === "OPERATOR_RECOVERY_RECORDED");
    await appendProtocolEvent(target, {
      taskId,
      event: "OPERATOR_RECOVERY_RECORDED",
      details: { ...original.details, recoveryId: "recovery-second-unresolved" },
    }, packageRoot, { taskId });
    return;
  }
  if (entry.action === "duplicate-resume") {
    await runTaskResume({ target, packageRoot, taskId });
    await appendResume(target, taskId, recovered);
    return;
  }
  if (entry.action === "orphan-resume") {
    await runTaskResume({ target, packageRoot, taskId });
    await appendProtocolEvent(target, {
      taskId,
      event: "TASK_RECOVERY_RESUMED",
      details: {
        recoveryId: "recovery-never-recorded",
        reacquiredClaims: ["tests"],
        previousClassification: "ABANDONED",
      },
    }, packageRoot, { taskId });
    return;
  }
  if (entry.action === "fake-tombstone") {
    const lines = (await readRawFixtureText(target, eventsPath)).trimEnd().split("\n")
      .filter((line) => JSON.parse(line).event !== "OPERATOR_RECOVERY_RECORDED");
    await overwriteFixtureText(target, eventsPath, `${lines.join("\n")}\n`, "utf8");
    return;
  }
  throw new Error(`Unsupported recovery corpus action: ${entry.action}`);
}

for (const entry of corpus) {
  test(`recovery conformance corpus: ${entry.id}`, async () => {
    await withRecoveryTarget(async (target) => {
      const taskId = `corpus-${entry.id}`;
      await setupAbandonedTask(target, { taskId });
      const recovered = await runTaskRecover({ target, packageRoot, taskId, acknowledgeRecovery: true });
      await applyCorpusAction(target, taskId, entry, recovered);

      const projection = await resolveTaskClaimState(target, { taskId, packageRoot });
      assert.equal(projection.claimState, entry.expectedClaimState);
      if (entry.expectedClaimState === "INCONSISTENT") {
        assert.equal(projection.mutationAllowed, false);
        assert.ok(projection.effectiveWriteClaims.includes("tests"));
        assert.deepEqual(projection.effectiveWriteClaims, projection.historicalWriteClaims);
        assert.equal(projection.ownershipValid, false);
        assert.ok(projection.reasonCodes.includes("E_TASK_CLAIM_OWNERSHIP_INCONSISTENT"));
      }
    });
  });
}

test("recovery history accepts two complete cycles and only one unresolved cycle", () => {
  const events = [
    { seq: 1, event: "OPERATOR_RECOVERY_RECORDED", details: { recoveryId: "recovery-a" } },
    { seq: 2, event: "TASK_RECOVERY_RESUMED", details: { recoveryId: "recovery-a" } },
    { seq: 3, event: "OPERATOR_RECOVERY_RECORDED", details: { recoveryId: "recovery-b" } },
    { seq: 4, event: "TASK_RECOVERY_RESUMED", details: { recoveryId: "recovery-b" } },
  ];
  const result = classifyRecoveryHistory(events);
  assert.equal(result.valid, true);
  assert.equal(result.completedRecoveries.length, 2);
  assert.equal(result.activeRecovery, null);
});

test("claim projection properties hold across terminal and validated recovery states", () => {
  const cases = [
    { phase: "VERIFYING", validatedClaimState: null, claimState: "ACTIVE", claims: ["tests"], mutationAllowed: true },
    { phase: "VERIFYING", validatedClaimState: { valid: true, claimState: "RELEASED_BY_RECOVERY" }, claimState: "RELEASED_BY_RECOVERY", claims: [], mutationAllowed: false },
    // phase COMPLETE alone never releases claims or mints RELEASED_BY_COMPLETION.
    { phase: "COMPLETE", validatedClaimState: null, claimState: "ACTIVE", claims: ["tests"], mutationAllowed: true },
    { phase: "COMPLETE", validatedClaimState: { valid: true, claimState: "RELEASED_BY_COMPLETION" }, claimState: "RELEASED_BY_COMPLETION", claims: [], mutationAllowed: false },
    { phase: "VERIFYING", validatedClaimState: { valid: false, claimState: "RELEASED_BY_RECOVERY" }, claimState: "ACTIVE", claims: ["tests"], mutationAllowed: true },
  ];
  for (const entry of cases) {
    const projection = taskClaimProjection({
      phase: entry.phase,
      validatedClaimState: entry.validatedClaimState,
      historicalWriteClaims: ["tests"],
    });
    assert.equal(projection.claimState, entry.claimState);
    assert.deepEqual(projection.effectiveWriteClaims, entry.claims);
    assert.equal(projection.mutationAllowed, entry.mutationAllowed);
  }
});
