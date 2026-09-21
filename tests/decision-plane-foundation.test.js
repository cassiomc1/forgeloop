import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getPackageRoot } from "../src/core/templates.js";
import { buildDecisionState } from "../src/core/decision/state-builder.js";
import { DECISION_ERROR_CODES } from "../src/core/decision/errors.js";
import { getQuestionSet } from "../src/core/decision/question-registry.js";
import { normalizeDecisionPolicy } from "../src/core/decision/policy.js";
import { recordSemanticDecision } from "../src/core/decision/service.js";
import { validateEventLedger } from "../src/core/events.js";
import { readDecisionArtifact } from "../src/core/decision/artifact.js";
import { createTypesafeClient } from "../src/adapters/typesafe/client.js";
import { taskArtifactPath } from "../src/core/task-paths.js";

test("decision state builder strips secret-like fields and bounds user paths", () => {
  const result = buildDecisionState({
    objective: "select relevant context",
    authorization: "must not be sent",
    env: { TYPESAFE_API_KEY: "must not be sent" },
    path: "/Users/example/project/src/index.js",
  });
  assert.deepEqual(result, {
    objective: "select relevant context",
    path: "<redacted-user-path>",
  });
  assert.throws(() => buildDecisionState({ value: "ghp_12345678901234567890" }), (error) => error.code === DECISION_ERROR_CODES.STATE_UNSAFE);
});

test("decision policy is mandatory and pinned", () => {
  assert.equal(normalizeDecisionPolicy().model, "jev-1.13.0");
  assert.throws(() => normalizeDecisionPolicy({ model: "jev-latest" }), (error) => error.code === DECISION_ERROR_CODES.POLICY_INVALID);
});

test("question registry returns versioned fingerprints", () => {
  const set = getQuestionSet("context-v1");
  assert.equal(set.version, 1);
  assert.match(set.fingerprint, /^[a-f0-9]{64}$/);
  assert.throws(() => getQuestionSet("unknown-v1"), (error) => error.code === DECISION_ERROR_CODES.QUESTION_SET_UNKNOWN);
});

test("mock semantic decision is persisted as a non-authoritative artifact and ledger event", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-jev-"));
  const packageRoot = getPackageRoot();
  const result = await recordSemanticDecision({
    target,
    packageRoot,
    taskId: "jev-foundation-test",
    decisionId: "context",
    request: {
      decisionKind: "CONTEXT_PLAN",
      questionSetId: "context-v1",
      state: { objective: "bounded context selection" },
    },
    provider: {
      id: "typesafe-jev",
      model: "jev-1.13.0",
      async evaluate() {
        return {
          model: "jev-1.13.0",
          answers: { need_history: { noul: "no" }, need_security: { noul: "yes" } },
          confidence: { need_history: 0.9, need_security: 0.8 },
          usage: { inputTokens: 5, outputTokens: 3, reportedBy: "PROVIDER" },
        };
      },
    },
  });
  assert.equal(result.event.event, "SEMANTIC_DECISION_RECORDED");
  assert.equal(result.artifact.authority, "SEMANTIC_DECISION");
  assert.equal(result.artifact.lifecycleAuthority, false);
  assert.equal(result.artifact.completionAuthority, false);
  assert.equal((await readDecisionArtifact(target, "jev-foundation-test", "context", packageRoot)).value.taskId, "jev-foundation-test");
  const ledger = await validateEventLedger(target, packageRoot, { taskId: "jev-foundation-test" });
  assert.equal(ledger.valid, true, JSON.stringify(ledger.errors));
  assert.ok(ledger.events.some((event) => event.event === "TRANSACTION_COMMITTED" && event.details.operation === "semantic-decision"));
  const serialized = await readFile(path.join(target, taskArtifactPath("jev-foundation-test", "events")), "utf8");
  assert.doesNotMatch(serialized, /TYPESAFE_API_KEY|api_key|authorization/i);
});

test("typesafe client fails closed when credentials are absent", () => {
  assert.throws(() => createTypesafeClient(normalizeDecisionPolicy(), { env: {} }), (error) => error.code === DECISION_ERROR_CODES.AUTH_REQUIRED);
});
