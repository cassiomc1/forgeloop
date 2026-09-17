import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyConflictEvidence,
  TASK_CONFLICT_IDLE_THRESHOLD_MS,
} from "../src/core/task-conflict-inspection.js";

const NOW = Date.parse("2026-08-22T00:00:00.000Z");
const RECENT = "2026-08-21T00:00:00.000Z";
const OLD = "2026-07-01T00:00:00.000Z";

function evidence(overrides = {}) {
  const value = {
    healthy: true,
    phase: "EXECUTING",
    lastUpdated: RECENT,
    lastMeaningfulActivityAt: RECENT,
    workStateRevision: 3,
    lockStatus: "NONE",
    lockExpiresAt: null,
    freshnessStatus: "FRESH",
    freshnessReasons: [],
    ledgerValid: true,
    recordedChecks: 2,
    totalChecks: 2,
    repositoryBranch: "main",
    repositoryHead: "a".repeat(64),
    ...overrides,
  };
  if (Object.hasOwn(overrides, "lastUpdated") && !Object.hasOwn(overrides, "lastMeaningfulActivityAt")) {
    value.lastMeaningfulActivityAt = overrides.lastUpdated;
  }
  return value;
}

test("live lease implies ACTIVE regardless of other signals", () => {
  const verdict = classifyConflictEvidence(evidence({
    lockStatus: "LIVE",
    freshnessStatus: "REVALIDATION_REQUIRED",
    freshnessReasons: ["REPOSITORY_CHANGED"],
    lastUpdated: OLD,
  }), { now: NOW });
  assert.equal(verdict.classification, "ACTIVE");
  assert.deepEqual(verdict.reasonCodes, ["E_TASK_LOCKED"]);
});

test("fresh checkpoint implies ACTIVE", () => {
  const verdict = classifyConflictEvidence(evidence(), { now: NOW });
  assert.equal(verdict.classification, "ACTIVE");
  assert.deepEqual(verdict.reasonCodes, ["STATE_FRESH"]);
});

test("valid post-task-create ledger is an ACTIVE initial task", () => {
  const verdict = classifyConflictEvidence(evidence({
    phase: null,
    earlyPhase: "RECEIVED",
    freshnessStatus: "FRESH",
    recordedChecks: 0,
    totalChecks: 0,
  }), { now: NOW });
  assert.equal(verdict.classification, "ACTIVE");
  assert.deepEqual(verdict.reasonCodes, ["STATE_FRESH"]);
});

test("discovered early ledger is projected as DISCOVERING", () => {
  const verdict = classifyConflictEvidence(evidence({
    phase: null,
    earlyPhase: "DISCOVERING",
    freshnessStatus: "FRESH",
    recordedChecks: 0,
    totalChecks: 0,
  }), { now: NOW });
  assert.equal(verdict.classification, "ACTIVE");
  assert.deepEqual(verdict.reasonCodes, ["STATE_FRESH"]);
});

test("early lifecycle projection does not accept contradictory history", () => {
  const verdict = classifyConflictEvidence(evidence({
    phase: null,
    earlyPhase: null,
    freshnessStatus: "FRESH",
  }), { now: NOW });
  assert.equal(verdict.classification, "INCONSISTENT");
  assert.deepEqual(verdict.reasonCodes, ["E_PHASE_UNKNOWN"]);
});

test("post-execution REPOSITORY_CHANGED-only drift is RECOVERABLE even in REVIEWING", () => {
  const verdict = classifyConflictEvidence(evidence({
    phase: "REVIEWING",
    freshnessStatus: "REVALIDATION_REQUIRED",
    freshnessReasons: ["REPOSITORY_CHANGED"],
  }), { now: NOW });
  assert.equal(verdict.classification, "RECOVERABLE");
  assert.equal(verdict.recoverable, true);
  assert.ok(verdict.recoveredBy.every((command) => command.startsWith("forgeloop") || command.includes("canonical")));
});

test("post-execution idle with zero recorded evidence is ABANDONED", () => {
  const verdict = classifyConflictEvidence(evidence({
    phase: "VERIFYING",
    lastUpdated: OLD,
    freshnessStatus: "REVALIDATION_REQUIRED",
    freshnessReasons: ["REPOSITORY_CHANGED", "CONTRACT_NOT_VERIFIED"],
    recordedChecks: 0,
    totalChecks: 0,
  }), { now: NOW });
  assert.equal(verdict.classification, "ABANDONED");
  assert.equal(verdict.recoverable, false);
  assert.ok(verdict.recoveredBy.includes("forgeloop task-recover --task <id> --acknowledge-recovery"));
});

test("idle pre-execution task is STALE", () => {
  const verdict = classifyConflictEvidence(evidence({
    phase: "PLANNED",
    lastUpdated: OLD,
    freshnessStatus: "REVALIDATION_REQUIRED",
    freshnessReasons: ["REPOSITORY_CHANGED"],
    recordedChecks: 0,
    totalChecks: 0,
  }), { now: NOW });
  assert.equal(verdict.classification, "STALE");
});

test("REVIEWING plus an old timestamp alone is never STALE", () => {
  const verdict = classifyConflictEvidence(evidence({
    phase: "REVIEWING",
    lastUpdated: OLD,
    freshnessStatus: "REVALIDATION_REQUIRED",
    freshnessReasons: ["REPOSITORY_CHANGED"],
  }), { now: NOW });
  assert.equal(verdict.classification, "RECOVERABLE");
});

