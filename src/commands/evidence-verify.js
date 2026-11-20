import { readFile } from "node:fs/promises";

import { validateTaskBrief } from "../core/delegation.js";
import { E_DELEGATION_BRIEF_INVALID } from "../core/error-codes.js";
import { ensureWithin } from "../core/filesystem.js";
import { verifyEvidenceRange } from "../core/evidence/verify.js";

async function readBrief(target, packageRoot, briefPath) {
  try {
    return await validateTaskBrief(JSON.parse(await readFile(ensureWithin(target, briefPath), "utf8")), packageRoot);
  } catch (error) {
    throw Object.assign(new Error(`Task brief ${briefPath} is invalid: ${error.message}`), { code: E_DELEGATION_BRIEF_INVALID });
  }
}
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
    brief: options.delegationBrief ? await readBrief(options.target, options.packageRoot, options.delegationBrief) : null,
  });
}

export function formatEvidenceVerifyResult(result, options = {}) {
  if (options.evidenceFormat === "markdown") return formatEvidenceMarkdown(result);
  return [
    `FORGELOOP EVIDENCE VERIFICATION: ${result.status}`,
    `LEVEL: ${result.level}`,
    `ASSURANCE: ${result.assurance}`,
    ...(result.delegation ? [`DELEGATION: ${result.delegation.status} (${result.delegation.taskId})`] : []),
    `CHANGED: ${result.changedPaths}`,
    `COVERED: ${result.coveredPaths}`,
    `UNCOVERED: ${result.uncoveredPaths.length}`,
    `BUNDLES: ${result.bundles.length}`,
    ...result.errors.map((error) => `${error.code}: ${error.message}`),
    ...result.warnings.map((warning) => `WARNING: ${warning}`),
    "",
  ].join("\n");
}
