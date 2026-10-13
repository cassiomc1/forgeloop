import { getTaskTransaction, withTaskTransaction } from "./transaction.js";
import { appendProtocolEvent } from "./events.js";
import { canonicalFingerprint } from "./artifacts.js";
import {
  assertApprovalIdFormat,
  assertApprovalEventDetails,
  validateApprovalArtifact,
} from "./action-model.js";
import {
  E_ACTION_AUTHORITY_REQUIRED,
  E_ACTION_NOT_FOUND,
  E_APPROVAL_ALREADY_RESOLVED,
  E_APPROVAL_INVALID,
  E_APPROVAL_STALE,
} from "./error-codes.js";
import { isTrustedHostAuthorityContext } from "./capability-policy.js";
import { readAction } from "./actions.js";
import { readWorkState } from "./work-state.js";
import { requireNativeStore, withNativeReadScope } from "./native-storage.js";

function approvalError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function readApprovalFile(target, taskId, approvalId) {
  return withNativeReadScope(target, () => requireNativeStore(
    target,
    approvalError,
    "Approvals require canonical SQLite storage; migrate legacy operational state explicitly",
  ).readApproval(taskId, approvalId));
}

async function writeApprovalFile(target, approval) {
  const transaction = await getTaskTransaction(target);
  if (!transaction) throw approvalError("E_STORAGE_TRANSACTION_INVALID", "Approval persistence requires an active task transaction");
  return transaction.stageApproval(approval);
}

async function listApprovalFiles(target, taskId) {
  return withNativeReadScope(target, () => requireNativeStore(
    target,
    approvalError,
    "Approval listing requires canonical SQLite storage; migrate legacy operational state explicitly",
  ).listApprovals(taskId).sort((left, right) => String(left.requestedAt).localeCompare(String(right.requestedAt))));
}

function approvalBindingFields(approval) {
  return {
    taskId: approval.taskId,
    actionId: approval.actionId,
    actionFingerprint: approval.actionFingerprint,
    contractFingerprint: approval.contractFingerprint,
    taskRevision: approval.taskRevision,
    capability: approval.capability,
  };
}

function approvalFingerprintPayload(approval) {
  return {
    ...approvalBindingFields(approval),
    status: approval.status,
    decision: approval.decision ?? null,
    resolvedAt: approval.resolvedAt ?? null,
    authorityKind: approval.authorityKind ?? null,
    hostGrantRef: approval.hostGrantRef ?? null,
  };
}

/**
 * Canonical approval fingerprint. Binds the full resolved approval content —
 * including its resolution authority — so any post-authorization mutation of
 * the approval artifact is detectable during ledger replay/audit.
 */
export function approvalFingerprint(approval) {
  return canonicalFingerprint(approvalFingerprintPayload(approval));
}

export function assertApprovalFresh(approval, expectedBinding) {
  assertApprovalBinding(approval, expectedBinding);
  if (approval.status !== "APPROVED") {
    throw approvalError(E_APPROVAL_INVALID, `approval ${approval.approvalId} is not APPROVED`);
  }
  return true;
}

/**
 * Validate only the immutable binding between an approval and the current
 * action/task revision. Pending approvals use this check before they become
 * the active guidance target; approval status is intentionally evaluated by
 * the current capability policy, not by historical approval state.
 */
export function assertApprovalBinding(approval, expectedBinding) {
  if (!expectedBinding || typeof expectedBinding !== "object") {
    throw approvalError(E_APPROVAL_INVALID, "expected binding must be an object");
  }
  for (const [key, value] of Object.entries(approvalBindingFields(approval))) {
    if (expectedBinding[key] !== value) {
      throw approvalError(
        E_APPROVAL_STALE,
        `approval ${approval.approvalId} is stale: bound ${key} does not match the current task/action state`,
      );
    }
  }
  return true;
}

