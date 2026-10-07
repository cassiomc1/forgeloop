import { withExistingProjectScope } from "../src/storage/existing-project-scope.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { removeTempTree } from "./helpers/rm-safe.js";
import { runPreflight } from "../src/commands/preflight.js";
import { prepareCompletion } from "../src/core/completion-artifacts.js";
import { recordCheck } from "../src/core/completion-artifacts.js";

import { createContract, contractFingerprint, writeContract } from "../src/core/contract.js";
import { appendProtocolEvent, readEvents } from "../src/core/events.js";
import { advanceWorkState } from "../src/core/phase.js";
import { getNextAction, NEXT_ACTIONS } from "../src/core/next-action.js";
import { evaluateRoute } from "../src/core/router.js";
import { persistRoute } from "../src/core/route-artifact.js";
import {
  buildInformationGainProjection,
  evaluateStructuredDiagnosticStall,
} from "../src/core/information-gain-projection.js";
import { recordIntervention, recordStructuredDiagnosticCase } from "../src/core/diagnostic-record.js";
import { getPackageRoot } from "../src/core/templates.js";
import { createWorkState, writeWorkState, readWorkState } from "../src/core/work-state.js";
import { buildTaskReflection } from "../src/core/reflection.js";
import { evaluateProgress } from "../src/core/progress.js";
import { inspectTarget } from "../src/core/inspect.js";
import { createTaskDescriptor, writeTaskDescriptor } from "../src/core/task-descriptor.js";
import { writeFile } from "node:fs/promises";

const packageRoot = getPackageRoot();
const TASK_ID = "task-gain-stall";

async function withTarget(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-gain-stall-"));
  try {
    await run(target);
  } finally {
    await removeTempTree(target);
  }
}

// ---------- unit-level dimension fixtures ----------

const ev = (seq, event, details = {}) => ({ seq, taskId: "t", event, details });

function caseEvent(seq, cycle, overrides = {}) {
  return ev(seq, "DIAGNOSTIC_CASE_RECORDED", {
    verificationCycle: cycle,
    failureClass: "VERIFICATION_FAILURE",
    hypotheses: [{ id: "h-1", statement: "Hypothesis one.", evidenceRefs: ["check-tests"] }],
    observations: [{ id: "obs-1", kind: "CHECK_RESULT", evidenceRef: "check-tests", statement: "tests failed with exit 1" }],
    contributors: [{ id: "c-1", type: "CODE", statement: "module X is suspect", basis: ["obs-1"], status: "SUSPECTED" }],
    ...overrides,
  });
}

const failTests = (seq, cycle) => ev(seq, "VERIFICATION_RECORDED", {
  id: "check-tests", requirement: "tests", status: "failed", exitCode: 1, verificationCycle: cycle,
});

test("gain alignment: new observation alone produces effectiveGain", () => {
  const events = [
    failTests(1, 1),
    caseEvent(2, 1),
    failTests(3, 2),
    caseEvent(4, 2, {
      observations: [
        { id: "obs-2", kind: "CHECK_RESULT", evidenceRef: "check-tests", statement: "failure occurs only with expired refresh token" },
      ],
    }),
  ];
  const projection = buildInformationGainProjection(events, "t");
  const latest = projection.at(-1);
  assert.equal(latest.classification, "NONE");
  assert.equal(latest.dimensions.newObservation, true);
  assert.equal(latest.effectiveGain, true);
});

test("gain alignment: new contributor alone produces effectiveGain", () => {
  const events = [
    failTests(1, 1),
    caseEvent(2, 1),
    failTests(3, 2),
    caseEvent(4, 2, {
      contributors: [
        { id: "c-2", type: "CONFIGURATION", statement: "timeout configuration is fixed at 2 seconds", basis: ["obs-1"], status: "SUSPECTED" },
      ],
    }),
  ];
  const projection = buildInformationGainProjection(events, "t");
  const latest = projection.at(-1);
  assert.equal(latest.classification, "NONE");
  assert.equal(latest.dimensions.newContributor, true);
  assert.equal(latest.effectiveGain, true);
});

