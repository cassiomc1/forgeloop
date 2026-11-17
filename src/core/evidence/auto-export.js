import { readConfig } from "../config.js";
import { assertEvidenceTaskId } from "./bundle-format.js";
import { exportEvidenceBundle } from "./export.js";

// Runs after a VALID completion has committed. Export is a convenience on top
// of the terminal state: every failure is reported, never thrown, so a broken
// export cannot turn a valid completion into an error.
export async function autoExportEvidence({ target, packageRoot, taskId } = {}) {
  let attestation;
  try {
    attestation = (await readConfig(target, packageRoot))?.attestation ?? null;
  } catch {
    attestation = null;
  }
  if (attestation?.mode !== "required") return { status: "SKIPPED", reason: "attestation mode is not required" };
  if (attestation.autoExportEvidence === false) return { status: "SKIPPED", reason: "attestation.autoExportEvidence is false" };
  if (!taskId) return { status: "SKIPPED", reason: "complete ran without --task" };
  try {
    assertEvidenceTaskId(taskId);
  } catch {
    return { status: "SKIPPED", reason: "task ID cannot name an evidence bundle" };
  }
  try {
    const { runAttestationCreate } = await import("../../commands/attestation-create.js");
    await runAttestationCreate({ target, packageRoot, taskId });
    const exported = await exportEvidenceBundle({ target, packageRoot, taskId });
    return { status: "EXPORTED", path: exported.path, digest: exported.digest, coveredPaths: exported.coveredPaths, signed: exported.signed };
  } catch (error) {
    return {
      status: "FAILED",
      code: error.code ?? "E_EVIDENCE_EXPORT_UNAVAILABLE",
      message: error.message,
      next: `forgeloop attestation-create --task ${taskId} && forgeloop evidence-export --task ${taskId}`,
    };
  }
}
