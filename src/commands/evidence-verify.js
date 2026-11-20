import { verifyEvidenceRange } from "../core/evidence/verify.js";
import { formatEvidenceMarkdown } from "../core/evidence/markdown.js";

export async function runEvidenceVerify(options = {}) {
  return verifyEvidenceRange({
    target: options.target,
    packageRoot: options.packageRoot,
    revisionProvider: options.revisionProvider ?? "git",
    baseRevision: options.baseRevision,
    headRevision: options.headRevision,
    ...(options.evidenceDirectory ? { directory: options.evidenceDirectory } : {}),
    requireCompleteCoverage: options.allowPartialCoverage !== true,
    requireSignature: options.requireSignature === true,
    signerPolicy: {
      identity: options.attestationIdentity,
      issuer: options.attestationIssuer,
      trustedRoot: options.trustedRoot,
    },
    exclusions: Array.isArray(options.evidenceExclusions) ? options.evidenceExclusions : [],
    minAssurance: options.minAssurance ?? null,
  });
}

export function formatEvidenceVerifyResult(result, options = {}) {
  if (options.evidenceFormat === "markdown") return formatEvidenceMarkdown(result);
  return [
    `FORGELOOP EVIDENCE VERIFICATION: ${result.status}`,
    `LEVEL: ${result.level}`,
    `ASSURANCE: ${result.assurance}`,
    `CHANGED: ${result.changedPaths}`,
    `COVERED: ${result.coveredPaths}`,
    `UNCOVERED: ${result.uncoveredPaths.length}`,
    `BUNDLES: ${result.bundles.length}`,
    ...result.errors.map((error) => `${error.code}: ${error.message}`),
    ...result.warnings.map((warning) => `WARNING: ${warning}`),
    "",
  ].join("\n");
}
