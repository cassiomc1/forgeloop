import { readConfig } from "../config.js";
import { resolveSigningProvider } from "../signing/provider.js";
import { SIGNING_PROVIDERS } from "../signing/registry.js";
import { taskAttestationBundlePath, taskAttestationStatementPath } from "../task-paths.js";
import { withTaskTransaction } from "../transaction.js";
import { assertEvidenceTaskId } from "./bundle-format.js";
import { exportEvidenceBundle, hasAttestationSignature } from "./export.js";

// Signs the statement only when Sigstore is the configured provider and no
// signature exists yet: keyless signing publishes the signer identity, so it
// must follow explicit configuration and never replace an earlier signature.
async function signStatement({ target, packageRoot, taskId, signing, signer }) {
  if (signing?.provider !== "sigstore") return { status: "NOT_CONFIGURED" };
  try {
    if (await hasAttestationSignature(target, taskId)) return { status: "EXISTING" };
    const provider = signer ?? await resolveSigningProvider({ providerName: "sigstore", registry: SIGNING_PROVIDERS });
    const result = await withTaskTransaction({ target, taskId, packageRoot, operation: "attestation-sign" }, () => provider.sign({
      target,
      statementPath: taskAttestationStatementPath(taskId),
      bundlePath: taskAttestationBundlePath(taskId),
    }));
    if (result?.status === "VALID") return { status: "SIGNED" };
    return { status: "FAILED", code: result?.code ?? "E_ATTESTATION_SIGNATURE_INVALID", message: result?.message ?? "Sigstore signing failed" };
  } catch (error) {
    return { status: "FAILED", code: error.code ?? "E_ATTESTATION_SIGNATURE_INVALID", message: error.message };
  }
}

// Runs after a VALID completion has committed. Export is a convenience on top
// of the terminal state: every failure is reported, never thrown, so a broken
// export or signature cannot turn a valid completion into an error.
export async function autoExportEvidence({ target, packageRoot, taskId, signer = null } = {}) {
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
    const signature = await signStatement({ target, packageRoot, taskId, signing: attestation.signing, signer });
    const exported = await exportEvidenceBundle({ target, packageRoot, taskId });
    return { status: "EXPORTED", path: exported.path, digest: exported.digest, coveredPaths: exported.coveredPaths, signed: exported.signed, signature };
  } catch (error) {
    return {
      status: "FAILED",
      code: error.code ?? "E_EVIDENCE_EXPORT_UNAVAILABLE",
      message: error.message,
      next: `forgeloop attestation-create --task ${taskId} && forgeloop evidence-export --task ${taskId}`,
    };
  }
}