function assertRequestInput(input) {
  if (!input || typeof input !== "object") {
    throw approvalError(E_APPROVAL_INVALID, "approval input must be an object");
  }
  assertApprovalIdFormat(input.approvalId);
  for (const key of ["actionId", "actionFingerprint", "contractFingerprint"]) {
    if (typeof input[key] !== "string" || !input[key]) {
      throw approvalError(E_APPROVAL_INVALID, `approval input.${key} must be a non-empty string`);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(input.actionFingerprint)) {
    throw approvalError(
      E_APPROVAL_INVALID,
      "approval input.actionFingerprint must be a lowercase sha256 hex digest",
    );
  }
  if (!/^[a-f0-9]{64}$/.test(input.contractFingerprint)) {
    throw approvalError(
      E_APPROVAL_INVALID,
      "approval input.contractFingerprint must be a lowercase sha256 hex digest",
    );
  }
  if (!Number.isInteger(input.taskRevision) || input.taskRevision < 0) {
    throw approvalError(E_APPROVAL_INVALID, "approval input.taskRevision must be a non-negative integer");
  }
  if (input.reason !== undefined && input.reason !== null && (typeof input.reason !== "string" || input.reason.length > 512)) {
    throw approvalError(E_APPROVAL_INVALID, "approval input.reason must be a string of at most 512 characters");
  }
}

export async function requestApproval(target, { packageRoot, taskId, input }) {
  assertRequestInput(input);
  return withTaskTransaction(
    { target, taskId, operation: "request-approval" },
    async () => {
      const existing = await readApprovalFile(target, taskId, input.approvalId);
      if (existing) {
        validateApprovalArtifact(existing);
        const existingBinding = approvalBindingFields(existing);
        const nextBinding = { ...approvalBindingFields({ ...input }), taskId };
        for (const key of Object.keys(existingBinding)) {
          if (existingBinding[key] !== nextBinding[key]) {
            throw approvalError(
              E_APPROVAL_INVALID,
              `approval ${input.approvalId} already exists with a different immutable binding`,
            );
          }
        }
        return { created: false, idempotent: true, approval: existing };
      }

      const now = new Date().toISOString();
      const approval = {
        schemaVersion: 1,
        taskId,
        approvalId: input.approvalId,
        actionId: input.actionId,
        actionFingerprint: input.actionFingerprint,
        contractFingerprint: input.contractFingerprint,
        taskRevision: input.taskRevision,
        capability: input.capability,
        status: "PENDING",
        requestedAt: now,
        reason: input.reason ?? null,
      };
      validateApprovalArtifact(approval);

      await writeApprovalFile(target, approval);
      await appendProtocolEvent(target, {
        taskId,
        event: "APPROVAL_REQUESTED",
        fingerprint: approval.contractFingerprint,
        details: {
          approvalId: approval.approvalId,
          actionId: approval.actionId,
          actionFingerprint: approval.actionFingerprint,
          contractFingerprint: approval.contractFingerprint,
          taskRevision: approval.taskRevision,
          capability: approval.capability,
        },
      }, packageRoot, { taskId });

      return { created: true, idempotent: false, approval };
    },
  );
}

export async function resolveApproval(target, {
  packageRoot,
  taskId,
  approvalId,
  decision,
  authorityKind,
  hostGrantRef,
  authorityContext,
  reason,
}) {
  assertApprovalIdFormat(approvalId);
  if (!["APPROVED", "REJECTED"].includes(decision)) {
    throw approvalError(E_APPROVAL_INVALID, "decision must be APPROVED or REJECTED");
  }
  if (!["CALLER_ACKNOWLEDGED", "HOST_ATTESTED"].includes(authorityKind)) {
    throw approvalError(E_APPROVAL_INVALID, "authorityKind must be CALLER_ACKNOWLEDGED or HOST_ATTESTED");
  }
  if (authorityKind === "HOST_ATTESTED") {
    if (!isTrustedHostAuthorityContext(authorityContext)) {
      throw approvalError(
        E_ACTION_AUTHORITY_REQUIRED,
        "HOST_ATTESTED approval resolution requires a trusted host-boundary authority context",
      );
    }
    if (typeof hostGrantRef !== "string" || !hostGrantRef || hostGrantRef.length > 256) {
      throw approvalError(
        E_APPROVAL_INVALID,
        "HOST_ATTESTED resolution requires a bounded non-empty hostGrantRef supplied by the host boundary",
      );
    }
    if (typeof authorityContext?.grantRef === "string" && authorityContext.grantRef !== hostGrantRef) {
      throw approvalError(E_ACTION_AUTHORITY_REQUIRED, "hostGrantRef does not match the trusted host authority context");
    }
  } else if (hostGrantRef !== undefined && hostGrantRef !== null) {
    throw approvalError(
      E_APPROVAL_INVALID,
      "CALLER_ACKNOWLEDGED resolutions cannot carry a hostGrantRef",
    );
  }
  if (reason !== undefined && reason !== null && (typeof reason !== "string" || reason.length > 512)) {
    throw approvalError(E_APPROVAL_INVALID, "reason must be a string of at most 512 characters");
  }

  return withTaskTransaction(
    { target, taskId, operation: "resolve-approval" },
    async () => {
      const current = await readApprovalFile(target, taskId, approvalId);
      if (!current) {
        throw approvalError(E_ACTION_NOT_FOUND, `approval ${approvalId} does not exist for task ${taskId}`);
      }
      validateApprovalArtifact(current);
      if (current.status !== "PENDING") {
        throw approvalError(
          E_APPROVAL_ALREADY_RESOLVED,
          `approval ${approvalId} is already ${current.status}`,
        );
      }

      const resolved = {
        ...current,
        status: decision,
        decision,
        resolvedAt: new Date().toISOString(),
        authorityKind,
        hostGrantRef: authorityKind === "HOST_ATTESTED" ? hostGrantRef : null,
        reason: reason ?? current.reason ?? null,
      };
      validateApprovalArtifact(resolved);
      await writeApprovalFile(target, resolved);

      const details = {
        approvalId: resolved.approvalId,
        actionId: resolved.actionId,
        actionFingerprint: resolved.actionFingerprint,
        decision,
        authorityKind,
      };
      if (authorityKind === "HOST_ATTESTED") details.hostGrantRef = hostGrantRef;
      assertApprovalEventDetails({ event: "APPROVAL_RESOLVED", details });
      await appendProtocolEvent(target, {
        taskId,
        event: "APPROVAL_RESOLVED",
        fingerprint: resolved.contractFingerprint,
        details,
      }, packageRoot, { taskId });

      return resolved;
    },
  );
}

export async function readApproval(target, { packageRoot, taskId, approvalId }) {
  const approval = await readApprovalFile(target, taskId, approvalId);
  if (!approval) {
    throw approvalError(E_ACTION_NOT_FOUND, `approval ${approvalId} does not exist for task ${taskId}`);
  }
  return validateApprovalArtifact(approval);
}

export async function listApprovals(target, { packageRoot, taskId }) {
  const approvals = await listApprovalFiles(target, taskId);
  return approvals.map((approval) => validateApprovalArtifact(approval));
}

export async function validateApprovalForAction(target, {
  packageRoot,
  taskId,
  action,
  actionId,
  approvalId,
  requireApproved = true,
}) {
  const currentAction = action ?? await readAction(target, { packageRoot, taskId, actionId });
  if (currentAction.taskId !== taskId) {
    throw approvalError(E_APPROVAL_STALE, `action ${currentAction.actionId} belongs to a different task`);
  }
  const state = await readWorkState(target, { packageRoot, taskId });
  if (!state) {
    throw approvalError(E_APPROVAL_INVALID, `task ${taskId} has no canonical work state`);
  }
  const approval = await readApproval(target, { packageRoot, taskId, approvalId });
  assertApprovalBinding(approval, {
    taskId,
    actionId: currentAction.actionId,
    actionFingerprint: currentAction.actionFingerprint,
    contractFingerprint: state.contractFingerprint,
    taskRevision: state.revision ?? 0,
    capability: currentAction.capability,
  });
  if (requireApproved && approval.status !== "APPROVED") {
    throw approvalError(E_APPROVAL_INVALID, `approval ${approval.approvalId} is not APPROVED`);
  }
  return approval;
}

/**
 * Validate that a resolved approval still hashes to the fingerprint bound at
 * action authorization. Any post-authorization mutation of the approval
 * artifact fails closed (INV-FINAL-APPROVAL-01).
 */
export async function validateBoundApprovalFingerprint(target, {
  packageRoot,
  taskId,
  approvalId,
  expectedFingerprint,
}) {
  if (
    typeof expectedFingerprint !== "string"
    || !/^[a-f0-9]{64}$/.test(expectedFingerprint)
  ) {
    throw approvalError(
      E_APPROVAL_INVALID,
      "expected approval fingerprint must be a lowercase sha256 hex digest",
    );
  }

  const approval = await readApproval(target, {
    packageRoot,
    taskId,
    approvalId,
  });

  const actualFingerprint = approvalFingerprint(approval);

  if (actualFingerprint !== expectedFingerprint) {
    throw approvalError(
      E_APPROVAL_INVALID,
      `approval ${approvalId} no longer matches the fingerprint bound at action authorization`,
    );
  }

  return {
    approval,
    fingerprint: actualFingerprint,
  };
}
