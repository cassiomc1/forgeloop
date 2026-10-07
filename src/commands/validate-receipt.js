import { assertSafePath, ensureWithin, readBytes } from "../core/filesystem.js";
import { validateReceipt } from "../core/receipt.js";
import { assertJsonBytes, assertJsonLimits } from "../core/json-safety.js";
import { ARTIFACT_PATHS } from "../core/artifacts.js";
import { taskArtifactPath } from "../core/task-paths.js";
import { withResolvedTask } from "../core/task-command.js";
import { readOperationalText } from "../storage/operational-context.js";
import { isOperationalArtifactPath, needsExistingProjectScope, withExistingProjectScope } from "../storage/existing-project-scope.js";

async function validateReceiptFile(target, packageRoot, relativeFile) {
  await assertSafePath(target, relativeFile);
  const receiptPath = ensureWithin(target, relativeFile);
  let receipt;
  try {
    const operational = readOperationalText(target, relativeFile);
    if (operational.selected && operational.text === null) throw new Error("Receipt is missing from canonical storage");
    const bytes = operational.selected ? Buffer.from(operational.text, "utf8") : await readBytes(receiptPath);
    assertJsonBytes(bytes, relativeFile);
    receipt = JSON.parse(bytes.toString("utf8"));
    assertJsonLimits(receipt, relativeFile);
  } catch (error) {
    throw new Error(`Unable to parse receipt ${relativeFile}: ${error.message}`);
  }
  try {
    return await validateReceipt(receipt, packageRoot);
  } catch (error) {
    throw new Error(`Invalid receipt ${relativeFile}: ${error.message}`);
  }
}

/**
 * Validates an execution receipt with deterministic resolution precedence:
 *   1. explicit `--file` validates exactly that relative file;
 *   2. explicit or context-resolved `--task` validates that task's namespaced
 *      `.forgeloop/task-state/<taskKey>/execution-receipt.json`;
 *   3. a single active task is resolved automatically through the shared
 *      task-command resolver;
 *   4. when no task descriptors exist, the legacy singleton
 *      `.forgeloop/execution-receipt.json` compatibility path is preserved.
 * Multiple active tasks without `--task`/`--file` fail with E_TASK_AMBIGUOUS
 * through the shared resolver instead of silently falling back to the legacy
 * singleton.
 */
export async function runValidateReceipt({
  target,
  packageRoot,
  file = null,
  taskId = null,
} = {}) {
  if ((!file || isOperationalArtifactPath(file)) && await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => runValidateReceipt({ target, packageRoot, file, taskId }), { readOnly: true });
  }
  if (file) {
    return validateReceiptFile(target, packageRoot, file);
  }
  return withResolvedTask(target, { taskId, packageRoot }, async (ctx) => {
    const relativeFile = ctx
      ? taskArtifactPath(ctx.taskId, "receipt")
      : ARTIFACT_PATHS.receipt;
    return validateReceiptFile(target, packageRoot, relativeFile);
  });
}
