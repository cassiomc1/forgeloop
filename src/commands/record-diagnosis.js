import { assertCanonicalPersistence } from "../storage/operational-context.js";
import { recordDiagnosis } from "../core/diagnosis.js";
import { recordStructuredDiagnosticCase } from "../core/diagnostic-record.js";
import { withTaskMutation } from "../core/task-command.js";

export { recordDiagnosis, recordStructuredDiagnosticCase };

export async function runRecordDiagnosis({
  target,
  packageRoot,
  file = null,
  hypothesis,
  failureClass,
  evidenceRefs = [],
  evidenceRef = null,
  settledBy,
  nextSafeAction,
  taskId,
  task,
  persistence = null,
}) {
  assertCanonicalPersistence(persistence);
  if (file) {
    const legacyFields = [hypothesis, failureClass, settledBy, nextSafeAction].some((value) => value !== undefined && value !== null)
      || (Array.isArray(evidenceRefs) && evidenceRefs.length > 0)
      || Boolean(evidenceRef);
    if (legacyFields) {
      const error = new Error("record-diagnosis accepts either --file (structured case) or legacy diagnosis fields, not both");
      error.code = "E_INPUT_CONFLICT";
      throw error;
    }
    return withTaskMutation(target, { taskId: taskId ?? task, packageRoot }, "record-diagnosis", async (ctx) => {
      return recordStructuredDiagnosticCase({
        target,
        packageRoot,
        caseFile: file,
        caseInput: null,
        taskId: ctx?.taskId ?? null,
      });
    });
  }

  const refs = Array.isArray(evidenceRefs) && evidenceRefs.length > 0
    ? evidenceRefs
    : (evidenceRef ? [evidenceRef] : []);

  return withTaskMutation(target, { taskId: taskId ?? task, packageRoot }, "record-diagnosis", async (ctx) => {
    return recordDiagnosis({
      target,
      packageRoot,
      hypothesis,
      failureClass,
      evidenceRefs: refs,
      settledBy,
      nextSafeAction,
      taskId: ctx?.taskId ?? null,
    });
  });
}

export function formatRecordDiagnosisResult(result) {
  if (result.diagnosticCase) {
    const d = result.diagnosticCase;
    return [
      `FORGELOOP DIAGNOSTIC CASE RECORDED`,
      `CYCLE: ${d.verificationCycle}`,
      `REVISION: ${d.diagnosticRevision}`,
      `FAILURE CLASS: ${d.failureClass}`,
      `OBSERVATIONS: ${(d.observations ?? []).length}`,
      `CONTRIBUTORS: ${(d.contributors ?? []).length}`,
      `HYPOTHESES: ${(d.hypotheses ?? []).map((hypothesis) => hypothesis.id).join(", ")}`,
      `NEXT SAFE ACTION: ${d.nextSafeAction?.statement ?? ""}`,
      `FINGERPRINT: ${d.diagnosticFingerprint}`,
    ].join("\n") + "\n";
  }
  const d = result.diagnosis ?? result.event?.details ?? {};
  return [
    `FORGELOOP DIAGNOSIS RECORDED`,
    `CYCLE: ${d.verificationCycle}`,
    `FAILURE CLASS: ${d.failureClass}`,
    `HYPOTHESIS: ${d.hypothesis}`,
    `INFORMATION GAIN: ${d.informationGain}`,
    `EVIDENCE: ${(d.evidenceRefs ?? []).join(", ")}`,
    `SETTLED BY: ${d.settledBy}`,
    `NEXT SAFE ACTION: ${d.nextSafeAction}`,
    `FINGERPRINT: ${d.diagnosisFingerprint}`,
  ].join("\n") + "\n";
}