test("post-execution drift beyond repository changes with recent progress is ACTIVE", () => {
  const verdict = classifyConflictEvidence(evidence({
    freshnessStatus: "REVALIDATION_REQUIRED",
    freshnessReasons: ["REPOSITORY_CHANGED", "CONTRACT_MODIFIED"],
  }), { now: NOW });
  assert.equal(verdict.classification, "ACTIVE");
  assert.ok(verdict.reasonCodes.includes("CONTRACT_MODIFIED"));
});

test("invalid ledger is INCONSISTENT", () => {
  const verdict = classifyConflictEvidence(evidence({ ledgerValid: false }), { now: NOW });
  assert.equal(verdict.classification, "INCONSISTENT");
  assert.deepEqual(verdict.reasonCodes, ["E_LEDGER_INVALID"]);
});

test("unknown or corrupt lock evidence is INCONSISTENT even when state is fresh", () => {
  for (const lockStatus of ["UNKNOWN", "CORRUPT"]) {
    const verdict = classifyConflictEvidence(evidence({ lockStatus }), { now: NOW });
    assert.equal(verdict.classification, "INCONSISTENT");
    assert.ok(verdict.reasonCodes.includes("E_TASK_LOCK_STATE_UNKNOWN"));
  }
});

test("unknown freshness evidence is INCONSISTENT", () => {
  const verdict = classifyConflictEvidence(evidence({
    freshnessStatus: "UNKNOWN",
    freshnessReasons: ["E_STATE_UNREADABLE"],
  }), { now: NOW });
  assert.equal(verdict.classification, "INCONSISTENT");
  assert.deepEqual(verdict.reasonCodes, ["E_STATE_UNREADABLE"]);
});

test("failed checks count as recorded evidence and never produce NO_RECORDED_EVIDENCE", () => {
  const verdict = classifyConflictEvidence(evidence({
    phase: "VERIFYING",
    lastUpdated: OLD,
    freshnessStatus: "REVALIDATION_REQUIRED",
    freshnessReasons: ["CONTRACT_NOT_VERIFIED"],
    recordedChecks: 0,
    totalChecks: 1,
  }), { now: NOW });
  assert.equal(verdict.classification, "ACTIVE");
  assert.equal(verdict.reasonCodes.includes("NO_RECORDED_EVIDENCE"), false);
});

test("recent meaningful ledger activity prevents abandonment of an old checkpoint", () => {
  const verdict = classifyConflictEvidence(evidence({
    phase: "VERIFYING",
    lastUpdated: OLD,
    lastMeaningfulActivityAt: RECENT,
    freshnessStatus: "REVALIDATION_REQUIRED",
    freshnessReasons: ["CONTRACT_NOT_VERIFIED"],
    recordedChecks: 0,
    totalChecks: 0,
  }), { now: NOW });
  assert.equal(verdict.classification, "ACTIVE");
  assert.equal(verdict.reasonCodes.includes("NO_RECORDED_EVIDENCE"), false);
});

test("a valid recovery tombstone is the canonical RECOVERED state", () => {
  const verdict = classifyConflictEvidence(evidence({ recoveryStatus: "RECOVERED" }), { now: NOW });
  assert.equal(verdict.classification, "RECOVERED");
  assert.equal(verdict.recoverable, false);
});

test("unknown or corrupt lock evidence overrides a recovery tombstone", () => {
  for (const lockStatus of ["UNKNOWN", "CORRUPT"]) {
    const verdict = classifyConflictEvidence(evidence({
      lockStatus,
      recoveryStatus: "RECOVERED",
    }), { now: NOW });
    assert.equal(verdict.classification, "INCONSISTENT");
    assert.deepEqual(verdict.reasonCodes, ["E_TASK_LOCK_STATE_UNKNOWN"]);
  }
});

test("unhealthy descriptor is INCONSISTENT", () => {
  const verdict = classifyConflictEvidence({ healthy: false }, { now: NOW });
  assert.equal(verdict.classification, "INCONSISTENT");
});

test("unknown phase is INCONSISTENT", () => {
  const verdict = classifyConflictEvidence(evidence({ phase: "SOMEWHERE" }), { now: NOW });
  assert.equal(verdict.classification, "INCONSISTENT");
});

test("COMPLETE is terminal and not recoverable", () => {
  const verdict = classifyConflictEvidence(evidence({ phase: "COMPLETE" }), { now: NOW });
  assert.equal(verdict.classification, "COMPLETE");
  assert.equal(verdict.terminal, true);
});

test("recent post-execution progress without drift is ACTIVE", () => {
  const verdict = classifyConflictEvidence(evidence({
    freshnessStatus: "STALE_CHECKPOINT",
    freshnessReasons: ["CHECKPOINT_AGE"],
  }), { now: NOW });
  assert.equal(verdict.classification, "ACTIVE");
});

test("idle threshold boundary is respected", () => {
  const justInside = new Date(NOW - TASK_CONFLICT_IDLE_THRESHOLD_MS + 1000).toISOString();
  const justOutside = new Date(NOW - TASK_CONFLICT_IDLE_THRESHOLD_MS - 1000).toISOString();
  const base = {
    phase: "PLANNED",
    freshnessStatus: "REVALIDATION_REQUIRED",
    freshnessReasons: ["REPOSITORY_CHANGED"],
    recordedChecks: 0,
    totalChecks: 0,
  };
  assert.equal(classifyConflictEvidence(evidence({ ...base, lastUpdated: justInside }), { now: NOW }).classification, "ACTIVE");
  assert.equal(classifyConflictEvidence(evidence({ ...base, lastUpdated: justOutside }), { now: NOW }).classification, "STALE");
});
