import { taskActionPath, taskApprovalPath, taskExecutionPath } from "../core/task-paths.js";
import { putAction, putApproval, putExecution } from "./repository.js";

function definition({ table, idColumn, payloadId, pathBuilder, writer, conflictCode = null }) {
  return Object.freeze({ table, idColumn, payloadId, pathBuilder, writer, conflictCode });
}

/**
 * The indexed operational records share one namespace contract.  Keep their
 * table columns, payload identity field, canonical path builder, and conflict
 * classification together so reads, staging, listing, and commit dispatch do
 * not grow separate action/approval/execution copies.
 */
export const RECORD_DEFINITIONS = Object.freeze({
  action: definition({
    table: "actions",
    idColumn: "action_id",
    payloadId: "actionId",
    pathBuilder: taskActionPath,
    writer: putAction,
    conflictCode: "E_ACTION_STATE_MISMATCH",
  }),
  approval: definition({
    table: "approvals",
    idColumn: "approval_id",
    payloadId: "approvalId",
    pathBuilder: taskApprovalPath,
    writer: putApproval,
    conflictCode: "E_APPROVAL_ALREADY_RESOLVED",
  }),
  execution: definition({
    table: "executions",
    idColumn: "execution_id",
    payloadId: "executionId",
    pathBuilder: taskExecutionPath,
    writer: putExecution,
  }),
});

/** Native artifact schemas whose canonical path is an indexed record table. */
export const RECORD_SCHEMA_KINDS = Object.freeze({
  action: "action",
  approval: "approval",
  execution: "execution",
});
