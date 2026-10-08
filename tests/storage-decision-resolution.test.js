import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { stat } from "node:fs/promises";
import { buildCanonicalDiagnosisProject } from "./helpers/canonical-diagnosis-fixture.js";
import { removeTempTree } from "./helpers/rm-safe.js";
import { recordSemanticDecision } from "../src/core/decision/service.js";
import { resolveRequiredSemanticDecision } from "../src/core/decision/resolver.js";
import { readCurrentDecisionBindings } from "../src/core/decision/task-bindings.js";
import { testSemanticProvider } from "../src/core/decision/test-provider.js";
import { taskDecisionDirectory, taskArtifactPath } from "../src/core/task-paths.js";
import { runModelRoute } from "../src/commands/model-route.js";
import { runSemanticPlan } from "../src/commands/semantic-plan.js";
import { openStorageDatabase } from "../src/storage/index.js";
import { withOperationalStore } from "../src/storage/unit-of-work.js";
import { getOperationalStore } from "../src/storage/operational-context.js";
import { runContextPlan } from "../src/commands/context-plan.js";
import { executeForgeLoopCommand } from "../src/integration.js";

async function record(f, decisionKind, questionSetId, decisionId) {
  return recordSemanticDecision({ ...f, decisionId, provider: testSemanticProvider,
    request: { decisionKind, questionSetId, state: { objective: "bounded advisory decision" } } });
}

test("native automatic decision discovery uses logical artifacts and retains stale-binding rejection", async () => {
  const f = await buildCanonicalDiagnosisProject();
  try {
    const created = await record(f, "MODEL_ROUTE", "model-route-v1", "native-model");
    await assert.rejects(stat(path.join(f.target, taskDecisionDirectory(f.taskId))), { code: "ENOENT" });
    const shown = await executeForgeLoopCommand({ command: "decision-show", projectPath: f.target,
      input: { taskId: f.taskId, decisionId: created.artifact.decisionId } });
    assert.equal(shown.ok, true, JSON.stringify(shown.error));
    assert.equal(shown.exitCode, 0);
    assert.deepEqual(shown.result, created.artifact);
    await assert.rejects(stat(path.join(f.target, taskDecisionDirectory(f.taskId))), { code: "ENOENT" });
    const bindings = await readCurrentDecisionBindings(f.target, f.packageRoot, f.taskId);
    assert.equal(created.artifact.taskStateFingerprint, bindings.taskStateFingerprint);
    delete bindings.stateFingerprint;
    const selected = await resolveRequiredSemanticDecision({ ...f, decisionKind: "MODEL_ROUTE", currentBindings: bindings });
    assert.equal(selected.decisionId, created.artifact.decisionId);
    await assert.rejects(resolveRequiredSemanticDecision({ ...f, decisionKind: "MODEL_ROUTE",
      decisionId: selected.decisionId, currentBindings: { ...bindings, taskStateFingerprint: "0".repeat(64) } }), { code: "E_DECISION_STALE" });
    const route = await runModelRoute({ ...f, workType: "code", surfaces: ["api"] });
    assert.equal(route.lifecycleAuthority, false);
    assert.equal(route.evidenceAuthority, "NONE");
  } finally { await removeTempTree(f.target); }
});

for (const operation of ["model-route", "semantic-plan"]) {
  test(`native ${operation} keeps bindings and decision proofs in one snapshot`, async () => {
    const f = await buildCanonicalDiagnosisProject();
    let db;
    let writer;
    try {
      const model = operation === "model-route";
      const created = await record(f, model ? "MODEL_ROUTE" : "DIAGNOSIS_PRIORITY", model ? "model-route-v1" : "diagnosis-v1", "native-command");
      const read = () => model ? runModelRoute({ ...f, decisionId: created.artifact.decisionId, workType: "code" })
        : runSemanticPlan({ ...f, decisionId: created.artifact.decisionId, kind: "diagnosis", input: {} });
      const expected = await read();
      const filename = path.join(f.target, ".forgeloop/state.sqlite");
      db = openStorageDatabase(filename);
      writer = openStorageDatabase(filename);
      await withOperationalStore({ db, target: f.target }, async source => {
        const prototype = Object.getPrototypeOf(source);
        const originalRead = prototype.readText;
        let changed = false;
        prototype.readText = function(relativePath) {
          const result = originalRead.call(this, relativePath);
          if (!changed && this.target === f.target && relativePath === taskArtifactPath(f.taskId, "state")) {
            changed = true;
            writer.prepare("DELETE FROM task_artifacts WHERE task_id = ? AND kind = 'decision'").run(f.taskId);
          }
          return result;
        };
        try {
          assert.deepEqual(await read(), expected);
          assert.equal(changed, true);
          assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
        } finally { prototype.readText = originalRead; }
      });
      await assert.rejects(read(), { code: "E_DECISION_LEDGER_INVALID" });
    } finally { writer?.close(); db?.close(); await removeTempTree(f.target); }
  });
}