test("gain alignment: semantic hypothesis elimination produces effectiveGain; ID churn does not", () => {
  // H1 + H2 open in cycle 1; cycle 2 keeps only an unrelated H3 -> H1/H2 eliminated
  const events = [
    failTests(1, 1),
    caseEvent(2, 1, {
      hypotheses: [
        { id: "h-1", statement: "Hypothesis one.", evidenceRefs: ["check-tests"] },
        { id: "h-2", statement: "Hypothesis two.", evidenceRefs: ["check-tests"] },
      ],
    }),
    failTests(3, 2),
    caseEvent(4, 2, {
      hypotheses: [{ id: "h-3", statement: "Unrelated third hypothesis.", evidenceRefs: ["check-tests"] }],
    }),
  ];
  let projection = buildInformationGainProjection(events, "t");
  let latest = projection.at(-1);
  assert.equal(latest.dimensions.hypothesisEliminated, true);
  assert.equal(latest.effectiveGain, true);

  // ID-only churn: same statement under a different id is NOT gain
  const churnEvents = [
    failTests(1, 1),
    caseEvent(2, 1),
    failTests(3, 2),
    caseEvent(4, 2, {
      hypotheses: [{ id: "h-99", statement: "Hypothesis one.", evidenceRefs: ["check-tests"] }],
    }),
  ];
  projection = buildInformationGainProjection(churnEvents, "t");
  latest = projection.at(-1);
  assert.equal(latest.dimensions.newHypothesis, false);
  assert.equal(latest.dimensions.hypothesisEliminated, false);
  assert.equal(latest.effectiveGain, false);
});

test("stall evaluator: first diagnosis never stalls; later no-gain stalls", () => {
  const firstOnly = [caseEvent(1, 1)];
  assert.equal(evaluateStructuredDiagnosticStall(buildInformationGainProjection(firstOnly, "t")).stalled, false);

  const noGainRepeat = [
    failTests(1, 1),
    caseEvent(2, 1),
    failTests(3, 2),
    caseEvent(4, 2),
  ];
  const stall = evaluateStructuredDiagnosticStall(buildInformationGainProjection(noGainRepeat, "t"));
  assert.equal(stall.stalled, true);
  assert.equal(stall.reason, "NO_DIAGNOSTIC_INFORMATION_GAIN");
});

test("progress alignment: 3+ repeated failures with real Information Gain v2 stay advisory", () => {
  const events = [
    failTests(1, 1),
    caseEvent(2, 1),
    failTests(3, 2),
    caseEvent(4, 2),
    failTests(5, 3),
    caseEvent(6, 3, {
      observations: [
        { id: "obs-2", kind: "CHECK_RESULT", evidenceRef: "check-tests", statement: "failure occurs only with expired refresh token" },
      ],
    }),
  ];

  const projection = buildInformationGainProjection(events, "t");
  const latest = projection.at(-1);
  assert.equal(latest.classification, "NONE");
  assert.equal(latest.dimensions.newObservation, true);
  assert.equal(latest.effectiveGain, true);

  const stall = evaluateStructuredDiagnosticStall(projection, {
    verificationCycle: 3,
  });
  assert.equal(stall.stalled, false);

  const progress = evaluateProgress({
    state: { taskId: "t", verificationCycle: 3, checks: [] },
    events,
  });
  assert.equal(progress.status, "WATCH");
  assert.ok(progress.signals.some(
    (signal) => signal.code === "REPEATED_FAILED_REQUIREMENT",
  ));
  assert.ok(!progress.signals.some(
    (signal) => signal.code === "NO_DIAGNOSTIC_INFORMATION_GAIN",
  ));
  assert.ok(!progress.signals.some(
    (signal) => signal.code === "REPEATED_FAILURE_WITH_SAME_DIAGNOSIS",
  ));
});

