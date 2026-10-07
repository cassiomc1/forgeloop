import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runContextPlan } from "../src/commands/context-plan.js";
import { runContractCreate } from "../src/commands/contract-create.js";
import { runDiscover } from "../src/commands/discover.js";
import { runRoute } from "../src/commands/route.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { runTestUtility } from "../src/core/test-intelligence/service.js";
import { getPackageRoot } from "../src/core/templates.js";
import { readEvents, validateEventLedger } from "../src/core/events.js";
import { clearTestSemanticProvider, installTestSemanticProvider } from "../src/core/decision/test-provider.js";

const packageRoot = getPackageRoot();
const provider = Object.freeze({
  id: "typesafe-jev",
  model: "jev-1.13.0",
  async evaluate(request) {
    const answers = Object.fromEntries(Object.entries(request.questionSet.questions).map(([name, question]) => [
      name, question.type === "choice" ? Object.keys(question.criteria)[0] : { noul: true },
    ]));
    return {
      model: "jev-1.13.0", answers,
      confidence: Object.fromEntries(Object.keys(answers).map((name) => [name, 0.95])),
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  },
});

async function withTask(run) {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-jev-enforcement-"));
  try {
    await writeFile(path.join(target, "README.md"), "fixture\n");
    await runTaskCreate({ target, packageRoot, taskId: "jev-task", preset: "feature", claims: ["README.md"] });
    await runDiscover({ target, packageRoot, taskId: "jev-task" });
    await runContractCreate({ target, packageRoot, taskId: "jev-task", preset: "feature", semanticProvider: provider });
    await run(target);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

test("route records canonical intake and route Jev decisions before route persistence", async () => {
  await withTask(async (target) => {
    await runRoute({ target, packageRoot, taskId: "jev-task", workType: "code", surfaces: ["config"], semanticProvider: provider });
    const events = await readEvents(target, packageRoot, { taskId: "jev-task" });
    assert.equal(events.filter((event) => event.event === "SEMANTIC_DECISION_RECORDED").length, 4);
    assert.ok(events.some((event) => event.event === "SEMANTIC_DECISION_RECORDED" && event.details.decisionKind === "EXECUTION_PROFILE"));
    assert.equal((await validateEventLedger(target, packageRoot, { taskId: "jev-task" })).valid, true);
  });
});

test("route Jev relevance and execution depth materially affect canonical routing", async () => {
  await withTask(async (target) => {
    const requests = [];
    const provider = {
      id: "typesafe-jev", model: "jev-1.13.0",
      async evaluate(request) {
        requests.push(structuredClone(request));
        const answers = Object.fromEntries(Object.entries(request.questionSet.questions).map(([name, question], index) => {
          if (request.decisionKind === "ROUTE" && name.startsWith("guide_")) {
            const guide = request.questionSet.candidateIds[Number(name.match(/guide_(\d+)_/u)?.[1] ?? index)];
            return [name, { noul: guide !== "clean" ? "yes" : "no" }];
          }
          if (request.decisionKind === "EXECUTION_PROFILE" && name === "recommended_depth") return [name, "full"];
          return [name, question.type === "choice" ? Object.keys(question.criteria)[0] : { noul: true }];
        }));
        return {
          model: "jev-1.13.0", answers,
          confidence: Object.fromEntries(Object.keys(answers).map((name) => [name, 0.95])),
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const route = await runRoute({
      target, packageRoot, taskId: "jev-task", provider,
      workType: "code", risks: ["external-service"], behaviorChange: true,
    });
    assert.equal(route.guides.includes("clean"), false);
    assert.equal(route.excluded.clean[0], "JEV_EXCLUDED");
    assert.equal(route.executionProfile.resolved, "full");
    const routeRequest = requests.find((request) => request.decisionKind === "ROUTE");
    assert.ok(routeRequest.state.semantic.eligibleGuides.some((guide) => guide.id === "security"));
    assert.ok(Array.isArray(routeRequest.state.semantic.eligibleGuides.find((guide) => guide.id === "security").reasons));
  });
});

test("route keeps mandatory security guide despite high-confidence Jev exclusion", async () => {
  await withTask(async (target) => {
    const provider = {
      id: "typesafe-jev", model: "jev-1.13.0",
      async evaluate(request) {
        const answers = Object.fromEntries(Object.entries(request.questionSet.questions).map(([name, question], index) => {
          if (request.decisionKind === "ROUTE" && name.startsWith("guide_")) {
            const guide = request.questionSet.candidateIds[Number(name.match(/guide_(\d+)_/u)?.[1] ?? index)];
            return [name, { noul: guide !== "security" ? "yes" : "no" }];
          }
          return [name, question.type === "choice" ? Object.keys(question.criteria)[0] : { noul: true }];
        }));
        return {
          model: "jev-1.13.0", answers,
          confidence: Object.fromEntries(Object.keys(answers).map((name) => [name, 0.99])),
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const route = await runRoute({
      target, packageRoot, taskId: "jev-task", provider,
      workType: "code", risks: ["external-service"], behaviorChange: true,
    });
    assert.equal(route.guides.includes("security"), true);
    assert.equal(route.excluded.security, undefined);
    assert.ok(route.reasons.security.includes("RISK_EXTERNAL_SERVICE"));
    assert.ok(route.reasons.security.includes("MANDATORY_SAFETY_GUIDE"));
  });
});

test("context planning ranks actual candidates through a task-bound Jev decision", async () => {
  await withTask(async (target) => {
    const result = await runContextPlan({
      target, packageRoot, taskId: "jev-task", provider,
      candidates: [
        { id: "required", summary: "Required contract context", required: true },
        { id: "optional", summary: "Optional bounded context" },
      ],
    });
    assert.deepEqual(result.selected.map((candidate) => candidate.id).sort(), ["optional", "required"]);
    const events = await readEvents(target, packageRoot, { taskId: "jev-task" });
    assert.ok(events.some((event) => event.event === "SEMANTIC_DECISION_RECORDED" && event.details.decisionKind === "CONTEXT_PLAN"));
  });
});

test("test utility sends real inventory metadata in bounded Jev batches", async () => {
  await withTask(async (target) => {
    await mkdir(path.join(target, "tests"));
    await writeFile(path.join(target, "tests", "sample.test.js"), "import test from 'node:test'; test('sample', () => {});\n");
    let observedRequest = null;
    const capturingProvider = {
      ...provider,
      async evaluate(request) {
        observedRequest = structuredClone(request);
        return provider.evaluate(request);
      },
    };
    const result = await runTestUtility({ target, packageRoot, taskId: "jev-task", provider: capturingProvider });
    assert.equal(result.artifact.semanticStatus, "PROVIDER_REPORTED");
    assert.ok(Array.isArray(result.artifact.decisionIds));
    assert.equal(result.artifact.decisionIds.length, 1);
    assert.equal(result.artifact.tests[0].sourceSummary, "tests/sample.test.js:1 sample");
    assert.equal(observedRequest.state.semantic.tests[0].testId, result.artifact.tests[0].testId);
    assert.equal(observedRequest.state.semantic.tests[0].sourceSummary, "tests/sample.test.js:1 sample");
    assert.deepEqual(observedRequest.state.semantic.tests[0].targets, ["tests/sample.test.js"]);
  });
});

test("semantic requests preserve lifecycle bindings alongside decision-specific state", async () => {
  await withTask(async (target) => {
    const requests = [];
    const capturingProvider = {
      id: "typesafe-jev", model: "jev-1.13.0",
      async evaluate(request) {
        requests.push(structuredClone(request));
        const answers = Object.fromEntries(Object.entries(request.questionSet.questions).map(([name, question]) => [
          name, question.type === "choice" ? Object.keys(question.criteria)[0] : { noul: true },
        ]));
        return {
          model: "jev-1.13.0", answers,
          confidence: Object.fromEntries(Object.keys(answers).map((name) => [name, 0.95])),
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    await runContextPlan({
      target, packageRoot, taskId: "jev-task", provider: capturingProvider,
      candidates: [{ id: "candidate", kind: "artifact", sourceRef: "docs/example.md", summary: "bounded summary", required: true, mandatory: true, risk: "low", trust: "repository" }],
    });
    const context = requests.find((request) => request.questionSet.decisionKind === "CONTEXT_PLAN");
    assert.ok(context);
    assert.equal(context.state.lifecycle.phase, "CONTRACT_READY");
    assert.equal(context.state.semantic.candidates[0].id, "candidate");
    assert.equal(context.state.semantic.candidates[0].sourceRef, "docs/example.md");
    assert.equal(context.state.semantic.candidates[0].mandatory, true);
  });
});

test("semantic-required context planning fails closed without a current decision or provider", async () => {
  await withTask(async (target) => {
    const priorCredential = process.env.TYPESAFE_API_KEY;
    clearTestSemanticProvider();
    delete process.env.TYPESAFE_API_KEY;
    try {
      await assert.rejects(
        () => runContextPlan({ target, packageRoot, taskId: "jev-task", candidates: [{ id: "candidate", summary: "bounded" }] }),
        (error) => ["E_DECISION_ENGINE_AUTH_REQUIRED", "E_DECISION_REQUIRED", "E_DECISION_ENGINE_UNAVAILABLE", "E_DECISION_ENGINE_AUTH_INVALID"].includes(error.code),
      );
    } finally {
      if (priorCredential === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = priorCredential;
      installTestSemanticProvider(provider);
    }
  });
});
