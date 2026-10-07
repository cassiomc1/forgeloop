import { getTaskTransaction, withTaskTransaction } from "./transaction.js";
import { readContract } from "./contract.js";
import { appendProtocolEvent, validateEventLedger } from "./events.js";
import {
  assertDecisionCriterionDetails,
  criterionForDecision,
  decisionCriterionEvents,
  decisionId,
  normalizeDecisionCriterionInput,
  normalizeDecisionText,
} from "./settlement-model.js";

export {
  assertDecisionCriterionDetails,
  criterionForDecision,
  decisionCriterionEvents,
  decisionId,
  normalizeDecisionCriterionInput,
  normalizeDecisionText,
};

export async function recordDecisionCriterion(options) {
  normalizeDecisionCriterionInput(options);
  if (await getTaskTransaction(options.target)) return recordCriterion(options);
  const contract = await readContract(options.target, options.packageRoot, { taskId: options.taskId, contractPath: options.contractPath });
  const taskId = options.taskId ?? contract?.value?.taskId;
  if (!taskId) return recordCriterion(options);
  return withTaskTransaction({ target: options.target, packageRoot: options.packageRoot,
    taskId, operation: "record-decision-criterion" }, () => recordCriterion({ ...options, taskId }));
}

async function recordCriterion({
  target,
  packageRoot,
  decision,
  settledBy,
  taskId = null,
  contractPath = null,
  eventsPath = null,
}) {
  const normalized = normalizeDecisionCriterionInput({ decision, settledBy });
  const contract = await readContract(target, packageRoot, { taskId, contractPath });
  if (!contract || !contract.value) {
    const error = new Error("Current contract not found");
    error.code = "E_CONTRACT_MISSING";
    throw error;
  }

  const unresolved = contract.value.unresolvedDecisions ?? [];
  if (!unresolved.includes(normalized.decision)) {
    const error = new Error(`Decision "${normalized.decision}" is not present in current unresolvedDecisions`);
    error.code = "E_DECISION_NOT_UNRESOLVED";
    throw error;
  }

  const ledger = await validateEventLedger(target, packageRoot, { taskId: taskId ?? null, eventsPath });
  if (!ledger.valid) {
    const first = ledger.errors[0];
    const error = new Error(first.message);
    error.code = first.code;
    throw error;
  }

  const decId = decisionId(normalized.decision);
  const details = {
    decision: normalized.decision,
    decisionId: decId,
    settledBy: normalized.settledBy,
    contractFingerprint: contract.fingerprint,
  };

  assertDecisionCriterionDetails(details);

  const event = await appendProtocolEvent(
    target,
    {
      taskId: contract.value.taskId,
      event: "DECISION_CRITERION_RECORDED",
      details,
    },
    packageRoot,
    { taskId: taskId ?? null, eventsPath },
  );

  return {
    event,
    criterion: details,
  };
}
