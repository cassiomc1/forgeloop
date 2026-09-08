import { assertSafePath, fileExists, ensureWithin, readBytes, writeFileAtomic } from "../core/filesystem.js";
import { readManifest, sha256, writeManifest } from "../core/manifest.js";
import { readTemplateEntries } from "../core/templates.js";
import { createEvidence } from "../core/evidence.js";
import { LAYOUT_VERSION } from "../core/target-layout.js";
import { inspectNativeAdapter, validateNativeAdapterTargets } from "../core/native-adapters.js";
import { findIncompleteTransactions, recoverIncompleteTransactions } from "../core/transaction.js";
import { isRepositoryCandidate } from "../repository-index/lifecycle.js";
import { getRepositoryIndexStatus } from "../repository-index/status.js";
import { searchRepository } from "../repository-index/search.js";

function finding(code, severity, relativePath, message, remediation = null, evidence = null) {
  const evidenceRecord = evidence && typeof evidence === "object"
    ? evidence
    : createEvidence({
      kind: "OBSERVED",
      source: `ForgeLoop doctor:${relativePath}`,
      result: evidence ?? message,
    });
  return {
    code,
    severity,
    path: relativePath,
    message,
    remediation: remediation ?? (severity === "info" ? "No action required." : "Review the target path and apply the suggested correction."),
    evidence: evidenceRecord,
  };
}

function readProfileMode(bytes) {
  const text = bytes.toString("utf8");
  return text.match(/^profile-mode:\s*([^\s]+)\s*$/m)?.[1] ?? null;
}

async function inspectManagedNativeAdapter({ target, relativePath, bytes, record, findings }) {
  const initialInspection = inspectNativeAdapter(relativePath, bytes);
  const appearsForgeLoopManaged = initialInspection.hasForgeLoopMarker
    || initialInspection.legacyReferences.length > 0
    || initialInspection.text.includes(".forgeloop/kit/");
  if (record.preserve && !appearsForgeLoopManaged) return;

  const validation = await validateNativeAdapterTargets({ target, relativePath, bytes });
  if (validation.stale) {
    findings.push(finding(
      "E_NATIVE_ADAPTER_STALE",
      "error",
      relativePath,
      "Managed native adapter does not resolve its ForgeLoop references to the hidden kit.",
      "Run forgeloop update or merge the hidden-kit references into this adapter.",
    ));
  }
  for (const missingTarget of validation.missingTargets) {
    findings.push(finding(
      "E_NATIVE_ADAPTER_TARGET_MISSING",
      "error",
      relativePath,
      `Managed native adapter target is missing: ${missingTarget}.`,
      "Restore the hidden canonical target and rerun doctor.",
    ));
  }
}

const ADAPTER_PATHS = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  ".cursor/rules/project-loop.mdc",
  ".github/copilot-instructions.md",
]);

async function adoptAdapters({ target, manifest, adoptPaths, findings }) {
  if (!manifest || adoptPaths.length === 0) return manifest;

  const nextManifest = structuredClone(manifest);
  let changed = false;

  for (const relativePath of adoptPaths) {
    if (!ADAPTER_PATHS.has(relativePath)) {
      findings.push(
        finding(
          "adopt-invalid-path",
          "error",
          relativePath,
          "Only supported adapter paths can be adopted.",
        ),
      );
      continue;
    }

    const destination = ensureWithin(target, relativePath);
    try {
      await assertSafePath(target, relativePath);
    } catch (error) {
      findings.push(finding("unsafe-path", "error", relativePath, error.message));
      continue;
    }
    if (!(await fileExists(destination))) {
      findings.push(finding("adopt-file-missing", "error", relativePath, "Adapter file is missing."));
      continue;
    }

    nextManifest.files[relativePath] = {
      sha256: sha256(await readBytes(destination)),
      preserve: true,
    };
    findings.push(
      finding(
        "file-adopted",
        "info",
        relativePath,
        "Existing adapter is now recorded as preserved by ForgeLoop.",
      ),
    );
    changed = true;
  }

  if (changed) await writeManifest(target, nextManifest);
  return nextManifest;
}

