import { readTestUtility } from "./service.js";

const PROTECTED_CLASSES = new Set(["KEEP_REQUIRED", "KEEP_RISK_GUARD", "KEEP_UNIQUE"]);

function planFor(test) {
  if (test.protected || PROTECTED_CLASSES.has(test.classification)) return { action: "KEEP", reason: "PROTECTED_TEST" };
  if (test.classification === "REDUNDANT_CANDIDATE" && test.recommendation === "PROBE_REMOVAL") return { action: "PROBE_REMOVAL", reason: "SEMANTIC_AND_DETERMINISTIC_EVIDENCE_REQUIRED" };
  if (test.classification === "KEEP_DOCUMENTATION_VALUE") return { action: "KEEP", reason: "DOCUMENTATION_VALUE" };
  return { action: "BLOCKED", reason: "INSUFFICIENT_PROVENANCE" };
}

export async function buildPrunePlan({ target, packageRoot, taskId } = {}) {
  const utility = await readTestUtility({ target, packageRoot, taskId });
  const items = utility.value.tests.map((test) => ({ testId: test.testId, file: test.file, name: test.name, ...planFor(test) }));
  return { schemaVersion: 1, taskId, semanticStatus: utility.value.semanticStatus, items, deletionAuthority: false };
}

export async function runPruneProbe({ target, packageRoot, taskId, testId } = {}) {
  const plan = await buildPrunePlan({ target, packageRoot, taskId });
  const item = plan.items.find((candidate) => candidate.testId === testId);
  if (!item) {
    const error = new Error(`Unknown test ID: ${testId}`); error.code = "E_TEST_ID_UNKNOWN"; throw error;
  }
  if (item.action !== "PROBE_REMOVAL") {
    const error = new Error(`Test prune probe blocked for ${testId}: ${item.reason}`);
    error.code = "E_TEST_PRUNE_BLOCKED";
    throw error;
  }
  return { status: "BLOCKED", reason: "ISOLATED_PROBE_NOT_AUTHORIZED", testId, liveWorktreeModified: false };
}