test("progress alignment: new contributor gain survives repeated failures", () => {
  const events = [
    failTests(1, 1),
    caseEvent(2, 1),
    failTests(3, 2),
    caseEvent(4, 2),
    failTests(5, 3),
    caseEvent(6, 3, {
      contributors: [
        { id: "c-2", type: "CONFIGURATION", statement: "timeout configuration is fixed at 2 seconds", basis: ["obs-1"], status: "SUSPECTED" },
      ],
    }),
  ];

  const projection = buildInformationGainProjection(events, "t");
  const latest = projection.at(-1);
  assert.equal(latest.classification, "NONE");
  assert.equal(latest.dimensions.newContributor, true);
  assert.equal(latest.effectiveGain, true);

  const progress = evaluateProgress({
    state: { taskId: "t", verificationCycle: 3, checks: [] },
    events,
  });
  assert.equal(progress.status, "WATCH");
  assert.ok(!progress.signals.some(
    (signal) => signal.code === "NO_DIAGNOSTIC_INFORMATION_GAIN",
  ));
  assert.ok(!progress.signals.some(
    (signal) => signal.code === "REPEATED_FAILURE_WITH_SAME_DIAGNOSIS",
  ));
});

test("progress alignment: hypothesis elimination gain survives repeated failures", () => {
  // h-1 and h-2 open in cycle 1; cycle 3 keeps only an unrelated h-3,
  // eliminating both prior hypotheses semantically (not ID churn).
  const events = [
    failTests(1, 1),
    caseEvent(2, 1, {
      hypotheses: [
        { id: "h-1", statement: "Hypothesis one.", evidenceRefs: ["check-tests"] },
        { id: "h-2", statement: "Hypothesis two.", evidenceRefs: ["check-tests"] },
      ],
    }),
    failTests(3, 2),
    caseEvent(4, 2, {
      hypotheses: [
        { id: "h-1", statement: "Hypothesis one.", evidenceRefs: ["check-tests"] },
        { id: "h-2", statement: "Hypothesis two.", evidenceRefs: ["check-tests"] },
      ],
    }),
    failTests(5, 3),
    caseEvent(6, 3, {
      hypotheses: [{ id: "h-3", statement: "Unrelated third hypothesis.", evidenceRefs: ["check-tests"] }],
    }),
  ];

  const projection = buildInformationGainProjection(events, "t");
  const latest = projection.at(-1);
  assert.equal(latest.dimensions.hypothesisEliminated, true);
  assert.equal(latest.effectiveGain, true);

  const stall = evaluateStructuredDiagnosticStall(projection, {
    verificationCycle: 3,
  });
  assert.equal(stall.stalled, false);

  const progress = evaluateProgress({
    state: { taskId: "t", verificationCycle: 3, checks: [] },
    events,
  });
  assert.equal(progress.status, "WATCH");
});

test("progress alignment: repeated semantically identical diagnoses stay stalled", () => {
  const events = [
    failTests(1, 1),
    caseEvent(2, 1),
    failTests(3, 2),
    caseEvent(4, 2),
    failTests(5, 3),
    caseEvent(6, 3),
  ];

  const projection = buildInformationGainProjection(events, "t");
  const latest = projection.at(-1);
  assert.equal(latest.classification, "NONE");
  assert.equal(latest.effectiveGain, false);

  const stall = evaluateStructuredDiagnosticStall(projection, {
    verificationCycle: 3,
  });
  assert.equal(stall.stalled, true);

  const progress = evaluateProgress({
    state: { taskId: "t", verificationCycle: 3, checks: [] },
    events,
  });
  assert.equal(progress.status, "STALLED");
  assert.ok(progress.signals.some(
    (signal) => signal.code === "NO_DIAGNOSTIC_INFORMATION_GAIN",
  ));
  assert.ok(progress.signals.some(
    (signal) => signal.code === "REPEATED_FAILURE_WITH_SAME_DIAGNOSIS",
  ));
});

test("progress alignment: legacy informationGain NONE keeps stall semantics", () => {
  const legacyDiag = (seq, cycle, informationGain) => ev(seq, "DIAGNOSIS_RECORDED", {
    verificationCycle: cycle,
    hypothesis: "Hypothesis one.",
    informationGain,
    evidenceRefs: ["check-tests"],
  });

  const events = [
    failTests(1, 1),
    legacyDiag(2, 1, "FIRST_DIAGNOSIS"),
    failTests(3, 2),
    legacyDiag(4, 2, "NONE"),
    failTests(5, 3),
    legacyDiag(6, 3, "NONE"),
  ];

  const progress = evaluateProgress({
    state: { taskId: "t", verificationCycle: 3, checks: [] },
    events,
  });
  assert.equal(progress.status, "STALLED");
  assert.ok(progress.signals.some(
    (signal) => signal.code === "NO_DIAGNOSTIC_INFORMATION_GAIN",
  ));
  assert.ok(progress.signals.some(
    (signal) => signal.code === "REPEATED_FAILURE_WITH_SAME_DIAGNOSIS",
  ));
});