async function inspectRepositoryIndexForDoctor({ target, packageRoot, repositoryIndex, repositoryIndexOptions, findings }) {
  if (!repositoryIndex) return { status: "DISABLED", required: false };
  if (!(await isRepositoryCandidate(target))) {
    return { status: "DEFERRED", required: true, reason: "target is not a Git repository" };
  }

  const status = await getRepositoryIndexStatus(target, { packageRoot, ...repositoryIndexOptions, includeLocalPaths: true });
  const result = {
    status: status.health,
    required: true,
    engine: status.engine,
    engineVersion: status.engineVersion,
    indexPath: status.indexPath,
    server: status.server,
    diagnostics: status.diagnostics,
  };
  if (status.health === "READY") {
    try {
      const smoke = await searchRepository(target, {
        ...repositoryIndexOptions,
        packageRoot,
        pattern: "__FORGELOOP_DOCTOR_INDEX_SMOKE__",
        fixedStrings: true,
        maxCount: 1,
      });
      result.smokeSearch = {
        status: "OK",
        matchCount: smoke.matches.length,
        nativeExitCode: smoke.metrics.exitCode,
      };
    } catch (error) {
      result.smokeSearch = {
        status: "ERROR",
        code: error.code ?? "E_REPOSITORY_INDEX_SEARCH_FAILED",
        message: error.message,
      };
      findings.push(finding(
        error.code ?? "E_REPOSITORY_INDEX_SEARCH_FAILED",
        "error",
        ".forgeloop/repository-index",
        `Repository Index smoke search failed: ${error.message}`,
        "Run forgeloop index-status --json, then index-rebuild if the managed search service is unhealthy.",
        error.message,
      ));
    }
  }
  if (status.health !== "READY") {
    findings.push(finding(
      status.diagnostics?.[0]?.code ?? "E_REPOSITORY_INDEX_SERVER_UNHEALTHY",
      "error",
      ".forgeloop/repository-index",
      `Repository Index is ${status.health}; ${status.diagnostics?.[0]?.message ?? "native index health is not ready"}`,
      "Run forgeloop index-setup or forgeloop index-rebuild with an approved managed tgrep asset.",
      status,
    ));
  }
  return result;
}