test("native semantic plans project canonical choice tokens and keep unknown advisory", async () => {
  const f = await buildCanonicalDiagnosisProject();
  try {
    await record(f, "FAILURE_TRIAGE", "failure-v1", "native-failure");
    const failure = await runSemanticPlan({ ...f, kind: "failure", input: {} });
    assert.equal(failure.ranked[0], "incorrect implementation");
    await record(f, "REVIEW_PLAN", "review-v1", "native-review");
    const review = await runSemanticPlan({ ...f, kind: "review", input: {} });
    assert.ok(review.ranked.includes("needs_security_review"));
    const provider = { ...testSemanticProvider, async evaluate(request) {
      const result = await testSemanticProvider.evaluate(request);
      result.answers.failure_class = "unknown";
      return result;
    } };
    await recordSemanticDecision({ ...f, decisionId: "native-unknown", provider,
      request: { decisionKind: "FAILURE_TRIAGE", questionSetId: "failure-v1", state: {} } });
    const unknown = await runSemanticPlan({ ...f, decisionId: "native-unknown", kind: "failure", input: {} });
    assert.equal(unknown.unknownEscalates, true);
    assert.equal(unknown.evidenceAuthority, "NONE");
  } finally { await removeTempTree(f.target); }
});

for (const operation of ["record API", "context-plan"]) {
  test(`native ${operation} rejects provider results after concurrent canonical task changes`, async () => {
    const f = await buildCanonicalDiagnosisProject();
    let writer;
    try {
      writer = openStorageDatabase(path.join(f.target, ".forgeloop/state.sqlite"));
      const before = writer.prepare("SELECT COUNT(*) AS count FROM task_artifacts WHERE task_id = ? AND kind = 'decision'").get(f.taskId).count;
      let calls = 0;
      const provider = { ...testSemanticProvider, async evaluate(request) {
        calls++;
        const source = getOperationalStore(f.target);
        assert.equal(source.db.isTransaction, false, "Provider work must not hold a live SQLite transaction");
        assert.equal(source.transaction, null);
        const row = writer.prepare("SELECT state_json FROM tasks WHERE task_id = ?").get(f.taskId);
        const state = { ...JSON.parse(row.state_json), lastUpdated: "2030-01-01T00:00:00.000Z" };
        writer.prepare("UPDATE tasks SET state_json = ? WHERE task_id = ?").run(JSON.stringify(state), f.taskId);
        return testSemanticProvider.evaluate(request);
      } };
      const run = selectedProvider => operation === "record API"
        ? recordSemanticDecision({ ...f, decisionId: "provider-race", provider: selectedProvider,
          request: { decisionKind: "MODEL_ROUTE", questionSetId: "model-route-v1", state: {} } })
        : runContextPlan({ ...f, provider: selectedProvider, candidates: [{ id: "source", sourceRef: "src", summary: "Inspect source" }] });
      await assert.rejects(run(provider), { code: "E_STATE_REVISION_CONFLICT" });
      assert.equal(calls, 1, "A failed persistence attempt must not replay the provider");
      assert.equal(writer.prepare("SELECT COUNT(*) AS count FROM task_artifacts WHERE task_id = ? AND kind = 'decision'").get(f.taskId).count, before);
      assert.equal(writer.prepare("SELECT COUNT(*) AS count FROM task_artifacts WHERE task_id = ? AND artifact_id = 'provider-race'").get(f.taskId).count, 0);
      await run(testSemanticProvider);
      assert.equal(writer.prepare("SELECT COUNT(*) AS count FROM task_artifacts WHERE task_id = ? AND kind = 'decision'").get(f.taskId).count, before + 1);
    } finally { writer?.close(); await removeTempTree(f.target); }
  });
}

for (const operation of ["record API", "context-plan"]) {
  test(`native ${operation} cache keeps task bindings and artifact proofs in one snapshot`, async () => {
    const f = await buildCanonicalDiagnosisProject();
    let db;
    let writer;
    try {
      const options = { ...f, request: { decisionKind: "MODEL_ROUTE", questionSetId: "model-route-v1", state: {} } };
      const run = provider => operation === "record API" ? recordSemanticDecision({ ...options, provider })
        : runContextPlan({ ...f, provider, candidates: [{ id: "source", sourceRef: "src", summary: "Inspect source" }] });
      const expected = await run(testSemanticProvider);
      const filename = path.join(f.target, ".forgeloop/state.sqlite");
      db = openStorageDatabase(filename);
      writer = openStorageDatabase(filename);
      let providerCalls = 0;
      const provider = { ...testSemanticProvider, async evaluate() { providerCalls++; throw new Error("Cache must not call provider"); } };
      await withOperationalStore({ db, target: f.target }, async source => {
        const prototype = Object.getPrototypeOf(source);
        const originalRead = prototype.readText;
        let changed = false;
        prototype.readText = function(relativePath) {
          const result = originalRead.call(this, relativePath);
          if (!changed && this.target === f.target && relativePath === taskArtifactPath(f.taskId, "state")) {
            changed = true;
            writer.prepare("DELETE FROM task_artifacts WHERE task_id = ? AND kind = 'decision'").run(f.taskId);
          }
          return result;
        };
        try {
          const result = await run(provider);
          if (operation === "record API") {
            assert.equal(result.cached, true);
            assert.deepEqual(result.artifact, expected.artifact);
          } else assert.deepEqual(result, expected);
          assert.equal(changed, true);
          assert.equal(providerCalls, 0);
          assert.throws(() => source.commit(), { code: "E_STATE_REVISION_CONFLICT" });
        } finally { prototype.readText = originalRead; }
      });
      await assert.rejects(run(provider), { code: "E_DECISION_LEDGER_INVALID" });
      assert.equal(providerCalls, 0);
    } finally { writer?.close(); db?.close(); await removeTempTree(f.target); }
  });
}