// ---------- public lifecycle fixtures ----------

async function setupToDiagnosing(target, { successCriteria = ["lint"], scoped = true } = {}) {
  const taskOptions = scoped ? { taskId: TASK_ID } : {};
  if (scoped) {
    await writeTaskDescriptor(target, createTaskDescriptor({ taskId: TASK_ID, writeClaims: ["src/app.js"] }), packageRoot);
  }
  const contract = createContract({
    taskId: TASK_ID,
    objective: "Exercise gain/stall alignment",
    deliverables: ["src/app.js"],
    constraints: ["offline"],
    risks: [],
    verification: ["lint"],
    successCriteria,
    stopConditions: ["verification unavailable"],
    unresolvedDecisions: [],
    sourceRefs: [],
  });
  const contractHash = contractFingerprint(contract);
  await writeContract(target, contract, packageRoot, taskOptions);
  const route = evaluateRoute({ workType: "code", surfaces: ["config"], platforms: [] });
  const persistedRoute = await persistRoute(target, route, packageRoot, { contractFingerprint: contractHash, ...taskOptions });
  const state = createWorkState({
    taskId: TASK_ID,
    contractFingerprint: contractHash,
    routeFingerprint: persistedRoute.fingerprint,
    repositoryFingerprint: { branch: null, head: null },
    phase: "PLANNED",
    selectedGuides: [...persistedRoute.value.guides],
    requiredGates: [],
    satisfiedGates: [],
    completedSteps: ["planning"],
    pendingSteps: ["execute"],
    requiredArtifacts: [],
    checks: [],
    failures: [],
    blockers: [],
    verificationEvidence: [],
  });
  await writeWorkState(target, state, { packageRoot, ...taskOptions });
  await appendProtocolEvent(target, { taskId: TASK_ID, event: "CONTRACT_VALIDATED" }, packageRoot, taskOptions);
  await appendProtocolEvent(target, { taskId: TASK_ID, event: "ROUTE_VALIDATED" }, packageRoot, taskOptions);
  const preflight = await runPreflight({ target, packageRoot, ...taskOptions });
  assert.equal(preflight.status, "READY");
  await advanceWorkState(target, "EXECUTING", { packageRoot, ...taskOptions });
  await advanceWorkState(target, "VERIFYING", { packageRoot, ...taskOptions });
  await prepareCompletion({ target, packageRoot, ...taskOptions });
  await recordCheck({ kind: "manual-review",
    target,
    packageRoot,
    id: "check-lint",
    requirement: "lint",
    status: "failed",
    evidenceKind: "OBSERVED",
    command: "npm run lint",
    result: "no-unused-vars in app.js",
    exitCode: 1,
    ...taskOptions,
  });
  await advanceWorkState(target, "DIAGNOSING", { packageRoot, ...taskOptions });
}

function caseFileContent({ cycle, statement = "Unused import triggers lint rule.", observations } = {}) {
  const content = {
    schemaVersion: 1,
    failureClass: "VERIFICATION_FAILURE",
    observations: observations ?? [
      { id: "obs-lint", kind: "CHECK_RESULT", evidenceRef: "check-lint", statement: "Lint reported no-unused-vars." },
    ],
    contributors: [
      { id: "c-import", type: "CODE", statement: "Unused import present in app.js.", basis: ["obs-lint"], status: "SUSPECTED" },
    ],
    hypotheses: [
      {
        id: "h-unused-import",
        statement,
        contributorRefs: ["c-import"],
        evidenceRefs: ["check-lint"],
        settledBy: { type: "CHECK_STATUS", checkId: "check-lint", expectedStatus: "passed" },
      },
    ],
    nextSafeAction: { statement: "Remove the unused import." },
  };
  if (Number.isInteger(cycle)) content.verificationCycle = cycle;
  return content;
}

