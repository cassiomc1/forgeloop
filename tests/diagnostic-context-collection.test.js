import test from "node:test";
import assert from "node:assert/strict";
import { deriveDiagnosticContext } from "../src/core/reflection.js";
import { summarizeOpenHypotheses, projectHypothesisStates } from "../src/core/hypothesis-projection.js";
import { decodedLedgerSource } from "./helpers/ledger-event-collection.js";
import { withSpilledLedgerRelationsSync } from "../src/storage/ledger-relations.js";

test("context collection preserves terminal hypotheses and repeated interventions beyond metadata spill", () => {
  const events = [];
  const append = (event, details, taskId = "context") => events.push({ seq: events.length + 1, taskId, event, details });
  for (let index = 0; index < 1000; index++) {
    append("DIAGNOSTIC_CASE_RECORDED", { hypotheses: [{ id: `h-${index}`, statement: `case ${index}` }] });
    append("INTERVENTION_RECORDED", { interventionSemanticFingerprint: `i-${index}`, intervention: { id: `first-${index}` }, verificationCycle: 1 });
    append("INTERVENTION_RECORDED", { interventionSemanticFingerprint: `i-${index}`, intervention: { id: `second-${index}` }, verificationCycle: 2 });
  }
  append("HYPOTHESIS_DISPOSITION_RECORDED", { hypothesisRef: "h-0", status: "FALSIFIED" });
  append("HYPOTHESIS_DISPOSITION_RECORDED", { hypothesisRef: "h-0", status: "SUPPORTED" });
  for (const cycle of [2, 3, 4]) {
    append("VERIFICATION_STARTED", { verificationCycle: cycle });
    append("VERIFICATION_RECORDED", { verificationCycle: cycle, status: "failed", requirement: "tests", exitCode: 1 });
  }
  append("DIAGNOSTIC_CASE_RECORDED", { hypotheses: [{ id: "foreign" }] }, "foreign");
  const state = { taskId: "context", verificationCycle: 4 };
  const expected = deriveDiagnosticContext(events, state);
  assert.equal(expected.openHypotheses.length, 999);
  assert.equal(expected.openHypotheses.includes("h-0"), false);
  assert.equal(expected.doNotRepeat.length, 1000);
  const source = decodedLedgerSource(events);
  withSpilledLedgerRelationsSync(() => {
    assert.deepEqual(deriveDiagnosticContext(source, state), expected);
    assert.deepEqual(summarizeOpenHypotheses(source, "context"), projectHypothesisStates(events.filter(event => event.taskId === "context")).openHypotheses);
  });
});

test("context ignores invalid intervention cycle groups and preserves unordered input sorting", () => {
  const events = [
    { seq: 3, taskId: "context", event: "HYPOTHESIS_DISPOSITION_RECORDED", details: { hypothesisRef: "h", status: "FALSIFIED" } },
    { seq: 1, taskId: "context", event: "DIAGNOSTIC_CASE_RECORDED", details: { hypotheses: [{ id: "h" }] } },
    { seq: 2, taskId: "context", event: "INTERVENTION_RECORDED", details: { interventionSemanticFingerprint: "invalid", verificationCycle: "invalid" } },
  ];
  assert.deepEqual(deriveDiagnosticContext(decodedLedgerSource(events), { taskId: "context" }), deriveDiagnosticContext(events, { taskId: "context" }));
});


test("context grouped failure membership preserves differing cycle surfaces after spill", () => {
  const events = [];
  const append = (event, details) => events.push({ seq: events.length + 1, taskId: "context", event, details });
  for (let index = 0; index < 160; index++) {
    append("INTERVENTION_RECORDED", { interventionSemanticFingerprint: `repeat-${index}`, verificationCycle: 1 });
    append("INTERVENTION_RECORDED", { interventionSemanticFingerprint: `repeat-${index}`, verificationCycle: 2 });
    append("VERIFICATION_RECORDED", { verificationCycle: 2, status: "failed", requirement: `requirement-${index}` });
    append("VERIFICATION_RECORDED", { verificationCycle: 4, status: "failed", requirement: `requirement-${index}` });
  }
  for (const cycle of [2, 3, 4]) append("VERIFICATION_STARTED", { verificationCycle: cycle });
  const state = { taskId: "context", verificationCycle: 4, checks: [] };
  const compare = () => {
    const expected = deriveDiagnosticContext(events, state);
    withSpilledLedgerRelationsSync(() => assert.deepEqual(deriveDiagnosticContext(decodedLedgerSource(events), state), expected));
    return expected;
  };
  assert.equal(compare().doNotRepeat.length, 160);
  state.checks.push({ requirement: "changed-surface", status: "blocked", details: { verificationCycle: 4 } });
  assert.equal(compare().doNotRepeat.length, 0);
});
