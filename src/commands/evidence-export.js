import { exportEvidenceBundle } from "../core/evidence/export.js";

export async function runEvidenceExport({ target, packageRoot, taskId, evidenceDirectory } = {}) {
  if (!taskId) throw Object.assign(new Error("--task is required for evidence-export"), { code: "E_CLI_INVOCATION_INVALID" });
  return exportEvidenceBundle({ target, packageRoot, taskId, ...(evidenceDirectory ? { directory: evidenceDirectory } : {}) });
}

export function formatEvidenceExportResult(result) {
  return [
    `FORGELOOP EVIDENCE EXPORTED: ${result.taskId}`,
    `PATH: ${result.path}`,
    `COVERED PATHS: ${result.coveredPaths}`,
    `SIGNED: ${result.signed ? "yes" : "no (CI reports INTEGRITY_ONLY)"}`,
    "Commit this file with the change it covers.",
    "",
  ].join("\n");
}
