import path from "node:path";
import { assertSchema, readSchema } from "../core/schema-validation.js";
import { assertJsonBytes, assertJsonLimits } from "../core/json-safety.js";
import { validateTaskDescriptor } from "../core/task-descriptor.js";
import { validateContract } from "../core/contract.js";
import { validateCodeManifest } from "../core/code-manifest.js";
import { validateActionArtifact, validateApprovalArtifact } from "../core/action-model.js";
import { validateEventLedger, validateStateLedgerCoherence } from "../core/events.js";
import { readWorkState } from "../core/work-state.js";
import { validateCheckExecutionProvenance } from "../core/completion-artifacts.js";
import { withOperationalStore } from "./unit-of-work.js";

const ARTIFACT_SCHEMAS = Object.freeze({
  contract: "current-contract", route: "routing-result", preflight: "preflight",
  continuity: "continuity", receipt: "execution-receipt", policySnapshot: "policy-snapshot",
  recovery: "task-recovery", workspaceBinding: "workspace-binding", responsibility: "responsibility",
  verificationScope: "verification-scope", usage: "usage", testUtility: "test-utility",
  gate: "gate", handoff: "handoff-envelope", decision: "semantic-decision",
  evaluation: "trajectory-evaluation", structuralQuality: "structural-quality",
});

function artifactSchema(row) {
  if (row.kind !== "attestation") return ARTIFACT_SCHEMAS[row.kind];
  const name = path.posix.basename(row.artifact_id);
  return name === "code-manifest" ? "code-manifest" : name === "statement" ? "in-toto-statement" : null;
}

/** Validate imported payloads with their existing protocol schemas and rules. */
export async function validateMigrationDatabase(db, { target, packageRoot }) {
  const schemas = new Map();
  const validate = async (text, name, label, taskId = null) => {
    if (!name) throw Object.assign(new Error(`Unmapped operational artifact: ${label}`), { code: "E_STORAGE_MIGRATION_UNMAPPED_SOURCE" });
    assertJsonBytes(text, label);
    const value = JSON.parse(text);
    assertJsonLimits(value, label);
    if (!schemas.has(name)) schemas.set(name, await readSchema(name, packageRoot));
    assertSchema(value, schemas.get(name), label);
    if (taskId && value.taskId !== undefined && value.taskId !== taskId) {
      throw Object.assign(new Error(`Artifact identity differs from its task: ${label}`), { code: "E_STORAGE_PAYLOAD_MISMATCH" });
    }
    return value;
  };
  for (const row of db.prepare("SELECT task_id, descriptor_json FROM tasks ORDER BY task_id").iterate()) {
    await validateTaskDescriptor(await validate(row.descriptor_json, "task-descriptor", row.task_id, row.task_id), packageRoot);
  }
  for (const row of db.prepare("SELECT task_id, kind, artifact_id, payload_json FROM task_artifacts ORDER BY task_id, kind, artifact_id").iterate()) {
    const name = artifactSchema(row);
    const value = await validate(row.payload_json, name, `${row.task_id}/${row.kind}/${row.artifact_id}`, row.task_id);
    if (row.kind === "contract") await validateContract(value, packageRoot);
    if (name === "code-manifest") await validateCodeManifest(value, packageRoot);
  }
  for (const [table, name, validator] of [["actions", "action", validateActionArtifact], ["approvals", "approval", validateApprovalArtifact], ["executions", "execution", null]]) {
    for (const row of db.prepare(`SELECT task_id, payload_json FROM ${table} ORDER BY task_id, payload_json`).iterate()) {
      const value = await validate(row.payload_json, name, table, row.task_id);
      validator?.(value);
    }
  }
  return withOperationalStore({ db, target }, async () => {
    const tasks = [];
    for (const row of db.prepare("SELECT task_id FROM tasks ORDER BY task_id").iterate()) {
      const state = await readWorkState(target, { taskId: row.task_id, packageRoot });
      for (const check of state?.checks ?? []) {
        if (check.provenance === "FORGELOOP_EXECUTED") {
          await validateCheckExecutionProvenance(check, { target, packageRoot, taskId: row.task_id });
        }
      }
      const ledger = await validateEventLedger(target, packageRoot, { taskId: row.task_id });
      const errors = [...ledger.errors, ...(state ? validateStateLedgerCoherence(state, ledger.events) : [])];
      if (errors.length) throw Object.assign(new Error(`Imported task failed domain validation: ${row.task_id}`), { code: "E_STORAGE_MIGRATION_VALIDATION_FAILED", errors });
      const head = ledger.events.at(-1);
      tasks.push({ taskId: row.task_id, phase: state?.phase ?? null, revision: state?.revision ?? null, events: ledger.events.length, head: head ? { seq: head.seq, hash: head.hash } : null });
    }
    return { tasks, schemas: [...schemas.keys()].sort() };
  });
}