export async function runDoctor({ target, packageRoot, adoptPaths = [], strict = false, fix = false, repositoryIndex, repositoryIndexOptions }) {
  const findings = [];
  let incompleteTransactions = await findIncompleteTransactions(target);
  if (fix && incompleteTransactions.some((transaction) => transaction.status === "COMMITTING")) {
    const recovered = await recoverIncompleteTransactions(target);
    for (const transaction of recovered) {
      findings.push(finding(
        transaction.status === "ROLLED_BACK" ? "TRANSACTION_RECOVERED" : "E_TRANSACTION_RECOVERY_FAILED",
        transaction.status === "ROLLED_BACK" ? "info" : "error",
        `.forgeloop/.txn/${transaction.transactionId}`,
        `Transaction recovery result: ${transaction.status}.`,
      ));
    }
    incompleteTransactions = await findIncompleteTransactions(target);
  }
  for (const transaction of incompleteTransactions) {
    findings.push(finding(
      "E_TRANSACTION_INCOMPLETE",
      "error",
      `.forgeloop/.txn/${transaction.transactionId}`,
      `Transaction ${transaction.transactionId} is ${transaction.status} and requires inspection or deterministic recovery.`,
      "Run forgeloop doctor --fix only after ensuring no active process owns the task lock.",
    ));
  }
  let manifest = null;
  let manifestChanged = false;
  try {
    manifest = await readManifest(target);
    if (!manifest) {
      findings.push(finding("manifest-missing", "error", ".forgeloop/manifest.json", "Run forgeloop init first."));
    }
  } catch (error) {
    findings.push(finding("manifest-invalid", "error", ".forgeloop/manifest.json", error.message));
  }

  manifest = await adoptAdapters({ target, manifest, adoptPaths, findings });
  const entries = await readTemplateEntries(packageRoot);
  const layoutVersion = manifest?.layoutVersion ?? 1;
  if (manifest && layoutVersion < LAYOUT_VERSION) {
    findings.push(finding(
      "legacy-layout",
      "info",
      ".forgeloop/manifest.json",
      "Target uses the legacy root template layout; run forgeloop update to migrate the canonical kit under .forgeloop/kit.",
    ));
  }
  for (const entry of entries) {
    const managedPath = layoutVersion >= LAYOUT_VERSION ? entry.relativePath : entry.legacyRelativePath;
    const destination = ensureWithin(target, managedPath);
    try {
      await assertSafePath(target, managedPath);
    } catch (error) {
      findings.push(finding("unsafe-path", "error", managedPath, error.message));
      continue;
    }
    const hasLegacyAlternative = layoutVersion >= LAYOUT_VERSION
      && entry.legacyRelativePath !== entry.relativePath;
    if (layoutVersion < LAYOUT_VERSION && entry.legacyRelativePath !== entry.relativePath) {
      const hiddenDestination = ensureWithin(target, entry.relativePath);
      try {
        await assertSafePath(target, entry.relativePath);
        if (await fileExists(hiddenDestination)) {
          findings.push(finding(
            "E_MIGRATION_INCOMPLETE",
            "error",
            entry.relativePath,
            "A hidden migration destination exists while the legacy manifest is still authoritative; rerun forgeloop update to recover the transaction.",
            "Run forgeloop update and inspect the result before changing either copy.",
          ));
        }
      } catch (error) {
        findings.push(finding("unsafe-path", "error", entry.relativePath, error.message));
      }
    }
    if (hasLegacyAlternative) {
      try {
        await assertSafePath(target, entry.legacyRelativePath);
      } catch (error) {
        findings.push(finding("unsafe-path", "error", entry.legacyRelativePath, error.message));
        continue;
      }
    }
    if (!(await fileExists(destination))) {
      const legacyDestination = hasLegacyAlternative
        ? ensureWithin(target, entry.legacyRelativePath)
        : null;
      if (legacyDestination && await fileExists(legacyDestination)) {
        findings.push(finding(
          "E_MIGRATION_INCOMPLETE",
          "error",
          entry.legacyRelativePath,
          "Canonical file remains in the legacy root layout; migration is incomplete and the legacy copy was preserved.",
          "Run forgeloop update; it removes the root copy only when the recorded ownership hash still matches.",
        ));
        continue;
      }
      if (fix && manifest && (layoutVersion >= LAYOUT_VERSION || managedPath.startsWith(".forgeloop/"))) {
        await writeFileAtomic(destination, entry.bytes);
        manifest.files[managedPath] = {
          sha256: sha256(entry.bytes),
          preserve: entry.sourcePath === "PROJECT_PROFILE.md",
        };
        manifestChanged = true;
        findings.push(finding("file-restored", "info", managedPath, "Restored missing managed template file.", "No action required."));
        continue;
      }
      findings.push(finding("file-missing", "error", managedPath, "Managed file is missing."));
      continue;
    }

    const destinationBytes = await readBytes(destination);
    if (entry.sourcePath === "PROJECT_PROFILE.md") {
      const mode = readProfileMode(destinationBytes);
      if (mode === "template") {
        findings.push(finding("profile-template", "info", managedPath, "Initialize profile-mode as project after confirming real project facts."));
      }
    }

    const legacyPath = hasLegacyAlternative
      ? ensureWithin(target, entry.legacyRelativePath)
      : null;
    if (entry.sourcePath === "PROJECT_PROFILE.md" && legacyPath && await fileExists(legacyPath)) {
      findings.push(finding(
        "E_DUPLICATE_PROFILE_SOURCE",
        "error",
        entry.legacyRelativePath,
        "Both legacy root and hidden-kit project profiles exist; keep only the hidden profile as canonical.",
        "Remove the legacy root profile after verifying its bytes are represented in .forgeloop/kit/PROJECT_PROFILE.md.",
      ));
    }

    const record = manifest?.files?.[managedPath];
    if (!record) {
      if (ADAPTER_PATHS.has(managedPath)) {
        findings.push(
          finding(
            "unmanaged-file",
            "error",
            managedPath,
            "Existing adapter is not managed by ForgeLoop; merge the loop reference and rerun doctor.",
          ),
        );
      }
      continue;
    }
    const actualHash = sha256(destinationBytes);
    if (actualHash !== record.sha256 && !record.preserve) {
      findings.push(finding("file-drift", "warning", managedPath, "File differs from the last managed version; update will preserve it."));
    }
    if (hasLegacyAlternative) {
      if (await fileExists(legacyPath)) {
        if (entry.sourcePath !== "PROJECT_PROFILE.md") {
          findings.push(finding(
            "E_MIGRATION_INCOMPLETE",
            "error",
            entry.legacyRelativePath,
            record.legacySha256
              ? "A legacy root copy remains after the manifest authority switch; cleanup is incomplete."
              : "A legacy root copy remains without an ownership proof; it was preserved.",
            "Run forgeloop update; modified or unowned legacy files require manual review and are never deleted silently.",
          ));
        }
        if (entry.sourcePath === "PROJECT_PROFILE.md") {
          findings.push(finding(
            "E_MIGRATION_INCOMPLETE",
            "error",
            entry.legacyRelativePath,
            record.legacySha256
              ? "The legacy project profile remains after the manifest authority switch; cleanup is incomplete."
              : "A legacy project profile remains alongside the hidden canonical profile.",
            "Run forgeloop update, then remove the root profile only after verifying ownership and preserved bytes.",
          ));
        }
      }
    }
    if (layoutVersion >= LAYOUT_VERSION && ADAPTER_PATHS.has(managedPath)) {
      await inspectManagedNativeAdapter({
        target,
        relativePath: managedPath,
        bytes: destinationBytes,
        record,
        findings,
      });
    }
  }

  const shippedPaths = new Set(entries.map((entry) => layoutVersion >= LAYOUT_VERSION ? entry.relativePath : entry.legacyRelativePath));
  for (const relativePath of Object.keys(manifest?.files ?? {})) {
    if (!shippedPaths.has(relativePath)) {
      findings.push(
        finding(
          "manifest-orphan",
          "warning",
          relativePath,
          "Manifest entry no longer corresponds to a shipped template.",
        ),
      );
    }
  }

  if (manifestChanged && manifest) {
    await writeManifest(target, manifest);
  }

  const repositoryIndexResult = await inspectRepositoryIndexForDoctor({
    target,
    packageRoot,
    repositoryIndex,
    repositoryIndexOptions,
    findings,
  });

  const ok = findings.every((item) => item.severity !== "error")
    && (!strict || findings.every((item) => item.severity !== "warning"));
  return {
    ok,
    findings,
    repositoryIndex: repositoryIndexResult,
    evidence: [createEvidence({
      kind: "OBSERVED",
      source: "ForgeLoop doctor",
      result: `${findings.length} findings; ${ok ? "healthy" : "needs attention"}`,
    })],
  };
}
