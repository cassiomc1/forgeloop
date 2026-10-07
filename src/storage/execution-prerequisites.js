import { assertStoreTaskMutationAllowed } from "./task-guards.js";
import { assertDiagnosingToCorrectingTransition } from "../core/phase.js";
import { resolveCurrentCycleDiagnostic } from "../core/diagnostic-projection.js";
import { preparePhaseReceipt } from "../core/phase.js";
import { createWorkState } from "../core/work-state.js";
import { canonicalFingerprint } from "../core/artifacts.js";
import { validateContract } from "../core/contract.js";
import { validateLedgerEvents } from "../core/events.js";
import { evaluateStartExecutionPrerequisites, prerequisiteError } from "../core/execution-prerequisites.js";
import { assertRouteInvariants } from "../core/router.js";
import { assertSchema, readSchema } from "../core/schema-validation.js";
import { currentRepositoryFingerprint } from "../core/repository.js";
import { classifyWorkState, readRequiredArtifactFingerprints } from "../core/work-state.js";
import { taskArtifactPath, taskGatePath, taskDirectory } from "../core/task-paths.js";
import { assertSecretFree } from "../core/receipt.js";
import { artifactByteDigest } from "./artifact-bytes.js";
import { TASK_ARTIFACT_FILES } from "../core/task-paths.js";
import { findTaskById, listArtifacts, listEvents } from "./repository.js";

function snapshot(db, taskId) {
  return { task: findTaskById(db, taskId), artifacts: listArtifacts(db, taskId), events: listEvents(db, taskId) };
}

/** Gather external observations without holding a SQLite writer transaction. */
export async function prepareStoreExecutionPrerequisites(db, { target, packageRoot, taskId }) {
  assertStoreTaskMutationAllowed(db, taskId);
  const observed = snapshot(db, taskId);
  const fingerprint = canonicalFingerprint(observed);
  const state = observed.task?.state ?? null;
  const artifact = async (kind, schemaName, logicalPath, id = "current") => {
    const record = observed.artifacts.find(item => item.kind === kind && item.artifactId === id);
    if (!record) {
      const error = new Error(`Required artifact is missing: ${logicalPath}`);
      error.code = "ARTIFACT_MISSING";
      throw error;
    }
    assertSecretFree(record.payload);
    assertSchema(record.payload, await readSchema(schemaName, packageRoot), logicalPath);
    if (canonicalFingerprint(record.payload) !== record.fingerprint) {
      const error = new Error(`Stored artifact fingerprint does not match payload: ${logicalPath}`);
      error.code = "E_STORAGE_ARTIFACT_INVALID";
      throw error;
    }
    return { value: record.payload, fingerprint: record.fingerprint, path: logicalPath };
  };
  const readers = {
    async readContract() {
      const result = await artifact("contract", "current-contract", taskArtifactPath(taskId, "contract"));
      await validateContract(result.value, packageRoot);
      return result;
    },
    async readRoute() {
      const result = await artifact("route", "routing-result", taskArtifactPath(taskId, "route"));
      assertRouteInvariants(result.value);
      return result;
    },
    readState: async () => state,
    readEvents: async () => observed.events,
    validateLedger: async () => validateLedgerEvents(observed.events),
    readReceipt: () => artifact("receipt", "execution-receipt", taskArtifactPath(taskId, "receipt")),
    readPreflight: () => artifact("preflight", "preflight", taskArtifactPath(taskId, "preflight")),
    readGate: (_target, gate) => artifact("gate", "gate", taskGatePath(taskId, gate), gate),
    async classifyState({ maxAgeMs }) {
      const contract = await readers.readContract();
      const required = state?.requiredArtifacts ?? [];
      // Resolve byte-bound references through imported byte evidence, never a filesystem mirror.
      const operational = required.filter(item => item.path.startsWith(`${taskDirectory(taskId)}/`));
      const external = required.filter(item => !operational.includes(item));
      const current = await readRequiredArtifactFingerprints(target, external);
      current.push(...operational.map(item => {
        const relative = item.path.slice(taskDirectory(taskId).length + 1);
        const [directory, filename] = relative.split("/");
        const kind = filename
          ? ({ gates: "gate", handoffs: "handoff", decisions: "decision", attestations: "attestation" })[directory]
          : Object.entries(TASK_ARTIFACT_FILES).find(([, value]) => value === relative)?.[0];
        const id = filename ? filename.replace(/\.json$/, "") : "current";
        const record = observed.artifacts.find(entry => entry.kind === kind && entry.artifactId === id);
        return record
          ? { path: item.path, sha256: artifactByteDigest(record), status: "present" }
          : { path: item.path, sha256: null, status: "missing" };
      }));
      return classifyWorkState(state, { repositoryFingerprint: await currentRepositoryFingerprint(target), contractFingerprint: contract.fingerprint, requiredArtifacts: current, maxAgeMs });
    },
  };
  const result = await evaluateStartExecutionPrerequisites({ target, packageRoot, taskId, state, readers });
  const error = prerequisiteError(result);
  if (error) throw error;
  assertDiagnosingToCorrectingTransition({ state, events: observed.events, resolveDiagnosis: resolveCurrentCycleDiagnostic });
  const next = createWorkState({ ...state, phase: "CORRECTING", previousPhase: "DIAGNOSING", revision: (state.revision ?? 0) + 1, lastUpdated: new Date().toISOString() });
  const receipt = await preparePhaseReceipt({ target, packageRoot, taskId, state, next, receiptRel: taskArtifactPath(taskId, "receipt"), readers });
  return {
    next,
    receipt,
    assertCurrent() {
      if (canonicalFingerprint(snapshot(db, taskId)) !== fingerprint) {
        const error = new Error("Store prerequisite evidence changed after external observation");
        error.code = "E_STATE_REVISION_CONFLICT";
        throw error;
      }
    },
    result,
  };
}