async function recordCase(target, fileName, content, scoped = true) {
  await writeFile(path.join(target, fileName), JSON.stringify(content));
  return recordStructuredDiagnosticCase({ target, packageRoot, caseFile: fileName, ...(scoped ? { taskId: TASK_ID } : {}) });
}

test("public lifecycle: no-gain stall agrees across phase, progress, reflect and next", async () => {
  await withTarget(async (target) => {
    await setupToDiagnosing(target);
    await recordCase(target, "case-1.json", caseFileContent({}));
    await advanceWorkState(target, "CORRECTING", { packageRoot, taskId: TASK_ID });
    await recordIntervention({
      target,
      packageRoot,
      taskId: TASK_ID,
      interventionInput: { id: "i-1", kind: "CODE_CHANGE", reversible: true, hypothesisRefs: ["h-unused-import"], statement: "Remove unused import." },
    });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: TASK_ID });

    // same failure again in cycle 2
    await prepareCompletion({ target, packageRoot, taskId: TASK_ID });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: TASK_ID,
      id: "check-lint",
      requirement: "lint",
      status: "failed",
      evidenceKind: "OBSERVED",
      command: "npm run lint",
      result: "no-unused-vars in app.js",
      exitCode: 1,
    });
    await advanceWorkState(target, "DIAGNOSING", { packageRoot, taskId: TASK_ID });

    // semantically equivalent diagnosis in cycle 2
    await recordCase(target, "case-2.json", caseFileContent({}));

    // phase must reject the blind retry
    await assert.rejects(
      () => advanceWorkState(target, "CORRECTING", { packageRoot, taskId: TASK_ID }),
      (error) => error.code === "E_DIAGNOSIS_NO_NEW_INFORMATION",
    );

    // same ledger feeds every consumer
    const rawEvents = await readEvents(target, packageRoot, { taskId: TASK_ID });
    const state = await readWorkState(target, { packageRoot, taskId: TASK_ID });
    const progress = evaluateProgress({ state, events: rawEvents });
    assert.equal(progress.status, "STALLED");

    const reflection = await buildTaskReflection({ target, packageRoot, taskId: TASK_ID });
    assert.equal(reflection.status, "STALLED");
    assert.ok(reflection.signals.includes("NO_EFFECTIVE_INFORMATION_GAIN"));

    const next = await getNextAction({ target, packageRoot, taskId: TASK_ID });
    assert.equal(next.nextAction, NEXT_ACTIONS.CHANGE_STRATEGY);
    assert.equal(next.diagnosticGuidance?.action, NEXT_ACTIONS.REQUIRE_NEW_DIAGNOSTIC_INFORMATION);

    // read-only purity across the queried projections
    const forgeDir = path.join(target, ".forgeloop");
    async function hashTree(dir) {
      const entries = await readdir(dir, { recursive: true });
      const hash = createHash("sha256");
      for (const relative of entries.sort()) {
        if (["state.sqlite-wal", "state.sqlite-shm"].includes(relative)) continue;
        hash.update(relative);
        try {
          hash.update(await readFile(path.join(dir, relative)));
        } catch { /* directories */ }
      }
      const records = await withExistingProjectScope(target, store => {
        const tables = store.db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all();
        return tables.map(({ name }) => {
          assert.match(name, /^[a-z_]+$/u);
          const rows = store.db.prepare(`SELECT * FROM "${name}"`).all();
          return { name, rows: rows.map(row => JSON.stringify(row)).sort() };
        });
      }, { readOnly: true });
      hash.update(JSON.stringify(records));
      return hash.digest("hex");
    }
    const before = await hashTree(forgeDir);
    await buildTaskReflection({ target, packageRoot, taskId: TASK_ID });
    await getNextAction({ target, packageRoot, taskId: TASK_ID });
    evaluateProgress({ state, events: rawEvents });
    const after = await hashTree(forgeDir);
    assert.equal(before, after);
  });
});

