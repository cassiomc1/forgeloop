import { readdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { resolveAttestationBundlePath } from "./attachment-paths.js";
import { withOperationalAttachmentFile } from "../storage/operational-attachments.js";
import { getOperationalStore, operationalArtifactExists, listOperationalArtifactNames } from "../storage/operational-context.js";

import { ARTIFACT_PATHS, canonicalFingerprint, readJsonArtifact, readPortableJsonArtifact, writePortableJsonArtifact } from "./artifacts.js";
import { validateContract } from "./contract.js";
import { assertSafePath, ensureWithin, fileExists, readBytes, writeFileAtomic } from "./filesystem.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { validateChecksExecutionProvenance } from "./completion-artifacts.js";
import { readExecutionArtifact } from "./execution.js";
import { assertContinuitySemantics } from "./continuity.js";
import { validateEventLedger } from "./events.js";
import { taskArtifactPath, taskDirectory, taskStructuralQualityDirectory } from "./task-paths.js";
import { resolveTaskClaimState } from "./task-claim-state.js";
import { E_TASK_CLAIM_OWNERSHIP_INCONSISTENT } from "./error-codes.js";
import { listActions } from "./actions.js";
import { validateActionArtifact } from "./action-model.js";
import { validateCanonicalHandoff } from "./handoff.js";
import { validateVerificationScope } from "./verification-scope.js";
import { validateResponsibilityContract } from "./responsibility.js";
import { validateWorkspaceBinding } from "./workspace-binding.js";
import { validateCodeManifest, validateCodeManifestBindings } from "./code-manifest.js";
import { withNativeReadScope } from "./native-storage.js";
import { assertAttestationStatementBindings } from "./attestation-verifier.js";
import { validateAttestationStatement } from "./attestation.js";
import {
  listStructuralQualityEvaluations,
  readStructuralQualityBaseline,
  validateStructuralQualityArtifact,
  validateStructuralQualityBindings,
} from "./structural-quality/artifacts.js";
import { normalizeStructuralQualityConfig, structuralQualityPolicyFingerprint } from "./structural-quality/policy.js";

export const BUNDLE_SCHEMA_VERSION = 2;

async function bundleFileBinding(target, relativePath, name) {
  if (typeof name !== "string" || name.includes("\\") || name.includes("\u0000") || name.split("/").some(part => !part || part === "." || part === "..")) throw Object.assign(new Error("Invalid portable bundle artifact path"), { code: "E_BUNDLE_PATH_INVALID" });
  const filename = await assertSafePath(target, relativePath);
  const hash = createHash("sha256");
  let size = 0;
  for await (const bytes of createReadStream(filename)) { hash.update(bytes); size += bytes.length; }
  return { path: name, size, sha256: hash.digest("hex") };
}
const BUNDLE_ROOT = ".forgeloop/tasks";

function safeTaskId(taskId) {
  if (typeof taskId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(taskId)) {
    const error = new Error(`Invalid task ID for bundle: ${taskId}`);
    error.code = "E_BUNDLE_PATH_INVALID";
    throw error;
  }
  return taskId;
}

function bundleDirectory(taskId) {
  return `${BUNDLE_ROOT}/${safeTaskId(taskId)}`;
}

function bundleBindingError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function structuralQualityBundleKind(artifact) {
  if (artifact === "structural-quality/baseline.json") return "baseline";
  if (/^structural-quality\/evaluations\/cycle-\d+-attempt-\d+\.json$/u.test(artifact)) return "evaluation";
  if (artifact.startsWith("structural-quality/")) {
    throw bundleBindingError("E_BUNDLE_PATH_INVALID", `Unknown structural-quality bundle artifact: ${artifact}`);
  }
  return null;
}

function bundleQualityReference(reference, taskId) {
  if (typeof reference !== "string" || reference.trim() === "") {
    throw bundleBindingError("E_STRUCTURAL_QUALITY_EVIDENCE_STALE", "Structural-quality check has no artifact reference");
  }
  const normalized = reference.replaceAll("\\", "/");
  const sourceRoot = taskStructuralQualityDirectory(taskId).replaceAll("\\", "/");
  const suffix = normalized.startsWith(`${sourceRoot}/`)
    ? normalized.slice(sourceRoot.length + 1)
    : normalized.startsWith("structural-quality/")
      ? normalized.slice("structural-quality/".length)
      : null;
  if (!suffix || !(suffix === "baseline.json" || /^evaluations\/cycle-\d+-attempt-\d+\.json$/u.test(suffix))) {
    throw bundleBindingError("E_STRUCTURAL_QUALITY_EVIDENCE_STALE", "Structural-quality artifact reference escapes its task quality directory");
  }
  return `structural-quality/${suffix}`;
}

function structuralQualityCheckProjection(value) {
  if (value.status === "PASS") return { status: "passed", evidenceKind: "OBSERVED" };
  if (value.status === "FAIL") return { status: "failed", evidenceKind: "OBSERVED" };
  if (value.status === "BLOCKED") return { status: "blocked", evidenceKind: "BLOCKED" };
  return { status: "not-run", evidenceKind: "NOT_VERIFIED" };
}

function assertStructuralQualityBundleEvidence({ loaded, manifest, taskId }) {
  const quality = loaded.structuralQuality;
  if (!quality) return;
  const baseline = quality.baseline;
  const evaluations = quality.evaluations ?? [];
  const qualityArtifacts = new Map();
  if (baseline) qualityArtifacts.set("structural-quality/baseline.json", baseline);
  for (const evaluation of evaluations) {
    const name = `structural-quality/evaluations/cycle-${evaluation.verificationCycle}-attempt-${evaluation.attempt}.json`;
    qualityArtifacts.set(name, evaluation);
  }
  for (const value of [baseline, ...evaluations].filter(Boolean)) {
    if (value.taskId !== taskId) throw bundleBindingError("E_BUNDLE_TASK_MISMATCH", "Structural-quality artifact taskId does not match its bundle task");
    const bindingErrors = validateStructuralQualityBindings(value);
    if (bindingErrors.length > 0) throw bundleBindingError(bindingErrors[0].code, bindingErrors[0].message);
  }
  const baselineFingerprint = baseline ? canonicalFingerprint(baseline) : null;
  const bundledConfig = loaded.config?.structuralQuality;
  let policy = null;
  if (bundledConfig) policy = normalizeStructuralQualityConfig(bundledConfig);
  const expectedContractFingerprint = loaded.contract ? canonicalFingerprint(loaded.contract) : null;
  const expectedRouteFingerprint = loaded.route ? canonicalFingerprint(loaded.route) : null;
  for (const value of [baseline, ...evaluations].filter(Boolean)) {
    if (baselineFingerprint && value.role === "EVALUATION" && value.bindings?.baselineFingerprint !== baselineFingerprint) {
      throw bundleBindingError("E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH", "Structural-quality evaluation does not bind the bundled baseline");
    }
    if (policy && value.bindings?.policyFingerprint !== structuralQualityPolicyFingerprint(policy)) {
      throw bundleBindingError("E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH", "Structural-quality artifact policy binding does not match bundled configuration");
    }
    if (expectedContractFingerprint && value.bindings?.contractFingerprint !== expectedContractFingerprint) {
      throw bundleBindingError("E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH", "Structural-quality contract binding does not match the bundled contract");
    }
    if (expectedRouteFingerprint && value.bindings?.routeFingerprint !== expectedRouteFingerprint) {
      throw bundleBindingError("E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH", "Structural-quality route binding does not match the bundled route");
    }
  }
  const checks = [
    ...(loaded.state?.checks ?? []),
    ...(loaded.receipt?.checks ?? []),
  ].filter((check) => check?.kind === "structural-quality");
  for (const check of checks) {
    const bundleReference = bundleQualityReference(check.details?.artifactRef, taskId);
    const value = qualityArtifacts.get(bundleReference);
    if (!value) throw bundleBindingError("E_STRUCTURAL_QUALITY_EVIDENCE_STALE", `Bundled structural-quality check references missing ${bundleReference}`);
    if (check.details?.artifactFingerprint !== canonicalFingerprint(value)) {
      throw bundleBindingError("E_STRUCTURAL_QUALITY_EVIDENCE_STALE", `Bundled structural-quality check fingerprint does not match ${bundleReference}`);
    }
    const expected = structuralQualityCheckProjection(value);
    if (check.status !== expected.status || check.evidenceKind !== expected.evidenceKind) {
      throw bundleBindingError("E_STRUCTURAL_QUALITY_EVIDENCE_STALE", `Bundled structural-quality check does not match ${bundleReference}`);
    }
  }
  for (const artifact of manifest.artifacts.filter((item) => item.startsWith("structural-quality/"))) {
    if (!qualityArtifacts.has(artifact)) throw bundleBindingError("E_STRUCTURAL_QUALITY_EVIDENCE_STALE", `Bundled structural-quality manifest entry was not loaded: ${artifact}`);
  }
}

function assertBundledCodeManifestBindings({ loaded, ledger, taskId }) {
  const manifest = loaded.codeManifest;
  if (!manifest) return;
  const comparisons = [
    ["taskId", manifest.taskId, taskId, "E_BUNDLE_TASK_MISMATCH"],
    ["contractFingerprint", manifest.bindings.contractFingerprint, loaded.contract ? canonicalFingerprint(loaded.contract) : null, "E_ATTESTATION_CONTRACT_MISMATCH"],
    ["routeFingerprint", manifest.bindings.routeFingerprint, loaded.route ? canonicalFingerprint(loaded.route) : null, "E_ATTESTATION_ROUTE_MISMATCH"],
    ["stateFingerprint", manifest.bindings.stateFingerprint, loaded.state ? canonicalFingerprint(loaded.state) : null, "E_ATTESTATION_STATE_MISMATCH"],
    ["receiptFingerprint", manifest.bindings.receiptFingerprint, loaded.receipt ? canonicalFingerprint(loaded.receipt) : null, "E_ATTESTATION_RECEIPT_MISMATCH"],
  ];
  for (const [name, expected, actual, code] of comparisons) {
    if (expected !== actual) throw bundleBindingError(code, `Bundled code manifest binding does not match ${name}`);
  }
  if (!ledger?.valid) {
    throw bundleBindingError("E_ATTESTATION_LEDGER_MISMATCH", "A valid bundled event ledger is required by the code manifest");
  }
  const completion = ledger.events.findLast((event) => event.taskId === taskId && event.event === "COMPLETION_VALIDATED");
  if (!completion || completion.seq !== manifest.bindings.ledgerSeq || completion.hash !== manifest.bindings.ledgerHash) {
    throw bundleBindingError("E_ATTESTATION_LEDGER_MISMATCH", "Bundled code manifest does not match the COMPLETION_VALIDATED ledger checkpoint");
  }
}

/** Export sources may be explicit legacy inputs; selected native authority never falls back. */
function readBundleSourceJson(target,sourcePath,schemaName,packageRoot){
 const reader=getOperationalStore(target)?readJsonArtifact:readPortableJsonArtifact;
 return reader(target,sourcePath,schemaName,packageRoot);
}

/** Read-only legacy export inspection; operational action listing remains SQLite-only. */
async function readBundleSourceActions(target,taskId,packageRoot){
 if(getOperationalStore(target))return listActions(target,{taskId,packageRoot});
 const directory=`${taskDirectory(taskId)}/actions`;
 const absolute=await assertSafePath(target,directory);
 if(!(await fileExists(absolute)))return [];
 const actions=[];
 for(const name of (await readdir(absolute)).filter(name=>name.endsWith(".json")).sort()){
  const artifact=await readPortableJsonArtifact(target,`${directory}/${name}`,"action",packageRoot);
  const action=validateActionArtifact(artifact.value);
  if(action.taskId!==taskId || `${action.actionId}.json`!==name)throw bundleBindingError("E_BUNDLE_TASK_MISMATCH","Legacy export action identity differs from its source path");
  actions.push(action);
 }
 return actions.sort((left,right)=>String(left.createdAt).localeCompare(String(right.createdAt)));
}

async function copyJson(target, sourcePath, destinationPath, schemaName, packageRoot, artifacts, relativeName) {
  try {
    const value = await readBundleSourceJson(target, sourcePath, schemaName, packageRoot);
    await writePortableJsonArtifact(target, destinationPath, value.value, schemaName, packageRoot);
    artifacts.push(relativeName);
    return value;
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING") return null;
    throw error;
  }
}

async function copyOptionalJson(target, taskPath, legacyPath, destinationPath, schemaName, packageRoot, artifacts, relativeName) {
  const candidates = [taskPath, legacyPath].filter(Boolean);
  for (const sourcePath of candidates) {
    if (getOperationalStore(target) && sourcePath === legacyPath) continue;
    if (!(operationalArtifactExists(target, sourcePath) ?? await fileExists(ensureWithin(target, sourcePath)))) continue;
    return copyJson(target, sourcePath, destinationPath, schemaName, packageRoot, artifacts, relativeName);
  }
  return null;
}

async function copyRawFile(target, sourcePath, destinationPath, artifacts, relativeName, taskId) {
  const canonical = getOperationalStore(target) && sourcePath.startsWith(".forgeloop/attachments/objects/");
  if (!canonical && !(await fileExists(ensureWithin(target, sourcePath)))) return false;
  await assertSafePath(target, sourcePath);
  const destination = await assertSafePath(target, destinationPath);
  await withOperationalAttachmentFile(target, sourcePath, taskId, source => writeFileAtomic(destination, createReadStream(source)));
  artifacts.push(relativeName);
  return true;
}

async function tryReadJson(target, taskPath, legacyPath, schemaName, packageRoot) {
  try {
    return await readBundleSourceJson(target, taskPath, schemaName, packageRoot);
  } catch (error) {
    if (error.code === "ARTIFACT_MISSING" && legacyPath && !getOperationalStore(target)) {
      return await readBundleSourceJson(target, legacyPath, schemaName, packageRoot);
    }
    throw error;
  }
}

export async function exportTaskBundle(target, taskId, packageRoot) {
  return withNativeReadScope(target, async () => {
    const store = getOperationalStore(target);
    if (!store) return exportSelectedTaskBundle(target, taskId, packageRoot);
    const [{ withStorageSnapshot }, { withOperationalStore }, { operationalContext }] = await Promise.all([
      import("../storage/snapshot.js"), import("../storage/unit-of-work.js"), import("../storage/operational-context.js"),
    ]);
    return withStorageSnapshot(store.db, snapshot => operationalContext.run(null,
      () => withOperationalStore({ db: snapshot, target }, () => exportSelectedTaskBundle(target, taskId, packageRoot))));
  });
}

async function exportSelectedTaskBundle(target, taskId, packageRoot) {
  safeTaskId(taskId);
  const directory = bundleDirectory(taskId);
  const artifacts = [];

  if (operationalArtifactExists(target, taskArtifactPath(taskId, "descriptor")) ?? await fileExists(ensureWithin(target, taskArtifactPath(taskId, "descriptor")))) {
    const claimProjection = await resolveTaskClaimState(target, { taskId, packageRoot });
    if (!claimProjection.valid) {
      const error = new Error(`Task ${taskId} claim ownership is inconsistent and cannot be exported safely`);
      error.code = E_TASK_CLAIM_OWNERSHIP_INCONSISTENT;
      error.reasonCodes = claimProjection.reasonCodes;
      error.errors = claimProjection.ownershipErrors;
      throw error;
    }
  }

  const stateSource = await tryReadJson(target, taskArtifactPath(taskId, "state"), ARTIFACT_PATHS.state, "work-state", packageRoot);
  let receiptSource = null;
  try {
    receiptSource = await tryReadJson(target, taskArtifactPath(taskId, "receipt"), ARTIFACT_PATHS.receipt, "execution-receipt", packageRoot);
  } catch (error) {
    if (error.code !== "ARTIFACT_MISSING") throw error;
  }

  await validateChecksExecutionProvenance(stateSource.value.checks, {
    target,
    packageRoot,
    taskId,
    artifactPath: ARTIFACT_PATHS.state,
  });
  if (receiptSource?.value?.checks) {
    await validateChecksExecutionProvenance(receiptSource.value.checks, {
      target,
      packageRoot,
      taskId,
      artifactPath: ARTIFACT_PATHS.receipt,
    });
  }

  const required = [
    [taskArtifactPath(taskId, "contract"), ARTIFACT_PATHS.contract, "contract.json", "current-contract"],
    [taskArtifactPath(taskId, "route"), ARTIFACT_PATHS.route, "route.json", "routing-result"],
    [taskArtifactPath(taskId, "state"), ARTIFACT_PATHS.state, "state.json", "work-state"],
  ];
  for (const [taskRel, legacyRel, destinationName, schemaName] of required) {
    const source = await tryReadJson(target, taskRel, legacyRel, schemaName, packageRoot);
    if (schemaName === "current-contract") {
      await validateContract(source.value, packageRoot);
    }
    if (source.value.taskId !== undefined && source.value.taskId !== taskId) {
      const error = new Error(`${taskRel} belongs to ${source.value.taskId}, not ${taskId}`);
      error.code = "E_BUNDLE_TASK_MISMATCH";
      throw error;
    }
    await writePortableJsonArtifact(target, `${directory}/${destinationName}`, source.value, schemaName, packageRoot);
    artifacts.push(destinationName);
  }

  const optional = [
    [taskArtifactPath(taskId, "preflight"), ARTIFACT_PATHS.preflight, "preflight.json", "preflight"],
    [taskArtifactPath(taskId, "receipt"), ARTIFACT_PATHS.receipt, "receipt.json", "execution-receipt"],
    [taskArtifactPath(taskId, "descriptor"), null, "task.json", "task-descriptor"],
    [ARTIFACT_PATHS.sources, null, "sources.json", "source-registry"],
    [ARTIFACT_PATHS.config, null, "config.json", "config"],
    [taskArtifactPath(taskId, "continuity"), ARTIFACT_PATHS.continuity, "continuity.json", "continuity"],
    [taskArtifactPath(taskId, "recovery"), null, "recovery.json", "task-recovery"],
    [taskArtifactPath(taskId, "workspaceBinding"), null, "workspace-binding.json", "workspace-binding"],
    [taskArtifactPath(taskId, "responsibility"), null, "responsibility.json", "responsibility"],
    [taskArtifactPath(taskId, "verificationScope"), null, "verification-scope.json", "verification-scope"],
    [taskArtifactPath(taskId, "attestations") + "/code-manifest.json", null, "attestations/code-manifest.json", "code-manifest"],
    [taskArtifactPath(taskId, "attestations") + "/statement.json", null, "attestations/statement.json", "in-toto-statement"],
  ];
  let exportedWorkspaceBinding = null;
  let exportedResponsibility = null;
  let exportedVerificationScope = null;
  let exportedManifest = null;
  let exportedStatement = null;
  for (const [taskRel, legacyRel, destinationName, schemaName] of optional) {
    const copied = await copyOptionalJson(target, taskRel, legacyRel, `${directory}/${destinationName}`, schemaName, packageRoot, artifacts, destinationName);
    if (copied && !artifacts.includes(destinationName)) artifacts.push(destinationName);
    if (destinationName === "attestations/code-manifest.json") exportedManifest = copied;
    if (destinationName === "attestations/statement.json") exportedStatement = copied;
    if (destinationName === "workspace-binding.json") exportedWorkspaceBinding = copied;
    if (destinationName === "responsibility.json") exportedResponsibility = copied;
    if (destinationName === "verification-scope.json") exportedVerificationScope = copied;
  }

  // Structural-quality evidence is provider output made portable by
  // ForgeLoop. Copy typed artifacts rather than raw process output, and keep
  // every immutable evaluation so an audit can inspect the complete attempt
  // history without rescanning the project.
  const qualityBaseline = await readStructuralQualityBaseline(target, taskId, packageRoot);
  const qualityEvaluations = await listStructuralQualityEvaluations(target, taskId, packageRoot);
  if (qualityBaseline) {
    await writePortableJsonArtifact(target, `${directory}/structural-quality/baseline.json`, qualityBaseline.value, "structural-quality", packageRoot);
    artifacts.push("structural-quality/baseline.json");
  }
  for (const evaluation of qualityEvaluations) {
    const destination = `structural-quality/evaluations/cycle-${evaluation.value.verificationCycle}-attempt-${evaluation.value.attempt}.json`;
    await writePortableJsonArtifact(target, `${directory}/${destination}`, evaluation.value, "structural-quality", packageRoot);
    artifacts.push(destination);
  }

  if (exportedWorkspaceBinding?.value) {
    exportedWorkspaceBinding.value = await validateWorkspaceBinding(exportedWorkspaceBinding.value, packageRoot);
    if (exportedWorkspaceBinding.value.taskId !== taskId) {
      const error = new Error("Workspace binding taskId does not match its bundle task");
      error.code = "E_BUNDLE_TASK_MISMATCH";
      throw error;
    }
  }
  if (exportedResponsibility?.value) {
    exportedResponsibility.value = await validateResponsibilityContract(exportedResponsibility.value, packageRoot);
    if (exportedResponsibility.value.taskId !== taskId) {
      const error = new Error("Responsibility taskId does not match its bundle task");
      error.code = "E_BUNDLE_TASK_MISMATCH";
      throw error;
    }
  }
  if (exportedVerificationScope?.value) {
    exportedVerificationScope.value = await validateVerificationScope(exportedVerificationScope.value, packageRoot);
    if (exportedVerificationScope.value.taskId !== taskId) {
      const error = new Error("Verification scope taskId does not match its bundle task");
      error.code = "E_BUNDLE_TASK_MISMATCH";
      throw error;
    }
  }

  const handoffDirectory = taskArtifactPath(taskId, "handoffs");
  const selectedHandoffs = listOperationalArtifactNames(target, taskId, "handoffs");
  if (selectedHandoffs !== null || await fileExists(ensureWithin(target, handoffDirectory))) {
    const handoffEntries = selectedHandoffs !== null ? selectedHandoffs.map(name => ({ name, isFile: () => true })) : await readdir(ensureWithin(target, handoffDirectory), { withFileTypes: true });
    for (const entry of handoffEntries
      .filter((item) => item.isFile() && /^handoff-[A-Za-z0-9_-]+\.json$/u.test(item.name))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const sourcePath = `${handoffDirectory}/${entry.name}`;
      const handoff = await readBundleSourceJson(target, sourcePath, "handoff-envelope", packageRoot);
      await validateCanonicalHandoff(target, handoff.value, { taskId, packageRoot });
      const destination = `handoffs/${entry.name}`;
      await writePortableJsonArtifact(target, `${directory}/${destination}`, handoff.value, "handoff-envelope", packageRoot);
      artifacts.push(destination);
    }
  }

  const rawAttestationBundle = resolveAttestationBundlePath(target, taskId);
  await copyRawFile(target, rawAttestationBundle, `${directory}/attestations/statement.sigstore.json`, artifacts, "attestations/statement.sigstore.json", taskId);
  if (exportedManifest?.value) {
    exportedManifest.value = await validateCodeManifest(exportedManifest.value, packageRoot);
    if (exportedManifest.value.taskId !== taskId) {
      const error = new Error("Code manifest taskId does not match its bundle task");
      error.code = "E_BUNDLE_TASK_MISMATCH";
      throw error;
    }
    await validateCodeManifestBindings({ target, packageRoot, taskId, manifest: exportedManifest.value });
  }
  if (exportedStatement?.value) {
    await validateAttestationStatement(exportedStatement.value, packageRoot);
    if (exportedStatement.value.predicate.task.taskId !== taskId) {
      const error = new Error("Attestation statement taskId does not match its bundle task");
      error.code = "E_BUNDLE_TASK_MISMATCH";
      throw error;
    }
  }
  if (exportedManifest?.value && exportedStatement?.value) {
    assertAttestationStatementBindings(exportedStatement.value, exportedManifest.value, taskId, canonicalFingerprint(exportedManifest.value));
  }
  const actionArtifacts = await readBundleSourceActions(target,taskId,packageRoot);
  for (const action of actionArtifacts) {
    const destination = `${directory}/actions/${action.actionId}.json`;
    await writePortableJsonArtifact(target, destination, action, "action", packageRoot);
    artifacts.push(`actions/${action.actionId}.json`);
  }

  const executionRefs = [...new Set([
    ...(stateSource.value.checks ?? []),
    ...(receiptSource?.value?.checks ?? []),
  ].map((check) => check?.executionRef).filter(Boolean))].sort();
  for (const executionRef of executionRefs) {
    const execution = await readExecutionArtifact({ target, executionRef, packageRoot, taskId });
    const destination = `${directory}/executions/${execution.value.executionId}.json`;
    await writePortableJsonArtifact(target, destination, execution.value, "execution", packageRoot);
    artifacts.push(`executions/${execution.value.executionId}.json`);
  }

  await exportBundleLedgerAndGates(target, taskId, packageRoot, directory, artifacts);

  artifacts.sort();
  const manifest = {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    taskId,
    artifacts,
    files: [],
  };
  for (const artifact of artifacts) manifest.files.push(await bundleFileBinding(target, `${directory}/${artifact}`, artifact));
  await writePortableJsonArtifact(target, `${directory}/bundle.json`, manifest, "task-bundle", packageRoot);
  return { ...manifest, path: `${directory}/bundle.json` };
}

export async function readTaskBundle(target, taskId, packageRoot) {
  const directory = bundleDirectory(taskId);
  const manifest = await readJsonArtifact(target, `${directory}/bundle.json`, "task-bundle", packageRoot);
  await verifyBundleFileBindings(target, directory, manifest);
  const loaded = {};
  const mappings = {
    "contract.json": ["contract", "current-contract"],
    "route.json": ["route", "routing-result"],
    "state.json": ["state", "work-state"],
    "preflight.json": ["preflight", "preflight"],
    "receipt.json": ["receipt", "execution-receipt"],
    "sources.json": ["sources", "source-registry"],
    "config.json": ["config", "config"],
    "continuity.json": ["continuity", "continuity"],
    "task.json": ["descriptor", "task-descriptor"],
    "recovery.json": ["recovery", "task-recovery"],
    "workspace-binding.json": ["workspaceBinding", "workspace-binding"],
    "responsibility.json": ["responsibility", "responsibility"],
    "verification-scope.json": ["verificationScope", "verification-scope"],
    "attestations/code-manifest.json": ["codeManifest", "code-manifest"],
    "attestations/statement.json": ["attestationStatement", "in-toto-statement"],
    ...Object.fromEntries(manifest.value.artifacts.filter((artifact) => artifact.startsWith("actions/")).map((artifact) => [artifact, ["action", "action"]])),
  };
  const executions = {};
  for (const artifact of manifest.value.artifacts) {
    const qualityKind = structuralQualityBundleKind(artifact);
    if (qualityKind) {
      await loadBundleQualityArtifact(target, directory, artifact, packageRoot, taskId, loaded, qualityKind);
      continue;
    }
    if (artifact.startsWith("executions/") && artifact.endsWith(".json")) {
      const execution = await readJsonArtifact(target, `${directory}/${artifact}`, "execution", packageRoot);
      executions[execution.value.executionId] = execution.value;
      continue;
    }
    if (artifact.startsWith("actions/") && artifact.endsWith(".json")) {
      const action = await readJsonArtifact(target, `${directory}/${artifact}`, "action", packageRoot);
      loaded.actions ??= {};
      loaded.actions[action.value.actionId] = action.value;
      continue;
    }
    if (artifact.startsWith("handoffs/") && artifact.endsWith(".json")) {
      const handoff = await readJsonArtifact(target, `${directory}/${artifact}`, "handoff-envelope", packageRoot);
      await validateCanonicalHandoff(target, handoff.value, { taskId, packageRoot });
      loaded.handoffs ??= [];
      loaded.handoffs.push(handoff.value);
      continue;
    }
    if (artifact === "attestations/statement.sigstore.json") {
      const raw = await readBytes(ensureWithin(target, `${directory}/${artifact}`));
      try {
        loaded.attestationBundle = JSON.parse(raw.toString("utf8"));
      } catch (error) {
        const invalid = new Error(`Attestation signature bundle is not valid JSON: ${error.message}`);
        invalid.code = "E_ATTESTATION_SIGNATURE_INVALID";
        throw invalid;
      }
      continue;
    }
    const mapping = mappings[artifact];
    if (!mapping) continue;
    const loadedArtifact = await readJsonArtifact(target, `${directory}/${artifact}`, mapping[1], packageRoot);
    if (mapping[1] === "current-contract") {
      await validateContract(loadedArtifact.value, packageRoot);
    }
    if (mapping[1] === "continuity") {
      assertContinuitySemantics(loadedArtifact.value);
      if (loadedArtifact.value.taskId !== taskId) {
        throw bundleBindingError("E_BUNDLE_TASK_MISMATCH", "Continuity taskId does not match its bundle task");
      }
    }
    if (mapping[1] === "workspace-binding" && loadedArtifact.value.taskId !== taskId) {
      const error = new Error("Workspace binding taskId does not match its bundle task");
      error.code = "E_BUNDLE_TASK_MISMATCH";
      throw error;
    }
    if (mapping[1] === "workspace-binding") {
      loadedArtifact.value = await validateWorkspaceBinding(loadedArtifact.value, packageRoot);
    }
    if (mapping[1] === "responsibility") {
      loadedArtifact.value = await validateResponsibilityContract(loadedArtifact.value, packageRoot);
      if (loadedArtifact.value.taskId !== taskId) {
        const error = new Error("Responsibility taskId does not match its bundle task");
        error.code = "E_BUNDLE_TASK_MISMATCH";
        throw error;
      }
    }
    if (mapping[1] === "verification-scope") {
      loadedArtifact.value = await validateVerificationScope(loadedArtifact.value, packageRoot);
      if (loadedArtifact.value.taskId !== taskId) {
        const error = new Error("Verification scope taskId does not match its bundle task");
        error.code = "E_BUNDLE_TASK_MISMATCH";
        throw error;
      }
    }
    if (mapping[1] === "code-manifest") {
      loadedArtifact.value = await validateCodeManifest(loadedArtifact.value, packageRoot);
      if (loadedArtifact.value.taskId !== taskId) {
        const error = new Error("Code manifest taskId does not match its bundle task");
        error.code = "E_BUNDLE_TASK_MISMATCH";
        throw error;
      }
    }
    if (mapping[1] === "in-toto-statement") {
      await validateAttestationStatement(loadedArtifact.value, packageRoot);
      if (loadedArtifact.value.predicate.task.taskId !== taskId) {
        const error = new Error("Attestation statement taskId does not match its bundle task");
        error.code = "E_BUNDLE_TASK_MISMATCH";
        throw error;
      }
    }
    loaded[mapping[0]] = loadedArtifact.value;
  }
  if (loaded.structuralQuality) {
    loaded.structuralQuality.evaluations.sort((left, right) => left.verificationCycle - right.verificationCycle || left.attempt - right.attempt);
    assertStructuralQualityBundleEvidence({ loaded, manifest: manifest.value, taskId });
  }
  const bundledLedger = loaded.codeManifest && manifest.value.artifacts.includes("events.ndjson")
    ? await validateEventLedger(target, packageRoot, { taskId, eventsPath: `${directory}/events.ndjson` })
    : null;
  assertBundledCodeManifestBindings({ loaded, ledger: bundledLedger, taskId });
  if (loaded.attestationStatement && !loaded.codeManifest) {
    throw bundleBindingError("E_ATTESTATION_MANIFEST_MISSING", "A bundled attestation statement requires its code manifest");
  }
  if (loaded.codeManifest && loaded.attestationStatement) {
    assertAttestationStatementBindings(
      loaded.attestationStatement,
      loaded.codeManifest,
      taskId,
      canonicalFingerprint(loaded.codeManifest),
    );
  }
  if (Object.keys(executions).length > 0) loaded.executions = executions;
  if (loaded.state?.checks) {
    await validateChecksExecutionProvenance(loaded.state.checks, {
      target,
      packageRoot,
      taskId,
      executionArtifacts: executions,
      allowForeignCwd: true,
      artifactPath: "state.json",
    });
  }
  if (loaded.receipt?.checks) {
    await validateChecksExecutionProvenance(loaded.receipt.checks, {
      target,
      packageRoot,
      taskId,
      executionArtifacts: executions,
      allowForeignCwd: true,
      artifactPath: "receipt.json",
    });
  }
  return { manifest: manifest.value, artifacts: loaded };
}

async function exportBundleLedgerAndGates(target, taskId, packageRoot, directory, artifacts) {
  // Events
  const selectedStore = getOperationalStore(target);
  if (selectedStore) {
    async function* ledgerBytes() {
      for (const row of selectedStore.db.prepare("SELECT event_json FROM events WHERE task_id = ? ORDER BY seq").iterate(taskId)) yield `${JSON.stringify(JSON.parse(row.event_json))}\n`;
    }
    await writeFileAtomic(await assertSafePath(target, `${directory}/events.ndjson`), ledgerBytes());
    artifacts.push("events.ndjson");
  } else {
  let eventsPath = ensureWithin(target, taskArtifactPath(taskId, "events"));
  if (!(await fileExists(eventsPath))) {
    eventsPath = ensureWithin(target, ARTIFACT_PATHS.events);
  }
  if (await fileExists(eventsPath)) {
    await assertSafePath(target, `${directory}/events.ndjson`);
    await writeFileAtomic(ensureWithin(target, `${directory}/events.ndjson`), await readBytes(eventsPath));
    artifacts.push("events.ndjson");
  }
  }

  // Gates
  let gateRelativePath = `${taskDirectory(taskId)}/gates`;
  let gateDirectory = ensureWithin(target, gateRelativePath);
  const selectedGates = listOperationalArtifactNames(target, taskId, "gates");
  if (selectedGates === null && !(await fileExists(gateDirectory))) {
    gateRelativePath = ARTIFACT_PATHS.gates;
    gateDirectory = ensureWithin(target, gateRelativePath);
  }
  if (selectedGates !== null || await fileExists(gateDirectory)) {
    const entries = selectedGates !== null ? selectedGates.map(name => ({ name, isFile: () => true })) : await readdir(gateDirectory, { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
      const gateName = entry.name.slice(0, -5);
      const sourcePath = `${gateRelativePath}/${entry.name}`;
      const destinationPath = `${directory}/gates/${entry.name}`;
      const gate = await readBundleSourceJson(target, sourcePath, "gate", packageRoot);
      if (gate.value.taskId !== taskId) continue;
      await writePortableJsonArtifact(target, destinationPath, gate.value, "gate", packageRoot);
      artifacts.push(`gates/${gateName}.json`);
    }
  }

}

async function verifyBundleFileBindings(target, directory, manifest) {
  if (manifest.value.schemaVersion === 2) {
    const listed = manifest.value.files.map(file => file.path);
    if (new Set(listed).size !== listed.length || canonicalFingerprint([...listed].sort()) !== canonicalFingerprint([...manifest.value.artifacts].sort())) {
      throw Object.assign(new Error("Bundle file bindings disagree with included artifacts"), { code: "E_BUNDLE_DIGEST_INVALID" });
    }
    for (const binding of manifest.value.files) {
      const actual = await bundleFileBinding(target, `${directory}/${binding.path}`, binding.path);
      if (actual.size !== binding.size || actual.sha256 !== binding.sha256) throw Object.assign(new Error(`Bundle bytes disagree with manifest: ${binding.path}`), { code: "E_BUNDLE_DIGEST_INVALID" });
    }
  }
}

async function loadBundleQualityArtifact(target, directory, artifact, packageRoot, taskId, loaded, qualityKind) {
  const qualityArtifact = await readJsonArtifact(target, `${directory}/${artifact}`, "structural-quality", packageRoot);
  validateStructuralQualityArtifact(qualityArtifact.value, artifact);
  if (qualityArtifact.value.taskId !== taskId) {
    throw bundleBindingError("E_BUNDLE_TASK_MISMATCH", `Structural-quality ${qualityKind} taskId does not match its bundle task`);
  }
  loaded.structuralQuality ??= { baseline: null, evaluations: [] };
  if (qualityKind === "baseline") {
    if (loaded.structuralQuality.baseline) throw bundleBindingError("E_STRUCTURAL_QUALITY_EVIDENCE_STALE", "A bundle cannot contain more than one structural-quality baseline");
    loaded.structuralQuality.baseline = qualityArtifact.value;
  } else {
    loaded.structuralQuality.evaluations.push(qualityArtifact.value);
  }
}
