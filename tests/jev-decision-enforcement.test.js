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
    assert.equal(events.filter((event) => event.event === "SEMANTIC_DECISION_RECORDED").length, 3);
    assert.equal((await validateEventLedger(target, packageRoot, { taskId: "jev-task" })).valid, true);
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
    const result = await runTestUtility({ target, packageRoot, taskId: "jev-task", provider });
    assert.equal(result.artifact.semanticStatus, "PROVIDER_REPORTED");
    assert.ok(Array.isArray(result.artifact.decisionIds));
    assert.equal(result.artifact.decisionIds.length, 1);
    assert.equal(result.artifact.tests[0].sourceSummary, "tests/sample.test.js:1 sample");
  });
});

test("semantic-required context planning fails closed without a current decision or provider", async () => {
  await withTask(async (target) => {
    const prior = process.env.FORGELOOP_TEST_SEMANTIC_PROVIDER;
    delete process.env.FORGELOOP_TEST_SEMANTIC_PROVIDER;
    try {
      await assert.rejects(
        () => runContextPlan({ target, packageRoot, taskId: "jev-task", candidates: [{ id: "candidate", summary: "bounded" }] }),
        (error) => ["E_DECISION_ENGINE_AUTH_REQUIRED", "E_DECISION_REQUIRED", "E_DECISION_ENGINE_UNAVAILABLE", "E_DECISION_ENGINE_AUTH_INVALID"].includes(error.code),
      );
    } finally {
      if (prior === undefined) delete process.env.FORGELOOP_TEST_SEMANTIC_PROVIDER;
      else process.env.FORGELOOP_TEST_SEMANTIC_PROVIDER = prior;
    }
  });
});