test("public lifecycle: meaningful new information clears the stall", async () => {
  await withTarget(async (target) => {
    await setupToDiagnosing(target);
    await recordCase(target, "case-1.json", caseFileContent({}));
    await advanceWorkState(target, "CORRECTING", { packageRoot, taskId: TASK_ID });
    await recordIntervention({
      target,
      packageRoot,
      taskId: TASK_ID,
      interventionInput: { id: "i-1", kind: "CODE_CHANGE", reversible: true, hypothesisRefs: ["h-unused-import"], statement: "Remove unused import." },
    });
    await advanceWorkState(target, "VERIFYING", { packageRoot, taskId: TASK_ID });
    await prepareCompletion({ target, packageRoot, taskId: TASK_ID });
    await recordCheck({ kind: "manual-review",
      target,
      packageRoot,
      taskId: TASK_ID,
      id: "check-lint",
      requirement: "lint",
      status: "failed",
      evidenceKind: "OBSERVED",
      command: "npm run lint",
      result: "no-unused-vars in app.js",
      exitCode: 1,
    });
    await advanceWorkState(target, "DIAGNOSING", { packageRoot, taskId: TASK_ID });

    // equivalent diagnosis -> stall
    await recordCase(target, "case-2.json", caseFileContent({}));
    const stateBefore = await readWorkState(target, { packageRoot, taskId: TASK_ID });
    const rawEventsBefore = await readEvents(target, packageRoot, { taskId: TASK_ID });
    assert.equal(evaluateProgress({ state: stateBefore, events: rawEventsBefore }).status, "STALLED");

    // new meaningful observation recorded as revision 2 in the same cycle
    await recordCase(target, "case-3.json", caseFileContent({
      observations: [
        { id: "obs-lint", kind: "CHECK_RESULT", evidenceRef: "check-lint", statement: "Lint reported no-unused-vars." },
        { id: "obs-token", kind: "MANUAL_OBSERVATION", provenance: "MANUAL_OBSERVATION", statement: "failure occurs only with expired refresh token" },
      ],
    }));

    const stateAfter = await readWorkState(target, { packageRoot, taskId: TASK_ID });
    const rawEventsAfter = await readEvents(target, packageRoot, { taskId: TASK_ID });
    assert.notEqual(evaluateProgress({ state: stateAfter, events: rawEventsAfter }).status, "STALLED");

    // DIAGNOSING -> CORRECTING becomes allowed again
    const correcting = await advanceWorkState(target, "CORRECTING", { packageRoot, taskId: TASK_ID });
    assert.equal(correcting.phase, "CORRECTING");
  });
});

async function driveRepeatedFailureCycle(target, cycle, scoped = true) {
  const taskOptions = scoped ? { taskId: TASK_ID } : {};
  await advanceWorkState(target, "CORRECTING", { packageRoot, ...taskOptions });
  await recordIntervention({
    target,
    packageRoot,
    interventionInput: { id: `i-${cycle}`, kind: "CODE_CHANGE", reversible: true, hypothesisRefs: ["h-unused-import"], statement: "Remove unused import." },
    ...taskOptions,
  });
  await advanceWorkState(target, "VERIFYING", { packageRoot, ...taskOptions });
  await prepareCompletion({ target, packageRoot, ...taskOptions });
  await recordCheck({ kind: "manual-review",
    target,
    packageRoot,
    id: "check-lint",
    requirement: "lint",
    status: "failed",
    evidenceKind: "OBSERVED",
    command: "npm run lint",
    result: "no-unused-vars in app.js",
    exitCode: 1,
    ...taskOptions,
  });
  await advanceWorkState(target, "DIAGNOSING", { packageRoot, ...taskOptions });
}

const withNewObservation = (id, statement) => caseFileContent({
  observations: [
    { id: "obs-lint", kind: "CHECK_RESULT", evidenceRef: "check-lint", statement: "Lint reported no-unused-vars." },
    { id, kind: "MANUAL_OBSERVATION", provenance: "MANUAL_OBSERVATION", statement },
  ],
});

