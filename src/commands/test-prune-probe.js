import { runPruneProbe as probe } from "../core/test-intelligence/prune.js";

export async function runTestPruneProbe({ target, packageRoot, taskId, testId } = {}) { return probe({ target, packageRoot, taskId, testId }); }
export function formatTestPruneProbeResult(result) { return `${JSON.stringify(result, null, 2)}\n`; }

