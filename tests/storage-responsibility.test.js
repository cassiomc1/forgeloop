import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import test from "node:test";
import { writeFile, stat } from "node:fs/promises";
import { createGitRepository } from "./helpers/git-fixture.js";
import path from "node:path";
import { runTaskCreate } from "../src/commands/task-create.js";
import { runDiscover } from "../src/commands/discover.js";
import { runContractCreate } from "../src/commands/contract-create.js";
import { runRoute } from "../src/commands/route.js";
import { runPreflight } from "../src/commands/preflight.js";
import { createContract } from "../src/core/contract.js";
import { getPackageRoot } from "../src/core/templates.js";
import { testSemanticProvider } from "../src/core/decision/test-provider.js";
import { setResponsibilityContract, readResponsibility, resolveResponsibilityStatus } from "../src/core/responsibility.js";
import { taskResponsibilityPath } from "../src/core/task-paths.js";
import { validateEventLedger } from "../src/core/events.js";
import { readWorkState } from "../src/core/work-state.js";
import { executeForgeLoopCommand } from "../src/integration.js";

test("native responsibility remains visible and immutable without a filesystem mirror", async () => {
  const target = await createGitRepository("forgeloop-responsibility-");
  const context = { target, packageRoot: getPackageRoot(), taskId: "native-responsibility" };
  try {
    await runTaskCreate({ ...context, claims: ["src"] });
    await runDiscover(context);
    const contract = createContract({ taskId: context.taskId, objective: "Validate responsibility persistence", deliverables: ["src"],
      constraints: [], risks: [], stopConditions: [], unresolvedDecisions: [], sourceRefs: [],
      verification: [{ id: "responsibility-check", text: "Responsibility boundaries are enforced", type: "VERIFICATION" }],
      successCriteria: ["Native responsibility is immutable and readable"] });
    await writeFile(path.join(target, "fixture-contract.json"), JSON.stringify(contract));
    await runContractCreate({ ...context, contractFile: "fixture-contract.json", semanticProvider: testSemanticProvider });
    await runRoute({ ...context, workType: "code", surfaces: ["config"], executableChange: true, semanticProvider: testSemanticProvider });
    assert.equal((await runPreflight(context)).status, "READY");
    const created = await setResponsibilityContract(target, { ...context, label: "native-pass", allowedPaths: ["."], frozenInputs: { claims: true } });
    await assert.rejects(stat(path.join(target, taskResponsibilityPath(context.taskId))), { code: "ENOENT" });
    const before = await readResponsibility(target, context);
    assert.deepEqual(before.value, created.responsibility);
    assert.equal(before.fingerprint, created.fingerprint);
    const status = await resolveResponsibilityStatus(target, context);
    assert.equal(status.status, "VALID", JSON.stringify(status.errors));
    assert.equal(status.responsibility.label, "native-pass");
    const dispatched = await executeForgeLoopCommand({ command: "responsibility-status", projectPath: target, input: { taskId: context.taskId } });
    assert.equal(dispatched.ok, true, JSON.stringify(dispatched.error));
    assert.equal(dispatched.exitCode, 0);
    assert.deepEqual(dispatched.result, status);
    await assert.rejects(stat(path.join(target, taskResponsibilityPath(context.taskId))), { code: "ENOENT" });
    const ledger = await validateEventLedger(target, context.packageRoot, context);
    const state = await readWorkState(target, context);
    await assert.rejects(setResponsibilityContract(target, { ...context, label: "replacement", allowedPaths: ["."] }), /immutable during a pass/);
    assert.deepEqual(await readResponsibility(target, context), before);
    assert.deepEqual(await validateEventLedger(target, context.packageRoot, context), ledger);
    assert.deepEqual(await readWorkState(target, context), state);
  } finally { await removeTempTree(target); }
});