test("same snapshot negative fixture: true no-gain stalls every consumer identically", async () => {
  await withTarget(async (target) => {
    await setupToDiagnosing(target, { scoped: true });
    await recordCase(target, "case-1.json", caseFileContent({}), true);
    await driveRepeatedFailureCycle(target, 2, true);
    await recordCase(target, "case-2.json", withNewObservation("obs-token", "failure occurs only with expired refresh token"), true);
    await driveRepeatedFailureCycle(target, 3, true);
    // Latest diagnostic state is semantically identical to the previous one.
    await recordCase(target, "case-3.json", withNewObservation("obs-token", "failure occurs only with expired refresh token"), true);

    const state = await readWorkState(target, { packageRoot, taskId: TASK_ID });
    const events = await readEvents(target, packageRoot, { taskId: TASK_ID });
    assert.ok(state.verificationCycle >= 3);

    const projection = buildInformationGainProjection(events, TASK_ID);
    const stall = evaluateStructuredDiagnosticStall(projection, {
      verificationCycle: state.verificationCycle ?? null,
    });
    assert.equal(stall.stalled, true);

    const progress = evaluateProgress({ state, events });
    assert.equal(progress.status, "STALLED");

    const reflection = await buildTaskReflection({ target, packageRoot, taskId: TASK_ID });
    assert.equal(reflection.status, "STALLED");

    await assert.rejects(
      () => advanceWorkState(target, "CORRECTING", { packageRoot, taskId: TASK_ID }),
      (error) => error.code === "E_DIAGNOSIS_NO_NEW_INFORMATION",
    );

    const next = await getNextAction({ target, packageRoot, taskId: TASK_ID });
    assert.equal(next.nextAction, NEXT_ACTIONS.CHANGE_STRATEGY);
    assert.equal(next.diagnosticGuidance?.action, NEXT_ACTIONS.REQUIRE_NEW_DIAGNOSTIC_INFORMATION);

    const inspection = await inspectTarget({ target, packageRoot, taskId: TASK_ID });
    assert.equal(inspection.taskInspection.progress.status, "STALLED");
    assert.ok(inspection.taskInspection.explanation.reasons.includes("DIAGNOSTIC_PROGRESS_STALLED"));
  });
});

test("same snapshot positive fixture: real gain keeps every consumer advisory", async () => {
  await withTarget(async (target) => {
    await setupToDiagnosing(target, { scoped: true });
    await recordCase(target, "case-1.json", caseFileContent({}), true);
    await driveRepeatedFailureCycle(target, 2, true);
    await recordCase(target, "case-2.json", withNewObservation("obs-token", "failure occurs only with expired refresh token"), true);
    await driveRepeatedFailureCycle(target, 3, true);
    // Latest diagnostic state adds another genuinely new observation.
    await recordCase(target, "case-4.json", withNewObservation("obs-drift", "token endpoint rejects valid signatures after clock drift"), true);

    const state = await readWorkState(target, { packageRoot, taskId: TASK_ID });
    const events = await readEvents(target, packageRoot, { taskId: TASK_ID });
    assert.ok(state.verificationCycle >= 3);

    const projection = buildInformationGainProjection(events, TASK_ID);
    const stall = evaluateStructuredDiagnosticStall(projection, {
      verificationCycle: state.verificationCycle ?? null,
    });
    assert.equal(stall.stalled, false);

    const progress = evaluateProgress({ state, events });
    assert.equal(progress.status, "WATCH");
    assert.ok(progress.signals.some((signal) => signal.code === "REPEATED_FAILED_REQUIREMENT"));

    const reflection = await buildTaskReflection({ target, packageRoot, taskId: TASK_ID });
    assert.notEqual(reflection.status, "STALLED");

    const next = await getNextAction({ target, packageRoot, taskId: TASK_ID });
    assert.notEqual(next.diagnosticGuidance?.action, NEXT_ACTIONS.REQUIRE_NEW_DIAGNOSTIC_INFORMATION);

    const inspection = await inspectTarget({ target, packageRoot, taskId: TASK_ID });
    assert.equal(inspection.taskInspection.progress.status, "WATCH");
    assert.ok(!inspection.taskInspection.explanation.reasons.includes("DIAGNOSTIC_PROGRESS_STALLED"));
  });
});
