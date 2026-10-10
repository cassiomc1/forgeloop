import { runActivate } from "../../src/commands/activate.js";
import { runAdvance } from "../../src/commands/advance.js";
import { runPrepareCompletion } from "../../src/commands/prepare-completion.js";
import { runPreflight } from "../../src/commands/preflight.js";
import { runTaskCreate } from "../../src/commands/task-create.js";
import { runRoute } from "../../src/commands/route.js";
import { createContract, writeContract, contractFingerprint } from "../../src/core/contract.js";
import { testSemanticProvider } from "../../src/core/decision/test-provider.js";
import { seedPolicyEpoch } from "./durable-policy.js";

/**
 * Full modern task lifecycle through canonical commands only:
 * task-create -> contract -> route -> preflight(READY) -> activate
 * -> PLANNED -> EXECUTING -> VERIFYING. Durable actions and verification
 * checks can execute in this state.
 */
export async function setupVerifyingTask(target, packageRoot, {
  taskId,
  capabilityPolicy = { schemaVersion: 1, defaultDecision: "ALLOW", rules: [] },
  requirement = "postcondition",
  semanticProvider = testSemanticProvider,
} = {}) {
  await runTaskCreate({ target, packageRoot, taskId, claims: ["src"] });
  if (capabilityPolicy) {
    await seedPolicyEpoch(target, packageRoot, taskId, capabilityPolicy);
  }
  const contract = createContract({
    taskId,
    objective: `exercise durable actions for ${taskId}`,
    deliverables: ["src"],
    constraints: [],
    risks: [],
    stopConditions: [],
    unresolvedDecisions: [],
    sourceRefs: [],
    verification: [`${requirement} verified`],
    successCriteria: [`required action satisfies ${requirement}`],
  });
  await writeContract(target, contract, packageRoot, { taskId });
  const fingerprint = contractFingerprint(contract);
  await runRoute({ target, packageRoot, taskId, workType: "code", surfaces: ["config"], executableChange: true, semanticProvider });
  const preflight = await runPreflight({ target, packageRoot, taskId });
  if (preflight.status !== "READY") throw new Error(`fixture preflight not READY: ${preflight.status}`);
  await runActivate({ target, packageRoot, taskId });
  for (const phase of ["PLANNED", "EXECUTING", "VERIFYING"]) {
    await runAdvance({ target, packageRoot, taskId, to: phase });
  }
  await runPrepareCompletion({ target, packageRoot, taskId });
  return { fingerprint };
}
