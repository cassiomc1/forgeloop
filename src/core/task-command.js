import { resolveTaskContext, TASK_SELECTION_MODES } from "./task-context.js";
import { withTaskTransaction } from "./transaction.js";
import { assertTaskMutationAllowed } from "./task-claim-state.js";
import { assertWorkspaceBinding } from "./workspace-binding.js";
import { getOperationalStore } from "../storage/operational-context.js";
import { withTaskLock } from "./task-lock.js";

export async function withResolvedTask(
  target,
  options = {},
  callback,
  { explicitRequired = false } = {},
) {
  const taskOption = options.taskId ?? options.task ?? null;
  const taskContext = await resolveTaskContext(target, {
    taskId: taskOption,
    explicitRequired,
    packageRoot: options.packageRoot,
    selectionMode: TASK_SELECTION_MODES.READ,
  });

  return callback(taskContext);
}

export async function withTaskMutation(
  target,
  options = {},
  operation = "mutation",
  callback,
  { explicitRequired = false, skipWorkspaceBinding = false } = {},
) {
  if (!getOperationalStore(target)) {
    const { withProjectStorage } = await import("../storage/project-boundary.js");
    return withProjectStorage(target, () => withTaskMutation(target, options, operation, callback, { explicitRequired, skipWorkspaceBinding }));
  }
  const taskOption = options.taskId ?? options.task ?? null;
  const taskContext = await resolveTaskContext(target, {
    taskId: taskOption,
    explicitRequired: explicitRequired || Boolean(getOperationalStore(target)),
    packageRoot: options.packageRoot,
    selectionMode: TASK_SELECTION_MODES.MUTATION,
  });

  if (taskContext) {
    if (getOperationalStore(target) && ["run-action", "run-check"].includes(operation)) {
      return withTaskLock(target, taskContext.taskId, operation, async () => {
        await withTaskTransaction({ target, taskId: taskContext.taskId, operation: `${operation}:prepare`, packageRoot: options.packageRoot }, async () => {
          await assertTaskMutationAllowed(target, { taskId: taskContext.taskId, packageRoot: options.packageRoot });
          if (!skipWorkspaceBinding) await assertWorkspaceBinding(target, { taskId: taskContext.taskId, packageRoot: options.packageRoot, operation });
        });
        // External work runs with a durable semantic reservation and no open
        // database transaction. Its domain services commit intent/outcome in
        // separate transactions, so a crash cannot erase a durable start.
        const result = await callback(taskContext);
        await withTaskTransaction({ target, taskId: taskContext.taskId, operation, packageRoot: options.packageRoot, recordCommitEvent: true }, () => undefined);
        return result;
      });
    }
    return withTaskTransaction({ target, taskId: taskContext.taskId, operation, packageRoot: options.packageRoot, recordCommitEvent: true }, async (transaction) => {
      await assertTaskMutationAllowed(target, { taskId: taskContext.taskId, packageRoot: options.packageRoot });
      if (!skipWorkspaceBinding) {
        await assertWorkspaceBinding(target, {
          taskId: taskContext.taskId,
          packageRoot: options.packageRoot,
          operation,
        });
      }
      return callback({ ...taskContext, transaction });
    });
  }

  return callback(null);
}
