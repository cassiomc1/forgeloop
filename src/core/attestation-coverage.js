import { getPackageRoot } from "./templates.js";
import { discoverTasks } from "./task-discovery.js";
import { readCodeManifest, validateCodeManifestBindings } from "./code-manifest.js";
import { readAttestationStatement } from "./attestation.js";
import { resolveRevisionProvider } from "./revision/provider.js";
import { REVISION_PROVIDERS } from "./revision/registry.js";
import { assertAttestationStatementBindings, verifyCodeManifestContent } from "./attestation-verifier.js";
import { taskAttestationBundlePath } from "./task-paths.js";
import { withProjectReadSnapshot } from "../storage/project-read-snapshot.js";

function pathMatchesExclusion(pathValue, exclusions) {
  return exclusions.some((pattern) => {
    const normalized = String(pattern).replaceAll("\\", "/");
    if (normalized.endsWith("/**")) return pathValue === normalized.slice(0, -3) || pathValue.startsWith(normalized.slice(0, -2));
    return pathValue === normalized;
  });
}

function changedPathNames(entry) {
  return [entry.path, entry.sourcePath].filter(Boolean);
}

function isProtocolMetadataPath(value) {
  const normalized = String(value).replaceAll("\\", "/").replace(/^\.\//u, "");
  return normalized === ".forgeloop" || normalized.startsWith(".forgeloop/");
}

export async function evaluateAttestationCoverage(options = {}) {
  return withProjectReadSnapshot(options.target, () => evaluateSelectedAttestationCoverage(options));
}

async function evaluateSelectedAttestationCoverage({
  target,
  packageRoot = getPackageRoot(),
  revisionProvider = "git",
  baseRevision,
  headRevision,
  requireCompleteCoverage = true,
  requireSignature = false,
  signingProvider = null,
  signerPolicy = {},
  exclusions = [],
} = {}) {
  const provider = typeof revisionProvider === "string"
    ? await resolveRevisionProvider({ target, providerName: revisionProvider, registry: REVISION_PROVIDERS })
    : revisionProvider;
  const changedEntries = await provider.getChangedEntries({ target, baseRevision, headRevision });
  const changedPaths = [...new Set(changedEntries.flatMap(changedPathNames)
    .filter((value) => !isProtocolMetadataPath(value)))].sort();
  const validAttestations = [];
  const errors = [];
  const tasks = await discoverTasks(target, packageRoot);
  for (const task of tasks.filter((item) => item.healthy !== false && item.taskId)) {
    try {
      const statement = await readAttestationStatement({ target, packageRoot, taskId: task.taskId });
      const manifest = await readCodeManifest({ target, packageRoot, taskId: task.taskId });
      await validateCodeManifestBindings({ target, packageRoot, taskId: task.taskId, manifest: manifest.value, revisionProvider: provider });
      assertAttestationStatementBindings(statement.value, manifest.value, task.taskId, manifest.fingerprint);
      await verifyCodeManifestContent({ target, manifest: manifest.value, revisionProvider: provider, revision: headRevision });
      let signatureStatus = "UNSIGNED";
      if (requireSignature) {
        const { verifyAttestation } = await import("./attestation-verifier.js");
        const verified = await verifyAttestation({
          target,
          packageRoot,
          taskId: task.taskId,
          revision: headRevision,
          revisionProvider: provider,
          requireSignature: true,
          signingProvider,
          bundlePath: taskAttestationBundlePath(task.taskId),
          identity: signerPolicy.identity,
          issuer: signerPolicy.issuer,
          trustedRoot: signerPolicy.trustedRoot,
        });
        signatureStatus = verified.signature.status;
        if (verified.status !== "VALID") {
          const error = new Error(verified.errors[0]?.message ?? "Signature verification failed");
          error.code = verified.errors[0]?.code ?? "E_ATTESTATION_SIGNATURE_INVALID";
          throw error;
        }
      }
      validAttestations.push({
        taskId: task.taskId,
        statement,
        manifest: manifest.value,
        signatureStatus,
      });
    } catch (error) {
      if (error.code !== "E_ATTESTATION_STATEMENT_MISSING" && error.code !== "E_ATTESTATION_MANIFEST_MISSING") {
        errors.push({ taskId: task.taskId, code: error.code ?? "E_ATTESTATION_INVALID", message: error.message });
      }
    }
  }
  const coveredByPath = new Map();
  const overlaps = [];
  for (const attestation of validAttestations) {
    for (const entry of attestation.manifest.entries) {
      for (const name of changedPathNames(entry)) {
        const digest = entry.kind === "DELETED" ? "DELETED" : entry.sha256 ?? entry.providerContentId ?? "UNKNOWN";
        const existing = coveredByPath.get(name);
        if (existing && existing.digest !== digest) {
          errors.push({ code: "E_ATTESTATION_COVERAGE_CONFLICT", message: `Conflicting attestation content for ${name}`, path: name, tasks: [existing.taskId, attestation.taskId] });
        } else if (existing) {
          overlaps.push({ path: name, tasks: [...new Set([existing.taskId, attestation.taskId])] });
        } else {
          coveredByPath.set(name, { taskId: attestation.taskId, digest });
        }
      }
    }
  }
  const excluded = changedPaths.filter((item) => pathMatchesExclusion(item, exclusions));
  const uncoveredPaths = changedPaths.filter((item) => !pathMatchesExclusion(item, exclusions) && !coveredByPath.has(item));
  if (requireCompleteCoverage && uncoveredPaths.length > 0) errors.push({ code: "E_ATTESTATION_COVERAGE_GAP", message: `Changed source paths are not covered by valid attestations: ${uncoveredPaths.join(", ")}`, paths: uncoveredPaths });
  const status = errors.length === 0 && (!requireCompleteCoverage || uncoveredPaths.length === 0) ? "VALID" : "INVALID";
  const signatureStatus = requireSignature
    ? (validAttestations.every((item) => item.signatureStatus === "VALID") && (validAttestations.length > 0 || changedPaths.length === 0) ? "VALID" : "INVALID")
    : "UNSIGNED";
  return {
    schemaVersion: 1,
    status,
    level: status === "VALID" ? (requireSignature ? "ATTESTED" : "VERIFIED") : "PROCESSED",
    revisionProvider: provider.name ?? "unknown",
    baseRevision,
    headRevision,
    changedPaths: changedPaths.length,
    coveredPaths: [...coveredByPath.keys()].filter((item) => !excluded.includes(item)).length,
    uncoveredPaths,
    tasks: validAttestations.length,
    overlaps,
    errors,
    signature: {
      required: requireSignature,
      status: signatureStatus,
      ...(signerPolicy.identity ? { identity: signerPolicy.identity } : {}),
      ...(signerPolicy.issuer ? { issuer: signerPolicy.issuer } : {}),
    },
  };
}
